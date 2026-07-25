/**
 * Time-Decay (Mean Reversion) Engine
 *
 * Implements an Ornstein–Uhlenbeck mean-reversion drift for all active indices.
 * Scores naturally gravitate back to the neutral baseline (50.00) over time
 * when no new news catalysts are present.
 *
 * FORMULA:
 *   Decayed_Score = 50.00 + ((Previous_Score - 50.00) * Math.exp(-λ * Δt))
 *   λ (lambda) = 0.10  (decay rate per hour)
 *
 * STATE UPDATE & LOGGING RULES:
 *   Scenario A — News exists:
 *     Final_Score = Decayed_Score + New_Oracle_Impact
 *     Log normally; update DB.
 *
 *   Scenario B — No news & Decay_Impact < 0.10:
 *     Update baseScore silently. Do NOT write to historical_sentiment_logs.
 *
 *   Scenario C — No news & Decay_Impact >= 0.10:
 *     Update baseScore AND write Audit Log entry:
 *       Label: 'Time-Decay (Theta)'
 *       Rationale: 'Asset naturally reverting to neutral baseline (50.00) due to
 *                   low news velocity and narrative stagnation.'
 *
 * STRICT SAFETY:
 *   No imports of index.css, tailwind.config.js, or components.json.
 *   All logic stays within this TypeScript service file.
 */

import { ACTIVE_INDICES } from "./gsiCovarianceEngine";

// ─── Constants ────────────────────────────────────────────────────────────────

/** Mean-reversion decay rate per hour. */
const LAMBDA = 0.35; // per hour — recovers ~2 hours from floor to midpoint (increased from 0.10 to break floor trap)

/** Neutral baseline all scores revert toward. */
const BASELINE = 50.0;

/** Minimum Decay_Impact required to write a Theta audit log entry (Scenario C). */
const AUDIT_LOG_THRESHOLD = 0.1;

// ─── Per-Index State ──────────────────────────────────────────────────────────

export interface IndexDecayState {
  /** Last known baseScore before decay is applied. */
  previousScore: number;
  /** Unix timestamp (ms) of the last Oracle update for this index. */
  lastUpdatedMs: number;
}

/**
 * In-memory state store for each active index.
 * Seeded lazily on first Oracle tick.
 */
const decayStateMap: Map<string, IndexDecayState> = new Map();

// ─── Audit Log ────────────────────────────────────────────────────────────────

export interface ThetaAuditEntry {
  indexName: string;
  timestamp: number; // ms since epoch
  label: "Time-Decay (Theta)";
  previousScore: number;
  decayedScore: number;
  decayImpact: number;
  deltaHours: number;
  rationale: string;
}

/** In-memory Theta audit log — appended by Scenario C events. */
const thetaAuditLog: ThetaAuditEntry[] = [];

/** Max entries to keep in memory (prevents unbounded growth). */
const MAX_AUDIT_LOG_ENTRIES = 500;

// ─── Core Math ────────────────────────────────────────────────────────────────

/**
 * Applies the mean-reversion decay formula to a single score.
 *
 * @param previousScore  The score before decay is applied.
 * @param deltaHours     Time elapsed since last update, in fractional hours.
 * @param lambda         Optional override decay rate (λ per hour). Defaults to
 *                       the module-level LAMBDA constant when not provided.
 *                       Pass a category-specific rate from indexCategoryRegistry
 *                       to get per-category reversion speeds.
 * @returns              The score after decay, rounded to 2 decimal places.
 */
export function applyDecay(
  previousScore: number,
  deltaHours: number,
  lambda = LAMBDA,
): number {
  const decayed =
    BASELINE + (previousScore - BASELINE) * Math.exp(-lambda * deltaHours);
  return Math.round(decayed * 100) / 100;
}

// ─── State Management ────────────────────────────────────────────────────────

/**
 * Initialises or updates the decay state for a given index.
 * Called after each Oracle tick writes a confirmed new score to the state map.
 */
export function updateDecayState(indexName: string, score: number): void {
  decayStateMap.set(indexName, {
    previousScore: score,
    lastUpdatedMs: Date.now(),
  });
}

/**
 * Returns the stored decay state for an index.
 * Returns null if no state has been recorded yet.
 */
export function getDecayState(indexName: string): IndexDecayState | null {
  return decayStateMap.get(indexName) ?? null;
}

// ─── Main Engine Entry Point ──────────────────────────────────────────────────

export interface DecayResult {
  indexName: string;
  previousScore: number;
  decayedScore: number;
  decayImpact: number;
  deltaHours: number;
  /** true → Scenario C: write Theta audit log entry */
  shouldAuditLog: boolean;
  /** The ThetaAuditEntry generated if shouldAuditLog is true, else null */
  auditEntry: ThetaAuditEntry | null;
}

