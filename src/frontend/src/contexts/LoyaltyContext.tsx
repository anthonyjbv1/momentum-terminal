/**
 * LoyaltyContext
 *
 * B4 REFACTOR: Per-position loyalty tier tracking.
 *
 * Each index position now has its own independent clock instead of a single
 * account-wide streak. The loyalty tier for a specific position is determined
 * by how long that position has been held, independently of all other positions.
 *
 * 5-tier loyalty system with day-based thresholds:
 *   Standard  0d  → 1.00×
 *   Bronze    7d  → 1.05×
 *   Silver    14d → 1.10×
 *   Gold      21d → 1.20×
 *   Obsidian  30d → 1.50×
 *
 * Storage key updated to v2 to avoid conflicts with the old account-level format.
 */

import type React from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  type DisqualificationStatus,
  getDaysRemaining,
} from "../lib/loyaltyTierEngine";

// Updated to v2 to avoid conflicts with old single-streak format
const LOYALTY_STORAGE_KEY = "sentimentam_loyalty_v2";

export type TierName = "Standard" | "Bronze" | "Silver" | "Gold" | "Obsidian";

export interface LoyaltyTierConfig {
  name: TierName;
  daysRequired: number;
  spreadReduction: number;
  color: string;
  emoji: string;
}

// NOTE: Canonical qualification rules — including notional minimums and peak
// retention thresholds — live in src/frontend/src/lib/loyaltyTierEngine.ts.
// The daysRequired values here MUST stay in sync with minHoldDays in that file.
export const LOYALTY_TIERS: LoyaltyTierConfig[] = [
  {
    name: "Standard",
    daysRequired: 0,
    spreadReduction: 0.0,
    color: "oklch(0.55 0 0)",
    emoji: "◈",
  },
  {
    name: "Bronze",
    daysRequired: 7,
    spreadReduction: 0.1,
    color: "oklch(0.62 0.12 55)",
    emoji: "◆",
  },
  {
    name: "Silver",
    daysRequired: 14,
    spreadReduction: 0.2,
    color: "oklch(0.78 0.04 240)",
    emoji: "◆",
  },
  {
    name: "Gold",
    daysRequired: 21,
    spreadReduction: 0.3,
    color: "oklch(0.82 0.18 85)",
    emoji: "★",
  },
  {
    name: "Obsidian",
    daysRequired: 30,
    spreadReduction: 0.4,
    color: "oklch(0.68 0.22 290)",
    emoji: "✦",
  },
];

export type TierDefinition = LoyaltyTierConfig;

function resolveTierFromMs(entryMs: number): LoyaltyTierConfig {
  const days = Math.max(0, Math.floor((Date.now() - entryMs) / 86_400_000));
  let current = LOYALTY_TIERS[0];
  for (const tier of LOYALTY_TIERS) {
    if (days >= tier.daysRequired) current = tier;
  }
  return current;
}

function resolveTier(streakDays: number): LoyaltyTierConfig {
  let current = LOYALTY_TIERS[0];
  for (const tier of LOYALTY_TIERS) {
    if (streakDays >= tier.daysRequired) {
      current = tier;
    }
  }
  return current;
}

function resolveNextTier(current: LoyaltyTierConfig): LoyaltyTierConfig | null {
  const idx = LOYALTY_TIERS.findIndex((t) => t.name === current.name);
  return idx < LOYALTY_TIERS.length - 1 ? LOYALTY_TIERS[idx + 1] : null;
}

function progressToNext(
  streakDays: number,
  current: LoyaltyTierConfig,
  next: LoyaltyTierConfig | null,
): number {
  if (!next) return 100;
  const range = next.daysRequired - current.daysRequired;
  const elapsed = streakDays - current.daysRequired;
  return Math.min((elapsed / range) * 100, 100);
}

// ─── Persisted shape (v2) ───────────────────────────────────────────────────────
// positionTimestamps: { [indexName]: entryTimestampMs }
interface PersistedV2 {
  positionTimestamps: Record<string, number>;
}

function loadPersisted(): PersistedV2 {
  try {
    const raw = localStorage.getItem(LOYALTY_STORAGE_KEY);
    if (!raw) return { positionTimestamps: {} };
    return JSON.parse(raw) as PersistedV2;
  } catch {
    return { positionTimestamps: {} };
  }
}

function savePersisted(data: PersistedV2): void {
  try {
    localStorage.setItem(LOYALTY_STORAGE_KEY, JSON.stringify(data));
  } catch {
    /* ignore */
  }
}

// ─── Context shape ─────────────────────────────────────────────────────────────

export interface LoyaltyState {
  // ── Per-position API (B4) ────────────────────────────────────────────
  /** Map of indexName → entry timestamp in ms */
  positionTimestamps: Map<string, number>;
  /** Returns the tier for a specific position based on its entry clock. */
  getPositionTier: (indexName: string) => TierDefinition;
  /** Records entry time for a specific position (call when position is opened/detected). */
  setPositionEntry: (indexName: string, timestampMs: number) => void;
  /** Removes a specific position's clock without affecting any other position. */
  clearPositionTier: (indexName: string) => void;

  // ── Account-level compat API (legacy consumers) ─────────────────────
  /**
   * Account-level streak: derived from the oldest active position.
   * Kept for backwards compat with components that still read streakDays.
   */
  streakDays: number;
  tier: LoyaltyTierConfig;
  nextTier: LoyaltyTierConfig | null;
  progressPercent: number;
  daysUntilNextTier: number | null;
  /**
   * Resets the streak entirely (all positions).
   * @deprecated Use clearPositionTier(indexName) instead for per-position resets.
   */
  resetStreak: () => void;
  /**
   * Sets the account-level oldest position timestamp.
   * @deprecated Use setPositionEntry(indexName, ms) instead.
   */
  setOldestPositionMs: (ms: number | null) => void;
  /**
   * Whether the user's current tier is at risk of disqualification.
   * Defaults to "QUALIFIED" when holdings data is not available in this context.
   * UI can override by calling checkDisqualification with richer data.
   */
  disqualificationStatus: DisqualificationStatus;
  /**
   * Days remaining until the next tier's hold requirement is met.
   * Computed from the oldest active position timestamp vs. nextTier.daysRequired.
   */
  daysRemaining: number;
}

