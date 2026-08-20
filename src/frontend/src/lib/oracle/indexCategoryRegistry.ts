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
  "Traditionalism Sentiment": "Traditionalism Sentiment",
  "Progressivism Sentiment": "Progressivism Sentiment",
  "Masculism Sentiment": "Masculism Sentiment",
  "Feminism Sentiment": "Feminism Sentiment",
  "F1 Constructor Sentiment": "F1 Constructor Sentiment",
  "NASCAR Sentiment": "NASCAR Sentiment",
  "Obesity Drug Sentiment": "Obesity Drug Sentiment",
  "Whole Food & Wellness Sentiment": "Whole Food & Wellness Sentiment",
  // ── Individuals ──────────────────────────────────────────────────────────────
  "Elon Musk Sentiment": "Elon Musk Sentiment",
  "MrBeast Sentiment": "MrBeast Sentiment",
  "Kai Cenat Sentiment": "Kai Cenat Sentiment",
  "Drake Sentiment": "Drake Sentiment",
  "Adin Ross Sentiment": "Adin Ross Sentiment",
  "Patrick Mahomes Sentiment": "Patrick Mahomes Sentiment",
  "Kendrick Lamar Sentiment": "Kendrick Lamar Sentiment",
  "Jensen Huang Sentiment": "Jensen Huang Sentiment",
  "Mark Zuckerberg Sentiment": "Mark Zuckerberg Sentiment",
  "Warren Buffett Sentiment": "Warren Buffett Sentiment",
  "Larry Ellison Sentiment": "Larry Ellison Sentiment",
  "Jeff Bezos Sentiment": "Jeff Bezos Sentiment",
  "Larry Page Sentiment": "Larry Page Sentiment",
  "Sergey Brin Sentiment": "Sergey Brin Sentiment",
  "Michael Dell Sentiment": "Michael Dell Sentiment",
  // ── Sports ───────────────────────────────────────────────────────────────────
  "Kansas City Chiefs Sentiment": "Kansas City Chiefs Sentiment",
  "Denver Broncos Sentiment": "Denver Broncos Sentiment",
  "F1 Ferrari Sentiment": "F1 Ferrari Sentiment",
  "FC Barcelona Sentiment": "FC Barcelona Sentiment",
  "France National Team Sentiment": "France National Team Sentiment",
  "F1 McLaren Sentiment": "F1 McLaren Sentiment",
  "Real Madrid CF Sentiment": "Real Madrid CF Sentiment",
  "F1 Mercedes Sentiment": "F1 Mercedes Sentiment",
  "Spain National Team Sentiment": "Spain National Team Sentiment",
  // ── Universities ─────────────────────────────────────────────────────────────
  "University of Michigan Sentiment": "University of Michigan Sentiment",
  "Ohio State University Sentiment": "Ohio State University Sentiment",
  "Harvard University Sentiment": "Harvard University Sentiment",
  "Yale University Sentiment": "Yale University Sentiment",
  // ── Health ───────────────────────────────────────────────────────────────────
  "Type 2 Diabetes Sentiment": "Type 2 Diabetes Sentiment",
  "Alzheimer's Sentiment": "Alzheimer's Sentiment",
  "Seasonal Influenza Sentiment": "Seasonal Influenza Sentiment",
  "Ozempic Sentiment": "Ozempic Sentiment",
  "Wegovy Sentiment": "Wegovy Sentiment",
  "Mental Health Sentiment": "Mental Health Sentiment",
  "Cancer Research Sentiment": "Cancer Research Sentiment",
  // ── Individuals (additional) ──────────────────────────────────────────────────
  "Anthony Baptiste Sentiment": "Anthony Baptiste Sentiment",
  // ── Privates ──────────────────────────────────────────────────────────────────
  "Mars Inc. Sentiment": "Mars Inc. Sentiment",
  "Vitol Sentiment": "Vitol Sentiment",
  "Cargill Sentiment": "Cargill Sentiment",
  "Stripe Sentiment": "Stripe Sentiment",
  "Momentum Terminal Sentiment": "Momentum Terminal Sentiment",
  // ── Regional ─────────────────────────────────────────────────────────────────
  "California Sentiment": "California Sentiment",
  "New York Sentiment": "New York Sentiment",
  "Florida Sentiment": "Florida Sentiment",
  "Texas Sentiment": "Texas Sentiment",
  "China Sentiment": "China Sentiment",
  "Germany Sentiment": "Germany Sentiment",
  "United States Sentiment": "United States Sentiment",
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
  | "health"
  | "individuals"
  | "universities"
  | "privates"
  | "regional";

const MAX_BASE_IMPACT: Record<IndexCategory, number> = {
  geopolitical: 1.5,
  cultural: 2.5,
  macro: 1.5,
  sports: 1.5,
  technology: 2.5,
  health: 2.0,
  individuals: 2.0,
  universities: 1.5,
  privates: 2.0,
  regional: 1.5,
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
  individuals: 0.5,
  universities: 0.25,
  privates: 0.35,
  regional: 0.3,
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
