import type React from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  getCurrentCap,
  getTotalAllocatedForIndex,
} from "../services/capacityTierService";
import { useAuth } from "./AuthContext";

export interface ActivityEntry {
  id: string;
  type: "Deposit" | "Spend" | "Credit";
  amount: number;
  source: string;
  timestamp: number;
  /** Number of units purchased/redeemed (Spend/Credit only) */
  units?: number;
  /** Price per unit at fill time (Spend/Credit only) */
  pricePerUnit?: number;
}

interface WalletContextValue {
  walletBalance: number;
  buyingPower: number;
  activityHistory: ActivityEntry[];
  depositFunds: (amount: number) => void;
  deductFunds: (amount: number) => boolean;
  addFunds: (amount: number) => void;
  logSpend: (
    amount: number,
    source: string,
    units?: number,
    pricePerUnit?: number,
  ) => void;
  logCredit: (
    amount: number,
    source: string,
    units?: number,
    pricePerUnit?: number,
  ) => void;
}

const SIMULATED_STARTING_BALANCE = 100_100;

// Static key suffixes — prefixed with userId at runtime
const SEEDED_FLAG_SUFFIX = "sentimentam_seeded_v5";
const WALLET_BALANCE_SUFFIX = "walletBalance";
const BUYING_POWER_SUFFIX = "buyingPower";
const ACTIVITY_HISTORY_SUFFIX = "activityHistory";
const ALLOC_100_FLAG_SUFFIX = "sentimentam_100_alloc_v1";
const AI_ALLOC_100_FLAG_SUFFIX = "sentimentam_ai_tech_alloc_100_v1";

function k(userId: string, suffix: string): string {
  return `${userId}_${suffix}`;
}

// ── Module-level holding callback registry ───────────────────────────────────
// LocalHoldingsContext registers these after its callbacks are created.
// WalletContext's processRedemptionQueue uses them without importing LocalHoldingsContext.
let _clearHoldingFn: ((indexName: string) => void) | null = null;
let _redeemPartialHoldingFn:
  | ((indexName: string, units: number) => void)
  | null = null;

export function _registerHoldingCallbacks(
  clearHolding: (indexName: string) => void,
  redeemPartialHolding: (indexName: string, units: number) => void,
): void {
  _clearHoldingFn = clearHolding;
  _redeemPartialHoldingFn = redeemPartialHolding;
}

// ── PendingRedemption types ───────────────────────────────────────────────────
export type PendingRedemptionType = "full" | "partial";
export type PendingRedemptionStatus = "pending" | "processed";

export interface PendingRedemption {
  id: string;
  userId: string;
  indexName: string;
  type: PendingRedemptionType;
  units?: number; // for partial only
  queuedAt: number;
  status: PendingRedemptionStatus;
}

export const REDEMPTION_QUEUE_KEY_SUFFIX = "momentum_redemption_queue_v1";

export function getRedemptionQueueKey(userId: string): string {
  return `momentum_redemption_queue_v1_${userId}`;
}

export function readRedemptionQueue(userId: string): PendingRedemption[] {
  try {
    const raw = localStorage.getItem(getRedemptionQueueKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as PendingRedemption[];
  } catch {
    return [];
  }
}

export function writeRedemptionQueue(
  userId: string,
  queue: PendingRedemption[],
): void {
  try {
    localStorage.setItem(getRedemptionQueueKey(userId), JSON.stringify(queue));
  } catch {
    // silent fail
  }
}

const QUEUE_PROCESS_THRESHOLD = 0.7;

const WalletContext = createContext<WalletContextValue | null>(null);

function loadNumber(key: string, defaultValue: number): number {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return defaultValue;
    const parsed = Number.parseFloat(raw);
    return Number.isNaN(parsed) ? defaultValue : parsed;
  } catch {
    return defaultValue;
  }
}

/**
 * Retroactively patch any existing Spend/Credit entries that are missing
 * units/pricePerUnit fields. For Spend entries where we know the seed prices,
 * we reconstruct them; for others we derive units from amount/pricePerUnit if
 * possible. This ensures old entries show full detail in the drilldown.
 */
