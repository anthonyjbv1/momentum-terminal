/**
 * Revert Target Configuration
 *
 * Per-index equilibrium targets for mean-reversion formula.
 * Each value reflects the narrative baseline for that index.
 * Dynamic overrides drift ±8 from the base target based on sustained streaks.
 */

import { FALLBACK_ASSET_DEFS } from "../data/fallbackAssets";

// ─── Base Targets ─────────────────────────────────────────────────────────────

export const REVERT_TARGETS: Record<string, number> = {
  // MACRO
  "Fed Policy Sentiment": 50,
  "AI Regulation Risk Sentiment": 52,

  // GEOPOLITICAL
  "MENA Stability Sentiment": 42,
  "United States Sentiment": 50,
  "China Sentiment": 47,
  "Germany Sentiment": 49,

  // TECHNOLOGY
  "Jensen Huang Sentiment": 63,
  "Mark Zuckerberg Sentiment": 55,
  "Elon Musk Sentiment": 55,
  "Larry Ellison Sentiment": 57,
  "Jeff Bezos Sentiment": 56,
  "Larry Page Sentiment": 55,
  "Sergey Brin Sentiment": 54,
  "Warren Buffett Sentiment": 62,
  "Michael Dell Sentiment": 53,

  // CULTURAL
  "Progressivism Sentiment": 50,
  "Traditionalism Sentiment": 50,
  "Masculism Sentiment": 48,
  "Feminism Sentiment": 51,

  // HEALTH
  "Obesity Drug Sentiment": 58,
  "Ozempic Sentiment": 60,
  "Wegovy Sentiment": 58,
  "Whole Food & Wellness Sentiment": 52,
  "Type 2 Diabetes Sentiment": 45,
  "Alzheimer's Sentiment": 47,
  "Cancer Research Sentiment": 53,
  "Mental Health Sentiment": 51,
  "Seasonal Influenza Sentiment": 46,

  // SPORTS
  "Kansas City Chiefs Sentiment": 58,
  "Denver Broncos Sentiment": 47,
  "Patrick Mahomes Sentiment": 61,
  "FC Barcelona Sentiment": 60,
  "Real Madrid CF Sentiment": 61,
  "France National Team Sentiment": 57,
  "Spain National Team Sentiment": 56,
  "F1 Constructor Sentiment": 55,
  "F1 Ferrari Sentiment": 62,
  "F1 McLaren Sentiment": 59,
  "F1 Mercedes Sentiment": 54,
  "NASCAR Sentiment": 50,

  // INDIVIDUALS
  "Drake Sentiment": 65,
  "Kendrick Lamar Sentiment": 63,
  "MrBeast Sentiment": 68,
  "Kai Cenat Sentiment": 60,
  "Adin Ross Sentiment": 52,

  // UNIVERSITIES
  "Harvard University Sentiment": 67,
  "Yale University Sentiment": 65,
  "University of Michigan Sentiment": 60,
  "Ohio State University Sentiment": 58,

  // REGIONAL
  "California Sentiment": 51,
  "New York Sentiment": 51,
  "Florida Sentiment": 50,
  "Texas Sentiment": 50,
};

// Runtime validation: warn on startup for any key that doesn't match FALLBACK_ASSET_DEFS
Object.keys(REVERT_TARGETS).forEach((key) => {
  if (!FALLBACK_ASSET_DEFS.find((a) => a.name === key)) {
    console.warn("[RevertTarget] No matching index for:", key);
  }
});

export function getRevertTarget(indexName: string): number {
  return REVERT_TARGETS[indexName] ?? 50;
}

// ─── Dynamic Override Store ───────────────────────────────────────────────────

const REVERT_TARGET_STORAGE_KEY = "mt_revert_targets_dynamic";

export function loadDynamicRevertTargets(): Record<string, number> {
  try {
    const stored = localStorage.getItem(REVERT_TARGET_STORAGE_KEY);
    return stored ? (JSON.parse(stored) as Record<string, number>) : {};
  } catch {
    return {};
  }
}

export function saveDynamicRevertTargets(targets: Record<string, number>): void {
  try {
    localStorage.setItem(REVERT_TARGET_STORAGE_KEY, JSON.stringify(targets));
  } catch { /* ignore quota errors */ }
}

export function getDynamicRevertTarget(
  indexName: string,
  dynamicOverrides: Record<string, number>,
): number {
  return dynamicOverrides[indexName] ?? getRevertTarget(indexName);
}
