/**
 * Stream #4 — Feedback Loop Ingestion Module
 *
 * Tracks internal platform order flow (buy vol − sell vol) per index over a
 * rolling 60-second window, derives a Conviction Score (Cs), and fires a
 * Price Pre-emption when Cs exceeds 1.5 standard deviations from the 24h mean.
 *
 * PRE-EMPTION FORMULA
 *   netFlow      = cumulative (buyVol − sellVol) in the last 60 seconds
 *   Cs           = netFlow / totalIndexLiquidity     (clamped to [-1, +1])
 *   adjustment   = Cs × W_INTERNAL                  (W_INTERNAL = 0.25 fixed)
 *
 * STREAM 2 CROSS-REFERENCE (pump protection)
 *   Social velocity present  → confirmed, full adjustment (1.0×)
 *   Social velocity absent   → unconfirmed, partial dampening (0.4×)
 *
 * STRICT SAFETY RULES
 *   - No imports from UI components, index.css, or tailwind.config.js
 *   - No modifications to gsiCovarianceEngine, timeDecayEngine, or syntheticLiquidityEngine
 *   - All external function signatures unchanged
 *   - Pure TypeScript service
 */

// ─── Constants ────────────────────────────────────────────────────────────────

/** Fixed internal weighting for Stream #4. Phase 2: make self-adjusting. */
export const W_INTERNAL = 0.25;

/** Rolling window for net order flow aggregation (ms). */
const WINDOW_MS = 60_000;

/** Number of standard deviations above/below mean to trigger pre-emption. */
const PREEMPTION_THRESHOLD_SD = 1.5;

/** How many 60s conviction score samples to retain for 24h mean/SD tracking. */
const MAX_CS_HISTORY = 1440; // 24h × 60 ticks/h

/** Partial dampening factor when Stream 2 (social) does NOT confirm the move. */
export const PARTIAL_DAMPENING_FACTOR = 0.4;

/** Total nominal liquidity per index used as denominator for Cs normalization. */
const NOMINAL_LIQUIDITY = 90_000; // matches hard cap per index

// ─── Types ────────────────────────────────────────────────────────────────────

interface OrderFlowEvent {
  timestamp: number;
  /** Positive for buy, negative for sell (dollar-equivalent notional). */
  notional: number;
}

interface PreemptionResult {
  /** Whether a pre-emption triggered this evaluation. */
  triggered: boolean;
  /** The price adjustment to add to finalScore (can be 0 if not triggered). */
  adjustment: number;
  /** Whether Stream 2 confirmed the move (true = full, false = dampened). */
  confirmed: boolean;
  /** The Conviction Score that was computed. */
  convictionScore: number;
  /** Direction of the pre-emption (+1 buy-side, -1 sell-side, 0 none). */
  direction: number;
}

// ─── Module State ─────────────────────────────────────────────────────────────

/** Rolling order flow events per index. */
const _orderFlowRegistry = new Map<string, OrderFlowEvent[]>();

/** Historical conviction scores per index (for 24h mean/SD). */
const _csHistory = new Map<string, number[]>();

/** Active pre-emptions: index → expiry timestamp (ms). Pre-emptions last 1 tick. */
const _activePreemptions = new Map<string, PreemptionResult>();

// ─── Order Flow Recording ─────────────────────────────────────────────────────

/**
 * Record a buy or sell order flow event for an index.
 * Called by LocalHoldingsContext on every addHolding (buy) and clearHolding (sell).
 *
 * @param indexName  Canonical God-Tier index name
 * @param notional   Dollar-equivalent notional (positive = buy, negative = sell)
 */
export function recordOrderFlowEvent(
  indexName: string,
  notional: number,
): void {
  const now = Date.now();
  if (!_orderFlowRegistry.has(indexName)) {
    _orderFlowRegistry.set(indexName, []);
  }
  _orderFlowRegistry.get(indexName)!.push({ timestamp: now, notional });
}

// ─── Rolling Window Drain ─────────────────────────────────────────────────────

function drainExpiredEvents(indexName: string, nowMs: number): void {
  const events = _orderFlowRegistry.get(indexName);
  if (!events) return;
  const cutoff = nowMs - WINDOW_MS;
  // Remove events older than 60 seconds
  const fresh = events.filter((e) => e.timestamp >= cutoff);
  _orderFlowRegistry.set(indexName, fresh);
}

// ─── Conviction Score Computation ─────────────────────────────────────────────

