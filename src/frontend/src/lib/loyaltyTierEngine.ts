/**
 * loyaltyTierEngine.ts
 *
 * Canonical home for all loyalty tier qualification logic on Momentum Terminal.
 * Pure functions only — no React, no hooks, no side effects, no context imports.
 *
 * Qualification is evaluated on three independent axes simultaneously:
 *   1. Continuous hold period (calendar days since position entry)
 *   2. Current notional value in USD (units × index score)
 *   3. Peak position retention % (current units ÷ peak units held during window)
 *
 * A position qualifies for a tier ONLY when ALL THREE axes meet or exceed
 * that tier's thresholds. The highest qualifying tier is returned.
 *
 * SAFETY RULES — do NOT touch these files:
 *   sourceTierRegistry.ts, indexCategoryRegistry.ts, confidenceScoreEngine.ts,
 *   entityValidator.ts, timeDecayEngine.ts, unifiedOraclePipeline.ts,
 *   netOrderFlowEngine.ts, OracleTickContext.tsx
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type TierName = "Standard" | "Bronze" | "Silver" | "Gold" | "Obsidian";

export interface TierQualification {
  /** Loyalty tier identifier */
  tier: TierName;
  /** Minimum continuous hold in calendar days */
  minHoldDays: number;
  /** Minimum notional value in USD (units × current score) */
  minNotionalUSD: number;
  /** User must retain >= this % of their peak position during the qualification window */
  peakRetentionPct: number;
}

export interface QualificationResult {
  tier: TierName;
  holdDays: number;
  notionalUSD: number;
  retentionPct: number;
}

// ─── Tier Qualification Constants ─────────────────────────────────────────────

export const TIER_QUALIFICATIONS: TierQualification[] = [
  { tier: "Standard", minHoldDays: 0, minNotionalUSD: 0, peakRetentionPct: 0 },
  { tier: "Bronze", minHoldDays: 7, minNotionalUSD: 25, peakRetentionPct: 50 },
  { tier: "Silver", minHoldDays: 14, minNotionalUSD: 50, peakRetentionPct: 60 },
  { tier: "Gold", minHoldDays: 21, minNotionalUSD: 100, peakRetentionPct: 70 },
  {
    tier: "Obsidian",
    minHoldDays: 30,
    minNotionalUSD: 250,
    peakRetentionPct: 80,
  },
];

const MS_PER_DAY = 86_400_000;

// ─── Pure Qualification Functions ─────────────────────────────────────────────

/**
 * Returns the continuous hold duration in fractional days.
 * @param entryTimestampMs - Position entry time in epoch milliseconds
 * @param nowMs - Override for "now" (defaults to Date.now())
 * @returns Fractional days held; 0 if entry timestamp is invalid
 */
export function checkHoldPeriod(
  entryTimestampMs: number,
  nowMs: number = Date.now(),
): number {
  if (!Number.isFinite(entryTimestampMs) || entryTimestampMs <= 0) return 0;
  const elapsed = nowMs - entryTimestampMs;
  if (elapsed < 0) return 0;
  return elapsed / MS_PER_DAY;
}

/**
 * Returns the current notional value in USD.
 * @param currentUnits - Number of units currently held
 * @param currentScore - Current index score (used as price proxy)
 * @returns Notional value (units × score); 0 for invalid inputs
 */
export function checkNotional(
  currentUnits: number,
  currentScore: number,
): number {
  if (
    !Number.isFinite(currentUnits) ||
    currentUnits < 0 ||
    !Number.isFinite(currentScore) ||
    currentScore < 0
  )
    return 0;
  return currentUnits * currentScore;
}

/**
 * Returns the current retention % relative to the peak position.
 * @param currentUnits - Units currently held
 * @param peakUnits - Maximum units held at any point during the qualification window
 * @returns Retention percentage clamped to 0–100;
 *          100 if peakUnits is 0 (no peak = no reduction = full retention)
 */
export function checkPeakRetention(
  currentUnits: number,
  peakUnits: number,
): number {
  if (!Number.isFinite(peakUnits) || peakUnits <= 0) return 100;
  if (!Number.isFinite(currentUnits) || currentUnits < 0) return 0;
  const retention = (currentUnits / peakUnits) * 100;
  return Math.min(100, Math.max(0, retention));
}

/**
 * Evaluates all three qualification axes and returns the highest qualifying tier.
 *
 * A position qualifies for a tier when ALL THREE conditions are met:
 *   - holdDays >= tier.minHoldDays
 *   - notionalUSD >= tier.minNotionalUSD
 *   - retentionPct >= tier.peakRetentionPct
 *
 * @returns The resolved tier name plus the three computed values for transparency
 */
