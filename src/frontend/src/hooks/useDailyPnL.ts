import { useEffect, useRef, useState } from "react";
import type { Holding } from "../types/backendEnums";

const OPENING_PRICES_PREFIX = "sentimentam_opening_prices_";
const SNAPSHOT_KEY_LEGACY = "sentimentam_daily_snapshot_v1";

function getTodayDate(): string {
  return new Date().toISOString().split("T")[0];
}

function getOpeningPricesKey(date: string): string {
  return `${OPENING_PRICES_PREFIX}${date}`;
}

/** Load opening prices for today — returns null if none stored for today. */
function loadTodayOpeningPrices(): Record<string, number> | null {
  try {
    const key = getOpeningPricesKey(getTodayDate());
    const stored = localStorage.getItem(key);
    if (stored) return JSON.parse(stored) as Record<string, number>;
  } catch {
    /* ignore */
  }
  return null;
}

/** Write opening prices for today. */
function saveTodayOpeningPrices(prices: Record<string, number>): void {
  try {
    const key = getOpeningPricesKey(getTodayDate());
    localStorage.setItem(key, JSON.stringify(prices));
  } catch {
    /* ignore */
  }
}

/** Prune any opening price keys from prior dates to avoid localStorage bloat. */
function pruneStalePriceKeys(): void {
  try {
    const todayKey = getOpeningPricesKey(getTodayDate());
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(OPENING_PRICES_PREFIX) && k !== todayKey) {
        keysToRemove.push(k);
      }
    }
    for (const k of keysToRemove) localStorage.removeItem(k);
  } catch {
    /* ignore */
  }
}

// ── Shared return type ────────────────────────────────────────────────────────
interface DailyPnLResult {
  dailyPnL: number;
  dailyPnLPercent: number;
  isPositive: boolean;
  isNegative: boolean;
  /** @deprecated use dailyPnL — kept for legacy callers */
  dailyChange: number;
  /** @deprecated use dailyPnLPercent — kept for legacy callers */
  dailyChangePct: number;
  /** @deprecated use dailyPnL + dailyPnLPercent for display — kept for legacy callers */
  formatted: string;
}

// ── Overload signatures ───────────────────────────────────────────────────────

/**
 * New signature: per-holding opening value logic.
 * Use this in PortfolioHeader — accepts holdings, costBasisMap, and liveRedeemPriceFn.
 */
export function useDailyPnL(
  holdings: Array<[string, Holding]>,
  costBasisMap: Map<string, number>,
  liveRedeemPriceFn: (name: string) => number,
): DailyPnLResult;

/**
 * Legacy signature: accepts a single totalPortfolioValue number.
 * Kept for backward compatibility with ProfileSlideOver and any other callers.
 */
export function useDailyPnL(currentTotal: number): DailyPnLResult;

