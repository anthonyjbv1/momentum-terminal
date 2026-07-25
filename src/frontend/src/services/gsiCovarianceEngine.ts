/**
 * GSI Covariance Engine — Tidal Propagation Service
 *
 * Architecture:
 *   1. DATA REPOSITORY: Logs hourly baseScore snapshots for the GSI and all 5 active indices.
 *      Rolling window: 720 entries max = 30 days × 24 hours.
 *
 *   2. GSI CALCULATION: Weighted average based on narrative systemic importance:
 *      AI & Tech 35% · Fed Policy 25% · MENA 20% · Democratic 10% · Republican 10%
 *
 *   3. COVARIANCE CALCULATOR: Daily β update using:
 *      β = Cov(Index, GSI) / Var(GSI)
 *      Falls back to theory-based priors when < 48 data points (< 2 days of history).
 *      Democratic β always ≤ 0 (inverse); Republican β always ≥ 0 (pro-cyclical).
 *
 *   4. TIDAL PROPAGATION: Every Oracle refresh (60s):
 *      Delta = GSI_Change × β
 *      Applied as a micro-drift on top of each index's Oracle-driven score.
 *
 * STRICT SAFETY: No imports of index.css, tailwind.config.js, or components.json.
 * All logic stays within this TypeScript service file.
 */

// ─── Constants ────────────────────────────────────────────────────────────────

/** Active index canonical names — must match backend and AssetList exactly. */
export const ACTIVE_INDICES = [
  "AI Regulation Risk Sentiment",
  "Fed Policy Sentiment",
  "MENA Stability Sentiment",
  "Traditional Values Sentiment",
  "Progressive Values Sentiment",
  "Masculinity Discourse Sentiment",
  "Feminism Wave Sentiment",
  "F1 Constructor Sentiment",
  "NASCAR Racing Sentiment",
  "Obesity Drug Sentiment",
  "Whole Food & Wellness Sentiment",
] as const;

export type ActiveIndex = (typeof ACTIVE_INDICES)[number];

/**
 * GSI weights based on narrative systemic importance.
 * Sum = 1.0
 */
export const GSI_WEIGHTS: Record<ActiveIndex, number> = {
  "Fed Policy Sentiment": 0.18,
  "MENA Stability Sentiment": 0.15,
  "AI Regulation Risk Sentiment": 0.14,
  "Progressive Values Sentiment": 0.1,
  "Traditional Values Sentiment": 0.1,
  "Masculinity Discourse Sentiment": 0.08,
  "Feminism Wave Sentiment": 0.08,
  "F1 Constructor Sentiment": 0.05,
  "NASCAR Racing Sentiment": 0.05,
  "Obesity Drug Sentiment": 0.04,
  "Whole Food & Wellness Sentiment": 0.03,
};

/**
 * Theory-based β priors — used before 48 data points accumulate.
 * Democratic is negative (inverse: rises when market sentiment falls).
 * Republican is positive (pro-cyclical).
 * MENA is high (1.2) — disproportionate systemic sensitivity to regional shocks.
 */
export const THEORY_PRIORS: Record<ActiveIndex, number> = {
  "AI Regulation Risk Sentiment": 0.7,
  "Fed Policy Sentiment": 0.9,
  "MENA Stability Sentiment": 1.2,
  "Traditional Values Sentiment": 0.4,
  "Progressive Values Sentiment": 0.4,
  "Masculinity Discourse Sentiment": 0.45,
  "Feminism Wave Sentiment": 0.45,
  "F1 Constructor Sentiment": 0.35,
  "NASCAR Racing Sentiment": 0.35,
  "Obesity Drug Sentiment": 0.5,
  "Whole Food & Wellness Sentiment": 0.4,
};

/** Minimum data points before switching from priors to calculated β. */
const MIN_POINTS_FOR_CALC = 48; // 2 days of hourly data

/** Rolling window cap: 30 days × 24 hours = 720 entries. */
const MAX_HISTORY_ENTRIES = 720;

// ─── Data Repository ──────────────────────────────────────────────────────────

