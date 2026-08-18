/**
 * Unified Oracle Pipeline
 *
 * Single entry point for all 4 math-engine steps per Oracle tick per index.
 * Produces one authoritative UnifiedOracleLogEntry per tick per index,
 * eliminating the race conditions and fragmented logs from calling each
 * engine independently.
 *
 * PIPELINE STEPS (executed in strict order):
 *   Step 1 — Time-Decay (Theta)
 *     Decayed_Score = 50 + (Prev - 50) * exp(-0.015 * deltaHours)
 *
 *   Step 2 — Oracle Impact (news)
 *     Post_News_Score = Decayed_Score + rawNewsImpact
 *     (rawNewsImpact = 0 when no headline fired this tick → Scenario B/C)
 *
 *   Step 3 — Tidal Propagation (GSI × β)
 *     Post_Tidal_Score = Post_News_Score + (GSI_Change × beta)
 *     All headlines cascade through GSI on every tick.
 *
 *   Step 4 — Synthetic Liquidity (Additive Deviation)
 *     Liquidity_Adjustment = (AllocationRatio - 0.20) * 25
 *     Final_Score = Post_Tidal_Score + Liquidity_Adjustment
 *     (0.20 = neutral equal share across 5 indices; adjustment is zero-sum)
 *
 *   Step 4b — Stream #4 Pre-emption
 *     Fires when Conviction Score (net order flow normalised) exceeds 1.5 SD
 *     from the 24h mean. Adjustment = Cs × W_INTERNAL (0.25).
 *     Cross-referenced against Stream 2 (social velocity): partial dampening
 *     at 0.4× when social is absent to prevent localised pump exploitation.
 *
 * SCENARIO LABELS:
 *   Scenario A — headline fired this tick for this index
 *   Scenario B — no headline, |theta decay| < 0.10 (silent update)
 *   Scenario C — no headline, |theta decay| >= 0.10 (audit-logged decay)
 *
 * STRICT SAFETY:
 *   No imports of index.css, tailwind.config.js, or components.json.
 *   No UI theme changes. Pure TypeScript service.
 */

import { FALLBACK_ASSET_DEFS } from "../data/fallbackAssets";
import { getDecayRate } from "../lib/oracle/indexCategoryRegistry";
import { markHeadlineConsumed } from "./dispatchedHeadlineLog";
import {
  ACTIVE_INDICES,
  ALL_INDICES,
  applyTidalPropagation,
  computeWeightedGSI,
  getBeta,
  logHourlyScores,
  updateCrisisRegime,
} from "./gsiCovarianceEngine";
import {
  clearExpiredPreemptions,
  evaluatePreemption,
} from "./netOrderFlowEngine";
import {
  type HoldingSnapshot,
  applyReflexivePricingForAll,
  computeAllocationRatios,
} from "./syntheticLiquidityEngine";
import { applyDecay, getDecayState, updateDecayState } from "./timeDecayEngine";

// ─── Types ────────────────────────────────────────────────────────────────────

/** Scenario classification for each Oracle tick. */
export type OracleScenario = "A" | "B" | "C";

/**
 * A headline payload passed in from the mock news dispatcher.
 * Present only when a new headline fired this tick.
 */
export interface TickHeadline {
  indexName: string;
  sentimentScore: number;
  headline: string;
  source?: string;
  rationale?: string;
  baseImpact?: number;
  tierMultiplier?: number;
  correlationWeight?: number;
  /** @deprecated use correlationWeight */
  weight?: number;
  /**
   * Classification confidence returned by finbertService (0–1).
   * Used to weight rawNewsImpact — high-confidence signals hit full force,
   * low-confidence signals are proportionally dampened.
   * Fallback: 0.75 (neutral middle ground) when absent.
   */
  confidence?: number;
  /**
   * Number of headlines that were merged into this TickHeadline for this tick window.
   * Used by the velocity multiplier: 1 = no multiplier, 3–5 = 1.3×, 6+ = 1.5×.
   * Defaults to 1 when absent (safe fallback — no velocity boost).
   */
  headlineCount?: number;
}

/**
 * Single authoritative record for one Oracle tick × one index.
 * This is the unified source of truth for the Audit Modal timeline.
 */
export interface UnifiedOracleLogEntry {
  /** Canonical index name */
  indexName: string;
  /** Unix timestamp (ms) when this tick was processed */
  timestamp: number;
  /** Monotonically increasing tick counter (module-global) */
  tickId: number;

