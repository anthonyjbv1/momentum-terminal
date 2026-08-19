import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  AlertTriangle,
  ChevronDown,
  Lock,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useCrisisRegime } from "../contexts/CrisisRegimeContext";
import { useLocalHoldings } from "../contexts/LocalHoldingsContext";
import { useLoyalty } from "../contexts/LoyaltyContext";
import { useOracleTick } from "../contexts/OracleTickContext";
import {
  getRedemptionQueueKey,
  readRedemptionQueue,
  useWalletContext,
  writeRedemptionQueue,
} from "../contexts/WalletContext";
import { useActor } from "../hooks/useActor";
import { useLocalHoldingsQuery } from "../hooks/useLocalHoldingsQuery";
import type { AssetPriceWithCapacity } from "../hooks/useQueries";
import { useUserFullPosition } from "../hooks/useUserFullPosition";
import { useYieldAccrual } from "../hooks/useYieldAccrual";

import { useAuth } from "../contexts/AuthContext";
import { getDisplayName } from "../lib/oracle/indexCategoryRegistry";
import {
  getCapacityStatus,
  getCurrentCap,
  getTotalAllocatedForIndex,
  initCapacityState,
  tickCapacity,
} from "../services/capacityTierService";
import { INVERSE_PAIRS } from "../services/unifiedOraclePipeline";
import type { Holding } from "../types/backendEnums";
import { AllocationModal } from "./AllocationModal";
import OracleAuditModal from "./OracleAuditModal";
import { ScoreHistoryModal } from "./ScoreHistoryModal";
import { SentimentArc } from "./SentimentArc";
import { ShortModal } from "./ShortModal";

/** Max position per user, per index — 20% of the $90k pool */
const MAX_USER_POSITION = 750;

// ── Display names are sourced from indexCategoryRegistry.ts (getDisplayName). ──

interface AssetRowProps {
  asset: AssetPriceWithCapacity;
  index: number;
  cooldownActive?: boolean;
  subLabel?: string;
  onInsightsToggle?: () => void;
  isInsightsExpanded?: boolean;
}

/** Returns a category-aware crisis alert message derived from the asset's category field. */
export function getCrisisHaltMessage(category: string): string {
  const cat = category?.toUpperCase();
  if (cat === "MACRO") {
    return "Oracle Alert: Macro volatility elevated — liquidity constraints active.";
  }
  if (cat === "GEOPOLITICAL") {
    return "Oracle Alert: Geopolitical instability detected — regional liquidity reduced.";
  }
  if (cat === "CULTURAL") {
    return "Oracle Alert: Sentiment volatility elevated — capacity buffer active.";
  }
  // Safe fallback for any unrecognised category
  return "Oracle Alert: Market volatility elevated — liquidity constraints active.";
}

// ── Redemption Scenario Preview helpers ──────────────────────────────────────
const REDEEM_SCENARIO_DELTAS = [5, 10, 20] as const;

interface RedeemScenarioResult {
  delta: number;
  scenarioRedeemPrice: number;
  payoutValue: number;
  gain: number;
  gainPct: number;
}

function computeRedemptionScenarios(
  currentScore: number,
  currentRedeemPrice: number,
  unitsToRedeem: number,
  effectiveSpread: number,
): RedeemScenarioResult[] {
  return REDEEM_SCENARIO_DELTAS.map((delta) => {
    const scenarioScore = currentScore + delta;
    const scenarioRedeemPrice = Math.max(0, scenarioScore - effectiveSpread);
    const payoutValue = unitsToRedeem * scenarioRedeemPrice;
    const currentPayout = unitsToRedeem * currentRedeemPrice;
    const gain = payoutValue - currentPayout;
    const gainPct = currentPayout > 0 ? (gain / currentPayout) * 100 : 0;
    return { delta, scenarioRedeemPrice, payoutValue, gain, gainPct };
  });
}

const PLATFORM_GREEN_REDEEM = "oklch(0.72 0.18 145)";

function HaltedIndexBanner({ message }: { message: string }) {
  return (
    <div
      className="flex items-start gap-2 mt-3 rounded-sm px-2.5 py-2"
      style={{
        background: "rgba(245,158,11,0.12)",
        border: "1px solid rgba(245,158,11,0.5)",
      }}
    >
      <AlertTriangle
        className="shrink-0 mt-0.5"
        style={{ width: "11px", height: "11px", color: "#F59E0B" }}
      />
      <p
        className="font-medium leading-snug"
        style={{ fontSize: "0.65rem", color: "#FCD34D" }}
      >
        {message}
      </p>
    </div>
  );
}

function UnitsDisplay({ holding }: { holding: Holding }) {
  const liveUnits = useYieldAccrual({
    baseUnits: holding.units,
    accruedYield: holding.accruedYield,
  });

  return (
    <p className="text-xs font-mono">
      <span className="text-muted-foreground">Shares Owned: </span>
      <span
        className={
          liveUnits > 0 ? "text-primary font-semibold" : "text-muted-foreground"
        }
      >
        {liveUnits.toFixed(4)}
      </span>
    </p>
  );
}

