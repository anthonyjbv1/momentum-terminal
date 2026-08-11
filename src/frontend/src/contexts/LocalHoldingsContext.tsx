/**
 * LocalHoldingsContext
 *
 * Stores all user holdings entirely in localStorage so that all 5 active
 * indices work correctly — not just "AI Index" which is the only one
 * registered in the Motoko backend.
 *
 * Holdings are keyed by index name and tracked as:
 *   units: number         — total units allocated
 *   accruedYield: number  — synthetic yield (starts at 0, increments via YieldAccrual)
 *   yieldStartTime: bigint — timestamp (nanoseconds) of first allocation
 *   costBasis: number     — total dollars paid across all allocations (locked-in)
 *
 * pnlUnlockedMap persists the one-way hasUnlockedPnL flag per index.
 * RESET RULE: when units drop to 0 via clearHolding, the pnlUnlocked flag
 * is also cleared so that re-entry is treated as a brand-new position at 0% yield.
 *
 * On the very first session this context seeds 100 units of each Golden 5 index
 * at their known fallback buy prices, recording the cost basis for P&L tracking.
 */

import type React from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { recordOrderFlowEvent } from "../services/netOrderFlowEngine";
import type { Holding } from "../types/backendEnums";
import { useAuth } from "./AuthContext";
import { _registerHoldingCallbacks } from "./WalletContext";

// ── Storage key suffixes — prefixed with userId at runtime ────────────────────
// Bumped to v4 to force a clean re-seed with correct costBasis values
const HOLDINGS_VERSION_SUFFIX = "sentimentam_local_holdings_v4";
const HOLDINGS_STORAGE_SUFFIX = "sentimentam_local_holdings_v5";
const HOLDINGS_SEEDED_SUFFIX = "sentimentam_holdings_seeded_v6";
const ALLOC_100_HOLDINGS_SUFFIX = "sentimentam_100_alloc_holdings_v1";
// Separate key so we never wipe unlock state when bumping holdings version
const PNL_UNLOCKED_SUFFIX = "sentimentam_pnl_unlocked_v1";
const KEY_MIGRATION_SUFFIX = "sentimentam_key_migration_v1";
const SHORT_COST_BASIS_SUFFIX = "sentimentam_short_cost_basis_v1";
const LOCAL_VOLUME_SUFFIX = "sentimentam_local_volume_v1";

// ── One-time localStorage key migration ─────────────────────────────────────
// Renames the original 3 engine keys (which carried an 'Index' suffix) to
// their new display-name-aligned forms used everywhere else in the codebase.
const KEY_RENAMES: Record<string, string> = {
  "Fed Policy Sentiment Index": "Fed Policy Sentiment",
  "MENA Stability Sentiment Index": "MENA Stability Sentiment",
  "AI & Tech Regulation Sentiment Index": "AI Regulation Risk Sentiment",
};

function migrateLocalStorageKeys(userId: string): void {
  try {
    const migrationKey = `${userId}_${KEY_MIGRATION_SUFFIX}`;
    if (localStorage.getItem(migrationKey) === "done") return;

    // Migrate holdings
    const holdingsKey = `${userId}_${HOLDINGS_STORAGE_SUFFIX}`;
    const rawHoldings = localStorage.getItem(holdingsKey);
    if (rawHoldings) {
      try {
        const obj = JSON.parse(rawHoldings) as Record<string, unknown>;
        const migrated: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(obj)) {
          migrated[KEY_RENAMES[key] ?? key] = value;
        }
        localStorage.setItem(holdingsKey, JSON.stringify(migrated));
      } catch {
        // Malformed JSON — leave as-is
      }
    }

    // Migrate P&L unlock flags
    const pnlKey = `${userId}_${PNL_UNLOCKED_SUFFIX}`;
    const rawPnl = localStorage.getItem(pnlKey);
    if (rawPnl) {
      try {
        const obj = JSON.parse(rawPnl) as Record<string, unknown>;
        const migrated: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(obj)) {
          migrated[KEY_RENAMES[key] ?? key] = value;
        }
        localStorage.setItem(pnlKey, JSON.stringify(migrated));
      } catch {
        // Malformed JSON — leave as-is
      }
    }

    localStorage.setItem(migrationKey, "done");
  } catch {
    // localStorage unavailable — skip silently
  }
}

