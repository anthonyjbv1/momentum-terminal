/**
 * Synthetic Liquidity (Additive Deviation) Engine
 *
 * Implements crowd-momentum weighting on top of the Oracle-driven base score.
 * Uses an additive deviation formula to prevent recursive decay:
 *
 * FORMULA:
 *   UserAllocationRatio = IndexTotalAllocated / PlatformTotalAllocated
 *   (defaults to 0.20 for each of the Big 5 if PlatformTotalAllocated === 0)
 *
 *   Liquidity_Adjustment = (UserAllocationRatio - 0.20) * 25
 *   Final_BaseScore = OracleScore + Liquidity_Adjustment
 *
 *   The neutral ratio is 0.20 (equal share across 5 indices).
 *   Adjustment is zero-sum: over-allocated indices gain, under-allocated lose.
 *
 * THRESHOLD & LOGGING:
 *   Reflexive_Impact = Liquidity_Adjustment
 *   If |Reflexive_Impact| > 0.25 → write a 'Synthetic Liquidity (User Premium)' audit entry.
 *
 * STRICT SAFETY:
 *   No imports of index.css, tailwind.config.js, or components.json.
 *   All logic stays within this TypeScript service file.
 */

import { ACTIVE_INDICES } from "./gsiCovarianceEngine";

// ─── Types ────────────────────────────────────────────────────────────────────

/** A single holding snapshot used to compute allocation ratios. */
export interface HoldingSnapshot {
  indexName: string;
  /** Dollar value currently allocated to this index. */
  allocated: number;
}

/** Result of the reflexive pricing computation for one index. */
export interface ReflexivePricingResult {
  indexName: string;
  /** Score produced by the Oracle after time-decay and news impact. */
  oracleScore: number;
  /** User allocation ratio for this index (0–1). */
  userAllocationRatio: number;
  /** Final score after synthetic liquidity weighting. */
  finalBaseScore: number;
  /** finalBaseScore − oracleScore */
  reflexiveImpact: number;
  /** true → impact exceeds 0.25 threshold → audit log entry created */
  shouldAuditLog: boolean;
  auditEntry: SyntheticLiquidityAuditEntry | null;
}

// ─── Audit Log ────────────────────────────────────────────────────────────────

export interface SyntheticLiquidityAuditEntry {
  indexName: string;
  timestamp: number;
  label: "Synthetic Liquidity (User Premium)";
  oracleScore: number;
  finalBaseScore: number;
  reflexiveImpact: number;
  userAllocationRatio: number;
  rationale: string;
}

/** In-memory audit log — capped to prevent unbounded growth. */
const syntheticAuditLog: SyntheticLiquidityAuditEntry[] = [];
const MAX_AUDIT_ENTRIES = 500;

// ─── Core Math ────────────────────────────────────────────────────────────────

/** Neutral equal-share ratio for 5 indices: 1/5 = 0.20 */
const NEUTRAL_ALLOCATION_RATIO = 1 / ACTIVE_INDICES.length; // 0.20 for Big 5
/** Sensitivity scalar: deviation of ±0.20 → ±5 point adjustment */
const LIQUIDITY_SENSITIVITY = 25;
const REFLEXIVE_IMPACT_THRESHOLD = 0.25;

/** Default equal-weight ratio when platform has no allocated capital yet. */
const DEFAULT_EQUAL_RATIO = NEUTRAL_ALLOCATION_RATIO;

/**
 * Computes per-index allocation ratios from a holdings snapshot array.
 *
 * @param holdings  Array of { indexName, allocated } for all active indices.
 * @returns         Map of indexName → UserAllocationRatio (0–1).
 */
export function computeAllocationRatios(
  holdings: HoldingSnapshot[],
): Record<string, number> {
  const platformTotalAllocated = holdings.reduce(
    (sum, h) => sum + Math.max(0, h.allocated),
    0,
  );

  const ratios: Record<string, number> = {};

  for (const indexName of ACTIVE_INDICES) {
    if (platformTotalAllocated === 0) {
      // Division-by-zero guard: equal weight across Big 5
      ratios[indexName] = DEFAULT_EQUAL_RATIO;
    } else {
      const indexAllocated =
        holdings.find((h) => h.indexName === indexName)?.allocated ?? 0;
      ratios[indexName] = Math.max(0, indexAllocated) / platformTotalAllocated;
    }
  }

  return ratios;
}