export interface SentimentLogEntry {
  timestamp: number; // ms since epoch
  gsi: number;
  scores: Record<ActiveIndex, number>;
}

/** In-memory rolling log of hourly sentiment snapshots. */
const sentimentLog: SentimentLogEntry[] = [];

/** Cached β values — updated daily (or on demand). */
const cachedBetas: Record<string, number> = { ...THEORY_PRIORS };

/** Previous GSI value — used to compute gsiChange each Oracle cycle. */
let previousGSI: number | null = null;

// ─── GSI Calculation ──────────────────────────────────────────────────────────

/**
 * Computes the weighted Global Sentiment Index from a map of index scores.
 * Only active indices contribute; missing indices use their prior score or 50.
 */
export function computeWeightedGSI(
  scores: Partial<Record<string, number>>,
): number {
  let weightedSum = 0;
  let totalWeight = 0;

  for (const indexName of ACTIVE_INDICES) {
    const score = scores[indexName];
    if (score !== undefined && !Number.isNaN(score)) {
      const weight = GSI_WEIGHTS[indexName];
      weightedSum += score * weight;
      totalWeight += weight;
    }
  }

  if (totalWeight === 0) return 50; // safe fallback
  return weightedSum / totalWeight;
}

// ─── Data Logging ─────────────────────────────────────────────────────────────

/**
 * Logs the current scores for all 5 indices and the derived GSI.
 * Called every Oracle refresh cycle (every 60 seconds).
 * Enforces the rolling 720-entry cap.
 */
export function logHourlyScores(scores: Partial<Record<string, number>>): void {
  const gsi = computeWeightedGSI(scores);
  const entry: SentimentLogEntry = {
    timestamp: Date.now(),
    gsi,
    scores: {} as Record<ActiveIndex, number>,
  };

  for (const indexName of ACTIVE_INDICES) {
    const score = scores[indexName];
    entry.scores[indexName] = score !== undefined ? score : 50;
  }

  sentimentLog.push(entry);

  // Enforce rolling window cap
  if (sentimentLog.length > MAX_HISTORY_ENTRIES) {
    sentimentLog.splice(0, sentimentLog.length - MAX_HISTORY_ENTRIES);
  }
}

/**
 * Returns an ordered array of historical scores for a given index
 * extracted from the sentimentLog. Used by Momentum Temperature computation.
 * Most recent entry last.
 */
export function getSentimentLogScoresForIndex(indexName: string): number[] {
  return sentimentLog
    .filter(
      (entry) =>
        entry.scores[indexName as keyof typeof entry.scores] !== undefined,
    )
    .map(
      (entry) => entry.scores[indexName as keyof typeof entry.scores] as number,
    );
}

/**
 * Returns the last `ticks` score values for the given index, oldest first.
 * Reads from the module-level sentimentLog — safe to call on every render.
 * Returns [] if fewer than 2 data points exist (sparkline renders nothing).
 */
export function getScoreHistory(indexName: string, ticks: number): number[] {
  const all = sentimentLog
    .filter(
      (entry) =>
        entry.scores[indexName as keyof typeof entry.scores] !== undefined,
    )
    .map(
      (entry) => entry.scores[indexName as keyof typeof entry.scores] as number,
    );

  const sliced = all.slice(-ticks);
  if (sliced.length < 2) return [];
  return sliced;
}

// ─── Covariance Math ─────────────────────────────────────────────────────────

function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function covariance(x: number[], y: number[]): number {
  const n = Math.min(x.length, y.length);
  if (n < 2) return 0;
  const mx = mean(x.slice(0, n));
  const my = mean(y.slice(0, n));
  let cov = 0;
  for (let i = 0; i < n; i++) {
    cov += (x[i] - mx) * (y[i] - my);
  }
  return cov / (n - 1);
}

function variance(arr: number[]): number {
  return covariance(arr, arr);
}

// ─── Beta Calculation ─────────────────────────────────────────────────────────

/**
 * Calculates β for a single index using the rolling 30-day window.
 * Falls back to theory-based prior if < MIN_POINTS_FOR_CALC data points.

 */
