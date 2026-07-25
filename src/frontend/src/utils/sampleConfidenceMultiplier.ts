/**
 * sampleConfidenceMultiplier
 *
 * Pure utility — no side effects, no async, no external calls, no imports.
 *
 * Applies a sample-window multiplier and source-type base impact ceiling to a
 * raw score delta, preserving the sign of the original value at all times.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type SourceType =
  | "social-reddit"
  | "social-twitter"
  | "social-youtube"
  | "social-cross-platform"
  | "economic-indicator"
  | "legislative"
  | "generic";

// ─── Constants ────────────────────────────────────────────────────────────────

const BASE_CEILING: Record<SourceType, number> = {
  "social-reddit": 2.0,
  "social-twitter": 1.5,
  "social-youtube": 2.5,
  "social-cross-platform": 3.0,
  "economic-indicator": 2.0,
  legislative: 1.8,
  generic: 1.0,
};

// ─── Utility ──────────────────────────────────────────────────────────────────

/**
 * Applies the sample confidence multiplier to a raw score delta.
 *
 * Sample window tiers:
 *   <= 7 days  → 0.3×
 *   <= 30 days → 1.0×
 *   <= 90 days → 1.5×
 *   >  90 days → 1.5× (capped)
 *
 * Output is capped at the source-type base ceiling, with the original sign
 * always preserved. Never returns a value with a flipped sign.
 */
export function applySampleConfidenceMultiplier(
  rawScoreDelta: number,
  sampleWindowDays: number,
  sourceType: SourceType,
): number {
  // Step 1 — resolve window multiplier
  let windowMultiplier: number;
  if (sampleWindowDays <= 7) {
    windowMultiplier = 0.3;
  } else if (sampleWindowDays <= 30) {
    windowMultiplier = 1.0;
  } else {
    // covers <= 90 and > 90 — both cap at 1.5
    windowMultiplier = 1.5;
  }

  // Step 2 — apply multiplier to absolute value, then cap at base ceiling
  const baseCeiling = BASE_CEILING[sourceType];
  const scaled = Math.min(
    Math.abs(rawScoreDelta) * windowMultiplier,
    baseCeiling,
  );

  // Step 3 — restore original sign (Math.sign(0) === 0, which is correct)
  return scaled * Math.sign(rawScoreDelta);
}