  // ── Step 1: Time-Decay ───────────────────────────────────────────────
  previousScore: number;
  deltaHours: number;
  decayedScore: number;
  /** Decayed_Score − Previous_Score (negative = moving toward 50) */
  thetaAdjustment: number;

  // ── Step 2: Oracle Impact ──────────────────────────────────────────────
  /** The headline that fired this tick for this index (null if none) */
  headlineUsed: TickHeadline | null;
  /** sentimentScore from the headline, 0 if no headline fired */
  rawNewsImpact: number;
  /**
   * Velocity multiplier applied to rawNewsImpact based on headlineCount.
   * 1.0 = no boost (< 3 headlines), 1.3 = moderate boost (3–5), 1.5 = high boost (6+).
   * Hard ceiling: 1.75.
   */
  velocityMultiplier: number;
  postNewsScore: number;

  // ── Step 3: Tidal Propagation ────────────────────────────────────────────
  gsiBeforeTick: number;
  gsiAfterTick: number;
  gsiChange: number;
  betaValue: number;
  tidalDelta: number;
  postTidalScore: number;

  // ── Step 4: Synthetic Liquidity ────────────────────────────────────────────
  allocationRatio: number;
  liquidityPremium: number;
  finalScore: number;

  // ── Classification ──────────────────────────────────────────────────────
  scenario: OracleScenario;
  scenarioLabel: string;

  // ── Step 4b: Stream #4 Pre-emption ──────────────────────────────────────
  /** Whether a Stream #4 price pre-emption fired this tick. */
  preemptionFired?: boolean;
  /** The price adjustment applied by the pre-emption (can be positive or negative). */
  preemptionAdjustment?: number;
  /** Whether Stream 2 (social velocity) confirmed the pre-emption (true = full, false = dampened). */
  preemptionConfirmed?: boolean;

  // ── Inverse Relationship Signal ──────────────────────────────────────────
  /** The paired inverse index that received a dampened counter-signal this tick. */
  inverseAffectedIndex?: string;
  /** The dampened inverse impact applied to the paired index (negative of primary × 0.40). */
  inverseImpact?: number;
}

// ─── Module State ────────────────────────────────────────────────────────────────

/** Monotonically increasing tick ID. */
let _tickId = 0;

// ─── Live Allocation Reader ───────────────────────────────────────────────────────

/**
 * Reads the user's current allocation data fresh from localStorage on every call.
 * This replaces the stale cached holdings snapshot that was previously frozen at
 * session initialization, ensuring User Premium reflects the user's actual
 * live position on every tick.
 *
 * Reads from "sentimentam_local_holdings_v5" — the same key that
 * getTotalAllocatedForIndex() and the capacity tier service use.
 *
 * Returns an empty object (all indices default to equal ratio) if the key is
 * absent, unparseable, or if any error occurs — safe fallback, never throws.
 */
function readLiveAllocationRatios(): Record<string, number> {
  try {
    const raw = localStorage.getItem("sentimentam_local_holdings_v5");
    if (!raw) return {};

    const holdings = JSON.parse(raw) as Record<
      string,
      { units?: number; costBasis?: number }
    >;

    // Build allocated amounts from costBasis (locked-in total dollars paid).
    // This matches getTotalAllocatedForIndex() exactly.
    const allocated: Record<string, number> = {};
    let platformTotal = 0;

    for (const indexName of ACTIVE_INDICES) {
      const entry = holdings[indexName];
      const costBasis =
        typeof entry?.costBasis === "number" && entry.costBasis > 0
          ? entry.costBasis
          : 0;
      allocated[indexName] = costBasis;
      platformTotal += costBasis;
    }

    if (platformTotal === 0) {
      // No capital deployed — return empty to fall back to equal-ratio default
      return {};
    }

    // Compute live allocation ratios: each index's share of total deployed capital
    const ratios: Record<string, number> = {};
    for (const indexName of ACTIVE_INDICES) {
      ratios[indexName] = allocated[indexName] / platformTotal;
    }
    return ratios;
  } catch {
    // Never crash the tick — return empty, let computeAllocationRatios use equal defaults
    return {};
  }
}

/** In-memory unified log — one entry per (tick, index). Capped at 500. */
const _unifiedLog: UnifiedOracleLogEntry[] = [];
const MAX_UNIFIED_LOG = 500;

