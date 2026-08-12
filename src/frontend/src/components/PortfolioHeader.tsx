import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { BarChart2, TrendingDown, TrendingUp, Wallet, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";
import {
  Area,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  YAxis,
} from "recharts";
import { useAuth } from "../contexts/AuthContext";
import { useLocalHoldings } from "../contexts/LocalHoldingsContext";
import { useOracleTick } from "../contexts/OracleTickContext";
import { useWalletContext } from "../contexts/WalletContext";
import { FALLBACK_ASSET_DEFS } from "../data/fallbackAssets";
import { useDailyPnL } from "../hooks/useDailyPnL";
import { useLocalHoldingsQuery } from "../hooks/useLocalHoldingsQuery";
import { useAssetPrices } from "../hooks/useQueries";
import { useUserFullPosition } from "../hooks/useUserFullPosition";
import { useYieldAccrual } from "../hooks/useYieldAccrual";
import { INDEX_DISPLAY_NAMES } from "../lib/oracle/indexCategoryRegistry";
import type { Holding } from "../types/backendEnums";
import type { TabType } from "./BottomNav";
import { DepositModal } from "./DepositModal";
import { YieldProgressBar } from "./YieldProgressBar";

// ── God-Tier base scores — fallback pricing when backend has no entry ─────────
const GOD_TIER_BASE_SCORES: Record<string, number> = Object.fromEntries(
  FALLBACK_ASSET_DEFS.map((d) => [d.name, d.baseScore]),
);

const BASE_SCORE_FALLBACK = 50.0;
const SPREAD = 0.5;

const PNL_TOGGLE_SUFFIX = "sentimentam_pnl_toggle_preference";
type PnLToggle = "TODAY" | "ALL_TIME";

function loadTogglePreference(userId: string): PnLToggle {
  try {
    const stored = localStorage.getItem(`${userId}_${PNL_TOGGLE_SUFFIX}`);
    if (stored === "TODAY" || stored === "ALL_TIME") return stored;
  } catch {
    /* ignore */
  }
  return "TODAY";
}

function saveTogglePreference(userId: string, value: PnLToggle): void {
  try {
    localStorage.setItem(`${userId}_${PNL_TOGGLE_SUFFIX}`, value);
  } catch {
    /* ignore */
  }
}

function fmt(value: number) {
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtPnL(value: number): string {
  const abs = Math.abs(value);
  const sign = value > 0.005 ? "+" : value < -0.005 ? "-" : "";
  return `${sign}$${abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ── Category color maps ────────────────────────────────────────────────────────
const CATEGORY_COLORS: Record<
  string,
  { bar: string; badge: string; text: string; dot: string }
> = {
  MACRO: {
    bar: "bg-blue-500",
    badge: "bg-blue-500/10",
    text: "text-blue-400",
    dot: "bg-blue-500",
  },
  GEOPOLITICAL: {
    bar: "bg-orange-500",
    badge: "bg-orange-500/10",
    text: "text-orange-400",
    dot: "bg-orange-500",
  },
  CULTURAL: {
    bar: "bg-purple-500",
    badge: "bg-purple-500/10",
    text: "text-purple-400",
    dot: "bg-purple-500",
  },
  SPORTS: {
    bar: "bg-green-500",
    badge: "bg-green-500/10",
    text: "text-green-400",
    dot: "bg-green-500",
  },
  TECHNOLOGY: {
    bar: "bg-cyan-500",
    badge: "bg-cyan-500/10",
    text: "text-cyan-400",
    dot: "bg-cyan-500",
  },
  HEALTH: {
    bar: "bg-pink-500",
    badge: "bg-pink-500/10",
    text: "text-pink-400",
    dot: "bg-pink-500",
  },
};

function getCategoryForName(name: string): string {
  return FALLBACK_ASSET_DEFS.find((a) => a.name === name)?.category ?? "MACRO";
}

// ── Direction pill — matches AssetRow.tsx CategoryBadge style ──────────────────
// inline-flex items-center px-1.5 py-0.5 rounded-sm border text-[9px] uppercase
// tracking-widest font-bold; HIGH = green, LOW = red.
function DirectionPill({ direction }: { direction: "HIGH" | "LOW" }) {
  const cls =
    direction === "HIGH"
      ? "bg-green-500/10 text-green-400 border-green-500/30"
      : "bg-red-500/10 text-red-400 border-red-500/30";
  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded-sm border text-[9px] uppercase tracking-widest font-bold ${cls}`}
      data-ocid={`portfolio.direction-pill.${direction.toLowerCase()}`}
    >
      {direction}
    </span>
  );
}

/**
 * Sub-component for a single holding row — isolates the useYieldAccrual hook call
 * so it is always called unconditionally at the top level of a component.
 */
function HoldingRow({
  name,
  holding,
  redeemPrice: _redeemPrice,
  costBasis,
  hasUnlockedPnL,
  onUnlock,
  index,
  category,
  platformAllocated,
  onSelectIndex,
  direction,
  unitCountOverride,
  pnlValueOverride,
}: {
  name: string;
  holding: Holding;
  redeemPrice: number;
  costBasis: number;
  hasUnlockedPnL: boolean;
  onUnlock: () => void;
  index: number;
  category: string;
  platformAllocated: number;
  onSelectIndex?: (name: string) => void;
  direction?: "HIGH" | "LOW";
  unitCountOverride?: number;
  pnlValueOverride?: number;
}) {
  const liveUnits = useYieldAccrual({
    baseUnits: holding.units,
    accruedYield: holding.accruedYield,
  });

  const { finalScores, scoreHistoryMap } = useOracleTick();
  const rawScore =
    finalScores.get(name) ?? GOD_TIER_BASE_SCORES[name] ?? BASE_SCORE_FALLBACK;
  const liveRedeemPrice = Math.max(0.01, rawScore - SPREAD);

  // Direction-aware unit count and live value.
  // - HIGH (long): prefer longUnits from useUserFullPosition when nonzero,
  //   otherwise fall back to the legacy holding.units (+ accruedYield).
  // - LOW (short): use shortUnits from useUserFullPosition.
  // When overrides are supplied by the parent (the split-row builder), they
  // win over the legacy derivation so the same row component can render either
  // direction.
  const effectiveUnits =
    unitCountOverride !== undefined
      ? unitCountOverride
      : direction === "LOW"
        ? 0
        : liveUnits;
  const liveValue =
    pnlValueOverride !== undefined
      ? pnlValueOverride
      : liveUnits * liveRedeemPrice;

  const borderLeftColor =
    hasUnlockedPnL && liveValue > costBasis
      ? "rgb(74 222 128)"
      : hasUnlockedPnL && liveValue <= costBasis
        ? "rgb(248 113 113)"
        : "rgb(99 102 241)";

  // Feature A — Sparkline data
  const scoreHistory = scoreHistoryMap.get(name) ?? [];
  const sparkData = scoreHistory.map((v, i) => ({ i, v }));
  const sparkStroke = "rgba(255,255,255,0.15)";

  // Feature I — Utilization
  const POOL_REF_CAP = 7500;
  const utilizationRatio = Math.min(1, platformAllocated / POOL_REF_CAP);
  const utilizationBarColor = "bg-white/20";

  return (
    <motion.div
      key={name}
      className="group flex flex-col py-1.5 px-2 sm:py-2 sm:px-3 rounded-sm bg-white/[0.02] border border-border/50 transition-all duration-150 hover:bg-white/[0.04] hover:border-border/80"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: "easeOut", delay: index * 0.06 }}
    >
      {/* Top row: name + category badge + score + price + value + shares */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-1">
        {/* Left: dot + name + category badge */}
        <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 min-w-0">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary/60 shrink-0" />
          <button
            type="button"
            className="text-foreground text-sm font-medium truncate cursor-pointer hover:text-white transition-colors text-left min-w-0"
            onClick={() => onSelectIndex?.(name)}
          >
            {INDEX_DISPLAY_NAMES[name] ?? name}
          </button>
          {direction && <DirectionPill direction={direction} />}
        </div>

        {/* Right: score + price + shares + value */}
        <div className="flex items-baseline gap-4 shrink-0">
          {/* Score */}
          <div className="hidden sm:flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-white/30" />
            <div className="text-right">
              <p className="text-[9px] uppercase tracking-widest text-muted-foreground">
                Score
              </p>
              <p className="font-mono text-[11px] text-muted-foreground">
                {rawScore.toFixed(1)}
              </p>
            </div>
          </div>
          {/* Price */}
          <div className="hidden sm:block text-right">
            <p className="text-[9px] uppercase tracking-widest text-muted-foreground">
              Price
            </p>
            <p className="font-mono text-[11px] text-muted-foreground">
              {liveRedeemPrice.toFixed(2)}
            </p>
          </div>
          {/* Shares */}
          <div className="text-right">
            <p className="text-[9px] uppercase tracking-widest text-muted-foreground">
              Shares
            </p>
            <p className="font-mono text-[11px] text-muted-foreground">
              {effectiveUnits.toFixed(4)}
            </p>
          </div>
          {/* Value */}
          <div className="text-right min-w-[80px]">
            <p className="text-[9px] uppercase tracking-widest text-muted-foreground">
              Value
            </p>
            <p className="text-muted-foreground font-mono text-[11px] sm:text-[15px] sm:font-semibold">
              {fmt(liveValue)}
            </p>
          </div>
        </div>
      </div>

      {/* P&L / Yield Progress Bar — one-way unlock via hasUnlockedPnL */}
      <YieldProgressBar
        costBasis={costBasis}
        currentValue={liveValue}
        hasUnlockedPnL={hasUnlockedPnL}
        onUnlock={onUnlock}
      />

    </motion.div>
  );
}