function computeConvictionScore(indexName: string, nowMs: number): number {
  drainExpiredEvents(indexName, nowMs);
  const events = _orderFlowRegistry.get(indexName) ?? [];
  if (events.length === 0) return 0;

  const netFlow = events.reduce((sum, e) => sum + e.notional, 0);
  // Normalise by nominal liquidity, clamp to [-1, +1]
  const raw = netFlow / NOMINAL_LIQUIDITY;
  return Math.max(-1, Math.min(1, raw));
}

// ─── Mean / SD Tracking ──────────────────────────────────────────────────────

function pushCsHistory(indexName: string, cs: number): void {
  if (!_csHistory.has(indexName)) {
    _csHistory.set(indexName, []);
  }
  const hist = _csHistory.get(indexName)!;
  hist.push(cs);
  if (hist.length > MAX_CS_HISTORY) {
    hist.shift();
  }
}

function getMeanAndSD(indexName: string): { mean: number; sd: number } {
  const hist = _csHistory.get(indexName) ?? [];
  if (hist.length < 2) return { mean: 0, sd: 0 };

  const mean = hist.reduce((a, b) => a + b, 0) / hist.length;
  const variance =
    hist.reduce((sum, v) => sum + (v - mean) ** 2, 0) / hist.length;
  return { mean, sd: Math.sqrt(variance) };
}

// ─── Social Velocity Proxy ────────────────────────────────────────────────────

/**
 * Returns true if there is an active social signal for this index this tick.
 * Social signal is present when a social-tier headline (sourceTier >= 3) has
 * been dispatched for this index in the last 2 ticks (~16 seconds).
 *
 * This is a lightweight proxy — the engine does not need full Stream 2 data.
 * The hasSocialSignal flag is passed in from the Oracle pipeline caller which
 * has access to the headline map and sourceTier metadata.
 */
export function evaluatePreemption(
  indexName: string,
  nowMs: number,
  hasSocialSignal: boolean,
): PreemptionResult {
  const cs = computeConvictionScore(indexName, nowMs);

  // Push current Cs into history before checking threshold
  pushCsHistory(indexName, cs);

  const { mean, sd } = getMeanAndSD(indexName);

  // Need at least some history to compute a meaningful threshold
  // If SD is 0 (all values identical), no pre-emption is possible
  if (sd === 0) {
    return {
      triggered: false,
      adjustment: 0,
      confirmed: false,
      convictionScore: cs,
      direction: 0,
    };
  }

  const upperThreshold = mean + PREEMPTION_THRESHOLD_SD * sd;
  const lowerThreshold = mean - PREEMPTION_THRESHOLD_SD * sd;

  const triggered = cs > upperThreshold || cs < lowerThreshold;

  if (!triggered) {
    return {
      triggered: false,
      adjustment: 0,
      confirmed: false,
      convictionScore: cs,
      direction: 0,
    };
  }

  const direction = cs > upperThreshold ? 1 : -1;
  const baseAdjustment = cs * W_INTERNAL;

  // Stream 2 cross-reference: partial dampening if social velocity is absent
  const dampingFactor = hasSocialSignal ? 1.0 : PARTIAL_DAMPENING_FACTOR;
  const adjustment = Number((baseAdjustment * dampingFactor).toFixed(2));

  const result: PreemptionResult = {
    triggered: true,
    adjustment,
    confirmed: hasSocialSignal,
    convictionScore: cs,
    direction,
  };

  // Store as active pre-emption for AssetRow badge display
  _activePreemptions.set(indexName, result);

  console.info(
    `[Stream#4] Pre-emption fired on ${indexName}: Cs=${cs.toFixed(4)}, ` +
      `threshold=${(direction === 1 ? upperThreshold : lowerThreshold).toFixed(4)}, ` +
      `adj=${adjustment >= 0 ? "+" : ""}${adjustment.toFixed(2)}, ` +
      `social=${hasSocialSignal ? "confirmed" : "unconfirmed (dampened 0.4x)"}`,
  );

  return result;
}

// ─── Active Pre-emption Read ─────────────────────────────────────────────────

/**
 * Returns the current active pre-emption map (index → result).
 * Used by AssetRow to render the pre-emption badge.
 * Read-only snapshot — do not mutate.
 */
export function getActivePreemptions(): Map<string, PreemptionResult> {
  return _activePreemptions;
}

/**
 * Returns the active pre-emption result for a specific index, or null.
 */
export function getActivePreemption(
  indexName: string,
): PreemptionResult | null {
  return _activePreemptions.get(indexName) ?? null;
}

/**
 * Clears all active pre-emptions. Called at the start of each Oracle tick
 * so badges expire after one tick unless re-fired.
 */
export function clearExpiredPreemptions(): void {
  _activePreemptions.clear();
}