export function calculateBeta(indexName: ActiveIndex): number {
  const prior = THEORY_PRIORS[indexName];

  if (sentimentLog.length < MIN_POINTS_FOR_CALC) {
    return prior;
  }

  const gsiSeries = sentimentLog.map((e) => e.gsi);
  const indexSeries = sentimentLog.map((e) => e.scores[indexName]);

  const varGSI = variance(gsiSeries);
  if (varGSI === 0) return prior; // no movement in GSI — can't calculate

  const cov = covariance(indexSeries, gsiSeries);
  let beta = cov / varGSI;

  // Clamp to reasonable range [-3, 3]
  beta = Math.max(-3, Math.min(3, beta));

  return beta;
}

/**
 * Recalculates β for all 5 active indices and caches the results.
 * Called daily (via background timer) and on demand.
 */
export function recalculateAllBetas(): void {
  for (const indexName of ACTIVE_INDICES) {
    cachedBetas[indexName] = calculateBeta(indexName);
  }
}

/**
 * Returns the cached β for a given index.
 * Safe to call on every render — reads from in-memory cache.
 */
export function getBeta(indexName: string): number {
  const beta = cachedBetas[indexName];
  if (beta !== undefined) return beta;
  // Fallback to theory prior if index is known, else 1.0
  return (THEORY_PRIORS as Record<string, number>)[indexName] ?? 1.0;
}

// ─── Tidal Propagation ────────────────────────────────────────────────────────

/**
 * Computes per-index macro drift deltas for an Oracle refresh cycle.
 * Delta = GSI_Change × β(index)
 *
 * Called every Oracle refresh (60s) after logHourlyScores.
 * Returns a map of indexName → delta to apply to baseScore.
 */
export function applyTidalPropagation(
  currentScores: Partial<Record<string, number>>,
): Record<string, number> {
  const currentGSI = computeWeightedGSI(currentScores);
  const deltas: Record<string, number> = {};

  if (previousGSI === null) {
    // First cycle — no change to propagate, just record baseline
    previousGSI = currentGSI;
    for (const indexName of ACTIVE_INDICES) {
      deltas[indexName] = 0;
    }
    return deltas;
  }

  const gsiChange = currentGSI - previousGSI;
  previousGSI = currentGSI;

  for (const indexName of ACTIVE_INDICES) {
    const beta = getBeta(indexName);
    deltas[indexName] = gsiChange * beta;
  }

  return deltas;
}

/**
 * Returns the current GSI value based on the last logged entry.
 * Returns null if no data has been logged yet.
 */
export function getCurrentGSI(): number | null {
  if (sentimentLog.length === 0) return null;
  return sentimentLog[sentimentLog.length - 1].gsi;
}

/**
 * Returns the full sentiment log for debugging or audit purposes.
 */
export function getSentimentLog(): Readonly<SentimentLogEntry[]> {
  return sentimentLog;
}

// ─── Global Crisis Regime (GCR) ───────────────────────────────────────────────

/**
 * GCR trigger threshold: GSI 1-hour change must drop below -25.0% to activate.
 * Stored as a fractional change (e.g. -0.25 = -25.0%).
 * A 25% GSI drop requires genuine systemic collapse — a -15% drop happens too
 * easily when scores are near floor.
 */
const GCR_TRIGGER_THRESHOLD = -0.25; // -25% GSI drop

/**
 * Cooldown: GSI per-tick volatility must stay below 1.0% for 6 consecutive
 * Oracle ticks to deactivate Crisis Mode.
 * Additional ceiling: a tick counts as calm if per-tick absolute GSI movement
 * is less than GCR_VOLATILITY_CEILING (2.0 pts), regardless of the fractional
 * threshold — prevents floor-trapped low-value GSIs from never completing cooldown.
 */
const GCR_COOLDOWN_QUIET_THRESHOLD = 0.01; // 1% per-tick fractional volatility
const GCR_VOLATILITY_CEILING = 2.0; // 2.0 pt absolute GSI movement — calm if below this
const GCR_COOLDOWN_REQUIRED_TICKS = 6;