function migrateActivityEntries(entries: ActivityEntry[]): ActivityEntry[] {
  // Build a lookup of seed prices by index name
  const seedPriceMap: Record<string, number> = {};
  for (const { name, buyPrice } of GOLDEN_5_SEEDS) {
    seedPriceMap[name] = buyPrice;
  }

  return entries.map((entry) => {
    // Already has detail — skip
    if (entry.units !== undefined && entry.pricePerUnit !== undefined) {
      return entry;
    }
    // Only Spend/Credit entries get units/price detail
    if (entry.type === "Deposit") return entry;

    // Try to infer price from seed map
    const knownPrice = seedPriceMap[entry.source];
    if (knownPrice && knownPrice > 0) {
      const units = entry.amount / knownPrice;
      return { ...entry, units, pricePerUnit: knownPrice };
    }

    // Fallback: if pricePerUnit is present but units missing
    if (entry.pricePerUnit && entry.pricePerUnit > 0 && !entry.units) {
      return { ...entry, units: entry.amount / entry.pricePerUnit };
    }

    // Last resort: mark as unknown quantity so UI shows N/A gracefully
    return entry;
  });
}

function loadActivityHistory(userId: string): ActivityEntry[] {
  try {
    const raw = localStorage.getItem(k(userId, ACTIVITY_HISTORY_SUFFIX));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const entries = parsed as ActivityEntry[];
    // Run migration and persist if anything changed
    const migrated = migrateActivityEntries(entries);
    const changed = migrated.some(
      (e, i) =>
        e.units !== entries[i].units ||
        e.pricePerUnit !== entries[i].pricePerUnit,
    );
    if (changed) {
      try {
        localStorage.setItem(
          k(userId, ACTIVITY_HISTORY_SUFFIX),
          JSON.stringify(migrated),
        );
      } catch {
        // ignore
      }
    }
    return migrated;
  } catch {
    return [];
  }
}

/**
 * Determine the initial wallet balance for a given user.
 * If no balance has ever been stored (null in localStorage), seed with $100,100.
 * If a balance exists (even $0), use it as-is so existing users are not overwritten.
 */
function getInitialBalance(userId: string): number {
  try {
    const raw = localStorage.getItem(k(userId, WALLET_BALANCE_SUFFIX));
    if (raw === null) {
      // First-time user — seed with $100,100 and persist immediately
      localStorage.setItem(
        k(userId, WALLET_BALANCE_SUFFIX),
        String(SIMULATED_STARTING_BALANCE),
      );
      localStorage.setItem(
        k(userId, BUYING_POWER_SUFFIX),
        String(SIMULATED_STARTING_BALANCE),
      );
      return SIMULATED_STARTING_BALANCE;
    }
    const parsed = Number.parseFloat(raw);
    return Number.isNaN(parsed) ? SIMULATED_STARTING_BALANCE : parsed;
  } catch {
    return SIMULATED_STARTING_BALANCE;
  }
}

/**
 * Seed 100 units of all 5 live Golden indices on first load.
 * Uses fallback buy prices (baseScore + 0.5 spread) for each index,
 * deducts the combined total from the wallet balance, and logs one
 * activity entry per index. Sets a localStorage flag to prevent
 * double-seeding on subsequent loads.
 *
 * Returns the balance AFTER all deductions, or the passed-in balance
 * unchanged if the seed was already applied or should not run.
 */
const SEED_UNITS = 100;

const GOLDEN_5_SEEDS: { name: string; buyPrice: number }[] = [
  { name: "AI Regulation Risk Sentiment", buyPrice: 73.0 },
  { name: "Fed Policy Sentiment", buyPrice: 48.0 },
  { name: "MENA Stability Sentiment", buyPrice: 46.5 },
];

function applySeedingIfNeeded(
  userId: string,
  currentBalance: number,
  activityHistory: ActivityEntry[],
): { balance: number; activity: ActivityEntry[] } {
  // Guard: only seed once
  if (localStorage.getItem(k(userId, SEEDED_FLAG_SUFFIX)) === "true") {
    return { balance: currentBalance, activity: activityHistory };
  }

  let balance = currentBalance;
  const seedEntries: ActivityEntry[] = [];
  const now = Date.now();

  for (const { name, buyPrice } of GOLDEN_5_SEEDS) {
    const cost = SEED_UNITS * buyPrice;
    balance = Math.max(0, balance - cost);

    seedEntries.push({
      id: `seed-${name.toLowerCase().replace(/\s+/g, "-")}-${now}`,
      type: "Spend",
      amount: cost,
      source: name,
      timestamp: now,
      units: SEED_UNITS,
      pricePerUnit: buyPrice,
    });
  }

  const newActivity = [...seedEntries, ...activityHistory];

  // Persist immediately
  localStorage.setItem(k(userId, WALLET_BALANCE_SUFFIX), String(balance));
  localStorage.setItem(k(userId, BUYING_POWER_SUFFIX), String(balance));
  localStorage.setItem(
    k(userId, ACTIVITY_HISTORY_SUFFIX),
    JSON.stringify(newActivity),
  );
  localStorage.setItem(k(userId, SEEDED_FLAG_SUFFIX), "true");

  return { balance, activity: newActivity };
}

