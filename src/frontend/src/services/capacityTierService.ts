/**
 * capacityTierService.ts
 *
 * Manages tiered capacity auto-extension state in localStorage.
 * All operations are wrapped in try/catch — never throws, never blocks.
 *
 * Tier structure:
 *   Tier 1: $90,000  (default)
 *   Tier 2: $135,000 (after 24h at Tier 1 capacity)
 *   Tier 3: $180,000 (after 24h at Tier 2 capacity)
 *   Tier 4: $270,000 (after 24h at Tier 3 capacity)
 *   Hard ceiling: $270,000 — never extends beyond
 */

import { createActorWithConfig } from "../config";

const STORAGE_KEY = "momentum_capacity_state_v1";
const TIER_1 = 90_000;
const TIER_2 = 135_000;
const TIER_3 = 180_000;
const TIER_4 = 270_000;
const TWENTY_FOUR_HOURS_MS = 86_400_000;

const INDEX_NAMES = [
  "Fed Policy Sentiment",
  "MENA Stability Sentiment",
  "AI Regulation Risk Sentiment",
  "Traditional Values Sentiment",
  "Progressive Values Sentiment",
  "Masculinity Discourse Sentiment",
  "Feminism Wave Sentiment",
  "F1 Constructor Sentiment",
  "NASCAR Racing Sentiment",
  "Obesity Drug Sentiment",
  "Whole Food & Wellness Sentiment",
] as const;

export interface CapacityEntry {
  currentCap: number;
  currentAllocated: number;
  fullSinceTimestamp: number | null;
}

export type CapacityState = Record<string, CapacityEntry>;

function buildDefault(): CapacityState {
  const state: CapacityState = {};
  for (const name of INDEX_NAMES) {
    state[name] = {
      currentCap: TIER_1,
      currentAllocated: 0,
      fullSinceTimestamp: null,
    };
  }
  return state;
}

/**
 * Initialize capacity state in localStorage if it does not already exist.
 * Silent fail on any storage error.
 */
export function initCapacityState(): void {
  try {
    const existing = localStorage.getItem(STORAGE_KEY);
    if (!existing) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(buildDefault()));
    }
  } catch {
    // silent fail — never block on storage failure
  }
}

/**
 * Read and parse capacity state from localStorage.
 * Returns the default initialized state if missing or corrupt.
 */
export function getCapacityState(): CapacityState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return buildDefault();
    const parsed = JSON.parse(raw) as CapacityState;
    return parsed ?? buildDefault();
  } catch {
    return buildDefault();
  }
}

/**
 * Update capacity tier state for a single index.
 * Call on every tick and allocation attempt.
 * Silent fail on storage errors — never blocks execution.
 */
export function tickCapacity(
  indexName: string,
  currentAllocated: number,
): void {
  try {
    const state = getCapacityState();
    const entry: CapacityEntry = state[indexName] ?? {
      currentCap: TIER_1,
      currentAllocated: 0,
      fullSinceTimestamp: null,
    };

    // Always persist the latest platform-wide allocated figure
    entry.currentAllocated = currentAllocated;

    if (currentAllocated >= entry.currentCap) {
      if (entry.fullSinceTimestamp === null) {
        // Mark the moment the index first reached capacity
        entry.fullSinceTimestamp = Date.now();
      } else if (
        Date.now() - entry.fullSinceTimestamp >=
        TWENTY_FOUR_HOURS_MS
      ) {
        // Advance to next tier
        if (entry.currentCap === TIER_1) {
          entry.currentCap = TIER_2;
        } else if (entry.currentCap === TIER_2) {
          entry.currentCap = TIER_3;
        } else if (entry.currentCap === TIER_3) {
          entry.currentCap = TIER_4;
        }
        // Hard ceiling — TIER_4 never extends further
        // Reset timer so the next tier's 24h window starts fresh
        entry.fullSinceTimestamp = null;
      }
    } else {
      // Below capacity — reset timer
      entry.fullSinceTimestamp = null;
    }

    state[indexName] = entry;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // silent fail — never block tick execution
  }
}