// ── Implementation ────────────────────────────────────────────────────────────
export function useDailyPnL(
  holdingsOrTotal: Array<[string, Holding]> | number,
  costBasisMap?: Map<string, number>,
  liveRedeemPriceFn?: (name: string) => number,
): DailyPnLResult {
  // ── BRANCH: Legacy mode (single number arg) ──────────────────────────────────
  const isLegacy = typeof holdingsOrTotal === "number";

  // Legacy snapshot state — only used in legacy mode
  const legacySeededRef = useRef(false);
  const [legacySnapshotValue, setLegacySnapshotValue] = useState<number>(() => {
    if (!isLegacy) return 0;
    try {
      const stored = localStorage.getItem(SNAPSHOT_KEY_LEGACY);
      if (stored) {
        const parsed = JSON.parse(stored) as { date: string; value: number };
        if (parsed.date === getTodayDate()) return parsed.value;
      }
    } catch {
      /* ignore */
    }
    return 0;
  });

  // Legacy: seed snapshot once on first valid total
  useEffect(() => {
    if (!isLegacy) return;
    const currentTotal = holdingsOrTotal as number;
    if (currentTotal <= 0 || legacySeededRef.current) return;

    const today = getTodayDate();
    try {
      const stored = localStorage.getItem(SNAPSHOT_KEY_LEGACY);
      if (stored) {
        const parsed = JSON.parse(stored) as { date: string; value: number };
        if (parsed.date === today) {
          setLegacySnapshotValue(parsed.value);
          legacySeededRef.current = true;
          return;
        }
      }
    } catch {
      /* ignore */
    }

    // New day or first ever — seed with current total
    try {
      localStorage.setItem(
        SNAPSHOT_KEY_LEGACY,
        JSON.stringify({ date: today, value: currentTotal }),
      );
    } catch {
      /* ignore */
    }
    setLegacySnapshotValue(currentTotal);
    legacySeededRef.current = true;
  }, [isLegacy, holdingsOrTotal]);

  // ── BRANCH: New per-holding mode ─────────────────────────────────────────────
  const snapshotWrittenRef = useRef(false);

  // Refs so the mount effect accesses latest values without dep-array instability
  const holdingsRef = useRef<Array<[string, Holding]>>([]);
  const liveRedeemPriceFnRef = useRef<(name: string) => number>(() => 0);

  if (!isLegacy) {
    holdingsRef.current = holdingsOrTotal as Array<[string, Holding]>;
    liveRedeemPriceFnRef.current = liveRedeemPriceFn!;
  }

  // Snapshot: write opening prices on first load of new calendar day (new mode only)
  useEffect(() => {
    if (isLegacy) return;
    if (snapshotWrittenRef.current) return;

    const existing = loadTodayOpeningPrices();
    if (!existing) {
      const snapshot: Record<string, number> = {};
      for (const [name, holding] of holdingsRef.current) {
        if (holding.units > 0) {
          snapshot[name] = liveRedeemPriceFnRef.current(name);
        }
      }
      saveTodayOpeningPrices(snapshot);
      pruneStalePriceKeys();
    }

    snapshotWrittenRef.current = true;
  }, [isLegacy]); // isLegacy is stable — won't cause re-runs

  // Add new holdings to snapshot as they are created (new mode only)
  useEffect(() => {
    if (isLegacy) return;
    const holdings = holdingsOrTotal as Array<[string, Holding]>;
    const existing = loadTodayOpeningPrices();
    if (!existing) return;

    let updated = false;
    for (const [name, holding] of holdings) {
      if (holding.units > 0 && !(name in existing)) {
        existing[name] = liveRedeemPriceFn!(name);
        updated = true;
      }
    }
    if (updated) saveTodayOpeningPrices(existing);
  }, [isLegacy, holdingsOrTotal, liveRedeemPriceFn]);

  // ── Compute result ────────────────────────────────────────────────────────────
  let dailyPnL: number;
  let openingValue: number;

  if (isLegacy) {
    const currentTotal = holdingsOrTotal as number;
    const base = legacySnapshotValue > 0 ? legacySnapshotValue : currentTotal;
    dailyPnL = currentTotal - base;
    openingValue = base > 0 ? base : currentTotal;
  } else {
    const holdings = holdingsOrTotal as Array<[string, Holding]>;
    const openingPrices = loadTodayOpeningPrices() ?? {};
    const todayStr = getTodayDate();

    let currentInvestedValue = 0;
    let openingInvestedValue = 0;

    for (const [name, holding] of holdings) {
      if (holding.units <= 0) continue;

      const livePrice = liveRedeemPriceFn!(name);
      const basis = costBasisMap?.get(name) ?? 0;

      let openedBeforeToday = false;
      try {
        const tsMs = Number(holding.allocationTimestamp) / 1_000_000;
        if (tsMs > 0) {
          const allocationDate = new Date(tsMs).toISOString().split("T")[0];
          openedBeforeToday = allocationDate < todayStr;
        }
      } catch {
        /* treat as opened today */
      }

      const storedOpeningPrice = openingPrices[name];
      let holdingOpeningValue: number;

      if (openedBeforeToday && storedOpeningPrice !== undefined) {
        holdingOpeningValue = holding.units * storedOpeningPrice;
      } else {
        holdingOpeningValue = basis > 0 ? basis : holding.units * livePrice;
      }

      currentInvestedValue += holding.units * livePrice;
      openingInvestedValue += holdingOpeningValue;
    }

    dailyPnL = currentInvestedValue - openingInvestedValue;
    openingValue = openingInvestedValue;
  }

  const dailyPnLPercent =
    openingValue > 0 ? (dailyPnL / openingValue) * 100 : 0;
  const isPositive = dailyPnL > 0.005;
  const isNegative = dailyPnL < -0.005;

  const absChange = Math.abs(dailyPnL);
  const absChangePct = Math.abs(dailyPnLPercent);
  const sign = isPositive ? "+" : isNegative ? "-" : "";
  const formatted = `${sign}$${absChange.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (${sign}${absChangePct.toFixed(2)}%) today`;

  return {
    dailyPnL,
    dailyPnLPercent,
    isPositive,
    isNegative,
    dailyChange: dailyPnL,
    dailyChangePct: dailyPnLPercent,
    formatted,
  };
}
