/**
 * Time-Decay (Mean Reversion) Engine
 *
 * Implements an Ornstein–Uhlenbeck mean-reversion drift for all active indices.
 * Scores naturally gravitate back to a per-index revertTarget over time when no
 * new news catalysts are present. The revertTarget defaults to 50 but drifts
 * automatically based on sustained above/below-target streaks (regime detection).
 *
 * FORMULA:
 *   Decayed_Score = revertTarget + ((Previous_Score - revertTarget) * Math.exp(-λ * Δt))
 *   λ (lambda) = 0.35  (decay rate per hour)
 *
 * REGIME ADJUSTMENT (applied once per tick after finalScore is written):
 *   If score ≤ (revertTarget - 10) for 5+ consecutive ticks → revertTarget -= 0.5 (min 35)
 *   If score ≥ (revertTarget + 5)  for 5+ consecutive ticks → revertTarget += 0.5 (max 50)
 *   Streak counts stored in localStorage key 'mt_tick_streaks'.
 *   revertTarget values stored in localStorage key 'mt_revert_targets'.
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
 *       Rationale: 'Asset naturally reverting to regime baseline due to
 *                   low news velocity and narrative stagnation.'
 *
 * STRICT SAFETY:
 *   No imports of index.css, tailwind.config.js, or components.json.
 *   All logic stays within this TypeScript service file.
 */

import { ACTIVE_INDICES } from "./gsiCovarianceEngine";

// ─── Constants ────────────────────────────────────────────────────────────────

/** Mean-reversion decay rate per hour. */
const LAMBDA = 0.35;

/** Default revert target when no per-index override is set. */
const DEFAULT_REVERT_TARGET = 50.0;

/** Floor below which revertTarget cannot be pushed by regime adjustment. */
const REVERT_TARGET_MIN = 35.0;

/** Ceiling above which revertTarget cannot be pushed by regime adjustment. */
const REVERT_TARGET_MAX = 50.0;

/** Consecutive ticks below/above threshold required to shift revertTarget. */
const STREAK_THRESHOLD = 5;

/** Amount revertTarget shifts per regime adjustment event. */
const REVERT_TARGET_STEP = 0.5;

/** Minimum Decay_Impact required to write a Theta audit log entry (Scenario C). */
const AUDIT_LOG_THRESHOLD = 0.1;

/** localStorage key for persisted revertTarget overrides. */
const LS_REVERT_TARGETS = "mt_revert_targets";

/** localStorage key for persisted tick streak counters. */
const LS_TICK_STREAKS = "mt_tick_streaks";

/**
 * Seed overrides for specific indexes reflecting current real-world regime.
 * Applied once on module load if no persisted value exists for the index.
 */
const INITIAL_REVERT_TARGET_OVERRIDES: Record<string, number> = {
  "MENA Stability Sentiment": 42,
};

// ─── Revert Target Store ──────────────────────────────────────────────────────

function loadRevertTargets(): Record<string, number> {
  try {
    const raw = localStorage.getItem(LS_REVERT_TARGETS);
    return raw ? (JSON.parse(raw) as Record<string, number>) : {};
  } catch {
    return {};
  }
}

function saveRevertTargets(targets: Record<string, number>): void {
  try {
    localStorage.setItem(LS_REVERT_TARGETS, JSON.stringify(targets));
  } catch { /* ignore quota errors */ }
}

/**
 * Returns the current revert target for an index.
 * Precedence: localStorage persisted value → INITIAL_REVERT_TARGET_OVERRIDES → DEFAULT_REVERT_TARGET.
 * Applies INITIAL_REVERT_TARGET_OVERRIDES on first access if no persisted value exists.
 */
export function getRevertTarget(indexName: string): number {
  const targets = loadRevertTargets();
  if (indexName in targets) return targets[indexName];

  // Seed from override map or default — persist so regime can drift from here
  const seed = INITIAL_REVERT_TARGET_OVERRIDES[indexName] ?? DEFAULT_REVERT_TARGET;
  targets[indexName] = seed;
  saveRevertTargets(targets);
  return seed;
}

/**
 * Directly sets a revert target for an index (admin / seed path).
 * Clamps to [REVERT_TARGET_MIN, REVERT_TARGET_MAX].
 */
export function setRevertTarget(indexName: string, value: number): void {
  const targets = loadRevertTargets();
  targets[indexName] = Math.max(REVERT_TARGET_MIN, Math.min(REVERT_TARGET_MAX, value));
  saveRevertTargets(targets);
}

// ─── Tick Streak Store ────────────────────────────────────────────────────────

interface TickStreaks {
  /** Consecutive ticks score has been at or below (revertTarget - 10). */
  low: Record<string, number>;
  /** Consecutive ticks score has been at or above (revertTarget + 5). */
  high: Record<string, number>;
}

