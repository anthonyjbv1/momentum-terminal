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
    name: "Traditional Values Sentiment",
    category: "CULTURAL",
    baseScore: 50.0,
    spread: 0.5,
    maxAllocation: 100_000.0,
    volatilityBuffer: 0.1,
  },
  {
    name: "Progressive Values Sentiment",
    category: "CULTURAL",
    baseScore: 50.0,
    spread: 0.5,
    maxAllocation: 100_000.0,
    volatilityBuffer: 0.1,
  },
  {
    name: "Masculinity Discourse Sentiment",
    category: "CULTURAL",
    baseScore: 50.0,
    spread: 0.5,
    maxAllocation: 100_000.0,
    volatilityBuffer: 0.1,
  },
  {
    name: "Feminism Wave Sentiment",
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
    name: "NASCAR Racing Sentiment",
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
];