export function evaluateQualification(params: {
  entryTimestampMs: number;
  currentUnits: number;
  peakUnits: number;
  currentScore: number;
  nowMs?: number;
}): QualificationResult {
  const { entryTimestampMs, currentUnits, peakUnits, currentScore, nowMs } =
    params;

  const holdDays = checkHoldPeriod(entryTimestampMs, nowMs);
  const notionalUSD = checkNotional(currentUnits, currentScore);
  const retentionPct = checkPeakRetention(currentUnits, peakUnits);

  // Iterate highest → lowest, return first tier where all three axes qualify
  for (let i = TIER_QUALIFICATIONS.length - 1; i >= 0; i--) {
    const spec = TIER_QUALIFICATIONS[i];
    if (
      holdDays >= spec.minHoldDays &&
      notionalUSD >= spec.minNotionalUSD &&
      retentionPct >= spec.peakRetentionPct
    ) {
      return { tier: spec.tier, holdDays, notionalUSD, retentionPct };
    }
  }

  // Standard always qualifies (0/0/0 thresholds) — this is a defensive fallback
  return { tier: "Standard", holdDays, notionalUSD, retentionPct };
}

/**
 * Returns the TierQualification spec for a given tier name.
 * @throws Error if the tier name is not found
 */
export function getQualificationForTier(tier: TierName): TierQualification {
  const spec = TIER_QUALIFICATIONS.find((q) => q.tier === tier);
  if (!spec) {
    throw new Error(`loyaltyTierEngine: unknown tier "${tier}"`);
  }
  return spec;
}

/**
 * Returns true if the position meets all qualification criteria for the specified tier.
 * Convenience wrapper around evaluateQualification.
 */
export function isQualifiedForTier(
  tier: TierName,
  params: {
    entryTimestampMs: number;
    currentUnits: number;
    peakUnits: number;
    currentScore: number;
    nowMs?: number;
  },
): boolean {
  const result = evaluateQualification(params);
  // The resolved tier must be >= the requested tier in the ordered list
  const resolvedIdx = TIER_QUALIFICATIONS.findIndex(
    (q) => q.tier === result.tier,
  );
  const requestedIdx = TIER_QUALIFICATIONS.findIndex((q) => q.tier === tier);
  return resolvedIdx >= requestedIdx;
}

// ─── Disqualification & Remaining Days ────────────────────────────────────────

/** Three-state disqualification indicator for mid-window position monitoring. */
export type DisqualificationStatus = "QUALIFIED" | "AT_RISK" | "DISQUALIFIED";

/**
 * Evaluates whether a user mid-window has dropped below their tier's retention
 * or notional thresholds.
 *
 * @returns
 *   "QUALIFIED"     — all thresholds still met
 *   "AT_RISK"       — retention % is within 10 percentage points of the breach threshold
 *   "DISQUALIFIED"  — notional or peak retention has fallen below the minimum
 */
export function checkDisqualification(params: {
  currentUnits: number;
  peakUnits: number;
  currentNotionalUSD: number;
  tier: TierName;
}): DisqualificationStatus {
  const { currentUnits, peakUnits, currentNotionalUSD, tier } = params;

  // Standard has no retention requirements — always qualified
  if (tier === "Standard") return "QUALIFIED";

  // Guard: invalid peak
  if (!Number.isFinite(peakUnits) || peakUnits <= 0) return "DISQUALIFIED";

  const spec = getQualificationForTier(tier);

  // Current retention percentage
  const currentRetentionPct = (currentUnits / peakUnits) * 100;

  // Hard disqualification: notional has fallen below minimum
  if (currentNotionalUSD < spec.minNotionalUSD) return "DISQUALIFIED";

  // Hard disqualification: retention has fallen below the tier minimum
  if (currentRetentionPct < spec.peakRetentionPct) return "DISQUALIFIED";

  // AT_RISK: within 10 percentage points of the retention breach threshold
  if (currentRetentionPct < spec.peakRetentionPct + 10) return "AT_RISK";

  return "QUALIFIED";
}

/**
 * Returns how many whole days remain until the given tier's hold requirement is met.
 *
 * @param params.entryTimestampMs - Position entry time in epoch milliseconds
 * @param params.tier             - The target tier to check against
 * @param params.nowMs            - Override for "now" (defaults to Date.now())
 * @returns Number of days remaining; 0 if already met or Standard tier
 */
export function getDaysRemaining(params: {
  entryTimestampMs: number;
  tier: TierName;
  nowMs?: number;
}): number {
  const { entryTimestampMs, tier, nowMs = Date.now() } = params;

  // Standard has no hold requirement
  if (tier === "Standard") return 0;

  const spec = getQualificationForTier(tier);
  const daysElapsed = Math.floor((nowMs - entryTimestampMs) / 86_400_000);
  return Math.max(0, spec.minHoldDays - daysElapsed);
}