const ALLOC_100_PRICE_MAP: { name: string; price: number }[] = [
  { name: "AI Regulation Risk Sentiment", price: 75.0 },
  { name: "Fed Policy Sentiment", price: 50.0 },
  { name: "MENA Stability Sentiment", price: 48.5 },
];

/**
 * Seeds a $100 allocation per index on first session.
 * Logs Spend entries in activity history and deducts from balance.
 */
function apply100DollarAlloc(
  userId: string,
  currentBalance: number,
  activityHistory: ActivityEntry[],
): { balance: number; activity: ActivityEntry[] } {
  if (localStorage.getItem(k(userId, ALLOC_100_FLAG_SUFFIX)) === "true") {
    return { balance: currentBalance, activity: activityHistory };
  }

  let balance = currentBalance;
  const allocEntries: ActivityEntry[] = [];
  const now = Date.now();

  for (const { name, price } of ALLOC_100_PRICE_MAP) {
    const amount = 100;
    const units = Number.parseFloat((amount / price).toFixed(4));
    balance = Math.max(0, balance - amount);
    allocEntries.push({
      id: `alloc100-${name.toLowerCase().replace(/\s+/g, "-")}-${now}`,
      type: "Spend",
      amount,
      source: name,
      timestamp: now - 1, // 1ms before seed entries so they appear just below
      units,
      pricePerUnit: price,
    });
  }

  const newActivity = [...allocEntries, ...activityHistory];

  localStorage.setItem(k(userId, WALLET_BALANCE_SUFFIX), String(balance));
  localStorage.setItem(k(userId, BUYING_POWER_SUFFIX), String(balance));
  localStorage.setItem(
    k(userId, ACTIVITY_HISTORY_SUFFIX),
    JSON.stringify(newActivity),
  );
  localStorage.setItem(k(userId, ALLOC_100_FLAG_SUFFIX), "true");

  return { balance, activity: newActivity };
}

/**
 * Seeds a $100 allocation specifically for the AI & Tech Regulation Sentiment Index
 * at the current base score price of 75.0.
 * Logs a single Spend entry in activity history and deducts $100 from balance.
 */
function applyAITechAlloc(
  userId: string,
  currentBalance: number,
  activityHistory: ActivityEntry[],
): { balance: number; activity: ActivityEntry[] } {
  if (localStorage.getItem(k(userId, AI_ALLOC_100_FLAG_SUFFIX)) === "true") {
    return { balance: currentBalance, activity: activityHistory };
  }

  const AI_INDEX_NAME = "AI Regulation Risk Sentiment";
  const AI_BASE_PRICE = 75.0;
  const amount = 100;
  const units = Number.parseFloat((amount / AI_BASE_PRICE).toFixed(4));
  const now = Date.now();

  const balance = Math.max(0, currentBalance - amount);

  const entry: ActivityEntry = {
    id: `ai-alloc100-${now}`,
    type: "Spend",
    amount,
    source: AI_INDEX_NAME,
    timestamp: now,
    units,
    pricePerUnit: AI_BASE_PRICE,
  };

  const newActivity = [entry, ...activityHistory];

  localStorage.setItem(k(userId, WALLET_BALANCE_SUFFIX), String(balance));
  localStorage.setItem(k(userId, BUYING_POWER_SUFFIX), String(balance));
  localStorage.setItem(
    k(userId, ACTIVITY_HISTORY_SUFFIX),
    JSON.stringify(newActivity),
  );
  localStorage.setItem(k(userId, AI_ALLOC_100_FLAG_SUFFIX), "true");

  return { balance, activity: newActivity };
}

/**
 * Compute the initial wallet state in one pass, applying all seeding functions.
 */
