// SINGLE SOURCE OF TRUTH — to add a new index, add one entry here. All other systems derive from this file automatically.

/**
 * Fallback asset baseline scores used when the backend does not return data
 * for a given active index.
 *
 * Kept in a separate, dependency-free file to avoid circular imports:
 *   useQueries.ts → fallbackAssets.ts  (safe, no cycle)
 *   AssetList.tsx → fallbackAssets.ts  (safe, no cycle)
 *   OracleTickContext.tsx → fallbackAssets.ts  (safe, no cycle)
 *
 * Callers that need a full AssetPriceWithCapacity should apply computeCapacity()
 * from useQueries.ts on top of these raw definitions.
 */

export interface FallbackAssetDef {
  name: string;
  category: string;
  baseScore: number;
  spread: number;
  maxAllocation: number;
  volatilityBuffer: number;
}

export const FALLBACK_ASSET_DEFS: FallbackAssetDef[] = [
  {
    name: "Fed Policy Sentiment",
    category: "MACRO",
    baseScore: 50.0,
    spread: 0.5,
    maxAllocation: 100_000.0,
    volatilityBuffer: 0.1,
  },
  {
    name: "MENA Stability Sentiment",
    category: "GEOPOLITICAL",
    baseScore: 48.5,
    spread: 0.5,
    maxAllocation: 100_000.0,
    volatilityBuffer: 0.1,
  },
  {
    name: "AI Regulation Risk Sentiment",
    category: "TECHNOLOGY",
    baseScore: 75.0,
    spread: 0.5,
    maxAllocation: 100_000.0,
    volatilityBuffer: 0.1,
  },
  {
    name: "Traditionalism Sentiment",
    category: "CULTURAL",
    baseScore: 50.0,
    spread: 0.5,
    maxAllocation: 100_000.0,
    volatilityBuffer: 0.1,
  },
  {
    name: "Progressivism Sentiment",
    category: "CULTURAL",
    baseScore: 50.0,
    spread: 0.5,
    maxAllocation: 100_000.0,
    volatilityBuffer: 0.1,
  },
  {
    name: "Masculism Sentiment",
    category: "CULTURAL",
    baseScore: 50.0,
    spread: 0.5,
    maxAllocation: 100_000.0,
    volatilityBuffer: 0.1,
  },
  {
    name: "Feminism Sentiment",
    category: "CULTURAL",
    baseScore: 50.0,
    spread: 0.5,
    maxAllocation: 100_000.0,
    volatilityBuffer: 0.1,
  },
  {
    name: "F1 Constructor Sentiment",
    category: "SPORTS",
    baseScore: 50.0,
    spread: 0.5,
    maxAllocation: 100_000.0,
    volatilityBuffer: 0.1,
  },
  {
    name: "NASCAR Sentiment",
    category: "SPORTS",
    baseScore: 50.0,
    spread: 0.5,
    maxAllocation: 100_000.0,
    volatilityBuffer: 0.1,
  },
  {
    name: "Obesity Drug Sentiment",
    category: "HEALTH",
    baseScore: 50.0,
    spread: 0.5,
    maxAllocation: 100_000.0,
    volatilityBuffer: 0.1,
  },
  {
    name: "Whole Food & Wellness Sentiment",
    category: "HEALTH",
    baseScore: 50.0,
    spread: 0.5,
    maxAllocation: 100_000.0,
    volatilityBuffer: 0.1,
  },
  // ── Individuals ───────────────────────────────────────────────────────────────
  { name: "Elon Musk Sentiment", category: "INDIVIDUALS", baseScore: 50.0, spread: 0.5, maxAllocation: 100_000.0, volatilityBuffer: 0.1 },
  { name: "MrBeast Sentiment", category: "INDIVIDUALS", baseScore: 50.0, spread: 0.5, maxAllocation: 100_000.0, volatilityBuffer: 0.1 },
  { name: "Kai Cenat Sentiment", category: "INDIVIDUALS", baseScore: 50.0, spread: 0.5, maxAllocation: 100_000.0, volatilityBuffer: 0.1 },
  { name: "Drake Sentiment", category: "INDIVIDUALS", baseScore: 50.0, spread: 0.5, maxAllocation: 100_000.0, volatilityBuffer: 0.1 },
  { name: "Adin Ross Sentiment", category: "INDIVIDUALS", baseScore: 50.0, spread: 0.5, maxAllocation: 100_000.0, volatilityBuffer: 0.1 },
  { name: "Patrick Mahomes Sentiment", category: "INDIVIDUALS", baseScore: 50.0, spread: 0.5, maxAllocation: 100_000.0, volatilityBuffer: 0.1 },
  { name: "Kendrick Lamar Sentiment", category: "INDIVIDUALS", baseScore: 50.0, spread: 0.5, maxAllocation: 100_000.0, volatilityBuffer: 0.1 },
  { name: "Jensen Huang Sentiment", category: "INDIVIDUALS", baseScore: 50.0, spread: 0.5, maxAllocation: 100_000.0, volatilityBuffer: 0.1 },
  { name: "Mark Zuckerberg Sentiment", category: "INDIVIDUALS", baseScore: 50.0, spread: 0.5, maxAllocation: 100_000.0, volatilityBuffer: 0.1 },
  { name: "Warren Buffett Sentiment", category: "INDIVIDUALS", baseScore: 50.0, spread: 0.5, maxAllocation: 100_000.0, volatilityBuffer: 0.1 },
  { name: "Larry Ellison Sentiment", category: "INDIVIDUALS", baseScore: 50.0, spread: 0.5, maxAllocation: 100_000.0, volatilityBuffer: 0.1 },
  { name: "Jeff Bezos Sentiment", category: "INDIVIDUALS", baseScore: 50.0, spread: 0.5, maxAllocation: 100_000.0, volatilityBuffer: 0.1 },
  { name: "Larry Page Sentiment", category: "INDIVIDUALS", baseScore: 50.0, spread: 0.5, maxAllocation: 100_000.0, volatilityBuffer: 0.1 },
  { name: "Sergey Brin Sentiment", category: "INDIVIDUALS", baseScore: 50.0, spread: 0.5, maxAllocation: 100_000.0, volatilityBuffer: 0.1 },
  { name: "Michael Dell Sentiment", category: "INDIVIDUALS", baseScore: 50.0, spread: 0.5, maxAllocation: 100_000.0, volatilityBuffer: 0.1 },
  // ── Sports ────────────────────────────────────────────────────────────────────
  { name: "Kansas City Chiefs Sentiment", category: "SPORTS", baseScore: 50.0, spread: 0.5, maxAllocation: 100_000.0, volatilityBuffer: 0.1 },
  { name: "Denver Broncos Sentiment", category: "SPORTS", baseScore: 50.0, spread: 0.5, maxAllocation: 100_000.0, volatilityBuffer: 0.1 },
  { name: "F1 Ferrari Sentiment", category: "SPORTS", baseScore: 50.0, spread: 0.5, maxAllocation: 100_000.0, volatilityBuffer: 0.1 },
  { name: "FC Barcelona Sentiment", category: "SPORTS", baseScore: 50.0, spread: 0.5, maxAllocation: 100_000.0, volatilityBuffer: 0.1 },
  { name: "France National Team Sentiment", category: "SPORTS", baseScore: 50.0, spread: 0.5, maxAllocation: 100_000.0, volatilityBuffer: 0.1 },
  { name: "F1 McLaren Sentiment", category: "SPORTS", baseScore: 50.0, spread: 0.5, maxAllocation: 100_000.0, volatilityBuffer: 0.1 },
  { name: "Real Madrid CF Sentiment", category: "SPORTS", baseScore: 50.0, spread: 0.5, maxAllocation: 100_000.0, volatilityBuffer: 0.1 },
  { name: "F1 Mercedes Sentiment", category: "SPORTS", baseScore: 50.0, spread: 0.5, maxAllocation: 100_000.0, volatilityBuffer: 0.1 },
  { name: "Spain National Team Sentiment", category: "SPORTS", baseScore: 50.0, spread: 0.5, maxAllocation: 100_000.0, volatilityBuffer: 0.1 },
  // ── Universities ──────────────────────────────────────────────────────────────
  { name: "University of Michigan Sentiment", category: "UNIVERSITIES", baseScore: 50.0, spread: 0.5, maxAllocation: 100_000.0, volatilityBuffer: 0.1 },
  { name: "Ohio State University Sentiment", category: "UNIVERSITIES", baseScore: 50.0, spread: 0.5, maxAllocation: 100_000.0, volatilityBuffer: 0.1 },
  { name: "Harvard University Sentiment", category: "UNIVERSITIES", baseScore: 50.0, spread: 0.5, maxAllocation: 100_000.0, volatilityBuffer: 0.1 },
  { name: "Yale University Sentiment", category: "UNIVERSITIES", baseScore: 50.0, spread: 0.5, maxAllocation: 100_000.0, volatilityBuffer: 0.1 },
  // ── Health ────────────────────────────────────────────────────────────────────
  { name: "Type 2 Diabetes Sentiment", category: "HEALTH", baseScore: 50.0, spread: 0.5, maxAllocation: 100_000.0, volatilityBuffer: 0.1 },
  { name: "Alzheimer's Sentiment", category: "HEALTH", baseScore: 50.0, spread: 0.5, maxAllocation: 100_000.0, volatilityBuffer: 0.1 },
  { name: "Seasonal Influenza Sentiment", category: "HEALTH", baseScore: 50.0, spread: 0.5, maxAllocation: 100_000.0, volatilityBuffer: 0.1 },
  { name: "Ozempic Sentiment", category: "HEALTH", baseScore: 50.0, spread: 0.5, maxAllocation: 100_000.0, volatilityBuffer: 0.1 },
  { name: "Wegovy Sentiment", category: "HEALTH", baseScore: 50.0, spread: 0.5, maxAllocation: 100_000.0, volatilityBuffer: 0.1 },
  { name: "Mental Health Sentiment", category: "HEALTH", baseScore: 50.0, spread: 0.5, maxAllocation: 100_000.0, volatilityBuffer: 0.1 },
  { name: "Cancer Research Sentiment", category: "HEALTH", baseScore: 50.0, spread: 0.5, maxAllocation: 100_000.0, volatilityBuffer: 0.1 },
  // ── Regional ──────────────────────────────────────────────────────────────────
  { name: "California Sentiment", category: "REGIONAL", baseScore: 50.0, spread: 0.5, maxAllocation: 100_000.0, volatilityBuffer: 0.1 },
  { name: "New York Sentiment", category: "REGIONAL", baseScore: 50.0, spread: 0.5, maxAllocation: 100_000.0, volatilityBuffer: 0.1 },
  { name: "Florida Sentiment", category: "REGIONAL", baseScore: 50.0, spread: 0.5, maxAllocation: 100_000.0, volatilityBuffer: 0.1 },
  { name: "Texas Sentiment", category: "REGIONAL", baseScore: 50.0, spread: 0.5, maxAllocation: 100_000.0, volatilityBuffer: 0.1 },
  { name: "China Sentiment", category: "REGIONAL", baseScore: 50.0, spread: 0.5, maxAllocation: 100_000.0, volatilityBuffer: 0.1 },
  { name: "Germany Sentiment", category: "REGIONAL", baseScore: 50.0, spread: 0.5, maxAllocation: 100_000.0, volatilityBuffer: 0.1 },
  { name: "United States Sentiment", category: "REGIONAL", baseScore: 50.0, spread: 0.5, maxAllocation: 100_000.0, volatilityBuffer: 0.1 },
];