/**
 * Maximum crisis duration: auto-deactivate after 20 ticks (~10 minutes at 30s/tick)
 * regardless of current volatility — prevents indefinite crisis state.
 */
const GCR_MAX_DURATION_TICKS = 20; // ~10 minutes at 30s/tick

/** GCR internal state — module singleton. */
let _isCrisisMode = false;

/** Counts how many ticks crisis has been continuously active. Reset on deactivation. */
let _crisisDurationTicks = 0;

/**
 * Rolling 60-tick GSI history for 1-hour change calculation.
 * Each Oracle tick ≈ 60s → 60 ticks ≈ 60 minutes.
 */
const gsiHistory: number[] = [];
const GSI_HISTORY_MAX = 60;

/** Consecutive quiet ticks since last volatile event. */
let _quietTickCount = 0;

/** Previous GSI value for per-tick volatility calculation. */
let _lastTickGSI: number | null = null;

/**
 * The set of index names that triggered the current crisis regime.
 * Populated when isCrisisMode flips to true; cleared on cooldown.
 * These are the indices whose score drops contributed most to the GSI decline.
 */
let _crisisTriggerIndices: Set<string> = new Set();

/**
 * Rolling per-index score history — mirrors gsiHistory length.
 * Used to identify which indices drove the GSI drop at trigger time.
 */
const indexScoreHistory: Partial<Record<string, number[]>> = {};

/**
 * Called every Oracle cycle with the latest computed GSI value and current index scores.
 * Handles:
 *   1. 1-hour change trigger  → sets isCrisisMode = true when GSI drops > 5%
 *   2. Consecutive quiet tick → clears isCrisisMode after 4 calm ticks
 *   3. Tracks which indices drove the drop when the trigger fires
 *
 * Returns the updated isCrisisMode boolean.
 */