/**
 * Per-holding child component that splits a single holding into one or two
 * direction rows (HIGH long, LOW short) using useUserFullPosition.
 *
 * The hook cannot be called inside the parent render loop, so this component
 * isolates the per-name query and renders the appropriate HoldingRow(s).
 */
function PositionRows({
  name,
  holding,
  redeemPrice,
  costBasis,
  shortCostBasis,
  hasUnlockedPnL,
  onUnlock,
  index,
  category,
  platformAllocated,
  onSelectIndex,
}: {
  name: string;
  holding: Holding;
  redeemPrice: number;
  costBasis: number;
  shortCostBasis: number;
  hasUnlockedPnL: boolean;
  onUnlock: () => void;
  index: number;
  category: string;
  platformAllocated: number;
  onSelectIndex?: (name: string) => void;
}) {
  const { data: position } = useUserFullPosition(name);

  const longUnits = position?.longUnits ?? 0;
  const shortUnits = position?.shortUnits ?? 0;
  const longMarkToMarket = position?.longMarkToMarket ?? 0;
  const shortMarkToMarket = position?.shortMarkToMarket ?? 0;

  // Legacy long MTM fallback when the hook has no data yet.
  const rawScore =
    // finalScores is not available here; HoldingRow recomputes its own price.
    // We only need a fallback PnL value for the long row when the hook is
    // still loading. Use the holding's own units * a conservative price.
    holding.units > 0
      ? (holding.units + holding.accruedYield) * Math.max(0.01, redeemPrice)
      : 0;

  const hasLong = longUnits > 0 || holding.units > 0;
  const hasShort = shortUnits > 0;

  const rows: Array<ReactNode> = [];

  if (hasLong) {
    const unitCountOverride = longUnits > 0 ? longUnits : holding.units;
    const pnlValueOverride = longUnits > 0 ? longMarkToMarket : rawScore;
    rows.push(
      <HoldingRow
        key={`${name}-HIGH`}
        name={name}
        holding={holding}
        redeemPrice={redeemPrice}
        costBasis={costBasis}
        hasUnlockedPnL={hasUnlockedPnL}
        onUnlock={onUnlock}
        index={index}
        category={category}
        platformAllocated={platformAllocated}
        onSelectIndex={onSelectIndex}
        direction="HIGH"
        unitCountOverride={unitCountOverride}
        pnlValueOverride={pnlValueOverride}
      />,
    );
  }

  if (hasShort) {
    rows.push(
      <HoldingRow
        key={`${name}-LOW`}
        name={name}
        holding={holding}
        redeemPrice={redeemPrice}
        costBasis={shortCostBasis}
        hasUnlockedPnL={shortCostBasis > 0}
        onUnlock={onUnlock}
        index={index}
        category={category}
        platformAllocated={platformAllocated}
        onSelectIndex={onSelectIndex}
        direction="LOW"
        unitCountOverride={shortUnits}
        pnlValueOverride={shortMarkToMarket}
      />,
    );
  }

  // If neither direction has units (shouldn't happen for active holdings),
  // fall back to a single HIGH row using the legacy holding data.
  if (rows.length === 0) {
    rows.push(
      <HoldingRow
        key={`${name}-HIGH`}
        name={name}
        holding={holding}
        redeemPrice={redeemPrice}
        costBasis={costBasis}
        hasUnlockedPnL={hasUnlockedPnL}
        onUnlock={onUnlock}
        index={index}
        category={category}
        platformAllocated={platformAllocated}
        onSelectIndex={onSelectIndex}
        direction="HIGH"
      />,
    );
  }

  return <>{rows}</>;
}

/**
 * Aggregator component that runs useUserFullPosition for each holding and
 * reports the sum of short mark-to-market values up to the parent via a
 * callback. This is necessary because useUserFullPosition cannot be called
 * inside the parent's render loop.
 */
function ShortTotalAggregator({
  holdings,
  onShortTotal,
}: {
  holdings: Array<{ name: string; holding: Holding }>;
  onShortTotal: (total: number) => void;
}) {
  // Per-instance map so short totals never bleed across user sessions.
  const totalsRef = useRef(new Map<string, number>());

  return (
    <div className="hidden" aria-hidden="true">
      {holdings.map(({ name }) => (
        <ShortTotalCollector
          key={name}
          name={name}
          totalsRef={totalsRef}
          onShortTotal={onShortTotal}
        />
      ))}
    </div>
  );
}

function ShortTotalCollector({
  name,
  totalsRef,
  onShortTotal,
}: {
  name: string;
  totalsRef: RefObject<Map<string, number>>;
  onShortTotal: (total: number) => void;
}) {
  const { data: position } = useUserFullPosition(name);
  const shortMTM = position?.shortMarkToMarket ?? 0;

  useEffect(() => {
    totalsRef.current.set(name, shortMTM);
    const total = Array.from(totalsRef.current.values()).reduce(
      (sum, v) => sum + v,
      0,
    );
    onShortTotal(total);
    return () => {
      totalsRef.current.delete(name);
    };
  }, [name, shortMTM, onShortTotal, totalsRef]);

  return null;
}