/** Previous GSI for computing gsiChange — tracked internally here. */
let _prevGSI: number | null = null;

// ─── Pipeline Constants ───────────────────────────────────────────────────────────

/**
 * Liquidity drag scalar: allocationFraction × scalar → mild friction signal.
 * At 10% allocation: -0.04 drag. At 50%: -0.20. At 100%: -0.40.
 * Target range: ±0.05 to ±0.20 per tick at typical allocation levels.
 */
const LIQUIDITY_DRAG_SCALAR = 0.4;
const THETA_AUDIT_THRESHOLD = 0.1;

/** Minimum score floor — prevents indexes from collapsing to zero. */
const SCORE_FLOOR = 35.0;

/** GSI level below which tidal propagation is braked to 50% magnitude. */
const GSI_BRAKE_THRESHOLD = 15.0;
/** Fraction of tidal delta applied when GSI is suppressed below threshold. */
const GSI_BRAKE_FACTOR = 0.5;

/**
 * Minimum allocation fraction required for Stream #4 (Net Order Flow) to fire.
 * Below this threshold the pre-emption engine returns 0.00 — eliminates the
 * near-zero noise floor that added overhead without meaningful signal.
 * At ≥15% allocation, meaningful order-flow concentration exists.
 */
const ORDER_FLOW_THRESHOLD = 0.15;

/**
 * Static index → category map built once from FALLBACK_ASSET_DEFS.
 * Used to look up the per-category decay rate for each index without
 * passing category data through every function signature.
 */
const INDEX_CATEGORY_MAP: Record<string, string> = Object.fromEntries(
  FALLBACK_ASSET_DEFS.map((a) => [a.name, a.category]),
);

// ─── Core Pipeline ────────────────────────────────────────────────────────────────

/**
 * Runs the full 4-step pipeline (plus Step 4b pre-emption) for a single index
 * within a tick. Does NOT call logHourlyScores or updateCrisisRegime — those
 * are called once per tick by runOraclePipelineForAll before the per-index pass.
 */