const LoyaltyContext = createContext<LoyaltyState | null>(null);

export function LoyaltyProvider({ children }: { children: React.ReactNode }) {
  // ── Per-position state (B4) ───────────────────────────────────────────
  const [positionTimestamps, setPositionTimestamps] = useState<
    Map<string, number>
  >(() => {
    const persisted = loadPersisted();
    return new Map(Object.entries(persisted.positionTimestamps));
  });

  // ── Account-level streak (derived from oldest position) ───────────────
  const computeStreakDays = useCallback(
    (tsMap: Map<string, number>): number => {
      if (tsMap.size === 0) return 0;
      let oldest = Number.POSITIVE_INFINITY;
      for (const ms of tsMap.values()) {
        if (ms < oldest) oldest = ms;
      }
      return oldest === Number.POSITIVE_INFINITY
        ? 0
        : Math.max(0, Math.floor((Date.now() - oldest) / 86_400_000));
    },
    [],
  );

  const [streakDays, setStreakDays] = useState<number>(() =>
    computeStreakDays(
      new Map(Object.entries(loadPersisted().positionTimestamps)),
    ),
  );

  // Recalculate streak every minute
  useEffect(() => {
    const recalc = () => setStreakDays(computeStreakDays(positionTimestamps));
    recalc();
    const interval = setInterval(recalc, 60_000);
    return () => clearInterval(interval);
  }, [positionTimestamps, computeStreakDays]);

  // ── Per-position API ────────────────────────────────────────────────────

  const getPositionTier = useCallback(
    (indexName: string): TierDefinition => {
      const entryMs = positionTimestamps.get(indexName);
      if (entryMs === undefined) return LOYALTY_TIERS[0];
      return resolveTierFromMs(entryMs);
    },
    [positionTimestamps],
  );

  const setPositionEntry = useCallback(
    (indexName: string, timestampMs: number) => {
      setPositionTimestamps((prev) => {
        // Only set if not already present — preserve original entry clock
        if (prev.has(indexName)) return prev;
        const next = new Map(prev);
        next.set(indexName, timestampMs);
        savePersisted({
          positionTimestamps: Object.fromEntries(next),
        });
        return next;
      });
    },
    [],
  );

  const clearPositionTier = useCallback((indexName: string) => {
    setPositionTimestamps((prev) => {
      if (!prev.has(indexName)) return prev;
      const next = new Map(prev);
      next.delete(indexName);
      savePersisted({
        positionTimestamps: Object.fromEntries(next),
      });
      return next;
    });
  }, []);

  // ── Legacy / account-level API ──────────────────────────────────────────

  const setOldestPositionMs = useCallback((ms: number | null) => {
    // Legacy shim: no-op if ms is null (clearing handled per-position)
    // If ms is provided this is called by old LoyaltySyncer logic —
    // we no longer reset anything here; per-position API takes over.
    if (ms === null) return;
  }, []);

  const resetStreak = useCallback(() => {
    setPositionTimestamps((prev) => {
      if (prev.size === 0) return prev;
      const empty = new Map<string, number>();
      savePersisted({ positionTimestamps: {} });
      return empty;
    });
  }, []);

  const tier = resolveTier(streakDays);
  const nextTier = resolveNextTier(tier);
  const progressPercent = progressToNext(streakDays, tier, nextTier);
  const daysUntilNextTier = nextTier
    ? Math.max(0, nextTier.daysRequired - streakDays)
    : null;

  // ── Oldest position timestamp (for daysRemaining calculation) ─────────────
  const oldestPositionMs = useMemo(() => {
    if (positionTimestamps.size === 0) return null;
    let oldest = Number.POSITIVE_INFINITY;
    for (const ms of positionTimestamps.values()) {
      if (ms < oldest) oldest = ms;
    }
    return oldest === Number.POSITIVE_INFINITY ? null : oldest;
  }, [positionTimestamps]);

  // ── daysRemaining: days until nextTier's hold requirement is met ────────────
  const daysRemaining = useMemo(() => {
    if (!oldestPositionMs) return 0;
    if (!nextTier) return 0; // already at max tier
    return getDaysRemaining({
      entryTimestampMs: oldestPositionMs,
      tier: nextTier.name,
      nowMs: Date.now(),
    });
  }, [oldestPositionMs, nextTier]);

  // ── disqualificationStatus: defaults to QUALIFIED ─────────────────────────
  // Holdings data is not available in this context (avoiding circular dependency
  // with LocalHoldingsContext). The UI layer or future enhancement can call
  // checkDisqualification() directly with richer position data.
  const disqualificationStatus: DisqualificationStatus = "QUALIFIED";

  return (
    <LoyaltyContext.Provider
      value={{
        positionTimestamps,
        getPositionTier,
        setPositionEntry,
        clearPositionTier,
        streakDays,
        tier,
        nextTier,
        progressPercent,
        daysUntilNextTier,
        resetStreak,
        setOldestPositionMs,
        disqualificationStatus,
        daysRemaining,
      }}
    >
      {children}
    </LoyaltyContext.Provider>
  );
}

export function useLoyalty(): LoyaltyState {
  const ctx = useContext(LoyaltyContext);
  if (!ctx) throw new Error("useLoyalty must be used within LoyaltyProvider");
  return ctx;
}