function IndexSlideOver({
  selectedIndex,
  onClose,
  finalScores,
  costBasisMap,
  shortCostBasisMap,
  holdingsData,
  totalPortfolioValue,
  activityHistory,
  todayMs,
}: {
  selectedIndex: string;
  onClose: () => void;
  finalScores: Map<string, number>;
  costBasisMap: Map<string, number>;
  shortCostBasisMap: Map<string, number>;
  holdingsData: Array<[string, Holding]> | undefined;
  totalPortfolioValue: number;
  activityHistory: { source: string; timestamp: number; type: string; amount: number }[];
  todayMs: number;
}) {
  const { data: position } = useUserFullPosition(selectedIndex);

  const indexHolding = holdingsData?.find(([n]) => n === selectedIndex)?.[1];
  const rawScore =
    finalScores.get(selectedIndex) ??
    GOD_TIER_BASE_SCORES[selectedIndex] ??
    BASE_SCORE_FALLBACK;
  const liveRedeemPriceIdx = Math.max(0.01, rawScore - SPREAD);

  const longUnits = indexHolding?.units ?? 0;
  const longAccrued = indexHolding?.accruedYield ?? 0;
  const shortUnits = position?.shortUnits ?? 0;
  const shortMarkToMarket = position?.shortMarkToMarket ?? 0;

  const hasShort = shortUnits > 0;
  const hasLong = longUnits > 0;

  // Long stats
  const longLiveValue = (longUnits + longAccrued) * liveRedeemPriceIdx;
  const longBasis = costBasisMap.get(selectedIndex) ?? 0;

  // Short stats
  const shortBasis = shortCostBasisMap.get(selectedIndex) ?? 0;
  const shortUnrealizedPnL = shortMarkToMarket - shortBasis;

  // Combined display values — prefer short when only short exists
  const displayUnits = hasLong ? longUnits + longAccrued : shortUnits;
  const displayValue = hasLong ? longLiveValue : shortMarkToMarket;
  const displayBasis = hasLong ? longBasis : shortBasis;
  const unrealizedReturn = hasLong ? longLiveValue - longBasis : shortUnrealizedPnL;
  const unrealizedReturnPct =
    displayBasis > 0 ? (unrealizedReturn / displayBasis) * 100 : 0;
  const avgCostIdx = displayUnits > 0 ? displayBasis / displayUnits : 0;
  const portfolioPctIdx =
    totalPortfolioValue > 0 ? (displayValue / totalPortfolioValue) * 100 : 0;

  const idxCategory = getCategoryForName(selectedIndex);
  const idxCatColors = CATEGORY_COLORS[idxCategory] ?? CATEGORY_COLORS.MACRO;

  const todayActivityIdx = activityHistory.filter(
    (e) => e.source === selectedIndex && e.timestamp >= todayMs,
  );
  const todayReturnIdx =
    todayActivityIdx.reduce((sum, e) => {
      if (e.type === "Credit") return sum + e.amount;
      if (e.type === "Spend") return sum - e.amount;
      return sum;
    }, 0) + unrealizedReturn;

  const recentActivity = activityHistory
    .filter((e) => e.source === selectedIndex)
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 3);

  const scoreValue = finalScores.get(selectedIndex) ?? GOD_TIER_BASE_SCORES[selectedIndex] ?? BASE_SCORE_FALLBACK;
  const scoreIsHigh = scoreValue >= 50;

  return (
    <>
      <motion.div
        className="fixed inset-0 bg-black/60 z-40"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      />
      <motion.div
        className="fixed right-0 top-0 h-full z-50 flex flex-col w-full sm:w-96"
        style={{ background: "#0a0a0a", borderLeft: "1px solid #1e1e1e", fontFamily: "'Inter', system-ui, sans-serif" }}
        initial={{ x: "100%" }}
        animate={{ x: 0 }}
        exit={{ x: "100%" }}
        transition={{ type: "spring", damping: 30, stiffness: 300 }}
        data-ocid="portfolio.index-slide-over"
      >
        {/* ── Sticky Header ── */}
        <div style={{ position: "sticky", top: 0, background: "#0a0a0a", borderBottom: "1px solid #1e1e1e", padding: "1rem 1.25rem", display: "flex", alignItems: "center", justifyContent: "space-between", zIndex: 10, flexShrink: 0 }}>
          <div>
            <p style={{ color: "#6b6b6b", fontSize: "0.625rem", textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 500, marginBottom: "0.25rem" }}>
              Position Detail
            </p>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <h2 style={{ color: "#ffffff", fontSize: "1.25rem", fontWeight: 700, letterSpacing: "-0.02em", margin: 0 }}>
                {selectedIndex}
              </h2>
              {/* Score badge */}
              <span style={{
                display: "inline-flex",
                alignItems: "center",
                padding: "2px 8px",
                borderRadius: "9999px",
                fontSize: "0.75rem",
                fontWeight: 600,
                backgroundColor: scoreIsHigh ? "rgba(34,197,94,0.12)" : "rgba(239,68,68,0.12)",
                border: `1px solid ${scoreIsHigh ? "rgba(34,197,94,0.3)" : "rgba(239,68,68,0.3)"}`,
                color: scoreIsHigh ? "#4ade80" : "#f87171",
              }}>
                {scoreValue.toFixed(1)}
              </span>
            </div>
            <div style={{ display: "flex", gap: "0.375rem", marginTop: "0.375rem" }}>
              {hasLong && (
                <span style={{ fontSize: "0.625rem", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700, padding: "2px 6px", borderRadius: "4px", backgroundColor: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.3)", color: "#4ade80" }}>
                  HIGH
                </span>
              )}
              {hasShort && (
                <span style={{ fontSize: "0.625rem", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700, padding: "2px 6px", borderRadius: "4px", backgroundColor: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", color: "#f87171" }}>
                  LOW
                </span>
              )}
              <span style={{ fontSize: "0.625rem", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600, padding: "2px 6px", borderRadius: "4px", backgroundColor: `rgba(0,0,0,0.3)`, border: "1px solid #2a2a2a", color: idxCatColors.text.replace("text-", "") }}>
                {idxCategory}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{ background: "none", border: "none", cursor: "pointer", color: "#6b6b6b", padding: "0.375rem", display: "flex", alignItems: "center", justifyContent: "center" }}
            data-ocid="portfolio.index-slide-over.close_button"
          >
            <X size={18} />
          </button>
        </div>

        {/* ── Scrollable Body ── */}
        <div style={{ flex: 1, overflowY: "auto", padding: "1rem 1.25rem", display: "flex", flexDirection: "column", gap: "1rem" }}>

          {/* ── P&L Hero ── */}
          <div style={{ borderRadius: "0.75rem", background: "#111111", border: "1px solid #1e1e1e", padding: "1rem" }}>
            <p style={{ color: "#6b6b6b", fontSize: "0.625rem", textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 500, marginBottom: "0.5rem" }}>
              Unrealized P&amp;L
            </p>
            <p style={{ fontSize: "2rem", fontWeight: 700, letterSpacing: "-0.03em", color: unrealizedReturn >= 0 ? "#4ade80" : "#f87171", margin: 0 }}>
              {fmtPnL(unrealizedReturn)}
            </p>
            <p style={{ color: "#6b6b6b", fontSize: "0.75rem", marginTop: "0.25rem" }}>
              {unrealizedReturnPct >= 0 ? "+" : ""}{unrealizedReturnPct.toFixed(2)}% · Basis {fmt(displayBasis)}
            </p>
          </div>

          {/* ── Long position card ── */}
          {hasLong && (
            <motion.div
              style={{ borderRadius: "0.75rem", background: "rgba(5,46,22,0.3)", border: "1px solid rgba(22,101,52,0.3)", padding: "1rem" }}
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.25, ease: "easeOut" }}
            >
              <p style={{ color: "#4ade80", fontSize: "0.6875rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "0.75rem" }}>
                High (Long)
              </p>
              <p style={{ fontSize: "1.75rem", fontWeight: 700, letterSpacing: "-0.03em", color: "#ffffff", marginBottom: "0.75rem" }}>
                {fmt(longLiveValue)}
              </p>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
                <div>
                  <p style={{ color: "#6b6b6b", fontSize: "0.625rem", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "0.125rem" }}>Cost Basis</p>
                  <p style={{ color: "#ffffff", fontSize: "0.875rem", fontWeight: 600 }}>{fmt(longBasis)}</p>
                </div>
                <div>
                  <p style={{ color: "#6b6b6b", fontSize: "0.625rem", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "0.125rem" }}>Shares</p>
                  <p style={{ color: "#ffffff", fontSize: "0.875rem", fontWeight: 600 }}>{(longUnits + longAccrued).toFixed(4)}</p>
                </div>
                <div>
                  <p style={{ color: "#6b6b6b", fontSize: "0.625rem", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "0.125rem" }}>Avg Cost/Share</p>
                  <p style={{ color: "#ffffff", fontSize: "0.875rem", fontWeight: 600 }}>{fmt(avgCostIdx)}</p>
                </div>
                <div>
                  <p style={{ color: "#6b6b6b", fontSize: "0.625rem", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "0.125rem" }}>% of Portfolio</p>
                  <p style={{ color: "#ffffff", fontSize: "0.875rem", fontWeight: 600 }}>
                    {totalPortfolioValue > 0 ? ((longLiveValue / totalPortfolioValue) * 100).toFixed(1) : "0.0"}%
                  </p>
                </div>
                <div style={{ gridColumn: "1 / -1" }}>
                  <p style={{ color: "#6b6b6b", fontSize: "0.625rem", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "0.125rem" }}>Unrealized P&amp;L</p>
                  <p style={{ fontSize: "0.875rem", fontWeight: 700, color: longLiveValue - longBasis >= 0 ? "#4ade80" : "#f87171" }}>
                    {fmtPnL(longLiveValue - longBasis)}
                    {longBasis > 0 && <span style={{ fontSize: "0.75rem", opacity: 0.75, fontWeight: 400 }}> ({(((longLiveValue - longBasis) / longBasis) * 100).toFixed(1)}%)</span>}
                  </p>
                </div>
              </div>
            </motion.div>
          )}

          {/* ── Short position card ── */}
          {hasShort && (
            <motion.div
              style={{ borderRadius: "0.75rem", background: "rgba(69,10,10,0.3)", border: "1px solid rgba(127,29,29,0.3)", padding: "1rem" }}
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.25, ease: "easeOut", delay: hasLong ? 0.05 : 0 }}
            >
              <p style={{ color: "#f87171", fontSize: "0.6875rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "0.75rem" }}>
                Low (Short)
              </p>
              <p style={{ fontSize: "1.75rem", fontWeight: 700, letterSpacing: "-0.03em", color: "#ffffff", marginBottom: "0.75rem" }}>
                {fmt(shortMarkToMarket)}
              </p>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
                <div>
                  <p style={{ color: "#6b6b6b", fontSize: "0.625rem", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "0.125rem" }}>Cost Basis</p>
                  <p style={{ color: "#ffffff", fontSize: "0.875rem", fontWeight: 600 }}>{fmt(shortBasis)}</p>
                </div>
                <div>
                  <p style={{ color: "#6b6b6b", fontSize: "0.625rem", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "0.125rem" }}>Units Short</p>
                  <p style={{ color: "#ffffff", fontSize: "0.875rem", fontWeight: 600 }}>{shortUnits.toFixed(4)}</p>
                </div>
                <div>
                  <p style={{ color: "#6b6b6b", fontSize: "0.625rem", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "0.125rem" }}>% of Portfolio</p>
                  <p style={{ color: "#ffffff", fontSize: "0.875rem", fontWeight: 600 }}>
                    {totalPortfolioValue > 0 ? ((shortMarkToMarket / totalPortfolioValue) * 100).toFixed(1) : "0.0"}%
                  </p>
                </div>
                <div>
                  <p style={{ color: "#6b6b6b", fontSize: "0.625rem", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "0.125rem" }}>Unrealized P&amp;L</p>
                  <p style={{ fontSize: "0.875rem", fontWeight: 700, color: shortUnrealizedPnL >= 0 ? "#4ade80" : "#f87171" }}>
                    {fmtPnL(shortUnrealizedPnL)}
                    {shortBasis > 0 && <span style={{ fontSize: "0.75rem", opacity: 0.75, fontWeight: 400 }}> ({((shortUnrealizedPnL / shortBasis) * 100).toFixed(1)}%)</span>}
                  </p>
                </div>
              </div>
            </motion.div>
          )}

          {/* ── Oracle Score ── */}
          <div style={{ borderRadius: "0.75rem", background: "#111111", border: "1px solid #1e1e1e", padding: "1rem" }}>
            <p style={{ color: "#6b6b6b", fontSize: "0.625rem", textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 500, marginBottom: "0.5rem" }}>
              Oracle Score
            </p>
            <p style={{ fontSize: "2.5rem", fontWeight: 700, letterSpacing: "-0.04em", color: scoreIsHigh ? "#4ade80" : "#f87171", margin: 0 }}>
              {scoreValue.toFixed(1)}
            </p>
            <div style={{ marginTop: "0.625rem", height: "4px", borderRadius: "9999px", background: "#1e1e1e", overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${Math.min(100, scoreValue)}%`, borderRadius: "9999px", background: scoreIsHigh ? "#4ade80" : "#f87171", transition: "width 0.5s ease" }} />
            </div>
            <p style={{ color: "#6b6b6b", fontSize: "0.75rem", marginTop: "0.375rem" }}>
              {scoreIsHigh ? "Bullish momentum" : "Bearish momentum"} · {idxCategory}
            </p>
          </div>

          {/* ── Recent Activity ── */}
          <div style={{ borderRadius: "0.75rem", background: "#111111", border: "1px solid #1e1e1e", padding: "1rem" }}>
            <p style={{ color: "#6b6b6b", fontSize: "0.625rem", textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 500, marginBottom: "0.75rem" }}>
              Recent Activity
            </p>
            {recentActivity.length === 0 ? (
              <p style={{ color: "#6b6b6b", fontSize: "0.8125rem" }}>No recent activity.</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "0.625rem" }}>
                {recentActivity.map((e) => (
                  <div key={e.timestamp} style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                      <span style={{
                        fontSize: "0.625rem",
                        fontWeight: 700,
                        textTransform: "uppercase",
                        letterSpacing: "0.08em",
                        padding: "2px 6px",
                        borderRadius: "4px",
                        backgroundColor: e.type === "Credit" ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.1)",
                        border: `1px solid ${e.type === "Credit" ? "rgba(34,197,94,0.3)" : "rgba(239,68,68,0.3)"}`,
                        color: e.type === "Credit" ? "#4ade80" : "#f87171",
                      }}>
                        {e.type}
                      </span>
                      <span style={{ color: "#6b6b6b", fontSize: "0.75rem" }}>
                        {new Date(e.timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                      </span>
                    </div>
                    <span style={{ color: "#ffffff", fontSize: "0.875rem", fontWeight: 600 }}>
                      {e.type === "Credit" ? "+" : "-"}{fmt(e.amount)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

        </div>
      </motion.div>
    </>
  );
}

export function PortfolioHeader({
  onTabChange,
}: {
  onTabChange?: (tab: TabType) => void;
}) {
  const { userAccount } = useAuth();
  const userId = userAccount?.email ?? "";
  const {
    walletBalance: localCashBalance,
    depositFunds,
    activityHistory,
  } = useWalletContext();
  const { data: holdingsData, isLoading: holdingsLoading } =
    useLocalHoldingsQuery();
  const { data: assetPrices, isLoading: pricesLoading } = useAssetPrices();
  const { costBasisMap, shortCostBasisMap, pnlUnlockedMap, unlockPnL } = useLocalHoldings();
  const { finalScores, platformAllocatedByIndex, tickCount } = useOracleTick();

  const [isDepositOpen, setIsDepositOpen] = useState(false);
  const [shortHoldingsTotal, setShortHoldingsTotal] = useState(0);
  const [pnlToggle, setPnlToggle] = useState<PnLToggle>(() =>
    loadTogglePreference(userId),
  );
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<
    "default" | "newest" | "oldest" | "capital" | "pct_change"
  >("default");
  const [timeRange, setTimeRange] = useState<"LIVE" | "1D" | "1W" | "1M" | "3M" | "YTD" | "1Y" | "ALL">("1D");
  const [scrubbedValue, setScrubbedValue] = useState<number | null>(null);

  const PORTFOLIO_HISTORY_KEY = userId
    ? `mt_portfolio_value_history_v1_${userId}`
    : null;

  // Portfolio value history ref — persisted to localStorage
  const portfolioHistoryRef = useRef<Array<{ value: number; ts: number }>>([]);
  const portfolioHistoryLoadedRef = useRef(false);

  // Restore history from localStorage on first mount for this user
  useEffect(() => {
    if (!PORTFOLIO_HISTORY_KEY || portfolioHistoryLoadedRef.current) return;
    portfolioHistoryLoadedRef.current = true;
    try {
      const raw = localStorage.getItem(PORTFOLIO_HISTORY_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          // Discard any entries from the old { value, tick } format (no ts field)
          portfolioHistoryRef.current = parsed.filter(
            (e: unknown) =>
              typeof e === "object" &&
              e !== null &&
              typeof (e as Record<string, unknown>).ts === "number" &&
              typeof (e as Record<string, unknown>).value === "number",
          );
        }
      }
    } catch {
      // malformed — start empty
    }
  }, [PORTFOLIO_HISTORY_KEY]);

  // Portfolio history accumulator — push on each Oracle tick
  useEffect(() => {
    if (totalPortfolioValue <= 0) return;
    const prev = portfolioHistoryRef.current;
    const last = prev[prev.length - 1];
    // Always record; skip only exact duplicates within the same minute
    const sameMinute = last && Math.floor(last.ts / 60000) === Math.floor(Date.now() / 60000);
    if (sameMinute && last.value === totalPortfolioValue) return;
    const entry = { value: Math.round(totalPortfolioValue * 100) / 100, ts: Date.now() };
    portfolioHistoryRef.current = [
      ...portfolioHistoryRef.current,
      entry,
    ].slice(-525600); // up to 1Y at 1 tick/min
    if (PORTFOLIO_HISTORY_KEY) {
      try {
        localStorage.setItem(
          PORTFOLIO_HISTORY_KEY,
          JSON.stringify(portfolioHistoryRef.current),
        );
      } catch {
        // quota exceeded — skip
      }
    }
  }, [tickCount]); // eslint-disable-line react-hooks/exhaustive-deps

  const isLoading = holdingsLoading || pricesLoading;

  // ── liveRedeemPrice function — memoised, stable reference ───────────────────
  const getLiveRedeemPrice = useCallback(
    (name: string): number => {
      if (assetPrices) {
        const ap = assetPrices.find((a) => a.name === name);
        if (ap) {
          const liveScore = finalScores.get(name);
          if (liveScore !== undefined) {
            const spreadOffset = ap.buyPrice - ap.baseScore;
            return Math.max(
              0.01,
              Math.round((liveScore - spreadOffset) * 100) / 100,
            );
          }
          return Math.max(0.01, ap.redeemPrice);
        }
      }
      const liveScore = finalScores.get(name);
      if (liveScore !== undefined) {
        return Math.max(0.01, Math.round((liveScore - SPREAD) * 100) / 100);
      }
      const baseScore = GOD_TIER_BASE_SCORES[name] ?? BASE_SCORE_FALLBACK;
      return Math.max(0.01, Math.round((baseScore - SPREAD) * 100) / 100);
    },
    [assetPrices, finalScores],
  );

  // ── Build redeemPriceMap ────────────────────────────────────────────────────
  const redeemPriceMap: Record<string, number> = {};
  if (assetPrices) {
    for (const ap of assetPrices) {
      const liveScore = finalScores.get(ap.name);
      if (liveScore !== undefined) {
        const spreadOffset = ap.buyPrice - ap.baseScore;
        redeemPriceMap[ap.name] =
          Math.round((liveScore - spreadOffset) * 100) / 100;
      } else {
        redeemPriceMap[ap.name] = ap.redeemPrice;
      }
    }
  }
  for (const [indexName, baseScore] of Object.entries(GOD_TIER_BASE_SCORES)) {
    if (redeemPriceMap[indexName] !== undefined) continue;
    const liveScore = finalScores.get(indexName);
    if (liveScore !== undefined) {
      redeemPriceMap[indexName] = Math.round((liveScore - SPREAD) * 100) / 100;
    } else {
      redeemPriceMap[indexName] = Math.round((baseScore - SPREAD) * 100) / 100;
    }
  }

  // ── Active holdings (units > 0, God-Tier only) ──────────────────────────────
  const GOD_TIER = new Set(FALLBACK_ASSET_DEFS.map((d) => d.name));

  const activeHoldings: Array<{ name: string; holding: Holding }> = [];
  let holdingsTotal = 0;

  if (holdingsData) {
    for (const [name, holding] of holdingsData) {
      if (holding.units > 0) {
        const rawScore =
          finalScores.get(name) ??
          GOD_TIER_BASE_SCORES[name] ??
          redeemPriceMap[name] ??
          0;
        const livePrice = Math.max(0.01, rawScore - SPREAD);
        holdingsTotal += (holding.units + holding.accruedYield) * livePrice;
        activeHoldings.push({ name, holding });
      }
    }
  }

  const filteredHoldings = activeHoldings.filter(({ name }) =>
    GOD_TIER.has(name),
  );

  // Holdings as Array<[string, Holding]> for useDailyPnL
  const holdingsForPnL = useMemo(
    () =>
      filteredHoldings.map(
        ({ name, holding }) => [name, holding] as [string, Holding],
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filteredHoldings],
  );

  // ── Daily P&L ────────────────────────────────────────────────────────────────
  const {
    dailyPnL,
    dailyPnLPercent,
    isPositive: dailyPos,
    isNegative: dailyNeg,
  } = useDailyPnL(holdingsForPnL, costBasisMap, getLiveRedeemPrice);

  // ── All-time P&L ─────────────────────────────────────────────────────────────
  let allTimePnL = 0;
  let allTimeTotalCurrent = 0;
  let allTimeTotalCost = 0;
  for (const { name, holding } of filteredHoldings) {
    const livePrice = getLiveRedeemPrice(name);
    allTimeTotalCurrent += holding.units * livePrice;
    allTimeTotalCost += costBasisMap.get(name) ?? 0;
  }
  allTimePnL = allTimeTotalCurrent - allTimeTotalCost;
  const allTimePnLPercent =
    allTimeTotalCost > 0 ? (allTimePnL / allTimeTotalCost) * 100 : 0;
  const allTimePos = allTimePnL > 0.005;
  const allTimeNeg = allTimePnL < -0.005;

  // ── Toggle handler ────────────────────────────────────────────────────────────
  const handleToggle = (value: PnLToggle) => {
    setPnlToggle(value);
    saveTogglePreference(userId, value);
  };

  const cash = localCashBalance;
  const totalPortfolioValue = cash + holdingsTotal + shortHoldingsTotal;

  // Filtered chart history based on selected time range (real wall-clock time)
  // biome-ignore lint/correctness/useExhaustiveDependencies: tickCount triggers recompute on each tick
  const filteredHistory = useMemo(() => {
    const all = portfolioHistoryRef.current;
    const now = Date.now();
    const MS = (h: number) => h * 60 * 60 * 1000;
    if (timeRange === "LIVE") return all.filter((p) => p.ts >= now - MS(0.5));
    if (timeRange === "1D")   return all.filter((p) => p.ts >= now - MS(24));
    if (timeRange === "1W")   return all.filter((p) => p.ts >= now - MS(24 * 7));
    if (timeRange === "1M")   return all.filter((p) => p.ts >= now - MS(24 * 30));
    if (timeRange === "3M")   return all.filter((p) => p.ts >= now - MS(24 * 90));
    if (timeRange === "YTD") {
      const jan1 = new Date(new Date().getFullYear(), 0, 1).getTime();
      return all.filter((p) => p.ts >= jan1);
    }
    if (timeRange === "1Y")   return all.filter((p) => p.ts >= now - MS(24 * 365));
    return all;
  }, [timeRange, tickCount]);

  const handleDeposit = (amount: number) => {
    depositFunds(amount);
  };

  const makeUnlockHandler = useCallback(
    (indexName: string) => () => unlockPnL(indexName),
    [unlockPnL],
  );

  // Stable callback for the short MTM aggregator to report its running total.
  const handleShortTotal = useCallback((total: number) => {
    setShortHoldingsTotal((prev) => (prev === total ? prev : total));
  }, []);

  // ── Displayed P&L values based on toggle ─────────────────────────────────────
  const displayPnL = pnlToggle === "TODAY" ? dailyPnL : allTimePnL;
  const displayPnLPct =
    pnlToggle === "TODAY" ? dailyPnLPercent : allTimePnLPercent;
  const displayPos = pnlToggle === "TODAY" ? dailyPos : allTimePos;
  const displayNeg = pnlToggle === "TODAY" ? dailyNeg : allTimeNeg;

  const pnlSign = displayPos ? "+" : displayNeg ? "-" : "";
  const pnlColor = displayPos
    ? "text-green-400"
    : displayNeg
      ? "text-red-400"
      : "text-muted-foreground";

  // ── Feature D — Category allocation data ─────────────────────────────────────
  const categoryAllocations = useMemo(() => {
    const map: Record<
      string,
      { total: number; holdings: Array<{ name: string; holding: Holding }> }
    > = {};
    for (const { name, holding } of filteredHoldings) {
      const cat = getCategoryForName(name);
      const rawScore =
        finalScores.get(name) ??
        GOD_TIER_BASE_SCORES[name] ??
        BASE_SCORE_FALLBACK;
      const livePrice = Math.max(0.01, rawScore - SPREAD);
      const liveVal = (holding.units + holding.accruedYield) * livePrice;
      if (!map[cat]) map[cat] = { total: 0, holdings: [] };
      map[cat].total += liveVal;
      map[cat].holdings.push({ name, holding });
    }
    return map;
  }, [filteredHoldings, finalScores]);

  // ── Feature F — Sorted holdings ──────────────────────────────────────────────
  const sortedHoldings = useMemo(() => {
    if (sortMode === "default") return filteredHoldings;
    const arr = [...filteredHoldings];
    if (sortMode === "newest") {
      return arr.sort((a, b) =>
        Number(b.holding.allocationTimestamp - a.holding.allocationTimestamp),
      );
    }
    if (sortMode === "oldest") {
      return arr.sort((a, b) =>
        Number(a.holding.allocationTimestamp - b.holding.allocationTimestamp),
      );
    }
    if (sortMode === "capital") {
      return arr.sort((a, b) => {
        const aScore =
          (finalScores.get(a.name) ??
            GOD_TIER_BASE_SCORES[a.name] ??
            BASE_SCORE_FALLBACK) - SPREAD;
        const bScore =
          (finalScores.get(b.name) ??
            GOD_TIER_BASE_SCORES[b.name] ??
            BASE_SCORE_FALLBACK) - SPREAD;
        const aVal =
          a.holding.units > 0
            ? a.holding.units * Math.max(0.01, aScore)
            : (shortCostBasisMap.get(a.name) ?? 0);
        const bVal =
          b.holding.units > 0
            ? b.holding.units * Math.max(0.01, bScore)
            : (shortCostBasisMap.get(b.name) ?? 0);
        return bVal - aVal;
      });
    }
    if (sortMode === "pct_change") {
      return arr.sort((a, b) => {
        const aLocked = pnlUnlockedMap.get(a.name) !== true && (shortCostBasisMap.get(a.name) ?? 0) === 0;
        const bLocked = pnlUnlockedMap.get(b.name) !== true && (shortCostBasisMap.get(b.name) ?? 0) === 0;
        if (aLocked && bLocked) return 0;
        if (aLocked) return 1;
        if (bLocked) return -1;
        const aScore =
          (finalScores.get(a.name) ??
            GOD_TIER_BASE_SCORES[a.name] ??
            BASE_SCORE_FALLBACK) - SPREAD;
        const bScore =
          (finalScores.get(b.name) ??
            GOD_TIER_BASE_SCORES[b.name] ??
            BASE_SCORE_FALLBACK) - SPREAD;
        const aVal =
          a.holding.units > 0
            ? a.holding.units * Math.max(0.01, aScore)
            : (shortCostBasisMap.get(a.name) ?? 0);
        const bVal =
          b.holding.units > 0
            ? b.holding.units * Math.max(0.01, bScore)
            : (shortCostBasisMap.get(b.name) ?? 0);
        const aCost = a.holding.units > 0
          ? (costBasisMap.get(a.name) ?? 0)
          : (shortCostBasisMap.get(a.name) ?? 0);
        const bCost = b.holding.units > 0
          ? (costBasisMap.get(b.name) ?? 0)
          : (shortCostBasisMap.get(b.name) ?? 0);
        const aPct = aCost > 0 ? (aVal - aCost) / aCost : 0;
        const bPct = bCost > 0 ? (bVal - bCost) / bCost : 0;
        return bPct - aPct;
      });
    }
    return arr;
  }, [filteredHoldings, sortMode, finalScores, costBasisMap, shortCostBasisMap, pnlUnlockedMap]);

  // ── Feature D — Slide-over holding detail data ────────────────────────────────
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayMs = today.getTime();

  return (
    <>
      {/* Aggregates short mark-to-market across all holdings so the portfolio
          total includes short positions. useUserFullPosition cannot be called
          in the parent loop, so this component mounts one collector child per
          holding. */}
      <ShortTotalAggregator
        holdings={filteredHoldings}
        onShortTotal={handleShortTotal}
      />

      <div className="w-full rounded-sm border border-border bg-card mb-8 overflow-hidden">
        {/* Top bar — Total Portfolio Value */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 px-6 py-5 border-b border-border bg-white/[0.025]">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-8 h-8 rounded-sm bg-primary/10 border border-primary/20 shrink-0">
              <TrendingUp className="w-4 h-4 text-primary" strokeWidth={2.5} />
            </div>
            <div>
              <p className="text-muted-foreground text-[10px] uppercase tracking-widest font-medium">
                Total Portfolio Value
              </p>
              {isLoading ? (
                <Skeleton className="h-7 w-36 bg-white/5 mt-1" />
              ) : (
                <>
                  <p className="text-foreground font-mono text-2xl font-bold tracking-tight">
                    {fmt(scrubbedValue ?? totalPortfolioValue)}
                  </p>

                  {/* P&L display with TODAY / ALL TIME toggle */}
                  <div className="mt-1.5 flex flex-col gap-1.5">
                    {/* P&L value row */}
                    <p
                      className={`font-mono text-xs font-medium ${pnlColor}`}
                      data-ocid="portfolio-pnl-display"
                    >
                      {fmtPnL(displayPnL)}{" "}
                      <span className="opacity-80">
                        ({pnlSign}
                        {Math.abs(displayPnLPct).toFixed(2)}%)
                      </span>{" "}
                      <span className="text-muted-foreground font-normal">
                        {pnlToggle === "TODAY" ? "today" : "all time"}
                      </span>
                    </p>

                    {/* Toggle pill buttons */}
                    <div
                      className="flex items-center gap-0.5 w-fit rounded-sm border border-border/60 bg-white/[0.02] p-0.5"
                      data-ocid="pnl-toggle"
                    >
                      <button
                        type="button"
                        onClick={() => handleToggle("TODAY")}
                        data-ocid="pnl-toggle-today"
                        className={`px-2.5 py-0.5 rounded-[2px] text-[10px] font-semibold uppercase tracking-wider transition-all duration-150 focus:outline-none focus-visible:ring-1 focus-visible:ring-primary/50 ${
                          pnlToggle === "TODAY"
                            ? "bg-primary text-black"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        Today
                      </button>
                      <button
                        type="button"
                        onClick={() => handleToggle("ALL_TIME")}
                        data-ocid="pnl-toggle-alltime"
                        className={`px-2.5 py-0.5 rounded-[2px] text-[10px] font-semibold uppercase tracking-wider transition-all duration-150 focus:outline-none focus-visible:ring-1 focus-visible:ring-primary/50 ${
                          pnlToggle === "ALL_TIME"
                            ? "bg-primary text-black"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        All Time
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Capital split card */}
          {(() => {
            const availablePct =
              totalPortfolioValue > 0 ? (cash / totalPortfolioValue) * 100 : 0;
            const deployedPct = 100 - availablePct;
            return (
              <div
                className="flex flex-col px-3 py-2 sm:px-4 sm:py-3 rounded-sm bg-white/[0.03] border border-border min-w-[220px]"
                data-ocid="capital-split-card"
              >
                {/* Card label */}
                <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-semibold mb-1">
                  Capital
                </p>
                {/* Primary value */}
                <p className="hidden sm:block font-mono text-xl font-bold text-foreground tracking-tight mb-3">
                  {fmt(totalPortfolioValue)}
                </p>
                {/* Two columns */}
                <div className="flex gap-4">
                  {/* Left — Available */}
                  <div className="flex-1 flex flex-col relative pb-3">
                    <p className="font-mono text-[12px] sm:text-sm font-semibold text-foreground">
                      {fmt(cash)}
                    </p>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-widest mt-0.5">
                      Available
                    </p>
                    <p className="text-[11px] text-green-400 mt-0.5">
                      {availablePct.toFixed(1)}%
                    </p>
                    {/* Solid green bar */}
                    <div
                      className="absolute bottom-0 left-0 h-[3px] rounded-full bg-green-400"
                      style={{ width: `${availablePct}%` }}
                    />
                  </div>
                  {/* Right — Deployed */}
                  <div className="flex-1 flex flex-col relative pb-3">
                    <p className="font-mono text-[12px] sm:text-sm font-semibold text-foreground">
                      {fmt(holdingsTotal)}
                    </p>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-widest mt-0.5">
                      Deployed
                    </p>
                    <p className="text-[11px] text-orange-400 mt-0.5">
                      {deployedPct.toFixed(1)}%
                    </p>
                    {/* Dotted orange bar */}
                    <div
                      className="absolute bottom-0 left-0 h-[3px] border-t-2 border-dashed border-orange-400"
                      style={{ width: `${deployedPct}%` }}
                    />
                  </div>
                </div>
              </div>
            );
          })()}
        </div>

        {/* Scrubable Portfolio Chart */}
        <div className="px-4 pb-2 pt-3 border-b border-border/30">
          {(() => {
            const hasData = filteredHistory.length >= 2;
            const chartFirst = hasData ? filteredHistory[0].value : 0;
            const chartLast  = hasData ? filteredHistory[filteredHistory.length - 1].value : 0;
            const displayVal = scrubbedValue ?? totalPortfolioValue;
            const delta = hasData ? displayVal - chartFirst : 0;
            const pct   = chartFirst > 0 ? (delta / chartFirst) * 100 : 0;
            const isPos = delta >= 0;
            const chartColor = chartLast >= chartFirst ? "#4ade80" : "#f87171";
            const fmtTs = (ts: number) => {
              const d = new Date(ts);
              if (timeRange === "LIVE" || timeRange === "1D")
                return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
              if (timeRange === "1W")
                return d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
              return d.toLocaleDateString([], { month: "short", day: "numeric", year: "2-digit" });
            };
            // Thin to ≤400 points for performance
            const thinned = (() => {
              if (filteredHistory.length <= 400) return filteredHistory;
              const step = Math.ceil(filteredHistory.length / 400);
              return filteredHistory.filter((_, i) => i % step === 0 || i === filteredHistory.length - 1);
            })();

            const TIME_TABS = ["LIVE", "1D", "1W", "1M", "3M", "YTD", "1Y", "ALL"] as const;
            const tabRow = (
              <div className="flex justify-between mt-2 mb-1 border-t border-border/20 pt-2">
                {TIME_TABS.map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    data-ocid={`portfolio.chart.range.${tab.toLowerCase()}`}
                    onClick={() => setTimeRange(tab)}
                    className={`font-mono text-[10px] font-semibold px-1.5 py-0.5 rounded transition-all cursor-pointer ${
                      timeRange === tab
                        ? "text-white bg-white/10 border border-white/20"
                        : "text-muted-foreground hover:text-white"
                    }`}
                  >
                    {tab}
                  </button>
                ))}
              </div>
            );

            return (
              <div>
                {/* Delta row — updates while scrubbing */}
                {hasData && (
                  <div className="text-xs font-mono mb-3 flex items-center gap-1.5" style={{ color: isPos ? "#4ade80" : "#f87171" }}>
                    <span>
                      {isPos ? "+" : ""}
                      {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(delta)}
                    </span>
                    <span className="opacity-70">({isPos ? "+" : ""}{pct.toFixed(2)}%)</span>
                    <span className="text-muted-foreground font-normal text-[10px] ml-1">{timeRange}</span>
                  </div>
                )}

                {/* Chart — LineChart pattern: Area for fill, Line for stroke */}
                <div className="h-[180px] sm:h-[200px]">
                  {hasData ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart
                        data={thinned}
                        margin={{ top: 4, right: 2, bottom: 4, left: 2 }}
                        onMouseMove={(e: { activePayload?: Array<{ value: number; payload: { ts: number } }> }) => {
                          if (e?.activePayload?.[0]) setScrubbedValue(e.activePayload[0].value);
                        }}
                        onMouseLeave={() => setScrubbedValue(null)}
                      >
                        <defs>
                          <linearGradient id="pchGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%"   stopColor={chartColor} stopOpacity={0.20} />
                            <stop offset="100%" stopColor={chartColor} stopOpacity={0}    />
                          </linearGradient>
                        </defs>
                        <CartesianGrid
                          vertical={false}
                          stroke="rgba(255,255,255,0.04)"
                          strokeDasharray="3 3"
                        />
                        <YAxis
                          domain={[(d: number) => Math.max(0, d * 0.998), (d: number) => d * 1.002]}
                          hide
                        />
                        <Tooltip
                          cursor={{ stroke: chartColor, strokeWidth: 1, strokeOpacity: 0.5 }}
                          content={({ active, payload }) => {
                            if (!active || !payload?.length) return null;
                            const pt = payload[0].payload as { value: number; ts: number };
                            return (
                              <div className="bg-black/90 border border-white/10 rounded px-2 py-1.5 text-[11px] font-mono text-white flex flex-col gap-0.5 shadow-lg">
                                <span className="text-white/50 text-[10px]">{fmtTs(pt.ts)}</span>
                                <span className={isPos ? "text-green-400" : "text-red-400"}>
                                  {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(pt.value)}
                                </span>
                              </div>
                            );
                          }}
                        />
                        {/* Area fill below the line */}
                        <Area
                          type="monotone"
                          dataKey="value"
                          stroke="none"
                          fill="url(#pchGrad)"
                          fillOpacity={1}
                          isAnimationActive={false}
                        />
                        {/* Clean stroke line on top */}
                        <Line
                          type="monotone"
                          dataKey="value"
                          stroke={chartColor}
                          strokeWidth={2}
                          dot={false}
                          isAnimationActive={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="h-full flex flex-col items-center justify-center gap-2">
                      <div className="h-[1px] w-full bg-white/10" />
                      <span className="text-muted-foreground text-xs">Accumulating data...</span>
                    </div>
                  )}
                </div>

                {tabRow}
              </div>
            );
          })()}
        </div>

        {/* Holdings breakdown */}
        <div className="px-6 py-4">
          <p className="text-muted-foreground text-[10px] uppercase tracking-widest font-medium mb-3">
            Holdings
          </p>

          {/* Feature F — Sort Controls */}
          {filteredHoldings.length > 0 && (
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground shrink-0">
                Sort
              </span>
              <div className="flex items-center gap-1 overflow-x-auto">
                {(
                  [
                    { id: "default", label: "Default" },
                    { id: "newest", label: "Newest" },
                    { id: "oldest", label: "Oldest" },
                    { id: "capital", label: "Capital" },
                    { id: "pct_change", label: "% Change" },
                  ] as const
                ).map(({ id, label }) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setSortMode(id)}
                    data-ocid={`portfolio.sort.${id}`}
                    className={`text-[10px] px-2 py-0.5 rounded-sm cursor-pointer transition-colors whitespace-nowrap ${
                      sortMode === id
                        ? "bg-white/10 border border-border text-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Feature E — Column Headers */}
          {filteredHoldings.length > 0 && (
            <div className="flex items-center justify-between px-3 pb-1 mb-1 border-b border-border/30">
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">
                Index
              </span>
              <div className="flex items-center gap-4">
                <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold w-[44px] text-right">
                  Score
                </span>
                <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold w-[44px] text-right">
                  Price
                </span>
                <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold w-[44px] text-right">
                  Shares
                </span>
                <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold w-[80px] text-right">
                  Value
                </span>
              </div>
            </div>
          )}

          {isLoading ? (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-10 w-full bg-white/5" />
              <Skeleton className="h-10 w-full bg-white/5" />
            </div>
          ) : filteredHoldings.length === 0 ? (
            <div
              className="flex flex-col items-center justify-center py-10 px-4 text-center"
              data-ocid="portfolio.empty_state"
            >
              <div className="flex items-center justify-center w-12 h-12 rounded-full bg-primary/10 border border-primary/20 mb-4">
                <BarChart2
                  className="w-5 h-5 text-primary/60"
                  strokeWidth={1.75}
                />
              </div>
              <p className="text-sm font-medium text-foreground mb-1.5">
                Your portfolio is empty
              </p>
              <p className="text-xs text-muted-foreground mb-5 max-w-[240px] leading-relaxed">
                Allocate capital to a Sentiment Asset to start building your
                position.
              </p>
              <Button
                variant="outline"
                size="sm"
                data-ocid="portfolio.view_markets_button"
                onClick={() => onTabChange?.("markets")}
                className="text-xs font-semibold border-primary/40 text-primary hover:bg-primary/10 hover:border-primary/60 transition-colors duration-150"
              >
                View Sentiment Assets
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {sortedHoldings.map(({ name, holding }, index) => (
                <PositionRows
                  key={name}
                  name={name}
                  holding={holding}
                  redeemPrice={redeemPriceMap[name] ?? 0}
                  costBasis={costBasisMap.get(name) ?? 0}
                  shortCostBasis={shortCostBasisMap.get(name) ?? 0}
                  hasUnlockedPnL={pnlUnlockedMap.get(name) === true}
                  onUnlock={makeUnlockHandler(name)}
                  index={index}
                  category={getCategoryForName(name)}
                  platformAllocated={platformAllocatedByIndex[name] ?? 0}
                  onSelectIndex={(n) => setSelectedIndex(n)}
                />
              ))}

              {/* Holdings subtotal */}
              <div className="flex items-center justify-between py-2 px-3 mt-1 rounded-sm border border-primary/20 bg-primary/5">
                <span className="text-muted-foreground text-xs font-medium">
                  Invested Value
                </span>
                <span className="text-primary font-mono text-xs font-semibold">
                  {fmt(holdingsTotal + shortHoldingsTotal)}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Deposit Modal */}
      <DepositModal
        isOpen={isDepositOpen}
        onClose={() => setIsDepositOpen(false)}
        onConfirm={handleDeposit}
      />

      {/* Index Position Detail Slide-Over */}
      <AnimatePresence>
        {selectedIndex && (
          <IndexSlideOver
            selectedIndex={selectedIndex}
            onClose={() => setSelectedIndex(null)}
            finalScores={finalScores}
            costBasisMap={costBasisMap}
            shortCostBasisMap={shortCostBasisMap}
            holdingsData={holdingsData}
            totalPortfolioValue={totalPortfolioValue}
            activityHistory={activityHistory}
            todayMs={todayMs}
          />
        )}
      </AnimatePresence>

      {/* Feature D — Category Slide-Over */}
      <AnimatePresence>
        {selectedCategory && (
          <>
            {/* Backdrop */}
            <motion.div
              className="fixed inset-0 z-40 bg-black/50"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedCategory(null)}
            />
            {/* Panel */}
            <motion.div
              className="fixed right-0 top-0 h-full w-[360px] bg-zinc-950 border-l border-border flex flex-col z-50"
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", stiffness: 300, damping: 30 }}
              data-ocid="portfolio.category-slide-over"
            >
              {/* Header */}
              <div className="flex items-start justify-between px-5 py-4 border-b border-border">
                <div>
                  <div className="flex items-center gap-2 mb-0.5">
                    <span
                      className={`w-2 h-2 rounded-full ${
                        (
                          CATEGORY_COLORS[selectedCategory] ??
                          CATEGORY_COLORS.MACRO
                        ).dot
                      }`}
                    />
                    <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">
                      Category
                    </p>
                  </div>
                  <p className="text-foreground font-mono text-lg font-bold uppercase tracking-wide">
                    {selectedCategory}
                  </p>
                  <p className="text-[11px] font-mono text-muted-foreground mt-0.5">
                    Deployed:{" "}
                    {fmt(categoryAllocations[selectedCategory]?.total ?? 0)}
                  </p>
                </div>
                <button
                  type="button"
                  className="text-muted-foreground hover:text-foreground transition-colors mt-0.5"
                  onClick={() => setSelectedCategory(null)}
                  data-ocid="portfolio.category-slide-over.close_button"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Holdings list */}
              <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-3">
                {(categoryAllocations[selectedCategory]?.holdings ?? []).map(
                  ({ name, holding }) => {
                    const rawScore =
                      finalScores.get(name) ??
                      GOD_TIER_BASE_SCORES[name] ??
                      BASE_SCORE_FALLBACK;
                    const livePrice = Math.max(0.01, rawScore - SPREAD);
                    const liveVal = holding.units * livePrice;
                    const basis = costBasisMap.get(name) ?? 0;
                    const unrealizedPnL = liveVal - basis;
                    const unrealizedPct =
                      basis > 0 ? (unrealizedPnL / basis) * 100 : 0;
                    const avgCost =
                      holding.units > 0 ? basis / holding.units : 0;
                    const portfolioPct =
                      totalPortfolioValue > 0
                        ? (liveVal / totalPortfolioValue) * 100
                        : 0;

                    // Today's return from activity history
                    const todayActivity = activityHistory.filter(
                      (e) => e.source === name && e.timestamp >= todayMs,
                    );
                    const todayReturn =
                      todayActivity.reduce((sum, e) => {
                        if (e.type === "Credit") return sum + e.amount;
                        if (e.type === "Spend") return sum - e.amount;
                        return sum;
                      }, 0) +
                      (liveVal - basis);

                    const unrealizedColor =
                      unrealizedPnL >= 0 ? "text-green-400" : "text-red-400";

                    return (
                      <motion.div
                        key={name}
                        className="rounded-sm border border-border/50 bg-white/[0.02] p-3"
                        initial={{ opacity: 0, x: 16 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ duration: 0.25, ease: "easeOut" }}
                      >
                        {/* Name + category badge */}
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-foreground text-sm font-medium leading-tight">
                            {name}
                          </span>
                          <span
                            className={`text-[9px] uppercase tracking-widest px-1.5 py-0.5 rounded-sm font-semibold ${
                              (
                                CATEGORY_COLORS[selectedCategory] ??
                                CATEGORY_COLORS.MACRO
                              ).badge
                            } ${
                              (
                                CATEGORY_COLORS[selectedCategory] ??
                                CATEGORY_COLORS.MACRO
                              ).text
                            }`}
                          >
                            {selectedCategory}
                          </span>
                        </div>

                        {/* 2x2 data grid */}
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <p className="text-[9px] uppercase tracking-widest text-muted-foreground mb-0.5">
                              Today's Return
                            </p>
                            <p
                              className={`font-mono text-[12px] font-semibold ${
                                todayReturn >= 0
                                  ? "text-green-400"
                                  : "text-red-400"
                              }`}
                            >
                              {fmtPnL(todayReturn)}
                            </p>
                          </div>
                          <div>
                            <p className="text-[9px] uppercase tracking-widest text-muted-foreground mb-0.5">
                              Unrealized P&amp;L
                            </p>
                            <p
                              className={`font-mono text-[12px] font-semibold ${unrealizedColor}`}
                            >
                              {fmtPnL(unrealizedPnL)}{" "}
                              <span className="text-[10px] opacity-75">
                                ({unrealizedPct.toFixed(1)}%)
                              </span>
                            </p>
                          </div>
                          <div>
                            <p className="text-[9px] uppercase tracking-widest text-muted-foreground mb-0.5">
                              Avg Cost
                            </p>
                            <p className="font-mono text-[12px] font-semibold text-foreground">
                              {fmt(avgCost)}
                            </p>
                          </div>
                          <div>
                            <p className="text-[9px] uppercase tracking-widest text-muted-foreground mb-0.5">
                              % of Portfolio
                            </p>
                            <p className="font-mono text-[12px] font-semibold text-foreground">
                              {portfolioPct.toFixed(1)}%
                            </p>
                          </div>
                        </div>
                      </motion.div>
                    );
                  },
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
