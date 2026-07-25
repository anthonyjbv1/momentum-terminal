/**
 * sourceCredibilityEngine.ts
 *
 * 5-Tier Source Credibility Weighting System for the Oracle Mock Generator.
 *
 * When a mock headline is generated, it is assigned a source from this
 * dictionary. The source's tier multiplier is applied to the raw sentiment
 * score to produce the Final_Headline_Impact passed into the pipeline.
 *
 * Tier probability weights (institutional terminal bias):
 *   Tier 1: 40% | Tier 2: 30% | Tier 3: 20% | Tier 4: 7% | Tier 5: 3%
 *
 * STRICT SAFETY: no UI, no theme changes. Pure TypeScript service.
 */

export interface SourceCredibilityEntry {
  source: string;
  tier: 1 | 2 | 3 | 4 | 5;
  multiplier: number;
}

// ─── Canonical Source Dictionary ─────────────────────────────────────────────
export const SOURCE_CREDIBILITY_DICT: Record<string, SourceCredibilityEntry> = {
  Bloomberg: { source: "Bloomberg", tier: 1, multiplier: 1.0 },
  Reuters: { source: "Reuters", tier: 1, multiplier: 1.0 },
  "Federal Reserve": { source: "Federal Reserve", tier: 1, multiplier: 1.0 },
  SEC: { source: "SEC", tier: 1, multiplier: 1.0 },
  WSJ: { source: "WSJ", tier: 2, multiplier: 0.8 },
  "Financial Times": { source: "Financial Times", tier: 2, multiplier: 0.8 },
  CNBC: { source: "CNBC", tier: 2, multiplier: 0.8 },
  TechCrunch: { source: "TechCrunch", tier: 3, multiplier: 0.5 },
  "Verified Corporate X": {
    source: "Verified Corporate X",
    tier: 3,
    multiplier: 0.5,
  },
  "Defense One": { source: "Defense One", tier: 3, multiplier: 0.5 },
  "Seeking Alpha": { source: "Seeking Alpha", tier: 4, multiplier: 0.2 },
  Reddit: { source: "Reddit", tier: 4, multiplier: 0.2 },
  "Verified Social": { source: "Verified Social", tier: 4, multiplier: 0.2 },
  "Unverified Telegram": {
    source: "Unverified Telegram",
    tier: 5,
    multiplier: 0.05,
  },
  "Anonymous X": { source: "Anonymous X", tier: 5, multiplier: 0.05 },
};

// ─── Tier Source Groups ───────────────────────────────────────────────────────
const TIER_1_SOURCES = ["Bloomberg", "Reuters", "Federal Reserve", "SEC"];
const TIER_2_SOURCES = ["WSJ", "Financial Times", "CNBC"];
const TIER_3_SOURCES = ["TechCrunch", "Verified Corporate X", "Defense One"];
const TIER_4_SOURCES = ["Seeking Alpha", "Reddit", "Verified Social"];
const TIER_5_SOURCES = ["Unverified Telegram", "Anonymous X"];

// ─── Tier Probability Distribution ───────────────────────────────────────────
// Institutional terminal bias: Tiers 1–3 account for 90% of all signals.
const TIER_PROBABILITIES: { sources: string[]; cumulative: number }[] = [
  { sources: TIER_1_SOURCES, cumulative: 0.4 }, // 40%
  { sources: TIER_2_SOURCES, cumulative: 0.7 }, // 30%
  { sources: TIER_3_SOURCES, cumulative: 0.9 }, // 20%
  { sources: TIER_4_SOURCES, cumulative: 0.97 }, //  7%
  { sources: TIER_5_SOURCES, cumulative: 1.0 }, //  3%
];

/**
 * Randomly selects a source using tier-weighted probability.
 * Tiers 1–3 appear ~90% of the time to simulate an institutional feed.
 */
export function pickWeightedSource(): SourceCredibilityEntry {
  const r = Math.random();
  for (const { sources, cumulative } of TIER_PROBABILITIES) {
    if (r < cumulative) {
      const name = sources[Math.floor(Math.random() * sources.length)];
      return SOURCE_CREDIBILITY_DICT[name];
    }
  }
  // Fallback — should never reach
  return SOURCE_CREDIBILITY_DICT.Reuters;
}

/**
 * Looks up an existing source name in the credibility dictionary.
 * Returns a Tier 3 default for unrecognized sources.
 */
export function getSourceCredibility(
  sourceName: string,
): SourceCredibilityEntry {
  return (
    SOURCE_CREDIBILITY_DICT[sourceName] ?? {
      source: sourceName,
      tier: 3,
      multiplier: 0.5,
    }
  );
}

/**
 * Applies the tier multiplier to a raw impact score.
 * Final_Headline_Impact = Raw_Impact * Tier_Multiplier
 */
export function applyCredibilityMultiplier(
  rawImpact: number,
  entry: SourceCredibilityEntry,
): number {
  return rawImpact * entry.multiplier;
}

/**
 * Returns the tier-based confidence weight used by the confidence score engine.
 * Aligned with the impact multiplier tiers for a single source of truth.
 */
export function getConfidenceWeight(sourceName: string): number {
  const entry = SOURCE_CREDIBILITY_DICT[sourceName];
  if (!entry) return 0.1;
  return entry.multiplier;
}

/** Returns a human-readable label for the given tier number. */
export function getTierLabel(tier: 1 | 2 | 3 | 4 | 5): string {
  switch (tier) {
    case 1:
      return "Tier 1 — Institutional Wire";
    case 2:
      return "Tier 2 — Major Financial Press";
    case 3:
      return "Tier 3 — Verified Industry";
    case 4:
      return "Tier 4 — Social / Aggregator";
    case 5:
      return "Tier 5 — Unverified / Anonymous";
  }
}
