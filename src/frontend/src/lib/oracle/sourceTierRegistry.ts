/**
 * sourceTierRegistry.ts
 *
 * Single source of truth for all source credibility and tier weighting logic
 * on the Momentum Terminal platform.
 *
 * Previously, confidenceScoreEngine.ts used its own weight lookup via
 * sourceCredibilityEngine.getConfidenceWeight(), and entityValidator.ts used
 * an inline if/else chain to resolve tier multipliers independently.
 *
 * After this refactor:
 *   - confidenceScoreEngine.ts imports getConfidenceWeight() from here.
 *   - entityValidator.ts imports getImpactMultiplier() from here.
 *   - No other file should define tier weights independently.
 *
 * STRICT SAFETY: pure TypeScript — no UI, no CSS, no component imports.
 */

export type SourceTier = 1 | 2 | 3 | 4 | 5;

export interface TierDefinition {
  tier: SourceTier;
  examples: string[];
  /** Weight used by confidenceScoreEngine.ts for the confidence ring calculation */
  confidenceWeight: number;
  /** Multiplier used by entityValidator.ts in the final impact formula */
  impactMultiplier: number;
  /** confidence * 100 baseline — the raw score base for this tier */
  rawScoreBase: number;
}

export const SOURCE_TIER_REGISTRY: Record<SourceTier, TierDefinition> = {
  1: {
    tier: 1,
    examples: ["Bloomberg", "Reuters", "Fed", "SEC", "AP"],
    confidenceWeight: 1.0,
    impactMultiplier: 1.5,
    rawScoreBase: 100,
  },
  2: {
    tier: 2,
    examples: ["WSJ", "FT", "CNBC"],
    confidenceWeight: 0.8,
    impactMultiplier: 1.0,
    rawScoreBase: 80,
  },
  3: {
    tier: 3,
    examples: ["TechCrunch", "StockTwits", "Verified Corporate"],
    confidenceWeight: 0.5,
    impactMultiplier: 0.5,
    rawScoreBase: 50,
  },
  4: {
    tier: 4,
    examples: ["Reddit", "Seeking Alpha", "Anonymous X"],
    confidenceWeight: 0.2,
    impactMultiplier: 0.3,
    rawScoreBase: 20,
  },
  5: {
    tier: 5,
    examples: ["Anonymous Telegram", "Unverified Social"],
    confidenceWeight: 0.05,
    impactMultiplier: 0.3,
    rawScoreBase: 5,
  },
};

/**
 * Returns the full TierDefinition for a given tier number.
 * If the tier is unrecognized, null, or undefined, returns Tier 4 as the
 * safe fallback and logs a single console note.
 */
export function getTierDefinition(
  tier: SourceTier | number | undefined,
): TierDefinition {
  if (tier === undefined || tier === null) {
    console.log(
      `[SourceTierRegistry] Unrecognized tier value: ${tier}. Defaulting to Tier 4.`,
    );
    return SOURCE_TIER_REGISTRY[4];
  }
  const definition = SOURCE_TIER_REGISTRY[tier as SourceTier];
  if (!definition) {
    console.log(
      `[SourceTierRegistry] Unrecognized tier value: ${tier}. Defaulting to Tier 4.`,
    );
    return SOURCE_TIER_REGISTRY[4];
  }
  return definition;
}

/**
 * Returns only the impactMultiplier for a given tier.
 * Drop-in replacement for inline tier switch/case in entityValidator.ts.
 */
export function getImpactMultiplier(
  tier: SourceTier | number | undefined,
): number {
  return getTierDefinition(tier).impactMultiplier;
}

/**
 * Returns only the confidenceWeight for a given tier.
 * Drop-in replacement for SOURCE_CREDIBILITY_DICT lookups in confidenceScoreEngine.ts.
 */
export function getConfidenceWeight(
  tier: SourceTier | number | undefined,
): number {
  return getTierDefinition(tier).confidenceWeight;
}