function k(userId: string, suffix: string): string {
  return `${userId}_${suffix}`;
}

const ALLOC_100_SEEDS: { name: string; price: number }[] = [
  { name: "AI Regulation Risk Sentiment", price: 75.0 },
  { name: "Fed Policy Sentiment", price: 50.0 },
  { name: "MENA Stability Sentiment", price: 48.5 },
];

// ── Seed prices (must match WalletContext GOLDEN_5_SEEDS) ─────────────────────
const GOLDEN_5_SEEDS: { name: string; buyPrice: number }[] = [
  { name: "AI Regulation Risk Sentiment", buyPrice: 73.0 },
  { name: "Fed Policy Sentiment", buyPrice: 48.0 },
  { name: "MENA Stability Sentiment", buyPrice: 46.5 },
];

const GOLDEN_5_SEED_PRICE_MAP: Record<string, number> = Object.fromEntries(
  GOLDEN_5_SEEDS.map(({ name, buyPrice }) => [name, buyPrice]),
);

const SEED_UNITS = 100;

// ── Types ─────────────────────────────────────────────────────────────────────

export type LocalHoldingsMap = Map<string, Holding>;
export type CostBasisMap = Map<string, number>;
export type PnlUnlockedMap = Map<string, boolean>;

interface LocalHoldingsContextValue {
  /** All holdings as a [name, Holding][] array — matches backend format */
  holdings: Array<[string, Holding]>;
  /** Total dollars paid per index (locked-in cost basis). Key = index name. */
  costBasisMap: CostBasisMap;
  /**
   * One-way P&L unlock flag per index.
   * Resets to false when the position is fully closed (units → 0).
   */
  pnlUnlockedMap: PnlUnlockedMap;
  /** Total dollars paid per short position. Key = index name. */
  shortCostBasisMap: Map<string, number>;
  /** Record dollars spent opening a short position. Accumulates across top-ups. */
  addShortCostBasis: (indexName: string, dollars: number) => void;
  /** Cumulative local buy volume per index (dollars). Merges with canister volume for Vol. display. */
  localVolumeMap: Map<string, number>;
  /** Add units to an index holding. costBasis = dollars spent on this allocation. */
  addHolding: (indexName: string, units: number, costBasis?: number) => void;
  /** Remove all units from an index holding. Resets cost basis and P&L unlock flag. */
  clearHolding: (indexName: string) => void;
  /**
   * B5: Partial redemption — reduce position by unitsToRedeem.
   * If unitsToRedeem === currentUnits, delegates to clearHolding().
   * Validates: unitsToRedeem > 0 and <= currentUnits.
   * Leaves allocationTimestamp unchanged on the remaining position.
   */
  redeemPartialHolding: (indexName: string, unitsToRedeem: number) => void;
  /**
   * Permanently unlock P&L view for a specific index.
   * This is a one-way operation: calling it has no effect if already true.
   */
  unlockPnL: (indexName: string) => void;
  /** True until the context has initialised from localStorage */
  isLoading: boolean;
}

const LocalHoldingsContext = createContext<LocalHoldingsContextValue | null>(
  null,
);

// ── PnlUnlocked helpers ───────────────────────────────────────────────────────

function loadPnlUnlocked(userId: string): PnlUnlockedMap {
  try {
    const raw = localStorage.getItem(k(userId, PNL_UNLOCKED_SUFFIX));
    if (!raw) return new Map();
    const obj = JSON.parse(raw) as Record<string, boolean>;
    return new Map(Object.entries(obj).filter(([, v]) => v === true));
  } catch {
    return new Map();
  }
}

function savePnlUnlocked(userId: string, map: PnlUnlockedMap): void {
  try {
    const obj: Record<string, boolean> = {};
    for (const [k2, v] of map) if (v) obj[k2] = true;
    localStorage.setItem(k(userId, PNL_UNLOCKED_SUFFIX), JSON.stringify(obj));
  } catch {
    // ignore storage errors
  }
}

// ── Serialization helpers ─────────────────────────────────────────────────────

