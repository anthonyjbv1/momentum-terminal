// src/frontend/src/services/momentumTemperature.ts

export type TemperatureState = "HOT" | "WARM" | "NORMAL";

export interface MomentumTemperature {
  state: TemperatureState;
  velocityPercentile: number; // 0-100, where this tick's velocity sits historically
  typicalDurationDays: { min: number; max: number } | null;
  displayLabel: string; // Short label for UI badge
  displayDescription: string; // One-sentence context for allocation modal
}

// Minimum history entries required before computing a meaningful percentile
const MIN_HISTORY_FOR_PERCENTILE = 5;

// Category-aware typical duration estimates (days)
// These are seeded estimates that become data-driven as history accumulates
const TYPICAL_DURATIONS: Record<
  string,
  Record<TemperatureState, { min: number; max: number }>
> = {
  MACRO: {
    HOT: { min: 3, max: 14 },
    WARM: { min: 2, max: 7 },
    NORMAL: { min: 0, max: 0 },
  },
  GEOPOLITICAL: {
    HOT: { min: 2, max: 10 },
    WARM: { min: 1, max: 5 },
    NORMAL: { min: 0, max: 0 },
  },
  CULTURAL: {
    HOT: { min: 4, max: 21 },
    WARM: { min: 2, max: 10 },
    NORMAL: { min: 0, max: 0 },
  },
};

const FALLBACK_DURATIONS: Record<
  TemperatureState,
  { min: number; max: number }
> = {
  HOT: { min: 3, max: 14 },
  WARM: { min: 1, max: 7 },
  NORMAL: { min: 0, max: 0 },
};

/**
 * Computes the absolute score velocity for a given index
 * from the sentimentLog history.
 * Velocity = average absolute score change per entry over the last N entries.
 */
export function computeVelocity(
  indexName: string,
  scoreHistory: number[],
): number {
  void indexName; // parameter reserved for future per-index tuning
  if (scoreHistory.length < 2) return 0;
  const recentWindow = scoreHistory.slice(-10);
  let totalChange = 0;
  for (let i = 1; i < recentWindow.length; i++) {
    totalChange += Math.abs(recentWindow[i] - recentWindow[i - 1]);
  }
  return totalChange / (recentWindow.length - 1);
}

/**
 * Computes the percentile rank of currentVelocity within allVelocities.
 * Returns a value between 0 and 100.
 */
export function computePercentile(
  currentVelocity: number,
  allVelocities: number[],
): number {
  if (allVelocities.length === 0) return 50;
  const below = allVelocities.filter((v) => v <= currentVelocity).length;
  return Math.round((below / allVelocities.length) * 100);
}

/**
 * Maps a velocity percentile to a TemperatureState.
 * HOT:    top 25% (percentile >= 75)
 * WARM:   middle range (percentile >= 40)
 * NORMAL: below 40th percentile
 */
export function percentileToState(percentile: number): TemperatureState {
  if (percentile >= 75) return "HOT";
  if (percentile >= 40) return "WARM";
  return "NORMAL";
}

/**
 * Builds the display strings for each temperature state.
 */
function buildDisplayStrings(
  state: TemperatureState,
  category: string,
  duration: { min: number; max: number } | null,
): { label: string; description: string } {
  const categoryDurations =
    TYPICAL_DURATIONS[category] ?? TYPICAL_DURATIONS.GEOPOLITICAL;
  const effectiveDuration =
    duration ?? categoryDurations[state] ?? FALLBACK_DURATIONS[state];

  switch (state) {
    case "HOT":
      return {
        label: "HOT",
        description:
          effectiveDuration.min === 0
            ? "Narrative spike detected. Elevated activity in progress."
            : `Narrative spike detected. Similar intensity spikes have historically sustained elevated values for ${effectiveDuration.min}\u2013${effectiveDuration.max} days before mean reversion. Your position continues indefinitely \u2014 this is context, not an expiry.`,
      };
    case "WARM":
      return {
        label: "WARM",
        description:
          effectiveDuration.min === 0
            ? "Above-average narrative activity detected."
            : `Above-average narrative activity detected. Moderate momentum typically sustains for ${effectiveDuration.min}\u2013${effectiveDuration.max} days. Your position continues indefinitely.`,
      };
    case "NORMAL":
      return {
        label: "NORMAL",
        description:
          "Baseline narrative conditions. No significant spike detected. Theta decay is the dominant force \u2014 conviction-based entry.",
      };
  }
}

/**
 * Main entry point. Computes the full MomentumTemperature
 * for a given index given its score history array and category.
 */
export function computeMomentumTemperature(
  indexName: string,
  category: string,
  scoreHistory: number[],
): MomentumTemperature {
  if (scoreHistory.length < MIN_HISTORY_FOR_PERCENTILE) {
    // Not enough history — default to NORMAL
    const { label, description } = buildDisplayStrings(
      "NORMAL",
      category,
      null,
    );
    return {
      state: "NORMAL",
      velocityPercentile: 50,
      typicalDurationDays: null,
      displayLabel: label,
      displayDescription: description,
    };
  }

  // Build velocity series from full history
  const velocitySeries: number[] = [];
  for (let i = 1; i < scoreHistory.length; i++) {
    velocitySeries.push(Math.abs(scoreHistory[i] - scoreHistory[i - 1]));
  }

  const currentVelocity = computeVelocity(indexName, scoreHistory);
  const percentile = computePercentile(currentVelocity, velocitySeries);
  const state = percentileToState(percentile);

  const categoryDurations =
    TYPICAL_DURATIONS[category] ?? TYPICAL_DURATIONS.GEOPOLITICAL;
  const duration = categoryDurations[state] ?? FALLBACK_DURATIONS[state];

  const { label, description } = buildDisplayStrings(state, category, duration);

  return {
    state,
    velocityPercentile: percentile,
    typicalDurationDays: state === "NORMAL" ? null : duration,
    displayLabel: label,
    displayDescription: description,
  };
}