function runPipelineForIndex(
  indexName: string,
  rawOracleScore: number,
  tickHeadline: TickHeadline | null,
  tidalDeltas: Record<string, number>,
  allocationRatios: Record<string, number>,
  gsiBeforeTick: number,
  gsiAfterTick: number,
  tickId: number,
  nowMs: number,
  hasSocialSignal: boolean,
): UnifiedOracleLogEntry {
  // ── Step 1: Time-Decay ──────────────────────────────────────────────────
  const decayState = getDecayState(indexName);
  let previousScore: number;
  let deltaHours: number;
  let decayedScore: number;

  // Look up the per-category decay rate for this index (MACRO/GEOPOLITICAL/CULTURAL).
  // Falls back to 0.35 (previous global LAMBDA) for any unregistered index.
  const indexCategory = INDEX_CATEGORY_MAP[indexName];
  const categoryDecayRate = getDecayRate(indexCategory);

  if (!decayState) {
    // First tick — seed state, no decay
    previousScore = rawOracleScore;
    deltaHours = 0;
    decayedScore = rawOracleScore;
  } else {
    previousScore = decayState.previousScore;
    const deltaMs = Math.max(0, nowMs - decayState.lastUpdatedMs);
    deltaHours = deltaMs / (1000 * 60 * 60);
    // Pass category-specific decay rate — applyDecay uses it as λ override.
    decayedScore = applyDecay(previousScore, deltaHours, categoryDecayRate);
  }

  const thetaAdjustment =
    Math.round((decayedScore - previousScore) * 100) / 100;

  // ── Step 2: Oracle Impact ─────────────────────────────────────────────────
  // Scenario A: headline fired this tick for this specific index
  const hasHeadline =
    tickHeadline !== null && tickHeadline.indexName === indexName;

  // Base impact: baseImpact × tierMultiplier × correlationWeight × sentiment
  // sentimentScore is clamped to [-1, 1] so magnitude is preserved — a 0.15
  // score (small macro move) hits softer than a 0.9 score (large shock).
  const clampedSentiment = hasHeadline
    ? Math.max(-1, Math.min(1, tickHeadline!.sentimentScore ?? 0))
    : 0;
  const baseRawImpact = hasHeadline
    ? (tickHeadline!.baseImpact ?? 1.0) *
      (tickHeadline!.tierMultiplier ?? 1.0) *
      (tickHeadline!.correlationWeight ?? 1.0) *
      clampedSentiment
    : 0;

  // Confidence-weighted scaling: multiply by classification confidence (0–1).
  // High-confidence signals hit full force; low-confidence signals are dampened.
  // Fallback: 0.75 (neutral middle) when the confidence field is absent.
  const classificationConfidence = hasHeadline
    ? (tickHeadline!.confidence ?? 0.75)
    : 1.0;
  let rawNewsImpact =
    Math.round(baseRawImpact * classificationConfidence * 100) / 100;

  // ── Headline Velocity Multiplier ──────────────────────────────────────────
  // Rewards genuine news density: when 3+ headlines targeting the same index
  // fire in a single tick window, the combined impact receives a boost.
  // headlineCount < 3  → 1.0 (no change)
  // headlineCount 3–5  → 1.3×
  // headlineCount 6+   → 1.5×
  // Hard ceiling: 1.75 (min guard against extreme edge cases)
  const headlineCount = hasHeadline ? (tickHeadline!.headlineCount ?? 1) : 1;
  let velocityMultiplier: number;
  if (headlineCount >= 6) {
    velocityMultiplier = 1.5;
  } else if (headlineCount >= 3) {
    velocityMultiplier = 1.3;
  } else {
    velocityMultiplier = 1.0;
  }
  velocityMultiplier = Math.min(velocityMultiplier, 1.75);
  rawNewsImpact = Math.round(rawNewsImpact * velocityMultiplier * 100) / 100;

  let postNewsScore = decayedScore + rawNewsImpact;
  postNewsScore = Math.round(Math.max(SCORE_FLOOR, postNewsScore) * 100) / 100;

  // ── Step 3: Tidal Propagation ───────────────────────────────────────────────
  const gsiChange = gsiAfterTick - gsiBeforeTick;
  const betaValue = getBeta(indexName);
  const tidalDelta = tidalDeltas[indexName] ?? 0;
  // Cap tidal drift to ±2 to prevent runaway divergence (inner cap — unchanged)
  const clampedTidalDelta = Math.max(-2, Math.min(2, tidalDelta));
  // GSI suppression brake: when GSI is below threshold, apply tidal at 50% to
  // break the low-GSI → tidal drag → lower scores → lower GSI feedback loop.
  const effectiveTidalDelta =
    gsiAfterTick < GSI_BRAKE_THRESHOLD
      ? clampedTidalDelta * GSI_BRAKE_FACTOR
      : clampedTidalDelta;

  let postTidalScore = postNewsScore + effectiveTidalDelta;
  postTidalScore =
    Math.round(Math.max(SCORE_FLOOR, postTidalScore) * 100) / 100;

  // ── Step 4: Synthetic Liquidity (Mild Friction) ────────────────────────────
  // Liquidity_Drag = -(allocationFraction * LIQUIDITY_DRAG_SCALAR)
  // Produces mild friction: 0% → 0.00, 14.3% → -0.057, 50% → -0.20, 100% → -0.40
  // No recursive decay — applied once per tick as a signal, not a suppressant.
  const allocationRatio = allocationRatios[indexName] ?? 0;
  const liquidityPremium =
    Math.round(-(allocationRatio * LIQUIDITY_DRAG_SCALAR) * 100) / 100;
  const rawFinal = postTidalScore + liquidityPremium;
  const finalScore = Math.round(Math.max(SCORE_FLOOR, rawFinal) * 100) / 100;

  // ── Step 4b: Stream #4 Pre-emption ─────────────────────────────────────────
  // Fires when Conviction Score (net order flow normalized) exceeds 1.5 SD
  // from the 24h mean. Adjustment = Cs × W_INTERNAL (0.25).
  // Cross-referenced against Stream 2 (social velocity): partial dampening
  // at 0.4× when social is absent to prevent localized pump exploitation.
  //
  // Gate: only evaluate if allocation ≥ ORDER_FLOW_THRESHOLD (15%).
  // Below the threshold there is no meaningful order-flow concentration —
  // evaluating would produce near-zero noise rather than a real signal.
  const preemptionResult =
    allocationRatio >= ORDER_FLOW_THRESHOLD
      ? evaluatePreemption(indexName, nowMs, hasSocialSignal)
      : { triggered: false, adjustment: 0, confirmed: false };
  const preemptionAdj = preemptionResult.triggered
    ? preemptionResult.adjustment
    : 0;
  const finalScoreWithPreemption =
    Math.round(Math.max(SCORE_FLOOR, finalScore + preemptionAdj) * 100) / 100;

  // ── Scenario Classification ───────────────────────────────────────────────
  let scenario: OracleScenario;
  let scenarioLabel: string;

  if (hasHeadline) {
    scenario = "A";
    scenarioLabel = "Scenario A — News-Driven Update";
  } else if (Math.abs(thetaAdjustment) < THETA_AUDIT_THRESHOLD) {
    scenario = "B";
    scenarioLabel = "Scenario B — Silent Theta Decay";
  } else {
    scenario = "C";
    scenarioLabel =
      "Scenario C — Significant Decay (asset reverting to baseline 50.00)";
  }

  // ── Build Entry ──────────────────────────────────────────────────────────────
  const entry: UnifiedOracleLogEntry = {
    indexName,
    timestamp: nowMs,
    tickId,
    previousScore,
    deltaHours: Math.round(deltaHours * 10000) / 10000,
    decayedScore,
    thetaAdjustment,
    headlineUsed: hasHeadline ? tickHeadline : null,
    rawNewsImpact,
    velocityMultiplier,
    postNewsScore,
    gsiBeforeTick: Math.round(gsiBeforeTick * 100) / 100,
    gsiAfterTick: Math.round(gsiAfterTick * 100) / 100,
    gsiChange: Math.round(gsiChange * 100) / 100,
    betaValue: Math.round(betaValue * 100) / 100,
    tidalDelta: Math.round(effectiveTidalDelta * 100) / 100,
    postTidalScore,
    allocationRatio: Math.round(allocationRatio * 10000) / 10000,
    liquidityPremium,
    finalScore: finalScoreWithPreemption,
    scenario,
    scenarioLabel,
    preemptionFired: preemptionResult.triggered,
    preemptionAdjustment: preemptionResult.triggered
      ? preemptionResult.adjustment
      : 0,
    preemptionConfirmed: preemptionResult.confirmed,
  };

  return entry;
}