/**
 * Processes time-decay for a single index when no new news event exists.
 * Implements the Scenario B / Scenario C branching logic.
 *
 * @param indexName      Canonical index name (must match ACTIVE_INDICES).
 * @param currentScore   The current baseScore from the Oracle tick.
 * @param nowMs          Current timestamp in milliseconds (injectable for testing).
 * @returns              DecayResult with the new decayed score and audit metadata.
 */
export function processDecay(
  indexName: string,
  currentScore: number,
  nowMs = Date.now(),
): DecayResult {
  const state = decayStateMap.get(indexName);

  if (!state) {
    // No prior state — seed it and return zero-decay result (first tick)
    updateDecayState(indexName, currentScore);
    return {
      indexName,
      previousScore: currentScore,
      decayedScore: currentScore,
      decayImpact: 0,
      deltaHours: 0,
      shouldAuditLog: false,
      auditEntry: null,
    };
  }

  const { previousScore, lastUpdatedMs } = state;
  const deltaMs = Math.max(0, nowMs - lastUpdatedMs);
  const deltaHours = deltaMs / (1000 * 60 * 60);

  const decayedScore = applyDecay(previousScore, deltaHours);
  const decayImpact = Math.abs(previousScore - decayedScore);

  // Scenario B: silent update — no audit log
  if (decayImpact < AUDIT_LOG_THRESHOLD) {
    return {
      indexName,
      previousScore,
      decayedScore,
      decayImpact,
      deltaHours,
      shouldAuditLog: false,
      auditEntry: null,
    };
  }

  // Scenario C: significant decay — write Theta audit entry
  const entry: ThetaAuditEntry = {
    indexName,
    timestamp: nowMs,
    label: "Time-Decay (Theta)",
    previousScore,
    decayedScore,
    decayImpact,
    deltaHours,
    rationale:
      "Asset naturally reverting to neutral baseline (50.00) due to low news velocity and narrative stagnation.",
  };

  thetaAuditLog.push(entry);
  if (thetaAuditLog.length > MAX_AUDIT_LOG_ENTRIES) {
    thetaAuditLog.splice(0, thetaAuditLog.length - MAX_AUDIT_LOG_ENTRIES);
  }

  return {
    indexName,
    previousScore,
    decayedScore,
    decayImpact,
    deltaHours,
    shouldAuditLog: true,
    auditEntry: entry,
  };
}

/**
 * Processes time-decay for all active indices in a single Oracle tick
 * where no new news events are present.
 *
 * Returns a map of indexName → DecayResult for downstream consumption.
 */
export function processDecayForAllIndices(
  currentScores: Partial<Record<string, number>>,
  nowMs = Date.now(),
): Map<string, DecayResult> {
  const results = new Map<string, DecayResult>();

  for (const indexName of ACTIVE_INDICES) {
    const currentScore = currentScores[indexName];
    if (currentScore === undefined) continue;
    const result = processDecay(indexName, currentScore, nowMs);
    results.set(indexName, result);
  }

  return results;
}

// ─── Scenario A helper ───────────────────────────────────────────────────────

/**
 * Applies Scenario A: Oracle has new news impact for this index.
 * Returns the Final_Score after layering news impact on top of the decayed base.
 *
 * @param indexName        Canonical index name.
 * @param previousScore    Score before this Oracle tick.
 * @param newOracleImpact  Signed news sentiment delta from the Oracle.
 * @param nowMs            Current timestamp in milliseconds.
 * @returns                Final_Score = Decayed_Score + New_Oracle_Impact, floor at 0 (no upper ceiling).
 */
export function applyNewsDecay(
  indexName: string,
  previousScore: number,
  newOracleImpact: number,
  nowMs = Date.now(),
): number {
  const state = decayStateMap.get(indexName);
  const lastUpdatedMs = state?.lastUpdatedMs ?? nowMs;
  const deltaMs = Math.max(0, nowMs - lastUpdatedMs);
  const deltaHours = deltaMs / (1000 * 60 * 60);

  const decayedScore = applyDecay(previousScore, deltaHours);
  const finalScore = decayedScore + newOracleImpact;

  // Floor at 0 — no upper ceiling (scores above 100 are valid and will decay back toward 50)
  return Math.round(Math.max(0, finalScore) * 100) / 100;
}

// ─── Audit Log Access ────────────────────────────────────────────────────────

/**
 * Returns all Theta audit log entries, most recent first.
 */
export function getThetaAuditLog(): Readonly<ThetaAuditEntry[]> {
  return [...thetaAuditLog].reverse();
}

/**
 * Returns the last N Theta audit entries for a specific index.
 */
export function getThetaAuditLogForIndex(
  indexName: string,
  count = 5,
): ThetaAuditEntry[] {
  return thetaAuditLog
    .filter((e) => e.indexName === indexName)
    .slice(-count)
    .reverse();
}
