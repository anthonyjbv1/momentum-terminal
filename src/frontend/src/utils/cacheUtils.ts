import type { AssetPriceWithCapacity } from "../hooks/useQueries";

export interface PortfolioCache {
  assets: AssetPriceWithCapacity[];
  totalPortfolioValue: number;
  savedAt: string;
}

/**
 * Saves the current assets array and total portfolio value to localStorage
 * under the key `{userId}_portfolio_cache`. Called every time the Oracle updates.
 */
export function saveToCache(
  userId: string,
  assets: AssetPriceWithCapacity[],
  totalPortfolioValue: number,
): void {
  if (!userId) return;
  try {
    const cache: PortfolioCache = {
      assets,
      totalPortfolioValue,
      savedAt: new Date().toISOString(),
    };
    localStorage.setItem(`${userId}_portfolio_cache`, JSON.stringify(cache));
  } catch (err) {
    console.error(
      "[saveToCache] Failed to write portfolio cache to localStorage:",
      err,
    );
  }
}

/**
 * Reads and parses the cached portfolio data from localStorage.
 * Returns a typed PortfolioCache object if valid data is found,
 * or null if the key is missing, parsing fails, or data is malformed.
 */
export function loadFromCache(userId: string): PortfolioCache | null {
  if (!userId) return null;
  try {
    const raw = localStorage.getItem(`${userId}_portfolio_cache`);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as unknown;

    // Validate the structure matches PortfolioCache
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !Array.isArray((parsed as PortfolioCache).assets) ||
      typeof (parsed as PortfolioCache).totalPortfolioValue !== "number" ||
      typeof (parsed as PortfolioCache).savedAt !== "string"
    ) {
      return null;
    }

    return parsed as PortfolioCache;
  } catch (err) {
    console.error(
      "[loadFromCache] Failed to read portfolio cache from localStorage:",
      err,
    );
    return null;
  }
}
