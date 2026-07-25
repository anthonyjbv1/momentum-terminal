/**
 * confidenceScoreEngine.ts
 *
 * Calculates the Oracle Confidence Score for a given set of news events.
 *
 * Algorithm:
 *  1. Source Tier Weighting — delegates to sourceTierRegistry (single source of truth)
 *  2. Agreement Bonus     — +15 if all headlines have the same sentiment direction
 *  3. Volume Multiplier   — +10 if ≥5 sources are used
 *  4. MENA Special Rule   — UAE Regulatory halt sources snap to 99
 *
 * Result is clamped to [0, 100] and returned as a percentage integer.
 *
 * STRICT SAFETY: no modifications to index.css / tailwind.config.js / components.json.
 *
 * REFACTORED: SOURCE_CREDIBILITY_DICT lookup via sourceCredibilityEngine replaced
 * with getConfidenceWeight(sourceTier) from sourceTierRegistry — the unified
 * single source of truth for all tier weight values.
 */

import { getConfidenceWeight } from "../lib/oracle/sourceTierRegistry";
import type { AuditableNewsEvent } from "./mockHeadlineService";

// ─── UAE Regulatory Special Rule ──────────────────────────────────────────────────
const UAE_HALT_KEYWORDS = [
  "UAE Central Bank",
  "UAE Regulatory",
  "ADX",
  "DFM",
  "Capital Markets Authority",
];

function isUAEHaltSource(event: AuditableNewsEvent): boolean {
  const text = `${event.headline} ${event.source ?? ""}`.toLowerCase();
  return UAE_HALT_KEYWORDS.some((kw) => text.includes(kw.toLowerCase()));
}

// ─── Main Calculator ────────────────────────────────────────────────────────────────

export interface ConfidenceResult {
  /** 0–100 integer percentage */
  score: number;
  /** Human-readable explanation for the Audit Modal */
  rationale: string;
  /** 'high' | 'moderate' | 'low' */
  tier: "high" | "moderate" | "low";
}

export function calculateConfidenceScore(
  events: AuditableNewsEvent[],
): ConfidenceResult {
  if (events.length === 0) {
    return {
      score: 0,
      rationale: "No data sources available for this index.",
      tier: "low",
    };
  }

  // Special override: UAE regulatory halt → 99% immediately
  if (events.some(isUAEHaltSource)) {
    return {
      score: 99,
      rationale:
        "Confidence locked at maximum — data sourced from official UAE regulatory halt notice. Institutional-grade authority override applied.",
      tier: "high",
    };
  }

  // 1. Base: average confidence weights resolved from SOURCE_TIER_REGISTRY.
  // Uses sourceTier (numeric 1–5) on each event — the unified registry is the
  // single source of truth for all tier weight values across the platform.
  const avgWeight =
    events.reduce((sum, e) => sum + getConfidenceWeight(e.sourceTier), 0) /
    events.length;
  let rawScore = avgWeight * 100; // e.g. avg 0.85 → 85

  // 2. Agreement Bonus (+15 if all same direction)
  const directions = events.map((e) =>
    e.sentimentScore > 0 ? "pos" : e.sentimentScore < 0 ? "neg" : "neu",
  );
  const allAgree =
    directions.every((d) => d === directions[0]) && directions[0] !== "neu";
  if (allAgree) rawScore += 15;

  // 3. Volume Multiplier (+10 if ≥5 sources)
  if (events.length >= 5) rawScore += 10;

  // Clamp
  const score = Math.min(100, Math.max(0, Math.round(rawScore)));

  // Determine tier & rationale
  if (score >= 85) {
    return {
      score,
      rationale:
        "Based on multiple high-authority institutional reports. Data convergence across Tier 1 sources supports high signal fidelity.",
      tier: "high",
    };
  }
  if (score >= 50) {
    return {
      score,
      rationale:
        "Based on a mix of institutional and secondary sources. Moderate consensus detected — directional signal is present but not definitive.",
      tier: "moderate",
    };
  }
  return {
    score,
    rationale:
      "Based on limited or lower-authority sources. High volatility expected; treat this score as speculative data.",
    tier: "low",
  };
}
