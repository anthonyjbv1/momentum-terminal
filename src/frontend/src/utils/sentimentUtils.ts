/**
 * Unified sentiment display logic.
 * Single source of truth for color, icon character, and label
 * used across both the LATEST Headlines feed and the Oracle Tick Log.
 *
 * Thresholds (hardcoded):
 *   score >= 0.50  → High Positive  → green,  ↗
 *   score <= -0.50 → High Negative  → red,    ↘
 *   otherwise      → Neutral        → grey,   —
 */

export interface SentimentDisplay {
  /** Tailwind class for text color */
  colorClass: string;
  /** Inline hex color (for non-Tailwind contexts) */
  color: string;
  /** Unicode icon character */
  icon: string;
  /** Human-readable label */
  label: string;
}

export function getSentimentDisplayLogic(score: number): SentimentDisplay {
  if (score >= 0.5) {
    return {
      colorClass: "text-green-400",
      color: "#4ade80",
      icon: "↗",
      label: "Bullish",
    };
  }
  if (score <= -0.5) {
    return {
      colorClass: "text-red-400",
      color: "#f87171",
      icon: "↘",
      label: "Bearish",
    };
  }
  return {
    colorClass: "text-gray-400",
    color: "#9ca3af",
    icon: "—",
    label: "Neutral",
  };
}

/** Format a sentiment score to exactly 2 decimal places with explicit sign. */
export function formatSentimentScore(score: number): string {
  const fixed = score.toFixed(2);
  return score > 0 ? `+${fixed}` : fixed;
}