/**
 * Returns the platform-wide currentAllocated for the given index as persisted
 * in localStorage by tickCapacity(). Falls back to 0 on any error or missing entry.
 * This is the correct source for the arc Vol. label — not user position math.
 */
export function getAllocatedFromState(indexName: string): number {
  try {
    const state = getCapacityState();
    return state[indexName]?.currentAllocated ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Returns the currentCap for the given index.
 * Fallback: TIER_1 (90,000) if not found or on error.
 */
export function getCurrentCap(indexName: string): number {
  try {
    const state = getCapacityState();
    return state[indexName]?.currentCap ?? TIER_1;
  } catch {
    return TIER_1;
  }
}

export interface CapacityStatus {
  currentCap: number;
  isAtCapacity: boolean;
  isAtMaximum: boolean;
  fullSinceTimestamp: number | null;
  msUntilExpansion: number | null;
}

/**
 * Reads "sentimentam_local_holdings_v5" from localStorage and returns the
 * total allocated capital for the given index engine key.
 *
 * The holdings store is a Record<indexName, { units, costBasis, ... }> where
 * costBasis is the locked-in total dollars paid (units × buyPrice at allocation).
 * This gives the true allocated capital regardless of when the position was opened.
 *
 * Returns 0 on any parse error, missing key, or if the index has no holding.
 */
export function getTotalAllocatedForIndex(indexName: string): number {
  try {
    const raw = localStorage.getItem("sentimentam_local_holdings_v5");
    if (!raw) return 0;
    const holdings = JSON.parse(raw) as Record<
      string,
      { units?: number; costBasis?: number }
    >;
    const entry = holdings[indexName];
    if (!entry) return 0;
    // costBasis is the total locked-in cost: units × buyPrice at allocation time
    // If costBasis is present and positive, use it directly
    if (typeof entry.costBasis === "number" && entry.costBasis > 0) {
      return entry.costBasis;
    }
    // Fallback: if costBasis is missing but units exist, we cannot derive buyPrice
    // here without external context — return 0 to avoid misleading display
    return 0;
  } catch {
    return 0;
  }
}

/**
 * Fetches platform-wide allocated units per index from the canister.
 * Returns a Record<indexName, units> across all user principals.
 * Falls back to an empty object on any error — never throws.
 */
export async function fetchPlatformAllocatedByIndex(): Promise<
  Record<string, number>
> {
  try {
    const actor = await createActorWithConfig();
    const result = await actor.getTotalAllocatedByIndex();
    return Object.fromEntries(
      (result as Array<[string, number]>).map(([name, units]) => [
        name,
        Number(units),
      ]),
    );
  } catch {
    return {};
  }
}

/**
 * Returns a full capacity status object for a given index and allocated value.
 * Safe defaults returned on any error.
 */
export function getCapacityStatus(
  indexName: string,
  currentAllocated: number,
): CapacityStatus {
  try {
    const state = getCapacityState();
    const entry: CapacityEntry = state[indexName] ?? {
      currentCap: TIER_1,
      currentAllocated: 0,
      fullSinceTimestamp: null,
    };

    const { currentCap, fullSinceTimestamp } = entry;
    const isAtCapacity = currentAllocated >= currentCap && currentCap < TIER_4;
    const isAtMaximum = currentCap === TIER_4 && currentAllocated >= TIER_4;

    let msUntilExpansion: number | null = null;
    if (fullSinceTimestamp !== null) {
      msUntilExpansion = Math.max(
        0,
        fullSinceTimestamp + TWENTY_FOUR_HOURS_MS - Date.now(),
      );
    }

    return {
      currentCap,
      isAtCapacity,
      isAtMaximum,
      fullSinceTimestamp,
      msUntilExpansion,
    };
  } catch {
    return {
      currentCap: TIER_1,
      isAtCapacity: false,
      isAtMaximum: false,
      fullSinceTimestamp: null,
      msUntilExpansion: null,
    };
  }
}