/**
 * Applies the Additive Deviation formula for a single index.
 *
 * Liquidity_Adjustment = (UserAllocationRatio - 0.20) * 25
 * Final_BaseScore = OracleScore + Liquidity_Adjustment
 *
 * @param indexName           Canonical index name.
 * @param oracleScore         Score from Oracle after time-decay and news impact.
 * @param userAllocationRatio Ratio of this index's allocation vs. total platform (0–1).
 * @param nowMs               Current timestamp in milliseconds.
 */
export function applyReflexivePricing(
  indexName: string,
  oracleScore: number,
  userAllocationRatio: number,
  nowMs = Date.now(),
): ReflexivePricingResult {
  // Additive deviation — zero-sum across equal-weight portfolio
  const reflexiveImpact =
    Math.round(
      (userAllocationRatio - NEUTRAL_ALLOCATION_RATIO) *
        LIQUIDITY_SENSITIVITY *
        100,
    ) / 100;
  const raw = oracleScore + reflexiveImpact;

  // Fix A2: floor only — no upper ceiling. Scores above 100 are valid.
  const finalBaseScore = Math.round(Math.max(0, raw) * 100) / 100;

  const shouldAuditLog = Math.abs(reflexiveImpact) > REFLEXIVE_IMPACT_THRESHOLD;

  let auditEntry: SyntheticLiquidityAuditEntry | null = null;

  if (shouldAuditLog) {
    auditEntry = {
      indexName,
      timestamp: nowMs,
      label: "Synthetic Liquidity (User Premium)",
      oracleScore,
      finalBaseScore,
      reflexiveImpact,
      userAllocationRatio,
      rationale:
        "Asset price adjusted to reflect real-time user allocation ratios and crowd momentum.",
    };

    syntheticAuditLog.push(auditEntry);

    // Enforce rolling cap
    if (syntheticAuditLog.length > MAX_AUDIT_ENTRIES) {
      syntheticAuditLog.splice(0, syntheticAuditLog.length - MAX_AUDIT_ENTRIES);
    }
  }

  return {
    indexName,
    oracleScore,
    userAllocationRatio,
    finalBaseScore,
    reflexiveImpact,
    shouldAuditLog,
    auditEntry,
  };
}

/**
 * Applies reflexive pricing to all active indices in a single Oracle tick.
 *
 * @param oracleScores  Map of indexName → oracleScore (post time-decay, post tidal).
 * @param holdings      Current holding snapshots for all indices.
 * @param nowMs         Current timestamp in milliseconds.
 * @returns             Map of indexName → ReflexivePricingResult.
 */
export function applyReflexivePricingForAll(
  oracleScores: Partial<Record<string, number>>,
  holdings: HoldingSnapshot[],
  nowMs = Date.now(),
): Map<string, ReflexivePricingResult> {
  const ratios = computeAllocationRatios(holdings);
  const results = new Map<string, ReflexivePricingResult>();

  for (const indexName of ACTIVE_INDICES) {
    const oracleScore = oracleScores[indexName];
    if (oracleScore === undefined) continue;

    const ratio = ratios[indexName] ?? DEFAULT_EQUAL_RATIO;
    const result = applyReflexivePricing(indexName, oracleScore, ratio, nowMs);
    results.set(indexName, result);
  }

  return results;
}

// ─── Audit Log Access ────────────────────────────────────────────────────────────

/**
 * Returns all Synthetic Liquidity audit entries, most recent first.
 */
export function getSyntheticAuditLog(): Readonly<
  SyntheticLiquidityAuditEntry[]
> {
  return [...syntheticAuditLog].reverse();
}

/**
 * Returns the last N Synthetic Liquidity audit entries for a specific index.
 */
export function getSyntheticAuditLogForIndex(
  indexName: string,
  count = 5,
): SyntheticLiquidityAuditEntry[] {
  return syntheticAuditLog
    .filter((e) => e.indexName === indexName)
    .slice(-count)
    .reverse();
}