// biome-ignore lint/correctness/noUnusedVariables: kept for potential future use
function CategoryBadge({ category }: { category: string }) {
  const styles: Record<string, string> = {
    Finance: "bg-blue-500/10 text-blue-400 border-blue-500/30",
    Geopolitical: "bg-amber-500/10 text-amber-400 border-amber-500/30",
    Sports: "bg-sports/10 text-sports border-sports/30",
  };
  const cls =
    styles[category] ?? "bg-white/5 text-muted-foreground border-white/10";

  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded-sm border text-[9px] uppercase tracking-widest font-bold ${cls}`}
    >
      {category}
    </span>
  );
}

function CapacityBar({
  asset,
  isCrisis,
  userPositionLive,
}: {
  asset: AssetPriceWithCapacity;
  isCrisis: boolean;
  userPositionLive: number;
}) {
  const { platformAllocatedByIndex } = useOracleTick();
  // Use platform-wide allocated from OracleTickContext (sourced from canister aggregate)
  // as the primary value. Falls back to per-user localStorage value if canister data
  // is not yet loaded (e.g. first render before first tick completes).
  const currentAllocated =
    platformAllocatedByIndex[asset.name] ??
    getTotalAllocatedForIndex(asset.name);
  // biome-ignore lint/correctness/noUnusedVariables: kept for potential future use
  const { capacityUsedPercent } = asset;

  // Dynamic buffer: 25% during crisis, 10% normally
  const effectiveBuffer = isCrisis ? 0.25 : asset.volatilityBuffer;

  // ── Dynamic tier cap from capacityTierService ────────────────────────────
  // tickCapacity is called on every render so the tier state stays current.
  useEffect(() => {
    tickCapacity(asset.name, currentAllocated);
  }, [asset.name, currentAllocated]);

  const capacityStatus = getCapacityStatus(asset.name, currentAllocated);
  const dynamicCap = capacityStatus.currentCap;

  // Fill and label use the live position value (unitsOwned * redeemPrice) passed
  // from the parent so the bar reflects current liquidation value on every tick.
  const isAtCapacity = userPositionLive >= dynamicCap;

  const bufferPercent = effectiveBuffer * 100;
  const allocatedOfMax =
    dynamicCap > 0 ? Math.min(100, (userPositionLive / dynamicCap) * 100) : 0;

  const formatDollars = (n: number) =>
    n >= 1000 ? `$${(n / 1000).toFixed(0)}k` : `$${n.toFixed(0)}`;

  // ── Countdown helpers ────────────────────────────────────────────────────
  const msLeft = capacityStatus.msUntilExpansion;
  const countdownLabel = (() => {
    if (msLeft === null) return "Expanding soon";
    if (msLeft <= 0) return "Expanding soon";
    const totalMinutes = Math.floor(msLeft / 60_000);
    const hours = Math.floor(totalMinutes / 60);
    const mins = totalMinutes % 60;
    return `Expanding in ${hours}h ${mins}m`;
  })();

  return (
    <div className="mt-2.5 space-y-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium">
          Capacity
        </span>
        <span
          className={`text-xs sm:text-sm font-mono font-medium ${
            isAtCapacity ? "text-amber-400" : "text-muted-foreground"
          }`}
        >
          {formatDollars(userPositionLive)} / {formatDollars(dynamicCap)}
        </span>
      </div>

      <div className="relative h-1.5 w-full rounded-full bg-white/5 overflow-hidden">
        <div
          className={`absolute left-0 top-0 h-full rounded-full transition-[width] duration-150 sm:duration-500 ${
            isAtCapacity
              ? "bg-amber-500/80"
              : allocatedOfMax > 75
                ? "bg-amber-500/70"
                : "bg-primary/60"
          }`}
          style={{ width: `${allocatedOfMax}%` }}
        />
        <div
          className="absolute right-0 top-0 h-full border-l"
          style={{
            width: `${bufferPercent}%`,
            backgroundColor: "rgba(239,68,68,0.20)",
            borderColor: "rgba(239,68,68,0.50)",
          }}
        />
      </div>

      <div className="flex items-center justify-between gap-2">
        {isCrisis ? (
          <span className="text-[10px] font-bold text-red-500">
            25% Crisis Buffer Reserved
          </span>
        ) : (
          <span className="text-[10px] text-muted-foreground font-medium">
            {Math.round(asset.volatilityBuffer * 100)}% Volatility Buffer
            Reserved
          </span>
        )}
        {/* effectiveCap kept for its buffer visual; only show "Full" label based on dynamic cap */}
        {isAtCapacity && !capacityStatus.isAtMaximum && (
          <span className="text-[10px] text-amber-400 font-semibold uppercase tracking-wide">
            Full
          </span>
        )}
        {capacityStatus.isAtMaximum && (
          <span className="text-[10px] text-amber-400 font-semibold uppercase tracking-wide">
            Max
          </span>
        )}
      </div>

      {/* ── Capacity tier status labels ─────────────────────────────────── */}
      {capacityStatus.isAtMaximum && (
        <div className="flex items-center gap-1.5 pt-0.5">
          <span
            className="text-[9px] font-bold uppercase tracking-widest"
            style={{ color: "#F59E0B" }}
          >
            AT MAXIMUM CAPACITY
          </span>
        </div>
      )}
      {capacityStatus.isAtCapacity && !capacityStatus.isAtMaximum && (
        <div className="flex items-center gap-2 pt-0.5 flex-wrap">
          <span
            className="text-[9px] font-bold uppercase tracking-widest"
            style={{ color: "#F59E0B" }}
          >
            AT CAPACITY
          </span>
          <span className="text-[9px] font-mono" style={{ color: "#D97706" }}>
            {countdownLabel}
          </span>
        </div>
      )}
    </div>
  );
}

function getSubtitle(_name: string, category: string): string {
  if (category === "Sports") return "NBA City Index";
  return "Sentiment Index";
}

export function AssetColumnHeaders() {
  return (
    <div className="hidden sm:flex items-center px-6 py-2 border-b border-border/60 bg-white/[0.015]">
      <div className="w-8 shrink-0" />
      <div className="flex-1 min-w-0" />
      {/* Outer wrapper matches card: gap-3 sm:gap-5 */}
      <div className="flex items-center gap-3 sm:gap-5">
        {/* Inner wrapper matches card: gap-6 sm:gap-10 */}
        <div className="flex items-center gap-6 sm:gap-10">
          <div className="min-w-[88px] text-right">
            <span className="text-[10px] uppercase tracking-widest font-semibold text-muted-foreground/60">
              Score
            </span>
          </div>
          <div className="min-w-[80px] text-right">
            <span className="text-[10px] uppercase tracking-widest font-semibold text-muted-foreground/60">
              Buy
            </span>
          </div>
          <div className="min-w-[80px] text-right">
            <span className="text-[10px] uppercase tracking-widest font-semibold text-muted-foreground/60">
              Redeem Price
            </span>
          </div>
          {/* Arc spacer */}
          <div style={{ width: "80px" }} />
          {/* Buttons spacer — matches 2×w-36 + gap-2 */}
          <div style={{ width: "296px" }} />
        </div>
      </div>
    </div>
  );
}

function PreemptionBadge({
  adjustment,
  confirmed,
}: {
  adjustment: number;
  confirmed: boolean;
}) {
  const isPositive = adjustment >= 0;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "3px",
        padding: "1px 6px",
        borderRadius: "4px",
        fontSize: "0.6rem",
        
        fontWeight: 700,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        backgroundColor: isPositive
          ? "rgba(74,222,128,0.12)"
          : "rgba(248,113,113,0.12)",
        border: `1px solid ${isPositive ? "rgba(74,222,128,0.35)" : "rgba(248,113,113,0.35)"}`,
        color: isPositive ? "#4ade80" : "#f87171",
      }}
    >
      ⚡ S4 {isPositive ? "+" : ""}
      {adjustment.toFixed(2)}
      {!confirmed && (
        <span style={{ opacity: 0.6, fontWeight: 400 }}> unconf</span>
      )}
    </span>
  );
}

function AssetRowInner({
  asset,
  index,
  cooldownActive: _cooldownActive = false,
  subLabel,
  onInsightsToggle,
  isInsightsExpanded = false,
}: AssetRowProps) {
  const {
    walletBalance: localBalance,
    addFunds,
    logCredit,
  } = useWalletContext();
  const { data: allHoldings, isLoading: holdingsLoading } =
    useLocalHoldingsQuery();
  const { clearHolding, redeemPartialHolding, localVolumeMap, addLocalVolume, shortPositions, closeShort, costBasisMap } = useLocalHoldings();

  // B4: Per-position loyalty tier — each index has its own independent clock
  const { getPositionTier, clearPositionTier } = useLoyalty();
  const positionTier = getPositionTier(asset.name);

  const { isCrisisMode, crisisTriggerIndices } = useCrisisRegime();
  const { activePreemptions, scoreHistoryMap, platformVolumeByIndex, finalScores, secondsLeft } =
    useOracleTick();
  const redeemTimerMinutes = Math.floor(secondsLeft / 60);
  const redeemTimerSecs = secondsLeft % 60;
  const redeemCountdown = `${redeemTimerMinutes}:${redeemTimerSecs.toString().padStart(2, "0")}`;
  const isRedeemTimerUrgent = secondsLeft <= 5;
  const activePreemption = useMemo(() => {
    const p = activePreemptions.get(asset.name);
    return p ?? null;
  }, [activePreemptions, asset.name]);

  const showHaltBanner = isCrisisMode && crisisTriggerIndices.has(asset.name);

  const { userAccount } = useAuth();
  const userId = userAccount?.email ?? null;

  const [isAllocationModalOpen, setIsAllocationModalOpen] = useState(false);
  const [isAuditModalOpen, setIsAuditModalOpen] = useState(false);
  const [showRedeemConfirm, setShowRedeemConfirm] = useState(false);
  const [showScoreHistory, setShowScoreHistory] = useState(false);
  // Queue state — shown instead of normal close when high-utilization queuing occurs
  const [isQueued, setIsQueued] = useState(false);
  const [queuePosition, setQueuePosition] = useState(1);

  // B5: fractional redemption quantity state
  const [redeemUnits, setRedeemUnits] = useState<number>(0);
  // Step 1: raw input string state — allows free typing without mid-keystroke clamping
  const [redeemUnitsRaw, setRedeemUnitsRaw] = useState<string>("");
  // Validation error state for redemption input
  const [redeemUnitsError, setRedeemUnitsError] = useState<string>("");
  // Input mode toggle: "units" (default) or "dollar"
  const [redeemInputMode, setRedeemInputMode] = useState<"units" | "dollar">(
    "units",
  );
  // Dollar-mode raw input string
  const [redeemDollarRaw, setRedeemDollarRaw] = useState<string>("");

  // Short modal + redemption direction state — drives mobile LOW button and
  // the inline redeem modal's direction selector when both positions exist.
  const [isShortModalOpen, setIsShortModalOpen] = useState(false);
  const [redeemDirection, setRedeemDirection] = useState<"long" | "short">(
    "long",
  );

  const [isPriceFlashing, setIsPriceFlashing] = useState(false);
  const prevBaseScoreRef = useRef<number>(asset.baseScore);

  useEffect(() => {
    if (prevBaseScoreRef.current !== asset.baseScore) {
      prevBaseScoreRef.current = asset.baseScore;
      setIsPriceFlashing(true);
      const t = setTimeout(() => setIsPriceFlashing(false), 400);
      return () => clearTimeout(t);
    }
  }, [asset.baseScore]);

  const holding: Holding | undefined = allHoldings?.find(
    ([name]) => name === asset.name,
  )?.[1];
  const unitsOwned = holding?.units ?? 0;

  // ── Full position view (long + short) from backend ────────────────────────
  // Drives the mobile-only HIGH/LOW/REDEEM action zone and the inline redeem
  // modal's direction selector. Desktop layout is completely unaffected.
  const { actor } = useActor();
  const { data: fullPosition, isLoading: fullPositionLoading } =
    useUserFullPosition(asset.name);
  const longUnits = fullPosition?.longUnits ?? 0;
  const shortUnits = fullPosition?.shortUnits ?? 0;
  const hasAnyPosition = longUnits > 0 || shortUnits > 0 || unitsOwned > 0;
  const hasBothPositions = (longUnits > 0 || unitsOwned > 0) && shortUnits > 0;
  const rawShortEntryScore = fullPosition?.shortEntryScore ?? 0;
  const shortEntryScore =
    rawShortEntryScore > 0 ? rawShortEntryScore : asset.baseScore;
  const shortEntryScoreValid = shortEntryScore > 0;
  // FIX 1: direction-aware max units. Pure shorts have unitsOwned === 0 (legacy
  // local holdings only track longs), so the redeem input must be bounded by
  // shortUnits when redeemDirection === 'short'. Long path stays on unitsOwned.
  const maxRedeemUnits =
    redeemDirection === "short"
      ? Math.floor(shortUnits)
      : Math.floor(unitsOwned);
  // shortMarkToMarket exists on UserFullPosition but the short-path render uses
  // shortPartialRedeemNet (derived from shortEntryScore + effectiveShortSpread).
  // Kept to assert the field is present on the backend type.
  const _shortMarkToMarket = fullPosition?.shortMarkToMarket ?? 0;
  void _shortMarkToMarket;

  // Seed redeemUnits and redeemUnitsRaw on modal open; clear error; reset mode.
  // FIX 1: seed against the direction-aware maxRedeemUnits so a pure short
  // (unitsOwned === 0) seeds shortUnits instead of being stuck at 0.
  useEffect(() => {
    if (showRedeemConfirm) {
      const defaultUnits = maxRedeemUnits;
      setRedeemUnits(defaultUnits);
      setRedeemUnitsRaw(String(defaultUnits));
      setRedeemUnitsError("");
      setRedeemInputMode("units");
      setRedeemDollarRaw("");
    }
  }, [showRedeemConfirm, maxRedeemUnits]);

  const isAtCapacity = asset.isAtCapacity;
  // Derive the live LMSR spread from backend prices so it reflects the actual
  // platform-wide allocation state rather than a fixed constant.
  const activeSpread = asset.backendSpread ?? asset.buyPrice - asset.baseScore;

  // ── Capacity & anti-whale gate ───────────────────────────────────────────
  // Initialize capacity state once on first render of any AssetRow
  useEffect(() => {
    initCapacityState();
  }, []);

  const userPositionValue = unitsOwned * asset.buyPrice;

  // ── Uptick Rule: score velocity over last 3 ticks ─────────────────────────
  const scoreHistory = scoreHistoryMap.get(asset.name) ?? [];
  const scoreVelocity =
    scoreHistory.length >= 4
      ? (scoreHistory[scoreHistory.length - 1] ?? 0) -
        (scoreHistory[scoreHistory.length - 4] ?? 0)
      : 0;

  // ── Correlated Pair Exposure Cap ──────────────────────────────────────────
  const SINGLE_POSITION_LIMIT = 750;
  const inversePairName = INVERSE_PAIRS[asset.name] ?? null;
  const pairedLongExposure = inversePairName
    ? (costBasisMap.get(inversePairName) ?? 0)
    : 0;
  const adjustedShortCap = inversePairName
    ? Math.max(0, Math.min(500, SINGLE_POSITION_LIMIT - pairedLongExposure))
    : 500;

  // Use dynamic tier cap (from capacityTierService) for the remaining capacity
  // that is passed into AllocationModal — not the static effectiveCapacity.
  const dynamicTierCap = getCurrentCap(asset.name);
  const remainingPoolCapacity = Math.max(
    0,
    dynamicTierCap - asset.currentAllocated,
  );
  const isUserAtPositionLimit = userPositionValue >= MAX_USER_POSITION;

  // Crisis halt blocks allocation entirely for this index
  const canAllocate =
    localBalance > 0 &&
    !isAtCapacity &&
    !isUserAtPositionLimit &&
    !showHaltBanner;
  const canRedeem = unitsOwned > 0 || shortUnits > 0;

  const handleAllocateClick = () => {
    if (!canAllocate) return;
    setIsAllocationModalOpen(true);
  };

  const handleConfirmRedeem = () => {
    if (!canRedeem) return;

    // ── Short redemption path ────────────────────────────────────────────────
    // Routes to actor.redeemShort when the user selected the short direction
    // in the inline redeem modal. Bypasses all long-path queue/utilization
    // logic — short redemptions settle directly against the backend.
    if (redeemDirection === "short") {
      // Close short locally — no canister dependency
      const short = shortPositions.get(asset.name);
      if (!short || short.units <= 0) {
        // No local short entry — stale/orphaned position, nothing to close
        setShowRedeemConfirm(false);
        return;
      }
      const currentScore = finalScores.get(asset.name) ?? asset.baseScore;
      // Dollar-based MTM (same formula as useUserFullPosition)
      const shortMTM = short.entryScore > 0
        ? Math.max(0, short.dollars + ((short.entryScore - currentScore) / short.entryScore) * short.dollars)
        : 0;
      closeShort(asset.name);
      addFunds(shortMTM);
      logCredit(shortMTM, asset.name);
      addLocalVolume(asset.name, shortMTM);
      setShowRedeemConfirm(false);
      return;
    }

    // ── Long redemption path (existing logic, completely unchanged) ──────────

    // ── Utilization check ────────────────────────────────────────────────────
    // Must run before any redemption processing.
    const currentTierCap = getCurrentCap(asset.name);
    const currentAllocated = getTotalAllocatedForIndex(asset.name);
    const utilization =
      currentTierCap > 0 ? currentAllocated / currentTierCap : 0;
    const QUEUE_THRESHOLD = 0.8;
    const isHighUtilization = utilization >= QUEUE_THRESHOLD;

    if (isHighUtilization && userId) {
      // Queue the redemption — do NOT call addFunds, clearHolding, or redeemPartialHolding
      const unitsToQueue = activeRedeemUnits;
      const isFullQueue =
        unitsToQueue <= 0 ||
        unitsToQueue >= Math.floor(unitsOwned) ||
        unitsToQueue >= unitsOwned;

      const existing = readRedemptionQueue(userId);
      const newEntry = {
        id: crypto.randomUUID(),
        userId,
        indexName: asset.name,
        type: isFullQueue ? ("full" as const) : ("partial" as const),
        ...(isFullQueue ? {} : { units: unitsToQueue }),
        queuedAt: Date.now(),
        status: "pending" as const,
      };

      const updated = [...existing, newEntry];
      writeRedemptionQueue(userId, updated);

      // Count pending entries for this index (after appending) for position display
      const pendingForIndex = updated.filter(
        (e) => e.indexName === asset.name && e.status === "pending",
      ).length;
      setQueuePosition(pendingForIndex);
      setIsQueued(true);
      return;
    }

    // ── Normal redemption flow (sub-80% utilization) — completely unchanged ──
    // Use activeRedeemUnits so dollar mode's derived units flow through correctly
    const unitsToRedeem = activeRedeemUnits;

    const isFullRedeem =
      unitsToRedeem <= 0 ||
      unitsToRedeem >= Math.floor(unitsOwned) ||
      unitsToRedeem >= unitsOwned;

    if (isFullRedeem) {
      // Full redemption — uses LMSR-computed redeemPrice directly
      const estimatedNet = unitsOwned * asset.redeemPrice;
      clearHolding(asset.name);
      clearPositionTier(asset.name);
      addFunds(estimatedNet);
      logCredit(estimatedNet, asset.name);
      addLocalVolume(asset.name, estimatedNet);
    } else {
      // Partial redemption — uses LMSR-computed redeemPrice directly
      const estimatedNet = unitsToRedeem * asset.redeemPrice;
      redeemPartialHolding(asset.name, unitsToRedeem);
      addFunds(estimatedNet);
      logCredit(estimatedNet, asset.name);
      addLocalVolume(asset.name, estimatedNet);
      // Loyalty streak is NOT reset on partial redemption — position continues
    }

    setShowRedeemConfirm(false);
  };

  const displaySubtitle =
    subLabel && subLabel.length > 0
      ? subLabel
      : getSubtitle(asset.name, asset.category);

  // FIX 2: Unify display calculation with LMSR-computed prices
  // activeSpread is the live buy spread: buyPrice - baseScore (LMSR-driven)
  // The sell spread is: baseScore - redeemPrice (also LMSR-driven)
  const dynamicSellSpread = Math.max(0.1, asset.baseScore - asset.redeemPrice);
  const MINIMUM_SPREAD = 0.1;
  const spreadReduction = positionTier.spreadReduction ?? 0;
  // effectiveSpread for display/scenario uses the live sell-side spread
  const effectiveSpread = Math.max(
    MINIMUM_SPREAD,
    dynamicSellSpread - spreadReduction,
  );
  const effectiveRedeemPrice = asset.redeemPrice;

  // Dollar-mode derived units: floor(dollarInput / effectiveRedeemPrice), clamped [1, maxRedeemUnits].
  // FIX 1: clamp against the direction-aware maxRedeemUnits so a pure short
  // (unitsOwned === 0) can still derive units from a dollar input.
  const parsedDollarInput =
    Number.parseFloat(redeemDollarRaw.replace(/,/g, "")) || 0;
  const derivedUnitsFromDollar =
    effectiveRedeemPrice > 0
      ? Math.max(
          0,
          Math.min(
            maxRedeemUnits,
            Math.floor(parsedDollarInput / effectiveRedeemPrice),
          ),
        )
      : 0;

  // Active units for payout computation.
  // Fallback to full position when no units typed yet.
  const activeRedeemUnits =
    redeemDirection === "short"
      ? redeemUnits > 0 ? redeemUnits : shortUnits
      : redeemUnits > 0 ? redeemUnits : unitsOwned;

  const fullRedeemNet = unitsOwned * effectiveRedeemPrice;
  const partialRedeemNet =
    activeRedeemUnits > 0
      ? activeRedeemUnits * effectiveRedeemPrice
      : fullRedeemNet;

  // ── Short redemption payout (parallel to long partialRedeemNet) ──────────
  // Only meaningful when redeemDirection === 'short'. The short payout formula
  // is: units * ((2 * shortEntryScore) - baseScore) - (units * effectiveShortSpread)
  // where effectiveShortSpread = buyPrice - baseScore (the live LMSR buy spread).
  // FIX 2: fullPosition is null while loading, which zeroes shortEntryScore and
  // shortUnits and produces a misleading $0.00. Guard with shortPayoutReady so
  // the UI can show a placeholder until the backend position view loads.
  const shortPayoutReady =
    redeemDirection === "short" &&
    fullPosition !== null &&
    !fullPositionLoading;
  const shortRedeemUnits = redeemDirection === "short" ? activeRedeemUnits : 0;
  const effectiveShortSpread = asset.buyPrice - asset.baseScore;
  const shortPartialRedeemNet = shortPayoutReady
    ? shortRedeemUnits > 0
      ? Math.max(
          0,
          shortRedeemUnits * (2 * shortEntryScore - asset.baseScore) -
            shortRedeemUnits * effectiveShortSpread,
        )
      : Math.max(
          0,
          shortUnits * (2 * shortEntryScore - asset.baseScore) -
            shortUnits * effectiveShortSpread,
        )
    : null;

  // ── Short scenario preview (parallel to computeRedemptionScenarios) ──────
  // Short scenarios use NEGATIVE deltas (score drops benefit the short). When
  // redeemDirection !== 'short' this is null so the long path renders unchanged.
  // FIX 2: also null while fullPosition is loading so the preview does not
  // flash $0.00 scenario values derived from a zeroed shortEntryScore.
  const shortScenarios =
    redeemDirection === "short" && shortPayoutReady
      ? [-5, -10, -20].map((delta) => {
          const scenarioScore = asset.baseScore + delta;
          const scenarioUnits =
            shortRedeemUnits > 0 ? shortRedeemUnits : shortUnits;
          const scenarioValue = Math.max(
            0,
            scenarioUnits * (2 * shortEntryScore - scenarioScore) -
              scenarioUnits * effectiveShortSpread,
          );
          const currentVal = shortPartialRedeemNet ?? 0;
          const gain = scenarioValue - currentVal;
          const gainPct = currentVal > 0 ? (gain / currentVal) * 100 : 0;
          return { delta, scenarioValue, gain, gainPct };
        })
      : null;

  const isFullRedeemSelected =
    activeRedeemUnits <= 0 ||
    activeRedeemUnits >= Math.floor(unitsOwned) ||
    activeRedeemUnits >= unitsOwned;

  // Allocate button tooltip — crisis takes priority
  const allocateTooltip = showHaltBanner
    ? "Crisis Regime Active — allocation halted for this index"
    : isAtCapacity
      ? "Capacity Reached — this index is fully allocated"
      : isUserAtPositionLimit
        ? `Position limit — max $${MAX_USER_POSITION.toLocaleString()} per user, per index`
        : localBalance <= 0
          ? "Insufficient funds"
          : undefined;

  // FIX 3: Dynamic exit spread from live LMSR-priced redeemPrice
  const effectiveExitSpread = Math.max(
    0.1,
    asset.baseScore - asset.redeemPrice,
  );
  // FIX 4: Update redeemTooltip to use exit spread language
  const redeemTooltip =
    unitsOwned === 0
      ? "No units to redeem"
      : `Redeem — est. $${fullRedeemNet.toFixed(2)} · exit spread: ${effectiveExitSpread.toFixed(2)} pts`;

  // Derived disabled state for REDEEM button
  // FIX 4: dollar-mode upper bound uses direction-aware maxRedeemUnits so a
  // pure short (unitsOwned === 0) is not permanently disabled in dollar mode.
  // FIX 3d: keep the confirm button disabled while the short entry score has
  // no valid nonzero value (shortEntryScoreValid declared near line 487).
  // For short direction: disabled only if we HAVE a short position but entryScore is invalid.
  // If shortPositions has no entry (orphaned/pre-fix), allow button so the handler can clear gracefully.
  const shortHasEntry = shortPositions.has(asset.name);
  const isRedeemButtonDisabled =
    (redeemDirection === "short" && shortHasEntry && !shortEntryScoreValid) ||
    !!redeemUnitsError ||
    redeemUnits <= 0;

  return (
    <TooltipProvider delayDuration={200}>
      <div
        className="group relative flex flex-col gap-0 border border-[#1e1e1e] rounded-2xl bg-[#111111] transition-colors duration-150 hover:bg-[#161616] hover:border-[#2a2a2a] mb-3 w-full max-w-full"
        style={{ transform: "translateZ(0)" }}
      >
        <div className="absolute top-2 right-2 z-10 flex items-center justify-center shrink-0">
          <SentimentArc
            scores={scoreHistoryMap.get(asset.name) ?? []}
            allocatedCapital={(platformVolumeByIndex[asset.name] ?? 0) + (localVolumeMap.get(asset.name) ?? 0)}
            onClick={() => setShowScoreHistory(true)}
            ariaLabel={`View score history for ${asset.name}`}
            size={60}
          />
        </div>
        <div className="flex flex-col sm:flex-row sm:flex-nowrap sm:items-start gap-4 sm:gap-0 px-6 pt-4 pb-5">
          {/* Index number */}
          <div className="hidden sm:flex w-8 shrink-0 text-muted-foreground font-mono text-xs select-none pt-0.5">
            {String(index + 1).padStart(2, "0")}
          </div>

          {/* Asset name + subLabel + Units Owned + Capacity Bar + Insights trigger */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                className="block w-full text-left text-foreground font-semibold text-base tracking-tight leading-tight cursor-pointer hover:underline decoration-gray-400 underline-offset-4 bg-transparent border-0 p-0 m-0 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded-sm"
                style={(() => {
                  const displayName = getDisplayName(asset.name);
                  if (displayName.length >= 35) return { fontSize: "0.8em" };
                  if (displayName.length >= 25) return { fontSize: "0.9em" };
                  return {};
                })()}
                onClick={() => setIsAuditModalOpen(true)}
              >
                {getDisplayName(asset.name)}
              </button>
            </div>

            {displaySubtitle && (
              <p className="text-muted-foreground text-xs mt-0.5 font-normal tracking-wide uppercase">
                {displaySubtitle}
              </p>
            )}

            {/* Change 3: return null instead of "Units Owned: 0.0000" when no position */}
            <div className="mt-1.5">
              {holdingsLoading ? (
                <Skeleton className="h-3.5 w-28 rounded-sm" />
              ) : holding ? (
                <UnitsDisplay holding={holding} />
              ) : null}
            </div>

            {/* Change 1: INSIGHTS toggle only shown when holding a position */}
            {unitsOwned > 0 && onInsightsToggle && (
              <button
                type="button"
                onClick={onInsightsToggle}
                aria-expanded={isInsightsExpanded}
                aria-label={`Toggle source insights for ${asset.name}`}
                className="mt-3 flex items-center gap-1 px-1 py-0.5 rounded-sm hover:bg-white/5 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <span
                  className="text-[9px] uppercase tracking-widest font-medium"
                  style={{ color: "#8E8E93" }}
                >
                  Insights
                </span>
                <ChevronDown
                  className={`w-3 h-3 transition-transform duration-200 ${
                    isInsightsExpanded ? "rotate-180" : ""
                  }`}
                  style={{ color: "#8E8E93" }}
                />
              </button>
            )}

            {/* Capacity bar */}
            {unitsOwned > 0 && (
              <CapacityBar
                asset={asset}
                isCrisis={showHaltBanner}
                userPositionLive={unitsOwned * asset.redeemPrice}
              />
            )}

            {/* Per-user position limit warning — shown when user hits $18k cap */}
            {isUserAtPositionLimit && !isAtCapacity && (
              <div
                className="flex items-center gap-1.5 mt-2"
                style={{
                  background: "rgba(239,68,68,0.06)",
                  border: "1px solid rgba(239,68,68,0.25)",
                  borderRadius: "4px",
                  padding: "4px 8px",
                }}
              >
                <Lock
                  style={{ width: "9px", height: "9px", color: "#f87171" }}
                />
                <span
                  style={{
                    fontSize: "0.6rem",
                    fontWeight: 700,
                    letterSpacing: "0.12em",
                    textTransform: "uppercase",
                    color: "#f87171",
                  }}
                >
                  Position Limit — $
                  {MAX_USER_POSITION.toLocaleString("en-US", {
                    maximumFractionDigits: 0,
                  })}{" "}
                  Max Per Index
                </span>
              </div>
            )}

            {showHaltBanner && (
              <HaltedIndexBanner
                message={getCrisisHaltMessage(asset.category)}
              />
            )}
          </div>

          {/* Price columns */}
          <div className="flex items-start gap-3 sm:gap-5 shrink-0 flex-nowrap">
            <div className="flex flex-col sm:flex-row items-start gap-6 sm:gap-10 flex-nowrap">
              {/* Base Score */}
              <div className="text-left sm:text-right min-w-[88px]">
                <p className="text-muted-foreground text-[10px] uppercase tracking-widest font-medium mb-1">
                  Momentum Score
                </p>
                <p
                  className="text-foreground font-mono font-bold"
                  style={{
                    fontSize: "1.375rem",
                    lineHeight: 1,
                    letterSpacing: "-0.02em",
                    transition: "color 0.4s ease",
                    color: isPriceFlashing ? "oklch(0.72 0.18 145)" : undefined,
                  }}
                >
                  {(Number.isFinite(asset.baseScore) ? asset.baseScore : 50).toFixed(1)}
                </p>
              </div>

              {/* Allocate Price */}
              <div className="text-left sm:text-right min-w-[80px]">
                <p className="text-muted-foreground text-[10px] uppercase tracking-widest font-medium mb-1">
                  Allocate
                </p>
                <div className="text-left sm:text-right">
                  <p
                    className="font-mono font-semibold transition-colors"
                    style={{
                      fontSize: "1.375rem",
                      lineHeight: 1,
                      letterSpacing: "-0.02em",
                      transition: "color 0.4s ease",
                      color: isPriceFlashing
                        ? "oklch(0.72 0.18 145)"
                        : undefined,
                    }}
                  >
                    {(Number.isFinite(asset.buyPrice) ? asset.buyPrice : 50).toFixed(2)}
                  </p>
                  <p
                    className="font-mono text-[10px] mt-0.5 text-muted-foreground"
                  >
                    +{activeSpread.toFixed(2)} spread
                  </p>
                </div>
              </div>

              {/* Redeem Price */}
              <div className="text-left sm:text-right min-w-[80px]">
                <p className="text-muted-foreground text-[10px] uppercase tracking-widest font-medium mb-1">
                  Redeem Price
                </p>
                <div className="text-left sm:text-right">
                  <p
                    className="font-mono font-semibold transition-colors"
                    style={{
                      fontSize: "1.375rem",
                      lineHeight: 1,
                      letterSpacing: "-0.02em",
                      transition: "color 0.4s ease",
                      color: isPriceFlashing
                        ? "oklch(0.72 0.18 145)"
                        : undefined,
                    }}
                  >
                    {asset.redeemPrice.toFixed(2)}
                  </p>
                  <p
                    className="font-mono text-[10px] mt-0.5 text-muted-foreground"
                  >
                    −{activeSpread.toFixed(2)} spread
                  </p>
                </div>
              </div>

              {/* Arc + buttons — arc is absolute top-right; this reserves the column space */}
              <div className="flex items-start gap-3 shrink-0">
                {/* Arc spacer (arc is absolutely positioned top-right) */}
                <div className="hidden sm:block" style={{ width: "80px" }} />

                {/* Desktop: HIGH / LOW + conditional REDEEM */}
                <div className="hidden sm:flex flex-col gap-1.5" style={{ width: "296px" }}>
                  <div className="flex flex-row gap-2">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          onClick={() => setIsAllocationModalOpen(true)}
                          disabled={!canAllocate}
                          aria-disabled={!canAllocate}
                          className={`relative inline-flex items-center justify-center gap-1.5 w-36 h-10 px-4 py-2 text-xs font-semibold tracking-wider uppercase focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded-md border-0 transition-all duration-150 ${
                            showHaltBanner
                              ? "bg-muted/20 text-red-400 opacity-50 cursor-not-allowed"
                              : isAtCapacity || isUserAtPositionLimit
                                ? "bg-muted/20 text-muted-foreground opacity-50 cursor-not-allowed"
                                : "bg-green-500/15 text-green-500 hover:bg-green-500 hover:text-white active:scale-95"
                          }`}
                        >
                          {showHaltBanner ? (
                            <span className="text-[10px]">HALTED</span>
                          ) : isAtCapacity || isUserAtPositionLimit ? (
                            <><Lock className="w-3 h-3" /><span>Limit</span></>
                          ) : (
                            "HIGH"
                          )}
                        </button>
                      </TooltipTrigger>
                      {allocateTooltip && (
                        <TooltipContent side="left" className="text-xs max-w-[200px]">
                          {allocateTooltip}
                        </TooltipContent>
                      )}
                    </Tooltip>
                    <button
                      type="button"
                      onClick={() => setIsShortModalOpen(true)}
                      className="relative inline-flex items-center justify-center gap-1.5 w-36 h-10 px-4 py-2 text-xs font-semibold tracking-wider uppercase focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring bg-red-500/15 text-red-500 border-0 hover:bg-red-500 hover:text-white transition-all duration-150 active:scale-95 rounded-md"
                    >
                      LOW
                    </button>
                  </div>
                  {hasAnyPosition && (
                    <button
                      type="button"
                      onClick={() => {
                        if (longUnits > 0) {
                          setRedeemDirection("long");
                        } else {
                          setRedeemDirection("short");
                        }
                        setShowRedeemConfirm(true);
                      }}
                      className="w-full h-9 rounded-md text-xs font-semibold tracking-wider uppercase bg-zinc-800/60 text-zinc-400 border-0 hover:bg-zinc-700/60 hover:text-zinc-300 transition-all duration-150 active:scale-95"
                    >
                      REDEEM
                    </button>
                  )}
                </div>

                {/* Mobile: HIGH / LOW + conditional REDEEM */}
                <div className="sm:hidden flex flex-col gap-1 flex-1">
                  <div className="flex flex-row gap-2">
                    <button
                      type="button"
                      onClick={() => setIsAllocationModalOpen(true)}
                      className="relative inline-flex items-center justify-center gap-1.5 w-36 h-10 px-4 py-2 text-xs font-semibold tracking-wider uppercase focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring bg-green-500/15 text-green-500 border-0 hover:bg-green-500 hover:text-white transition-all duration-150 active:scale-95 rounded-md"
                      data-ocid="asset.high_button"
                    >
                      HIGH
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsShortModalOpen(true)}
                      className="relative inline-flex items-center justify-center gap-1.5 w-36 h-10 px-4 py-2 text-xs font-semibold tracking-wider uppercase focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring bg-red-500/15 text-red-500 border-0 hover:bg-red-500 hover:text-white transition-all duration-150 active:scale-95 rounded-md"
                      data-ocid="asset.low_button"
                    >
                      LOW
                    </button>
                  </div>
                  {hasAnyPosition && (
                    <button
                      type="button"
                      onClick={() => {
                        if (hasBothPositions) {
                          setRedeemDirection("long");
                        } else if (longUnits > 0) {
                          setRedeemDirection("long");
                        } else {
                          setRedeemDirection("short");
                        }
                        setShowRedeemConfirm(true);
                      }}
                      className="w-full h-9 rounded-md text-xs font-semibold tracking-wider uppercase bg-zinc-800/60 text-zinc-400 border-0 hover:bg-zinc-700/60 hover:text-zinc-300 transition-all duration-150 active:scale-95"
                      data-ocid="asset.redeem_button"
                    >
                      REDEEM
                    </button>
                  )}
                </div>
              </div>
              {/* end: arc + buttons group */}
            </div>
            {/* end: inner price columns */}
          </div>
          {/* end: outer price columns */}
        </div>

        {/* Score History Modal */}
        <ScoreHistoryModal
          isOpen={showScoreHistory}
          onClose={() => setShowScoreHistory(false)}
          indexName={asset.name}
          indexSubLabel={
            subLabel && subLabel.length > 0
              ? subLabel
              : `${asset.category} NARRATIVE`
          }
          currentScore={asset.baseScore}
          scores={scoreHistoryMap.get(asset.name) ?? []}
        />

        {/* Allocation Modal */}
        {isAllocationModalOpen && (
          <AllocationModal
            isOpen={isAllocationModalOpen}
            onClose={() => setIsAllocationModalOpen(false)}
            assetName={asset.name}
            category={asset.category}
            buyPrice={asset.buyPrice}
            redeemPrice={asset.redeemPrice}
            currentScore={asset.baseScore}
            remainingPoolCapacity={remainingPoolCapacity}
            userPositionValue={userPositionValue}
          />
        )}

        {/* Short Modal — opened by the mobile-only LOW button */}
        {isShortModalOpen && (
          <ShortModal
            isOpen={isShortModalOpen}
            onClose={() => setIsShortModalOpen(false)}
            assetName={asset.name}
            category={asset.category}
            buyPrice={asset.buyPrice}
            redeemPrice={asset.redeemPrice}
            currentScore={asset.baseScore}
            remainingPoolCapacity={remainingPoolCapacity}
            userPositionValue={userPositionValue}
            shortPositionCap={adjustedShortCap}
            scoreVelocity={scoreVelocity}
            inversePairName={inversePairName ?? undefined}
            pairedLongExposure={pairedLongExposure}
          />
        )}

        {/* Oracle Audit Modal */}
        <OracleAuditModal
          isOpen={isAuditModalOpen}
          onClose={() => setIsAuditModalOpen(false)}
          indexName={asset.name}
          currentScore={asset.buyPrice}
        />
      </div>

      {/* Redemption Confirmation Modal — portal-mounted, matches AllocationModal card design */}
      {createPortal(
        <AnimatePresence>
          {showRedeemConfirm && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3, ease: "easeOut" }}
              style={{
                position: "fixed",
                top: 0,
                right: 0,
                bottom: 0,
                left: 0,
                zIndex: 99999,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "1rem",
                backgroundColor: "rgba(0, 0, 0, 0.80)",
                backdropFilter: "blur(8px)",
              }}
              onClick={(e) => {
                if (e.target === e.currentTarget) {
                  setShowRedeemConfirm(false);
                  setIsQueued(false);
                }
              }}
              onKeyDown={(e) => {
                if (
                  (e.key === "Enter" || e.key === " ") &&
                  e.target === e.currentTarget
                ) {
                  setShowRedeemConfirm(false);
                  setIsQueued(false);
                }
              }}
            >
              {/* ── Card Container: flex column, max 90vh, overflow hidden ── */}
              <div
                style={{
                  width: "100%",
                  maxWidth: "24rem",
                  maxHeight: "90vh",
                  display: "flex",
                  flexDirection: "column",
                  overflow: "hidden",
                  borderRadius: "0.75rem",
                  backgroundColor: "#000000",
                  border: "1px solid #2a2a2a",
                  fontFamily: "'Inter', system-ui, sans-serif",
                }}
              >
                {/* ── Queued Confirmation Panel ── */}
                {isQueued ? (
                  <>
                    <div
                      style={{
                        flex: 1,
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        justifyContent: "center",
                        padding: "2rem 1.5rem",
                        gap: "1rem",
                        textAlign: "center",
                      }}
                    >
                      <div
                        style={{
                          width: "3rem",
                          height: "3rem",
                          borderRadius: "50%",
                          backgroundColor: "rgba(251,191,36,0.12)",
                          border: "1px solid rgba(251,191,36,0.35)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: "1.25rem",
                        }}
                      >
                        ⏳
                      </div>
                      <div>
                        <p
                          style={{
                            color: "#FBBF24",
                            fontSize: "0.75rem",
                            fontWeight: 700,
                            letterSpacing: "0.14em",
                            textTransform: "uppercase",
                            
                            margin: 0,
                            marginBottom: "0.5rem",
                          }}
                        >
                          REDEMPTION QUEUED
                        </p>
                        <p
                          style={{
                            color: "#6b6b6b",
                            fontSize: "0.8125rem",
                            lineHeight: 1.6,
                            margin: 0,
                          }}
                        >
                          High pool utilization detected. Your redemption will
                          be processed within 24 hours as liquidity becomes
                          available.
                        </p>
                      </div>
                      <div
                        style={{
                          padding: "0.5rem 1rem",
                          borderRadius: "0.375rem",
                          border: "1px solid rgba(251,191,36,0.25)",
                          backgroundColor: "rgba(251,191,36,0.06)",
                        }}
                      >
                        <span
                          style={{
                            color: "#6b6b6b",
                            fontSize: "0.6875rem",
                            
                          }}
                        >
                          Queue position:{" "}
                          <span style={{ color: "#FBBF24", fontWeight: 700 }}>
                            #{queuePosition}
                          </span>
                        </span>
                      </div>
                    </div>
                    <div
                      style={{
                        borderTop: "1px solid rgba(255,255,255,0.06)",
                        padding: "0.875rem 1.25rem 1.25rem 1.25rem",
                        flexShrink: 0,
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setShowRedeemConfirm(false);
                          setIsQueued(false);
                        }}
                        style={{
                          width: "100%",
                          padding: "0.875rem",
                          borderRadius: "0.5rem",
                          border: "1px solid rgba(251,191,36,0.4)",
                          backgroundColor: "rgba(251,191,36,0.1)",
                          color: "#FBBF24",
                          fontSize: "0.875rem",
                          fontWeight: 600,
                          cursor: "pointer",
                          
                          letterSpacing: "0.05em",
                          textTransform: "uppercase",
                        }}
                      >
                        OK
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    {/* ── Sticky Header: always visible, close button never scrolls away ── */}
                    <div
                      style={{
                        position: "sticky",
                        top: 0,
                        zIndex: 10,
                        backgroundColor: "#000000",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "1.25rem 1.25rem 0.75rem 1.25rem",
                        borderBottom: "1px solid rgba(255,255,255,0.06)",
                        flexShrink: 0,
                      }}
                    >
                      <h2
                        style={{
                          color: "#ffffff",
                          fontSize: "1.25rem",
                          fontWeight: 700,
                          letterSpacing: "-0.01em",
                          margin: 0,
                        }}
                      >
                        {hasBothPositions
                          ? "Close Position"
                          : redeemDirection === "short"
                            ? "Close Short Position"
                            : "Partial Redemption"}
                      </h2>
                      {/* Synced 30s countdown timer */}
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "0.375rem",
                          padding: "0.375rem 0.625rem",
                          borderRadius: "0.375rem",
                          backgroundColor: "rgba(255,255,255,0.03)",
                          border: "1px solid #2a2a2a",
                          flexShrink: 0,
                          marginLeft: "auto",
                          marginRight: "0.5rem",
                        }}
                      >
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#6b6b6b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="12" cy="12" r="10" />
                          <polyline points="12 6 12 12 16 14" />
                        </svg>
                        <span
                          style={{
                            fontFamily: '"JetBrains Mono", "Fira Code", monospace',
                            fontSize: "11px",
                            fontWeight: 400,
                            letterSpacing: "0.025em",
                            color: isRedeemTimerUrgent ? "#f87171" : "#ffffff",
                            transition: "color 0.15s",
                            fontVariantNumeric: "tabular-nums",
                          }}
                        >
                          {redeemCountdown}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setShowRedeemConfirm(false)}
                        style={{
                          background: "none",
                          border: "none",
                          cursor: "pointer",
                          color: "#6b6b6b",
                          padding: "0.25rem",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        ✕
                      </button>
                    </div>

                    {/* ── Scrollable Body: all content between header and redeem button ── */}
                    <div
                      style={{
                        overflowY: "auto",
                        flex: 1,
                        padding: "0 0 0.5rem 0",
                      }}
                    >
                      {hasBothPositions && (
                        <div
                          style={{
                            margin: "0 1.25rem 1rem 1.25rem",
                            display: "grid",
                            gridTemplateColumns: "1fr 1fr",
                            gap: "0.5rem",
                          }}
                        >
                          <button
                            type="button"
                            onClick={() => setRedeemDirection("long")}
                            style={{
                              padding: "0.625rem",
                              borderRadius: "0.5rem",
                              border: `1px solid ${
                                redeemDirection === "long"
                                  ? "rgba(34,197,94,0.5)"
                                  : "rgba(255,255,255,0.08)"
                              }`,
                              backgroundColor:
                                redeemDirection === "long"
                                  ? "rgba(34,197,94,0.1)"
                                  : "rgba(255,255,255,0.03)",
                              color:
                                redeemDirection === "long"
                                  ? "#22c55e"
                                  : "#8E8E93",
                              fontSize: "0.625rem",
                              fontWeight: 600,
                              letterSpacing: "0.1em",
                              textTransform: "uppercase",
                              cursor: "pointer",
                            }}
                          >
                            Close High
                          </button>
                          <button
                            type="button"
                            onClick={() => setRedeemDirection("short")}
                            style={{
                              padding: "0.625rem",
                              borderRadius: "0.5rem",
                              border: `1px solid ${
                                redeemDirection === "short"
                                  ? "rgba(239,68,68,0.5)"
                                  : "rgba(255,255,255,0.08)"
                              }`,
                              backgroundColor:
                                redeemDirection === "short"
                                  ? "rgba(239,68,68,0.1)"
                                  : "rgba(255,255,255,0.03)",
                              color:
                                redeemDirection === "short"
                                  ? "#ef4444"
                                  : "#8E8E93",
                              fontSize: "0.625rem",
                              fontWeight: 600,
                              letterSpacing: "0.1em",
                              textTransform: "uppercase",
                              cursor: "pointer",
                            }}
                          >
                            Close Low
                          </button>
                        </div>
                      )}
                      {/* Tier and spread info */}
                      <div
                        style={{
                          margin: "1rem 1.25rem 0 1.25rem",
                          padding: "0.75rem",
                          borderRadius: "0.5rem",
                          border: "1px solid rgba(255,255,255,0.08)",
                          backgroundColor: "rgba(255,255,255,0.03)",
                        }}
                      >
                        <p
                          style={{
                            color: "#6b6b6b",
                            fontSize: "0.8125rem",
                            lineHeight: 1.6,
                            margin: 0,
                          }}
                        >
                          {redeemDirection === "short" ? (
                            <>
                              Closing this short position will return your mark-to-market value to your wallet.
                            </>
                          ) : isFullRedeemSelected ? (
                              <>
                                Redeeming this position will reset your current{" "}
                                <span
                                  style={{
                                    color: "#ffffff",
                                    
                                    fontWeight: 600,
                                  }}
                                >
                                  {positionTier.name}
                                </span>{" "}
                                tier for{" "}
                                <span
                                  style={{ color: "#ffffff", fontWeight: 600 }}
                                >
                                  {asset.name}
                                </span>
                                {/* FIX 6: Exit spread language replacing discount language */}
                                . Exit spread:{" "}
                                <span
                                  style={{
                                    color: "#ffffff",
                                    
                                    fontWeight: 600,
                                  }}
                                >
                                  {effectiveExitSpread.toFixed(2)} pts
                                </span>
                                {positionTier.name !== "Standard" && (
                                  <span style={{ color: "#6b6b6b" }}>
                                    {" "}
                                    (reduced from 0.50 — {positionTier.name}{" "}
                                    tier)
                                  </span>
                                )}
                              </>
                            ) : (
                              <>
                                Redeeming{" "}
                                <span
                                  style={{
                                    color: "#ffffff",
                                    
                                    fontWeight: 600,
                                  }}
                                >
                                  {activeRedeemUnits}
                                </span>{" "}
                                shares. Your remaining position will keep its
                                loyalty tier clock.
                              </>
                            )}
                        </p>
                      </div>

                      {/* YOU WILL RECEIVE — prominent payout display */}
                      <div
                        style={{
                          margin: "0.75rem 1.25rem 0 1.25rem",
                          padding: "1rem",
                          borderRadius: "0.75rem",
                          border: "1px solid #1e1e1e",
                          backgroundColor: "#111111",
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "center",
                          gap: "0.375rem",
                        }}
                      >
                        <span
                          style={{
                            color: "#6b6b6b",
                            fontSize: "0.625rem",
                            textTransform: "uppercase",
                            letterSpacing: "0.12em",
                            fontWeight: 500,
                          }}
                        >
                          You Will Receive
                        </span>
                        {(() => {
                          // FIX 2: shortPartialRedeemNet is null while
                          // fullPosition loads — show a placeholder instead of
                          // a misleading $0.00. Long path is unaffected.
                          // FIX 3c: also gate on shortEntryScoreValid so the
                          // payout reads "Position data loading..." until the
                          // short entry score resolves to a nonzero value.
                          if (
                            redeemDirection === "short" &&
                            shortPartialRedeemNet === null
                          ) {
                            return (
                              <span
                                style={{
                                  color: "#6b6b6b",
                                  fontSize: "1.5rem",
                                  fontWeight: 600,
                                  
                                  letterSpacing: "-0.02em",
                                }}
                              >
                                Position data loading...
                              </span>
                            );
                          }
                          const payout = Math.max(
                            0,
                            redeemDirection === "short"
                              ? (shortPartialRedeemNet ?? 0)
                              : partialRedeemNet,
                          );
                          return (
                            <span
                              style={{
                                color: payout === 0 ? "#6b6b6b" : "#ffffff",
                                fontSize: "2rem",
                                fontWeight: 700,
                                
                                letterSpacing: "-0.02em",
                              }}
                            >
                              ${payout.toFixed(2)}
                            </span>
                          );
                        })()}
                        <span
                          style={{
                            color: "#6b6b6b",
                            fontSize: "0.6875rem",
                            
                          }}
                        >
                          exit spread: {effectiveExitSpread.toFixed(2)} pts
                          {positionTier.name !== "Standard" && (
                            <span
                              style={{
                                color: "oklch(0.72 0.18 145)",
                                marginLeft: "0.375rem",
                              }}
                            >
                              · {positionTier.name} tier discount applied
                            </span>
                          )}
                        </span>
                      </div>

                      {/* Input mode toggle: $ Dollar / # Shares */}
                      <div
                        style={{
                          display: "flex",
                          margin: "1rem 1.25rem 0 1.25rem",
                          backgroundColor: "rgba(255,255,255,0.04)",
                          borderRadius: "9999px",
                          padding: "3px",
                          gap: "3px",
                        }}
                      >
                        {(["dollar", "units"] as const).map((mode) => {
                          const label = mode === "dollar" ? "$ Dollar" : "# Shares";
                          const isActive = redeemInputMode === mode;
                          const activeColor = redeemDirection === "short" ? "#f87171" : "#4ade80";
                          const activeBg = redeemDirection === "short" ? "rgba(239,68,68,0.15)" : "rgba(74,222,128,0.15)";
                          const activeBorder = redeemDirection === "short" ? "rgba(239,68,68,0.4)" : "rgba(74,222,128,0.4)";
                          return (
                            <button
                              key={mode}
                              type="button"
                              onClick={() => {
                                if (redeemInputMode !== mode) {
                                  setRedeemInputMode(mode);
                                  setRedeemUnitsError("");
                                  if (mode === "units") {
                                    setRedeemDollarRaw("");
                                  } else {
                                    setRedeemUnitsRaw("");
                                    setRedeemUnits(0);
                                  }
                                }
                              }}
                              style={{
                                flex: 1,
                                padding: "0.375rem 0",
                                borderRadius: "9999px",
                                border: isActive ? `1px solid ${activeBorder}` : "1px solid transparent",
                                backgroundColor: isActive ? activeBg : "transparent",
                                color: isActive ? activeColor : "#8E8E93",
                                fontSize: "0.75rem",
                                fontWeight: 600,
                                cursor: "pointer",
                                transition: "all 0.15s ease",
                              }}
                            >
                              {label}
                            </button>
                          );
                        })}
                      </div>

                      {/* Input field */}
                      <div style={{ margin: "0.75rem 1.25rem 0 1.25rem" }}>
                        <div
                          style={{
                            backgroundColor: "#111111",
                            borderRadius: "0.75rem",
                            border: `1px solid ${
                              redeemUnitsError
                                ? "rgba(239,68,68,0.5)"
                                : redeemDirection === "short"
                                  ? "rgba(239,68,68,0.25)"
                                  : "#1e1e1e"
                            }`,
                            padding: "0.75rem 1rem",
                            display: "flex",
                            alignItems: "center",
                            gap: "0.25rem",
                          }}
                        >
                          {redeemInputMode === "dollar" && (
                            <span style={{ fontSize: "1.875rem", fontWeight: 300, color: redeemDollarRaw ? "#4a4a4a" : "#4a4a4a" }}>$</span>
                          )}
                          {redeemInputMode === "dollar" ? (
                            <input
                              type="text"
                              inputMode="decimal"
                              placeholder="0.00"
                              value={redeemDollarRaw}
                              onChange={(e) => {
                                const val = e.target.value;
                                if (/^[\d,]*\.?\d{0,2}$/.test(val) || val === "") {
                                  setRedeemDollarRaw(val);
                                  setRedeemUnitsError("");
                                  const parsed = Number.parseFloat(val.replace(/,/g, "")) || 0;
                                  const units = effectiveRedeemPrice > 0 ? Math.max(0, Math.min(maxRedeemUnits, Math.floor(parsed / effectiveRedeemPrice))) : 0;
                                  setRedeemUnits(units);
                                }
                              }}
                              style={{
                                background: "none",
                                border: "none",
                                outline: "none",
                                color: redeemDirection === "short" ? "#f87171" : (redeemDollarRaw ? "#ffffff" : "#4a4a4a"),
                                fontSize: "2.25rem",
                                fontWeight: 700,
                                caretColor: redeemDirection === "short" ? "#f87171" : "oklch(0.72 0.18 145)",
                                width: "100%",
                              }}
                            />
                          ) : (
                            <input
                              id="redeem-units-input"
                              type="number"
                              min={1}
                              max={maxRedeemUnits}
                              step={1}
                              value={redeemUnitsRaw}
                              onChange={(e) => {
                                const raw = e.target.value;
                                setRedeemUnitsRaw(raw);
                                setRedeemUnitsError("");
                                if (raw === "" || raw === "0") {
                                  setRedeemUnitsError("Enter a valid number of units");
                                  return;
                                }
                                const parsed = Number.parseInt(raw, 10);
                                if (Number.isNaN(parsed)) {
                                  setRedeemUnitsError("Enter a valid number of units");
                                  return;
                                }
                                if (parsed > maxRedeemUnits) {
                                  setRedeemUnitsError(`Cannot exceed your balance of ${maxRedeemUnits} shares`);
                                  return;
                                }
                                setRedeemUnits(parsed);
                              }}
                              onBlur={(e) => {
                                const parsed = Number.parseInt(e.target.value, 10);
                                const clamped = Number.isNaN(parsed)
                                  ? maxRedeemUnits
                                  : Math.max(0, Math.min(maxRedeemUnits, parsed));
                                setRedeemUnits(clamped);
                                setRedeemUnitsRaw(String(clamped));
                                setRedeemUnitsError("");
                              }}
                              style={{
                                background: "none",
                                border: "none",
                                outline: "none",
                                color: redeemDirection === "short" ? "#f87171" : (redeemUnitsRaw ? "#ffffff" : "#4a4a4a"),
                                fontSize: "2.25rem",
                                fontWeight: 700,
                                caretColor: redeemDirection === "short" ? "#f87171" : "oklch(0.72 0.18 145)",
                                width: "100%",
                              }}
                            />
                          )}
                        </div>
                        {/* Hint line */}
                        <p style={{ color: "#6b6b6b", fontSize: "0.6875rem", marginTop: "0.375rem", marginBottom: 0 }}>
                          {redeemInputMode === "dollar" ? (
                            <>
                              Max: ${(maxRedeemUnits * effectiveRedeemPrice).toFixed(2)}
                              {redeemDollarRaw && redeemUnits > 0 && (
                                <span style={{ color: redeemDirection === "short" ? "#f87171" : "#6b6b6b" }}>
                                  {" "}· {redeemUnits} shares
                                </span>
                              )}
                            </>
                          ) : (
                            <>
                              Max: {maxRedeemUnits} shares
                              {redeemUnitsRaw !== "" && redeemUnits > 0 && effectiveRedeemPrice > 0 && (
                                <span style={{ color: redeemDirection === "short" ? "#f87171" : "#6b6b6b" }}>
                                  {" "}· ${(redeemUnits * effectiveRedeemPrice).toFixed(2)}
                                </span>
                              )}
                            </>
                          )}
                        </p>
                        {redeemUnitsError && (
                          <p style={{ color: "#f87171", fontSize: "0.6875rem", marginTop: "0.25rem", marginBottom: 0 }}>
                            {redeemUnitsError}
                          </p>
                        )}
                      </div>

                      {/* ── Scenario Preview — only shown after user types a value ── */}
                      {redeemUnitsRaw !== "" &&
                        activeRedeemUnits > 0 &&
                        asset.baseScore > 0 &&
                        redeemDirection === "long" &&
                        effectiveRedeemPrice > 0 &&
                        (() => {
                          const scenarios = computeRedemptionScenarios(
                            asset.baseScore,
                            effectiveRedeemPrice,
                            activeRedeemUnits,
                            effectiveSpread,
                          );
                          return (
                            <div
                              style={{ margin: "0.875rem 1.25rem 0 1.25rem" }}
                            >
                              {/* Section header */}
                              <div
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: "0.3rem",
                                  marginBottom: "0.5rem",
                                }}
                              >
                                <TrendingUp
                                  size={10}
                                  style={{ color: "#6b6b6b" }}
                                />
                                <span
                                  style={{
                                    color: "#6b6b6b",
                                    fontSize: "0.625rem",
                                    textTransform: "uppercase",
                                    letterSpacing: "0.1em",
                                    fontWeight: 500,
                                  }}
                                >
                                  Scenario Preview
                                </span>
                              </div>

                              {/* Scenario columns card */}
                              <div
                                className="grid grid-cols-1 sm:grid-cols-3"
                                style={{
                                  borderRadius: "0.5rem",
                                  border: "1px solid rgba(255,255,255,0.08)",
                                  backgroundColor: "rgba(255,255,255,0.03)",
                                  overflow: "hidden",
                                }}
                              >
                                {scenarios.map((s, i) => (
                                  <div
                                    key={s.delta}
                                    style={{
                                      padding: "0.625rem 0.5rem",
                                      textAlign: "center",
                                      borderLeft:
                                        i > 0
                                          ? "1px solid rgba(255,255,255,0.08)"
                                          : "none",
                                      display: "flex",
                                      flexDirection: "column",
                                      gap: "0.25rem",
                                    }}
                                  >
                                    {/* Scenario label */}
                                    <span
                                      style={{
                                        color: "#6b6b6b",
                                        fontSize: "0.6rem",
                                        textTransform: "uppercase",
                                        letterSpacing: "0.08em",
                                        fontWeight: 500,
                                      }}
                                    >
                                      +{s.delta} pts
                                    </span>

                                    {/* Projected payout value */}
                                    <span
                                      style={{
                                        color: "#ffffff",
                                        fontSize: "0.8125rem",
                                        
                                        fontWeight: 600,
                                        letterSpacing: "-0.01em",
                                      }}
                                    >
                                      ${s.payoutValue.toFixed(2)}
                                    </span>

                                    {/* Gain vs current payout */}
                                    <span
                                      style={{
                                        color: PLATFORM_GREEN_REDEEM,
                                        fontSize: "0.6rem",
                                        
                                        fontWeight: 500,
                                      }}
                                    >
                                      +${s.gain.toFixed(2)}
                                      <br />
                                      <span style={{ opacity: 0.8 }}>
                                        (+{s.gainPct.toFixed(1)}%)
                                      </span>
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          );
                        })()}

                      {/* ── Short Scenario Preview — only shown after user types a value ── */}
                      {redeemUnitsRaw !== "" &&
                        redeemDirection === "short" &&
                        activeRedeemUnits > 0 &&
                        asset.baseScore > 0 &&
                        shortScenarios &&
                        (() => {
                          const scenarios = shortScenarios;
                          return (
                            <div
                              style={{ margin: "0.875rem 1.25rem 0 1.25rem" }}
                            >
                              {/* Section header */}
                              <div
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: "0.3rem",
                                  marginBottom: "0.5rem",
                                }}
                              >
                                <TrendingDown
                                  size={10}
                                  style={{ color: "#6b6b6b" }}
                                />
                                <span
                                  style={{
                                    color: "#6b6b6b",
                                    fontSize: "0.625rem",
                                    textTransform: "uppercase",
                                    letterSpacing: "0.1em",
                                    fontWeight: 500,
                                  }}
                                >
                                  Scenario Preview
                                </span>
                              </div>

                              {/* Scenario columns card */}
                              <div
                                className="grid grid-cols-1 sm:grid-cols-3"
                                style={{
                                  borderRadius: "0.5rem",
                                  border: "1px solid rgba(255,255,255,0.08)",
                                  backgroundColor: "rgba(255,255,255,0.03)",
                                  overflow: "hidden",
                                }}
                              >
                                {scenarios.map((s, i) => (
                                  <div
                                    key={s.delta}
                                    style={{
                                      padding: "0.625rem 0.5rem",
                                      textAlign: "center",
                                      borderLeft:
                                        i > 0
                                          ? "1px solid rgba(255,255,255,0.08)"
                                          : "none",
                                      display: "flex",
                                      flexDirection: "column",
                                      gap: "0.25rem",
                                    }}
                                  >
                                    {/* Scenario label — negative deltas, no + prefix */}
                                    <span
                                      style={{
                                        color: "#6b6b6b",
                                        fontSize: "0.6rem",
                                        textTransform: "uppercase",
                                        letterSpacing: "0.08em",
                                        fontWeight: 500,
                                      }}
                                    >
                                      {s.delta} pts
                                    </span>

                                    {/* Projected payout value */}
                                    <span
                                      style={{
                                        color: "#ffffff",
                                        fontSize: "0.8125rem",
                                        
                                        fontWeight: 600,
                                        letterSpacing: "-0.01em",
                                      }}
                                    >
                                      ${s.scenarioValue.toFixed(2)}
                                    </span>

                                    {/* Gain vs current payout */}
                                    <span
                                      style={{
                                        color: PLATFORM_GREEN_REDEEM,
                                        fontSize: "0.6rem",
                                        
                                        fontWeight: 500,
                                      }}
                                    >
                                      +${s.gain.toFixed(2)}
                                      <br />
                                      <span style={{ opacity: 0.8 }}>
                                        (+{s.gainPct.toFixed(1)}%)
                                      </span>
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          );
                        })()}

                      {/* Footer note — inside scroll area */}
                      <div
                        style={{
                          padding: "1rem 1.25rem 0.25rem 1.25rem",
                          display: "flex",
                          alignItems: "center",
                          gap: "0.375rem",
                        }}
                      >
                        <span
                          style={{
                            color: "#6b6b6b",
                            fontSize: "0.625rem",
                            lineHeight: 1.4,
                          }}
                        >
                          Redemption is final. Exit spread applied based on
                          current loyalty tier.
                        </span>
                      </div>
                    </div>

                    {/* ── Sticky Action Buttons: always visible at bottom ── */}
                    <div
                      style={{
                        position: "sticky",
                        bottom: 0,
                        backgroundColor: "#000000",
                        borderTop: "1px solid rgba(255,255,255,0.06)",
                        padding: "0.875rem 1.25rem 1.25rem 1.25rem",
                        display: "flex",
                        flexDirection: "column",
                        gap: "0.5rem",
                        flexShrink: 0,
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => setShowRedeemConfirm(false)}
                        style={{
                          width: "100%",
                          padding: "0.875rem",
                          borderRadius: "0.5rem",
                          border: "1px solid oklch(0.52 0.17 145 / 0.5)",
                          backgroundColor: "oklch(0.52 0.17 145 / 0.15)",
                          color: "oklch(0.72 0.18 145)",
                          fontSize: "0.875rem",
                          fontWeight: 600,
                          cursor: "pointer",
                        }}
                      >
                        Cancel
                      </button>
                      {/* Step 5: REDEEM button disabled when error exists or redeemUnits <= 0 */}
                      <button
                        type="button"
                        onClick={handleConfirmRedeem}
                        disabled={isRedeemButtonDisabled}
                        style={{
                          width: "100%",
                          padding: "0.875rem",
                          borderRadius: "0.5rem",
                          backgroundColor: isRedeemButtonDisabled ? "#1a1a1a" : (redeemDirection === "short" ? "rgba(239,68,68,0.15)" : "oklch(0.52 0.17 145)"),
                          border: isRedeemButtonDisabled ? "none" : (redeemDirection === "short" ? "1px solid rgba(239,68,68,0.5)" : "none"),
                          color: isRedeemButtonDisabled ? "#4a4a4a" : (redeemDirection === "short" ? "#f87171" : "#ffffff"),
                          fontSize: "0.875rem",
                          fontWeight: 600,
                          opacity: isRedeemButtonDisabled ? 0.4 : 1,
                          cursor: isRedeemButtonDisabled
                            ? "not-allowed"
                            : "pointer",
                        }}
                      >
                        {isRedeemButtonDisabled
                          ? "Enter an Amount"
                          : redeemDirection === "short"
                            ? `Close Short · ${redeemUnits} shares`
                            : redeemInputMode === "dollar"
                              ? `Confirm · $${redeemDollarRaw} (${redeemUnits} shares)`
                              : `Confirm · ${redeemUnits} shares`}
                      </button>
                    </div>
                  </>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </TooltipProvider>
  );
}

/**
 * Custom comparison for React.memo — skips re-render when the five
 * Oracle-driven prop fields are all identical.  Any change to baseScore,
 * buyPrice, redeemPrice, momentumState, or isAtCapacity allows the render.
 * Internal component logic (getTotalAllocatedForIndex calls etc.) is
 * completely untouched — the wrapper sits outside the function body.
 */
function areAssetRowPropsEqual(
  prev: Readonly<AssetRowProps>,
  next: Readonly<AssetRowProps>,
): boolean {
  return (
    prev.asset.baseScore === next.asset.baseScore &&
    prev.asset.buyPrice === next.asset.buyPrice &&
    prev.asset.redeemPrice === next.asset.redeemPrice &&
    prev.asset.isAtCapacity === next.asset.isAtCapacity
  );
}

export const AssetRow = memo(AssetRowInner, areAssetRowPropsEqual);