function computeInitialWalletState(userId: string): {
  balance: number;
  activity: ActivityEntry[];
} {
  const base = getInitialBalance(userId);
  const history = loadActivityHistory(userId);
  const seeded = applySeedingIfNeeded(userId, base, history);
  const alloc100 = apply100DollarAlloc(userId, seeded.balance, seeded.activity);
  return applyAITechAlloc(userId, alloc100.balance, alloc100.activity);
}

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const { userAccount } = useAuth();
  const userId = userAccount?.email ?? null;

  // Use a ref to track the userId for which state was last initialized
  const initializedForRef = useRef<string | null>(null);

  const [walletBalance, setWalletBalance] = useState<number>(
    SIMULATED_STARTING_BALANCE,
  );
  const [buyingPower, setBuyingPower] = useState<number>(
    SIMULATED_STARTING_BALANCE,
  );
  const [activityHistory, setActivityHistory] = useState<ActivityEntry[]>([]);

  // Re-initialize wallet state whenever userId changes (login / account switch)
  useEffect(() => {
    if (!userId) return;
    if (initializedForRef.current === userId) return;
    initializedForRef.current = userId;

    const state = computeInitialWalletState(userId);
    setWalletBalance(state.balance);
    setBuyingPower(
      loadNumber(k(userId, BUYING_POWER_SUFFIX), SIMULATED_STARTING_BALANCE),
    );
    setActivityHistory(state.activity);
  }, [userId]);

  const persistActivity = useCallback(
    (entries: ActivityEntry[]) => {
      if (!userId) return;
      try {
        localStorage.setItem(
          k(userId, ACTIVITY_HISTORY_SUFFIX),
          JSON.stringify(entries),
        );
      } catch {
        // ignore storage errors
      }
    },
    [userId],
  );

  const depositFunds = useCallback(
    (amount: number) => {
      if (!userId) return;
      setWalletBalance((prev) => {
        const next = prev + amount;
        localStorage.setItem(k(userId, WALLET_BALANCE_SUFFIX), String(next));
        return next;
      });
      setBuyingPower((prev) => {
        const next = prev + amount;
        localStorage.setItem(k(userId, BUYING_POWER_SUFFIX), String(next));
        return next;
      });

      const newEntry: ActivityEntry = {
        id: `deposit-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        type: "Deposit",
        amount,
        source: "Bank Account ****4242",
        timestamp: Date.now(),
      };

      setActivityHistory((prev) => {
        const next = [newEntry, ...prev];
        persistActivity(next);
        return next;
      });
    },
    [userId, persistActivity],
  );

  /**
   * Deduct funds from the simulated cash balance.
   * Returns true if successful, false if insufficient funds.
   * Balance is clamped to never go below $0.
   */
  const deductFunds = useCallback(
    (amount: number): boolean => {
      if (!userId) return false;
      let success = false;
      setWalletBalance((prev) => {
        if (prev < amount) {
          success = false;
          return prev;
        }
        success = true;
        const next = Math.max(0, prev - amount);
        localStorage.setItem(k(userId, WALLET_BALANCE_SUFFIX), String(next));
        return next;
      });
      setBuyingPower((prev) => {
        if (prev < amount) return prev;
        const next = Math.max(0, prev - amount);
        localStorage.setItem(k(userId, BUYING_POWER_SUFFIX), String(next));
        return next;
      });

      // We need to read the current balance synchronously to determine success
      // Use localStorage as the source of truth for the check
      const currentBalance = Number.parseFloat(
        localStorage.getItem(k(userId, WALLET_BALANCE_SUFFIX)) ?? "0",
      );
      // After the setState above has run (synchronously in React 18 batching during event handlers),
      // the localStorage value is already updated. We check the pre-deduction value.
      // Re-read to confirm:
      const afterBalance = Number.parseFloat(
        localStorage.getItem(k(userId, WALLET_BALANCE_SUFFIX)) ?? "0",
      );
      // If balance decreased, deduction was successful
      return afterBalance < currentBalance || success;
    },
    [userId],
  );

  /**
   * Add funds back to the simulated cash balance (e.g. after a redemption).
   */
  const addFunds = useCallback(
    (amount: number) => {
      if (!userId) return;
      setWalletBalance((prev) => {
        const next = prev + amount;
        localStorage.setItem(k(userId, WALLET_BALANCE_SUFFIX), String(next));
        return next;
      });
      setBuyingPower((prev) => {
        const next = prev + amount;
        localStorage.setItem(k(userId, BUYING_POWER_SUFFIX), String(next));
        return next;
      });
    },
    [userId],
  );

  /**
   * Process any pending redemptions in the queue that are now eligible
   * (index utilization has dropped below the 70% processing threshold).
   * Called on every Oracle tick via setInterval.
   */
  const processRedemptionQueue = useCallback(() => {
    if (!userId) return;
    const queue = readRedemptionQueue(userId);
    if (queue.length === 0) return;

    const pending = queue.filter((e) => e.status === "pending");
    if (pending.length === 0) return;

    let anyProcessed = false;

    const updated = queue.map((entry) => {
      if (entry.status !== "pending") return entry;

      // Check if this index utilization has dropped below the 70% processing threshold
      const tierCap = getCurrentCap(entry.indexName);
      const allocated = getTotalAllocatedForIndex(entry.indexName);
      const util = tierCap > 0 ? allocated / tierCap : 0;

      if (util >= QUEUE_PROCESS_THRESHOLD) return entry; // still above threshold

      // Below threshold — process this redemption now
      // Derive redemption amount from current holdings in localStorage
      const HOLDINGS_KEY = `${userId}_sentimentam_local_holdings_v5`;
      let redemptionAmount = 0;
      try {
        const raw = localStorage.getItem(HOLDINGS_KEY);
        if (raw) {
          const holdings = JSON.parse(raw) as Record<
            string,
            { units?: number; costBasis?: number }
          >;
          const h = holdings[entry.indexName];
          if (h) {
            // Use costBasis as the redemption amount (same convention as immediate redemption)
            redemptionAmount = h.costBasis ?? h.units ?? 0;
          }
        }
      } catch {
        // silent fail — use 0
      }

      // Delegate to registered holding callbacks (set by LocalHoldingsContext)
      if (entry.type === "full") {
        if (_clearHoldingFn) _clearHoldingFn(entry.indexName);
      } else if (entry.type === "partial" && entry.units !== undefined) {
        if (_redeemPartialHoldingFn)
          _redeemPartialHoldingFn(entry.indexName, entry.units);
      }

      // Credit the wallet
      if (redemptionAmount > 0) {
        setWalletBalance((prev) => {
          const next = prev + redemptionAmount;
          localStorage.setItem(k(userId, WALLET_BALANCE_SUFFIX), String(next));
          return next;
        });
        setBuyingPower((prev) => {
          const next = prev + redemptionAmount;
          localStorage.setItem(k(userId, BUYING_POWER_SUFFIX), String(next));
          return next;
        });
      }

      anyProcessed = true;
      return { ...entry, status: "processed" as PendingRedemptionStatus };
    });

    if (anyProcessed) {
      writeRedemptionQueue(userId, updated);
    }
  }, [userId]);

  // ── Oracle tick-aligned queue processor ───────────────────────────────────────
  // Runs on the same 30-second cadence as the Oracle tick engine.
  // Processes any pending redemptions that are now eligible.
  useEffect(() => {
    if (!userId) return;
    const intervalId = setInterval(() => {
      processRedemptionQueue();
    }, 30_000);
    return () => clearInterval(intervalId);
  }, [userId, processRedemptionQueue]);

  /**
   * Log a spend (allocation) activity entry without deducting funds.
   * Use when funds have already been deducted via deductFunds() and you
   * only need to append the activity record.
   */
  const logSpend = useCallback(
    (amount: number, source: string, units?: number, pricePerUnit?: number) => {
      const entry: ActivityEntry = {
        id: `spend-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        type: "Spend",
        amount,
        source,
        timestamp: Date.now(),
        ...(units !== undefined ? { units } : {}),
        ...(pricePerUnit !== undefined ? { pricePerUnit } : {}),
      };
      setActivityHistory((prev) => {
        const next = [entry, ...prev];
        persistActivity(next);
        return next;
      });
    },
    [persistActivity],
  );

  /**
   * Log a credit (redemption) activity entry without adding funds.
   * Use when funds have already been credited via addFunds() and you
   * only need to append the activity record.
   */
  const logCredit = useCallback(
    (amount: number, source: string, units?: number, pricePerUnit?: number) => {
      const entry: ActivityEntry = {
        id: `credit-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        type: "Credit",
        amount,
        source,
        timestamp: Date.now(),
        ...(units !== undefined ? { units } : {}),
        ...(pricePerUnit !== undefined ? { pricePerUnit } : {}),
      };
      setActivityHistory((prev) => {
        const next = [entry, ...prev];
        persistActivity(next);
        return next;
      });
    },
    [persistActivity],
  );

  return (
    <WalletContext.Provider
      value={{
        walletBalance,
        buyingPower,
        activityHistory,
        depositFunds,
        deductFunds,
        addFunds,
        logSpend,
        logCredit,
      }}
    >
      {children}
    </WalletContext.Provider>
  );
}

export function useWalletContext(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx)
    throw new Error("useWalletContext must be used within WalletProvider");
  return ctx;
}