export function updateCrisisRegime(
  currentGSI: number,
  currentScores?: Partial<Record<string, number>>,
): boolean {
  // Push to rolling 60-tick history
  gsiHistory.push(currentGSI);
  if (gsiHistory.length > GSI_HISTORY_MAX) {
    gsiHistory.splice(0, gsiHistory.length - GSI_HISTORY_MAX);
  }

  // Track per-index score history for trigger attribution
  if (currentScores) {
    for (const indexName of ACTIVE_INDICES) {
      const score = currentScores[indexName];
      if (score === undefined) continue;
      if (!indexScoreHistory[indexName]) {
        indexScoreHistory[indexName] = [];
      }
      const hist = indexScoreHistory[indexName]!;
      hist.push(score);
      if (hist.length > GSI_HISTORY_MAX) {
        hist.splice(0, hist.length - GSI_HISTORY_MAX);
      }
    }
  }

  // 1-hour change vs reference (oldest value in the window)
  const referenceGSI = gsiHistory[0] ?? currentGSI;
  const oneHourChange =
    referenceGSI > 0 ? (currentGSI - referenceGSI) / referenceGSI : 0;

  // ── Trigger ──────────────────────────────────────────────────────────────
  if (oneHourChange < GCR_TRIGGER_THRESHOLD && !_isCrisisMode) {
    _isCrisisMode = true;
    _quietTickCount = 0;

    // Identify which indices drove the GSI drop
    // Compare each index's current score to its oldest tracked score
    const drops: Array<{ name: string; drop: number }> = [];
    for (const indexName of ACTIVE_INDICES) {
      const hist = indexScoreHistory[indexName];
      if (!hist || hist.length < 2) continue;
      const refScore = hist[0];
      const curScore = hist[hist.length - 1];
      const dropPct = refScore > 0 ? (curScore - refScore) / refScore : 0;
      drops.push({ name: indexName, drop: dropPct });
    }

    // Sort by largest drop (most negative first)
    drops.sort((a, b) => a.drop - b.drop);

    // Mark the top-dropping indices — those whose drops account for the majority
    // of the GSI decline. Use the top 1–3 indices that had a negative move.
    _crisisTriggerIndices = new Set(
      drops
        .filter((d) => d.drop < -0.01) // must have dropped at least 1%
        .slice(0, 3) // cap at 3
        .map((d) => d.name),
    );

    // If no index had a clear drop (e.g. all scores were stale), fall back to
    // the index with the highest GSI weight that moved downward at all.
    if (_crisisTriggerIndices.size === 0 && drops.length > 0) {
      _crisisTriggerIndices = new Set([drops[0].name]);
    }
  }

  // ── Cooldown ──────────────────────────────────────────────────────────────
  if (_isCrisisMode) {
    // Increment duration counter every tick while crisis is active
    _crisisDurationTicks += 1;

    // Max-duration cap takes priority — force deactivate before quiet-tick check
    if (_crisisDurationTicks >= GCR_MAX_DURATION_TICKS) {
      console.log(
        "[CrisisRegime] Max duration reached (20 ticks) — auto-deactivating",
      );
      _isCrisisMode = false;
      _quietTickCount = 0;
      _crisisDurationTicks = 0;
      _crisisTriggerIndices.clear();
    } else {
      // Normal quiet-tick cooldown path
      // A tick is calm if EITHER:
      //   (a) fractional per-tick volatility < 1% (GCR_COOLDOWN_QUIET_THRESHOLD), OR
      //   (b) absolute GSI movement < 2.0 pts (GCR_VOLATILITY_CEILING) —
      //       prevents floor-trapped low-value GSIs from never completing cooldown
      const absoluteGSIMove =
        _lastTickGSI !== null ? Math.abs(currentGSI - _lastTickGSI) : 0;
      const tickVolatility =
        _lastTickGSI !== null && _lastTickGSI > 0
          ? Math.abs(currentGSI - _lastTickGSI) / _lastTickGSI
          : 0;

      const isCalm =
        tickVolatility < GCR_COOLDOWN_QUIET_THRESHOLD ||
        absoluteGSIMove < GCR_VOLATILITY_CEILING;

      if (isCalm) {
        _quietTickCount += 1;
      } else {
        _quietTickCount = 0;
      }

      if (_quietTickCount >= GCR_COOLDOWN_REQUIRED_TICKS) {
        _isCrisisMode = false;
        _quietTickCount = 0;
        _crisisDurationTicks = 0; // reset duration counter on natural deactivation
        _crisisTriggerIndices = new Set(); // clear on deactivation
      }
    }
  }

  _lastTickGSI = currentGSI;
  return _isCrisisMode;
}

/**
 * Returns the set of index names that triggered the current crisis regime.
 * Empty when no crisis is active.
 */
export function getCrisisTriggerIndices(): ReadonlySet<string> {
  return _crisisTriggerIndices;
}

/** Returns the current crisis regime state. */
export function getIsCrisisMode(): boolean {
  return _isCrisisMode;
}

/**
 * Returns the effective β for a given index.
 * In crisis mode, applies Beta Convergence:
 *   Temporary_Beta = (Original_Beta + 1.0) / 2
 * This pulls all indices toward 1.0 correlation with the global crash.
 */
export function getEffectiveBeta(indexName: string): number {
  const originalBeta = getBeta(indexName);
  if (!_isCrisisMode) return originalBeta;
  return (originalBeta + 1.0) / 2;
}

/**
 * Returns the current redemption fee rate.
 *   Normal: 2% (0.02)
 *   Crisis: 5% (0.05) — Liquidity Spread protection
 */
export function getRedemptionFeeRate(): number {
  return _isCrisisMode ? 0.05 : 0.02;
}

// ─── Background Timer ─────────────────────────────────────────────────────────

/**
 * Auto-start: recalculate β daily.
 * Uses setInterval with 24h delay; begins immediately with a first pass.
 *
 * This timer is safe to import in multiple places — the module is a singleton
 * in the JS module system, so the timer only starts once.
 */
const DAILY_MS = 24 * 60 * 60 * 1000;

// Initial recalc on module load (uses theory priors until data accumulates)
recalculateAllBetas();

// Daily recalculation
setInterval(() => {
  recalculateAllBetas();
}, DAILY_MS);