// ─── Batch Orchestrator ───────────────────────────────────────────────────────────────

export interface OraclePipelineInput {
  /** Raw scores returned by the backend Oracle this tick (before any client math). */
  rawOracleScores: Partial<Record<string, number>>;
  /** Current user holdings — used to compute allocation ratios. */
  holdings: HoldingSnapshot[];
  /**
   * Per-index headline map for this tick (from the 60-second batch queue drainer).
   * Each entry contains the aggregated NetImpact for that specific index.
   * Empty map = silent tick.
   */
  headlineMap?: Map<string, TickHeadline>;
  /**
   * Legacy single-headline compat (deprecated — prefer headlineMap).
   * Ignored when headlineMap is provided.
   */
  currentHeadline?: TickHeadline | null;
  /** Current timestamp in ms (injectable for testing). Defaults to Date.now(). */
  nowMs?: number;
}

export interface OraclePipelineOutput {
  /** Map of indexName → final computed score (use to set buyPrice/redeemPrice). */
  finalScores: Map<string, number>;
  /** All log entries produced this tick (one per active index). */
  tickEntries: UnifiedOracleLogEntry[];
  /** Whether crisis mode is active after this tick. */
  isCrisisMode: boolean;
}

/**
 * Master orchestrator — runs the full 4-step pipeline for all 5 active indices
 * in a single Oracle tick. Writes to the unified log and returns final scores.
 *
 * Call this ONCE per Oracle refresh cycle (every 60 seconds) from useQueries.ts.
 */