function loadTickStreaks(): TickStreaks {
  try {
    const raw = localStorage.getItem(LS_TICK_STREAKS);
    const parsed = raw ? (JSON.parse(raw) as Partial<TickStreaks>) : {};
    return {
      low: parsed.low ?? {},
      high: parsed.high ?? {},
    };
  } catch {
    return { low: {}, high: {} };
  }
}

function saveTickStreaks(streaks: TickStreaks): void {
  try {
    localStorage.setItem(LS_TICK_STREAKS, JSON.stringify(streaks));
  } catch { /* ignore */ }
}

/**
 * Called once per tick after finalScore is confirmed for an index.
 * Updates streak counters and shifts revertTarget when threshold is met.
 */
export function applyRegimeAdjustment(indexName: string, finalScore: number): void {
  const revertTarget = getRevertTarget(indexName);
  const streaks = loadTickStreaks();

  const isLow = finalScore <= revertTarget - 10;
  const isHigh = finalScore >= revertTarget + 5;

  // Update low streak
  if (isLow) {
    streaks.low[indexName] = (streaks.low[indexName] ?? 0) + 1;
  } else {
    streaks.low[indexName] = 0;
  }

  // Update high streak
  if (isHigh) {
    streaks.high[indexName] = (streaks.high[indexName] ?? 0) + 1;
  } else {
    streaks.high[indexName] = 0;
  }

  saveTickStreaks(streaks);

  // Shift revertTarget when streak threshold is met
  if (streaks.low[indexName] >= STREAK_THRESHOLD) {
    const current = getRevertTarget(indexName);
    const next = Math.max(REVERT_TARGET_MIN, current - REVERT_TARGET_STEP);
    if (next !== current) {
      setRevertTarget(indexName, next);
      streaks.low[indexName] = 0; // reset after adjustment
      saveTickStreaks(streaks);
      console.info(
        `[DecayEngine] Regime shift DOWN: "${indexName}" revertTarget ${current} → ${next} (sustained low streak)`,
      );
    }
  } else if (streaks.high[indexName] >= STREAK_THRESHOLD) {
    const current = getRevertTarget(indexName);
    const next = Math.min(REVERT_TARGET_MAX, current + REVERT_TARGET_STEP);
    if (next !== current) {
      setRevertTarget(indexName, next);
      streaks.high[indexName] = 0;
      saveTickStreaks(streaks);
      console.info(
        `[DecayEngine] Regime shift UP: "${indexName}" revertTarget ${current} → ${next} (sustained high streak)`,
      );
    }
  }
}

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
 * Uses the per-index revertTarget (loaded from localStorage) as the equilibrium.
 *
 * @param indexName      Canonical index name — used to look up revertTarget.
 * @param previousScore  The score before decay is applied.
 * @param deltaHours     Time elapsed since last update, in fractional hours.
 * @param lambda         Optional override decay rate (λ per hour). Defaults to LAMBDA.
 * @returns              The score after decay, rounded to 2 decimal places.
 */
export function applyDecay(
  previousScore: number,
  deltaHours: number,
  lambda = LAMBDA,
  indexName?: string,
): number {
  const target = indexName !== undefined ? getRevertTarget(indexName) : DEFAULT_REVERT_TARGET;
  const decayed = target + (previousScore - target) * Math.exp(-lambda * deltaHours);
  return Math.round(decayed * 100) / 100;
}

// ─── State Management ────────────────────────────────────────────────────────

/**
 * Initialises or updates the decay state for a given index.
 * Called after each Oracle tick writes a confirmed new score to the state map.
 * Also triggers regime adjustment to update revertTarget and streak counters.
 */
export function updateDecayState(indexName: string, score: number): void {
  if (!Number.isFinite(score)) {
    console.warn(`[DecayEngine] Refusing to store NaN/Inf decay state for "${indexName}" (score=${score}). Keeping previous state.`);
    return;
  }
  decayStateMap.set(indexName, {
    previousScore: score,
    lastUpdatedMs: Date.now(),
  });
  applyRegimeAdjustment(indexName, score);
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

  const decayedScore = applyDecay(previousScore, deltaHours, LAMBDA, indexName);
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

  const revertTarget = getRevertTarget(indexName);
  const entry: ThetaAuditEntry = {
    indexName,
    timestamp: nowMs,
    label: "Time-Decay (Theta)",
    previousScore,
    decayedScore,
    decayImpact,
    deltaHours,
    rationale: `Asset naturally reverting to regime baseline (${revertTarget.toFixed(1)}) due to low news velocity and narrative stagnation.`,
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
 * @returns                Final_Score = Decayed_Score + New_Oracle_Impact, floor at 0.
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

  const decayedScore = applyDecay(previousScore, deltaHours, LAMBDA, indexName);
  const finalScore = decayedScore + newOracleImpact;

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