interface SerializedHolding {
  units: number;
  accruedYield: number;
  yieldStartTimeMs: number; // stored as ms number for JSON compatibility
  costBasis: number; // total locked-in cost in dollars
}

function serialize(map: LocalHoldingsMap, costBasisMap: CostBasisMap): string {
  const obj: Record<string, SerializedHolding> = {};
  for (const [name, h] of map) {
    obj[name] = {
      units: h.units,
      accruedYield: h.accruedYield,
      yieldStartTimeMs: Number(h.yieldStartTime / BigInt(1_000_000)),
      costBasis: costBasisMap.get(name) ?? 0,
    };
  }
  return JSON.stringify(obj);
}

function deserialize(raw: string): {
  holdingsMap: LocalHoldingsMap;
  costBasisMap: CostBasisMap;
} {
  const holdingsMap = new Map<string, Holding>();
  const costBasisMap = new Map<string, number>();
  try {
    const obj = JSON.parse(raw) as Record<string, SerializedHolding>;
    for (const [name, sh] of Object.entries(obj)) {
      const yieldStartNs =
        BigInt(Math.round(sh.yieldStartTimeMs)) * BigInt(1_000_000);
      holdingsMap.set(name, {
        units: sh.units,
        accruedYield: sh.accruedYield,
        yieldStartTime: yieldStartNs,
        allocationTimestamp: yieldStartNs,
        assetName: name,
      });

      // Fallback: if costBasis is missing/zero but units exist, use seed price
      let costBasis = sh.costBasis ?? 0;
      if (costBasis === 0 && sh.units > 0) {
        const seedPrice = GOLDEN_5_SEED_PRICE_MAP[name];
        if (seedPrice !== undefined) {
          costBasis = seedPrice * sh.units;
        }
      }
      costBasisMap.set(name, costBasis);
    }
  } catch {
    // ignore parse errors — return empty maps
  }
  return { holdingsMap, costBasisMap };
}

function loadFromStorage(userId: string): {
  holdingsMap: LocalHoldingsMap;
  costBasisMap: CostBasisMap;
} {
  try {
    const raw = localStorage.getItem(k(userId, HOLDINGS_STORAGE_SUFFIX));
    if (!raw) return { holdingsMap: new Map(), costBasisMap: new Map() };
    return deserialize(raw);
  } catch {
    return { holdingsMap: new Map(), costBasisMap: new Map() };
  }
}

function saveToStorage(
  userId: string,
  map: LocalHoldingsMap,
  costBasisMap: CostBasisMap,
): void {
  try {
    localStorage.setItem(
      k(userId, HOLDINGS_STORAGE_SUFFIX),
      serialize(map, costBasisMap),
    );
  } catch {
    // ignore storage errors
  }
}

// ── Provider ──────────────────────────────────────────────────────────────────