export function runOraclePipelineForAll(
  input: OraclePipelineInput,
): OraclePipelineOutput {
  const {
    rawOracleScores,
    holdings,
    headlineMap,
    currentHeadline: legacyHeadline,
    nowMs = Date.now(),
  } = input;

  // Clear pre-emptions from the previous tick before this tick fires
  clearExpiredPreemptions();

  // Build an effective headline map: prefer headlineMap, fall back to legacy single headline
  const effectiveHeadlineMap: Map<string, TickHeadline> =
    headlineMap && headlineMap.size > 0
      ? headlineMap
      : legacyHeadline
        ? new Map([[legacyHeadline.indexName, legacyHeadline]])
        : new Map();

  _tickId += 1;
  const tickId = _tickId;

  // ── Step 0: GSI infrastructure (once per tick, not per index) ─────────────
  // 1. Log scores to rolling 30-day history
  logHourlyScores(rawOracleScores);

  // 2. Compute GSI before and after this tick's headline
  const gsiBeforeTick = _prevGSI ?? computeWeightedGSI(rawOracleScores);

  // 3. If a headline fired, temporarily apply it to the score map for GSI calc
  //    (all headlines cascade through GSI on every tick per user requirement)
  const scoresWithNews: Partial<Record<string, number>> = {
    ...rawOracleScores,
  };
  for (const [idxName, hl] of effectiveHeadlineMap) {
    const prev = rawOracleScores[idxName] ?? 50;
    // Fix A3: floor only — no upper ceiling on GSI intermediate score map.
    scoresWithNews[idxName] = Math.max(0, prev + hl.sentimentScore);
  }
  const gsiAfterTick = computeWeightedGSI(scoresWithNews);

  // 4. Update Global Crisis Regime — pass current scores for trigger attribution
  const isCrisisMode = updateCrisisRegime(gsiAfterTick, scoresWithNews);

  // 5. Compute tidal deltas (GSI_Change × β per index)
  const tidalDeltas = applyTidalPropagation(scoresWithNews);

  // 6. Compute allocation ratios once for all indices.
  // User Premium fix: read allocation percentage LIVE from localStorage on every
  // tick so it reflects the user's actual current position rather than the
  // stale holdings snapshot captured at session initialization.
  // readLiveAllocationRatios() returns {} when no capital is deployed — in that
  // case computeAllocationRatios(holdings) is used as a safe fallback.
  const liveRatios = readLiveAllocationRatios();
  const allocationRatios =
    Object.keys(liveRatios).length > 0
      ? liveRatios
      : computeAllocationRatios(holdings);

  // Store current GSI for next tick's "before" reference
  _prevGSI = gsiAfterTick;

  // -- Inverse Relationship Registry
  // When the primary index moves, a 40%-dampened inverse signal is applied
  // to the paired index in the second pass (after all first-pass scores settle).
  const INVERSE_PAIRS: Record<string, string> = {
    "Traditionalism Sentiment": "Progressivism Sentiment",
    "Progressivism Sentiment": "Traditionalism Sentiment",
    "Masculism Sentiment": "Feminism Sentiment",
    "Feminism Sentiment": "Masculism Sentiment",
    "F1 Constructor Sentiment": "NASCAR Sentiment",
    "NASCAR Sentiment": "F1 Constructor Sentiment",
    "Obesity Drug Sentiment": "Whole Food & Wellness Sentiment",
    "Whole Food & Wellness Sentiment": "Obesity Drug Sentiment",
  };
  const INVERSE_DAMPENING = 0.4;

  // -- Convergent Relationship Registry
  // When the primary index moves, a 30%-dampened convergent signal is applied
  // to the paired index in the SAME direction (they move together, not apart).
  const CONVERGENT_PAIRS: Record<string, string> = {
    "Masculism Sentiment": "Traditionalism Sentiment",
    "Feminism Sentiment": "Progressivism Sentiment",
  };
  const CONVERGENT_DAMPENING = 0.3;

  // ── Per-index pipeline pass ──────────────────────────────────────────────
  const finalScores = new Map<string, number>();
  const tickEntries: UnifiedOracleLogEntry[] = [];

  const DEBUG_INDICES = new Set(["Progressivism Sentiment", "Traditionalism Sentiment", "Masculism Sentiment", "Feminism Sentiment", "NASCAR Sentiment"]);

  for (const indexName of ALL_INDICES) {
    const rawScore = rawOracleScores[indexName];
    if (rawScore === undefined) {
      console.warn(
        `[OraclePipeline] rawOracleScore is undefined for "${indexName}" — skipping this index for this tick. Check seeding logic.`,
      );
      continue;
    }
    if (DEBUG_INDICES.has(indexName)) {
      console.debug(`[OraclePipeline][DEBUG] ${indexName}: rawScore=${rawScore}, isFinite=${Number.isFinite(rawScore)}`);
    }

    // Stream 2 social signal: present if this index received a social-tier headline this tick
    const thisTickHeadline = effectiveHeadlineMap.get(indexName) ?? null;
    const hasSocialSignal =
      thisTickHeadline !== null &&
      ((thisTickHeadline.source?.toLowerCase().includes("social") ?? false) ||
        (thisTickHeadline.source?.toLowerCase().includes("stocktwits") ??
          false) ||
        (thisTickHeadline.source?.toLowerCase().includes("reddit") ?? false) ||
        (thisTickHeadline.tierMultiplier ?? 1.5) <= 0.5);

    const entry = runPipelineForIndex(
      indexName,
      rawScore,
      thisTickHeadline,
      tidalDeltas,
      allocationRatios,
      gsiBeforeTick,
      gsiAfterTick,
      tickId,
      nowMs,
      hasSocialSignal,
    );

    if (!Number.isFinite(entry.finalScore)) {
      console.warn(`[OraclePipeline] finalScore is NaN/Inf for "${indexName}" (rawScore=${rawScore}) — entry dropped from log. Pipeline math produced invalid result.`);
      continue;
    }

    // Update decay state so next tick's deltaHours is correct
    updateDecayState(indexName, entry.finalScore);

    finalScores.set(indexName, entry.finalScore);
    tickEntries.push(entry);

    // Append to unified log
    _unifiedLog.push(entry);
  }

  // Second pass: Inverse + Convergent relationship adjustments
  // Runs after ALL indexes complete their first pass so signals do not cascade
  // through decay, tidal, or floor steps.
  for (const entry of tickEntries) {
    const primaryIndex = entry.indexName;
    const primaryImpact = entry.rawNewsImpact;
    if (primaryImpact === 0) continue;

    // Inverse pass -- paired index moves in opposite direction
    const inverseIndex = INVERSE_PAIRS[primaryIndex];
    if (inverseIndex) {
      const inverseImpact = -(primaryImpact * INVERSE_DAMPENING);
      const currentInverseScore = finalScores.get(inverseIndex) ?? 0;
      const newInverseScore =
        Math.round(
          Math.max(SCORE_FLOOR, currentInverseScore + inverseImpact) * 100,
        ) / 100;
      finalScores.set(inverseIndex, newInverseScore);
      // Tag the tick entry for Oracle Feed display
      entry.inverseAffectedIndex = inverseIndex;
      entry.inverseImpact = inverseImpact;
    }

    // Convergent pass -- paired index moves in the SAME direction
    const convergentIndex = CONVERGENT_PAIRS[primaryIndex];
    if (convergentIndex) {
      const convergentImpact = primaryImpact * CONVERGENT_DAMPENING;
      const currentConvergentScore = finalScores.get(convergentIndex) ?? 0;
      const newConvergentScore =
        Math.round(
          Math.max(SCORE_FLOOR, currentConvergentScore + convergentImpact) *
            100,
        ) / 100;
      finalScores.set(convergentIndex, newConvergentScore);
    }
  }

  // Enforce cap
  if (_unifiedLog.length > MAX_UNIFIED_LOG) {
    _unifiedLog.splice(0, _unifiedLog.length - MAX_UNIFIED_LOG);
  }

  // Mark all dispatched headlines as consumed by this tick so the shared log
  // can link Oracle Feed entries to their corresponding Unified Tick Log entry.
  for (const [idxName] of effectiveHeadlineMap) {
    markHeadlineConsumed(idxName, tickId);
  }

  return { finalScores, tickEntries, isCrisisMode };
}

// ─── Log Access ─────────────────────────────────────────────────────────────────

/**
 * Returns the last N unified log entries for a specific index, most recent first.
 */
export function getUnifiedLogForIndex(
  indexName: string,
  count = 5,
): UnifiedOracleLogEntry[] {
  return _unifiedLog
    .filter((e) => e.indexName === indexName)
    .slice(-count)
    .reverse();
}

/**
 * Returns the full unified log (all indices, all ticks), most recent first.
 */
export function getFullUnifiedLog(): Readonly<UnifiedOracleLogEntry[]> {
  return [..._unifiedLog].reverse();
}

/**
 * Returns the current tick ID (useful for the UI to detect when a new tick fired).
 */
export function getCurrentTickId(): number {
  return _tickId;
}

/**
 * Returns ALL unified log entries for a specific index, oldest-first.
 * Used by the historical chart in OracleAuditModal.
 */
export function getAllLogsForIndex(indexName: string): UnifiedOracleLogEntry[] {
  return _unifiedLog.filter((e) => e.indexName === indexName);
}
