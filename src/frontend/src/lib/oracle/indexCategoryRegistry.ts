/**
 * indexCategoryRegistry.ts
 *
 * Per-category maximum base impact values for the Oracle impact formula.
 * Used by calculateImpact() in entityValidator.ts to apply category-aware
 * impact ceilings instead of a universal hardcoded multiplier.
 *
 * Category-specific ceilings:
 *   geopolitical : 1.5  → max realistic impact: 0.98 × 1.5 × 1.5 = 2.205
 *   cultural     : 2.5  → max realistic impact: 0.98 × 2.5 × 1.5 = 3.675
 *   macro        : 1.5  → same ceiling as geopolitical (macro-driven indexes)
 *   sports       : 3.5  → max realistic impact: 0.98 × 3.5 × 1.5 = 5.145
 *
 * Note: accepts both lowercase ("geopolitical") and uppercase ("GEOPOLITICAL")
 * category strings. fallbackAssets.ts uses UPPERCASE — normalization is applied
 * inside getMaxBaseImpact() so neither file needs to change its conventions.
 */

/**
 * Canonical display names for all 11 indexes.
 * Maps internal engine key → user-facing display label.
 * Engine keys (the Record keys below) are used for routing, scoring, and
 * localStorage. Display values are the user-facing labels shown in the UI.
 */
export const INDEX_DISPLAY_NAMES: Record<string, string> = {
  "Fed Policy Sentiment": "Fed Policy Sentiment",
  "MENA Stability Sentiment": "MENA Stability Sentiment",
  "AI Regulation Risk Sentiment": "AI Regulation Risk Sentiment",
  "Traditional Values Sentiment": "Traditional Values Sentiment",
  "Progressive Values Sentiment": "Progressive Values Sentiment",
  "Masculinity Discourse Sentiment": "Masculinity Discourse Sentiment",
  "Feminism Wave Sentiment": "Feminism Wave Sentiment",
  "F1 Constructor Sentiment": "F1 Constructor Sentiment",
  "NASCAR Racing Sentiment": "NASCAR American Racing Sentiment",
  "Obesity Drug Sentiment": "Obesity Drug Sentiment",
  "Whole Food & Wellness Sentiment": "Whole Food & Wellness Sentiment",
};

/**
 * Returns the user-facing display name for an index engine key.
 * Falls back to the raw key string if no mapping is found.
 */
export function getDisplayName(engineKey: string): string {
  return INDEX_DISPLAY_NAMES[engineKey] ?? engineKey;
}

export type IndexCategory =
  | "geopolitical"
  | "cultural"
  | "macro"
  | "sports"
  | "technology"
  | "health";

const MAX_BASE_IMPACT: Record<IndexCategory, number> = {
  geopolitical: 1.5,
  cultural: 2.5,
  macro: 1.5,
  sports: 1.5,
  technology: 2.5,
  health: 2.0,
};

/**
 * Per-category mean-reversion decay rates (λ per hour).
 * MACRO indices move on quarterly cadences — slower reversion.
 * CULTURAL indices are driven by social sentiment — faster reversion.
 * GEOPOLITICAL sits between the two.
 */
const DECAY_RATE: Record<IndexCategory, number> = {
  macro: 0.2,
  geopolitical: 0.3,
  cultural: 0.45,
  sports: 0.35,
  technology: 0.25,
  health: 0.4,
};

const FALLBACK_MAX_BASE_IMPACT = 1.5;
const FALLBACK_DECAY_RATE = 0.35; // matches previous global LAMBDA as safe fallback

export function getMaxBaseImpact(
  category: IndexCategory | string | undefined,
): number {
  if (!category) {
    console.warn(
      `[indexCategoryRegistry] No category provided — using fallback ${FALLBACK_MAX_BASE_IMPACT}`,
    );
    return FALLBACK_MAX_BASE_IMPACT;
  }
  // Normalize to lowercase so both "CULTURAL" and "cultural" resolve correctly.
  const normalized = category.toLowerCase() as IndexCategory;
  if (!(normalized in MAX_BASE_IMPACT)) {
    console.warn(
      `[indexCategoryRegistry] Unrecognized category: "${category}" — using fallback ${FALLBACK_MAX_BASE_IMPACT}`,
    );
    return FALLBACK_MAX_BASE_IMPACT;
  }
  return MAX_BASE_IMPACT[normalized];
}

/**
 * Returns the per-category mean-reversion decay rate (λ per hour).
 * Pass the index's category string — both UPPERCASE and lowercase are accepted.
 */
export function getDecayRate(
  category: IndexCategory | string | undefined,
): number {
  if (!category) {
    console.warn(
      `[indexCategoryRegistry] No category provided for decayRate — using fallback ${FALLBACK_DECAY_RATE}`,
    );
    return FALLBACK_DECAY_RATE;
  }
  const normalized = category.toLowerCase() as IndexCategory;
  if (!(normalized in DECAY_RATE)) {
    console.warn(
      `[indexCategoryRegistry] Unrecognized category: "${category}" for decayRate — using fallback ${FALLBACK_DECAY_RATE}`,
    );
    return FALLBACK_DECAY_RATE;
  }
  return DECAY_RATE[normalized];
}