export function LocalHoldingsProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { userAccount } = useAuth();
  const userId = userAccount?.email ?? null;

  const [holdingsMap, setHoldingsMap] = useState<LocalHoldingsMap>(new Map());
  const [costBasisMap, setCostBasisMap] = useState<CostBasisMap>(new Map());
  const [shortCostBasisMap, setShortCostBasisMap] = useState<Map<string, number>>(new Map());
  const [localVolumeMap, setLocalVolumeMap] = useState<Map<string, number>>(new Map());
  const [pnlUnlockedMap, setPnlUnlockedMap] = useState<PnlUnlockedMap>(
    new Map(),
  );
  const [isLoading, setIsLoading] = useState(true);
  const seededRef = useRef(false);
  const loadedForRef = useRef<string | null>(null);

  // Load from localStorage on mount or when userId changes.
  // Migration: if a v3 holdings key exists (corrupted holdings created at the
  // broken 0.50 buy price), clear it before loading so users start clean.
  useEffect(() => {
    if (!userId) return;
    if (loadedForRef.current === userId) return;
    loadedForRef.current = userId;

    // Reset seeded guards when loading for a new user
    seededRef.current = false;

    // Run one-time key migration BEFORE any holdings are read
    migrateLocalStorageKeys(userId);

    const legacyKey = k(userId, HOLDINGS_VERSION_SUFFIX); // "userId_sentimentam_local_holdings_v4"
    if (localStorage.getItem(legacyKey) !== null) {
      localStorage.removeItem(legacyKey);
      console.log("[Holdings] Corrupted v3 holdings cleared — migrated to v4.");
    }

    const { holdingsMap: loaded, costBasisMap: loadedCostBasis } =
      loadFromStorage(userId);
    setHoldingsMap(loaded);
    setCostBasisMap(loadedCostBasis);
    setPnlUnlockedMap(loadPnlUnlocked(userId));

    // Load persisted short cost basis map
    try {
      const rawShort = localStorage.getItem(k(userId, SHORT_COST_BASIS_SUFFIX));
      if (rawShort) {
        const parsed = JSON.parse(rawShort) as Record<string, number>;
        setShortCostBasisMap(new Map(Object.entries(parsed)));
      }
    } catch {
      // malformed — start empty
    }

    try {
      const rawVol = localStorage.getItem(k(userId, LOCAL_VOLUME_SUFFIX));
      if (rawVol) {
        const parsed = JSON.parse(rawVol) as Record<string, number>;
        setLocalVolumeMap(new Map(Object.entries(parsed)));
      }
    } catch {
      // malformed — start empty
    }

    setIsLoading(false);
  }, [userId]);

  // Seed 100 units of all 5 Golden indices on first ever session.
  // Guarded by a localStorage flag so it only runs once per user.
  useEffect(() => {
    if (!userId) return;
    if (isLoading) return;
    if (seededRef.current) return;
    if (localStorage.getItem(k(userId, HOLDINGS_SEEDED_SUFFIX)) === "true") {
      seededRef.current = true;
      return;
    }

    seededRef.current = true;
    const nowNs = BigInt(Date.now()) * BigInt(1_000_000);

    setHoldingsMap((prev) => {
      const next = new Map(prev);
      const nextCostBasis = new Map<string, number>();

      // Copy existing cost basis values first
      setCostBasisMap((prevCB) => {
        for (const [k2, v] of prevCB) nextCostBasis.set(k2, v);
        return prevCB;
      });

      for (const { name, buyPrice } of GOLDEN_5_SEEDS) {
        const existing = next.get(name);
        if (!existing || existing.units === 0) {
          next.set(name, {
            units: SEED_UNITS,
            accruedYield: 0,
            yieldStartTime: nowNs,
            allocationTimestamp: nowNs,
            assetName: name,
          });
          // Record locked-in cost basis
          const existingCB = nextCostBasis.get(name) ?? 0;
          nextCostBasis.set(name, existingCB + SEED_UNITS * buyPrice);
        }
      }

      // Persist both maps together
      saveToStorage(userId, next, nextCostBasis);
      setCostBasisMap(nextCostBasis);
      return next;
    });

    localStorage.setItem(k(userId, HOLDINGS_SEEDED_SUFFIX), "true");
  }, [userId, isLoading]);

  // Seed $100 allocation (units at base price) for each index on first session.
  const alloc100Ref = useRef(false);
  useEffect(() => {
    if (!userId) return;
    if (isLoading) return;
    if (alloc100Ref.current) return;
    if (localStorage.getItem(k(userId, ALLOC_100_HOLDINGS_SUFFIX)) === "true") {
      alloc100Ref.current = true;
      return;
    }

    alloc100Ref.current = true;
    const nowNs = BigInt(Date.now()) * BigInt(1_000_000);

    setHoldingsMap((prev) => {
      const next = new Map(prev);
      const nextCostBasis = new Map<string, number>();
      setCostBasisMap((prevCB) => {
        for (const [k2, v] of prevCB) nextCostBasis.set(k2, v);
        return prevCB;
      });

      for (const { name, price } of ALLOC_100_SEEDS) {
        const units = Number.parseFloat((100 / price).toFixed(4));
        const existing = next.get(name);
        if (existing && existing.units > 0) {
          next.set(name, { ...existing, units: existing.units + units });
        } else {
          next.set(name, {
            units,
            accruedYield: 0,
            yieldStartTime: nowNs,
            allocationTimestamp: nowNs,
            assetName: name,
          });
        }
        const existingCB = nextCostBasis.get(name) ?? 0;
        nextCostBasis.set(name, existingCB + 100);
      }

      saveToStorage(userId, next, nextCostBasis);
      setCostBasisMap(nextCostBasis);
      return next;
    });

    localStorage.setItem(k(userId, ALLOC_100_HOLDINGS_SUFFIX), "true");
  }, [userId, isLoading]);


  const addShortCostBasis = useCallback(
    (indexName: string, dollars: number) => {
      if (!userId || dollars <= 0) return;
      setShortCostBasisMap((prev) => {
        const next = new Map(prev);
        next.set(indexName, (next.get(indexName) ?? 0) + dollars);
        try {
          localStorage.setItem(
            k(userId, SHORT_COST_BASIS_SUFFIX),
            JSON.stringify(Object.fromEntries(next)),
          );
        } catch {
          // quota exceeded — skip
        }
        return next;
      });
    },
    [userId],
  );

  const addHolding = useCallback(
    (indexName: string, units: number, costBasis?: number) => {
      if (!userId) return;
      if (units <= 0) return;
      setHoldingsMap((prev) => {
        const next = new Map(prev);
        const existing = next.get(indexName);
        const nowNs = BigInt(Date.now()) * BigInt(1_000_000);

        if (existing && existing.units > 0) {
          // Add to existing position
          next.set(indexName, {
            units: existing.units + units,
            accruedYield: existing.accruedYield,
            yieldStartTime: existing.yieldStartTime,
            allocationTimestamp: existing.allocationTimestamp,
            assetName: indexName,
          });
        } else {
          // New position (fresh start — cost basis begins from zero)
          next.set(indexName, {
            units,
            accruedYield: 0,
            yieldStartTime: nowNs,
            allocationTimestamp: nowNs,
            assetName: indexName,
          });
        }

        // Accumulate cost basis
        setCostBasisMap((prevCB) => {
          const nextCB = new Map(prevCB);
          const prevBasis = nextCB.get(indexName) ?? 0;
          nextCB.set(indexName, prevBasis + (costBasis ?? 0));
          saveToStorage(userId, next, nextCB);
          return nextCB;
        });

        return next;
      });
      // Stream #4: record buy-side order flow
      recordOrderFlowEvent(indexName, costBasis ?? 0);

      // Track local volume per index (persisted so Vol. label survives refresh)
      if (costBasis && costBasis > 0) {
        setLocalVolumeMap((prev) => {
          const next = new Map(prev);
          next.set(indexName, (next.get(indexName) ?? 0) + costBasis);
          try {
            localStorage.setItem(
              k(userId, LOCAL_VOLUME_SUFFIX),
              JSON.stringify(Object.fromEntries(next)),
            );
          } catch {
            // quota exceeded
          }
          return next;
        });
      }
    },
    [userId],
  );

  /**
   * Remove all units from an index holding.
   *
   * COST BASIS RESET: cost basis is deleted so re-entry starts fresh at 0%.
   * PNL UNLOCK RESET: the one-way pnlUnlocked flag is also cleared so the
   * next allocation is treated as a brand-new position starting at 0% yield.
   *
   * clearHolding is unchanged from before — it continues to support full exits.
   */
  const clearHolding = useCallback(
    (indexName: string) => {
      if (!userId) return;
      setHoldingsMap((prev) => {
        // Stream #4: record sell-side order flow (negative notional = redeem)
        // Read units from prev before deletion; use units as proxy for notional
        const holdingToRemove = prev.get(indexName);
        if (holdingToRemove && holdingToRemove.units > 0) {
          recordOrderFlowEvent(indexName, -holdingToRemove.units);
        }

        const next = new Map(prev);
        next.delete(indexName);

        setCostBasisMap((prevCB) => {
          const nextCB = new Map(prevCB);
          // ── FIX: reset cost basis to 0 on full redemption ──
          nextCB.delete(indexName);
          saveToStorage(userId, next, nextCB);
          return nextCB;
        });

        return next;
      });

      // ── FIX: reset P&L unlock flag on full redemption ──
      // The next buy-in will be treated as a brand-new position at 0% yield.
      setPnlUnlockedMap((prev) => {
        if (!prev.has(indexName)) return prev;
        const next = new Map(prev);
        next.delete(indexName);
        savePnlUnlocked(userId, next);
        return next;
      });
    },
    [userId],
  );

  /**
   * B5: Partial redemption — reduces units without closing the position.
   *
   * Rules:
   *   - unitsToRedeem must be > 0 and <= currentUnits (no-op otherwise)
   *   - If unitsToRedeem === currentUnits, delegates to clearHolding()
   *   - If unitsToRedeem < currentUnits:
   *     • Reduces units by unitsToRedeem
   *     • Updates cost basis proportionally (ratio = remaining/total)
   *     • Records negative order flow event for unitsToRedeem
   *     • allocationTimestamp is preserved on the remaining position
   */
  const redeemPartialHolding = useCallback(
    (indexName: string, unitsToRedeem: number) => {
      if (!userId) return;
      setHoldingsMap((prev) => {
        const existing = prev.get(indexName);
        if (!existing || existing.units <= 0) return prev;

        const currentUnits = existing.units;

        // Validation
        if (unitsToRedeem <= 0 || unitsToRedeem > currentUnits) return prev;

        // Full exit: delegate to clearHolding logic
        if (unitsToRedeem === currentUnits) {
          // Schedule clearHolding after this state update completes
          // Use setTimeout(0) to avoid calling setState inside setState
          setTimeout(() => clearHolding(indexName), 0);
          return prev;
        }

        // Partial exit
        const remainingUnits = currentUnits - unitsToRedeem;
        const retainRatio = remainingUnits / currentUnits;

        const next = new Map(prev);
        next.set(indexName, {
          ...existing,
          units: remainingUnits,
          // allocationTimestamp preserved — loyalty clock continues
        });

        // Update cost basis proportionally
        setCostBasisMap((prevCB) => {
          const nextCB = new Map(prevCB);
          const prevBasis = nextCB.get(indexName) ?? 0;
          nextCB.set(indexName, prevBasis * retainRatio);
          saveToStorage(userId, next, nextCB);
          return nextCB;
        });

        // Stream #4: record sell-side order flow for partial redemption
        recordOrderFlowEvent(indexName, -unitsToRedeem);

        return next;
      });
    },
    [userId, clearHolding],
  );

  /**
   * Permanently unlock the P&L view for a specific index.
   * This is a one-way operation — it will never set a true flag back to false
   * unless the position is fully redeemed (clearHolding resets it).
   */
  const unlockPnL = useCallback(
    (indexName: string) => {
      if (!userId) return;
      setPnlUnlockedMap((prev) => {
        // No-op if already unlocked — guarantees idempotency
        if (prev.get(indexName) === true) return prev;
        const next = new Map(prev);
        next.set(indexName, true);
        savePnlUnlocked(userId, next);
        return next;
      });
    },
    [userId],
  );

  // Register holding manipulation callbacks with WalletContext's queue processor.
  // This runs whenever the callbacks change (e.g. after userId changes),
  // keeping the module-level refs in WalletContext current.
  useEffect(() => {
    _registerHoldingCallbacks(clearHolding, redeemPartialHolding);
  }, [clearHolding, redeemPartialHolding]);

  // Convert map to array format matching backend [string, Holding][] contract
  const holdings: Array<[string, Holding]> = Array.from(
    holdingsMap.entries(),
  ).filter(([, h]) => h.units > 0);

  return (
    <LocalHoldingsContext.Provider
      value={{
        holdings,
        costBasisMap,
        shortCostBasisMap,
        localVolumeMap,
        pnlUnlockedMap,
        addHolding,
        addShortCostBasis,
        clearHolding,
        redeemPartialHolding,
        unlockPnL,
        isLoading,
      }}
    >
      {children}
    </LocalHoldingsContext.Provider>
  );
}

export function useLocalHoldings(): LocalHoldingsContextValue {
  const ctx = useContext(LocalHoldingsContext);
  if (!ctx) {
    throw new Error(
      "useLocalHoldings must be used within LocalHoldingsProvider",
    );
  }
  return ctx;
}
