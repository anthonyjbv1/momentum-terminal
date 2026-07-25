/**
 * platformDivergenceDetector
 *
 * Pure in-memory module that tracks social platform signals per story and
 * detects when platforms are diverging or converging on a narrative.
 *
 * STRICT SAFETY: no async, no external calls, no localStorage, no side effects.
 * All state is module-level — reset only on page reload.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type PlatformState = {
  status:
    | "insufficient-data"
    | "divergent"
    | "converging-positive"
    | "converging-negative"
    | "converging-neutral";
  platforms: string[];
  dominantDirection: "positive" | "negative" | "neutral" | null;
  confidenceScore: number; // 0.0 to 1.0
  divergentPlatforms: string[] | null; // which platforms disagree
};

type SentimentDirection = "positive" | "negative" | "neutral";

interface PlatformSignal {
  platform: "reddit" | "twitter" | "youtube";
  indexName: string;
  sentimentDirection: SentimentDirection;
  sentimentScore: number;
  engagementMetric: number;
  timestamp: number;
}

// ─── Module-level state ───────────────────────────────────────────────────────

/** Signal store: storyKey → array of platform signals (up to 4 hours old) */
const signalStore = new Map<string, PlatformSignal[]>();

/** Cooldown store: storyKey → timestamp of last cross-platform event fired */
const convergenceCooldownMap = new Map<string, number>();

/** Divergent flag store: storyKey → true when the last evaluation was divergent */
const divergentFlagMap = new Map<string, boolean>();

// ─── Constants ────────────────────────────────────────────────────────────────

const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;
const THIRTY_MINUTES_MS = 30 * 60 * 1000;

const STOP_WORDS = new Set([
  "a",
  "an",
  "the",
  "is",
  "are",
  "was",
  "were",
  "in",
  "on",
  "at",
  "to",
  "of",
  "and",
  "or",
  "but",
  "for",
  "with",
  "as",
  "by",
]);

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Stores a social platform signal for the given storyKey.
 * Prunes signals older than 4 hours on every write.
 * Pure in-memory — no side effects outside this module.
 */
export function recordPlatformSignal(
  storyKey: string,
  platform: "reddit" | "twitter" | "youtube",
  indexName: string,
  sentimentDirection: SentimentDirection,
  sentimentScore: number,
  engagementMetric: number,
  timestamp: number,
): void {
  const existing = signalStore.get(storyKey) ?? [];

  // Prune signals older than 4 hours
  const cutoff = timestamp - FOUR_HOURS_MS;
  const pruned = existing.filter((s) => s.timestamp >= cutoff);

  pruned.push({
    platform,
    indexName,
    sentimentDirection,
    sentimentScore,
    engagementMetric,
    timestamp,
  });

  signalStore.set(storyKey, pruned);
}

/**
 * Evaluates the cross-platform state for a given storyKey.
 * Returns a PlatformState describing agreement, divergence, or insufficient data.
 */
export function evaluatePlatformState(storyKey: string): PlatformState {
  const signals = signalStore.get(storyKey) ?? [];

  // Deduplicate to one signal per platform — use the most recent signal per platform
  const latestPerPlatform = new Map<string, PlatformSignal>();
  for (const signal of signals) {
    const existing = latestPerPlatform.get(signal.platform);
    if (!existing || signal.timestamp > existing.timestamp) {
      latestPerPlatform.set(signal.platform, signal);
    }
  }

  const platformList = Array.from(latestPerPlatform.keys());
  const platformSignals = Array.from(latestPerPlatform.values());

  // insufficient-data: fewer than 2 distinct platforms
  if (platformList.length < 2) {
    return {
      status: "insufficient-data",
      platforms: platformList,
      dominantDirection:
        platformList.length === 1
          ? platformSignals[0].sentimentDirection
          : null,
      confidenceScore: 0,
      divergentPlatforms: null,
    };
  }

  // Count direction votes
  const directionCounts: Record<SentimentDirection, string[]> = {
    positive: [],
    negative: [],
    neutral: [],
  };

  for (const [plat, sig] of latestPerPlatform.entries()) {
    directionCounts[sig.sentimentDirection].push(plat);
  }

  const totalPlatforms = platformList.length;

  // Find dominant direction (most platforms agreeing)
  let dominantDirection: SentimentDirection = "neutral";
  let maxCount = 0;
  for (const dir of [
    "positive",
    "negative",
    "neutral",
  ] as SentimentDirection[]) {
    if (directionCounts[dir].length > maxCount) {
      maxCount = directionCounts[dir].length;
      dominantDirection = dir;
    }
  }

  const agreeingPlatforms = directionCounts[dominantDirection];
  const disagreeingPlatforms = platformList.filter(
    (p) => !agreeingPlatforms.includes(p),
  );

  // divergent: at least one platform disagrees
  const isDivergent = disagreeingPlatforms.length > 0;

  if (isDivergent) {
    // confidenceScore for divergent: agreeing ratio * avg |score| of agreeing platforms
    const agreeingSignals = agreeingPlatforms.map(
      (p) => latestPerPlatform.get(p)!,
    );
    const avgAbsScore =
      agreeingSignals.reduce((acc, s) => acc + Math.abs(s.sentimentScore), 0) /
      agreeingSignals.length;
    const confidenceScore =
      (agreeingPlatforms.length / totalPlatforms) * avgAbsScore;

    return {
      status: "divergent",
      platforms: platformList,
      dominantDirection,
      confidenceScore: Math.min(1, Math.max(0, confidenceScore)),
      divergentPlatforms: disagreeingPlatforms,
    };
  }

  // All platforms agree — check converging thresholds
  // Weighted-average sentimentScore (weighted by engagementMetric)
  const totalEngagement = platformSignals.reduce(
    (acc, s) => acc + Math.max(0, s.engagementMetric),
    0,
  );

  let weightedAvgScore: number;
  if (totalEngagement === 0) {
    // Fallback: simple average if no engagement data
    weightedAvgScore =
      platformSignals.reduce((acc, s) => acc + s.sentimentScore, 0) /
      platformSignals.length;
  } else {
    weightedAvgScore =
      platformSignals.reduce(
        (acc, s) => acc + s.sentimentScore * Math.max(0, s.engagementMetric),
        0,
      ) / totalEngagement;
  }

  // confidenceScore for converging: (agreeing / total) * avg(|score|) across agreeing
  const avgAbsScore =
    platformSignals.reduce((acc, s) => acc + Math.abs(s.sentimentScore), 0) /
    platformSignals.length;
  const confidenceScore =
    (agreeingPlatforms.length / totalPlatforms) * avgAbsScore;
  const clampedConfidence = Math.min(1, Math.max(0, confidenceScore));

  // Determine converging status by weighted average threshold
  const absWeighted = Math.abs(weightedAvgScore);

  let status: PlatformState["status"];
  if (dominantDirection === "positive" && absWeighted > 0.4) {
    status = "converging-positive";
  } else if (dominantDirection === "negative" && absWeighted > 0.4) {
    status = "converging-negative";
  } else if (absWeighted < 0.2) {
    status = "converging-neutral";
  } else {
    // Weighted score is in ambiguous middle zone — treat as converging in dominant direction
    status =
      dominantDirection === "positive"
        ? "converging-positive"
        : dominantDirection === "negative"
          ? "converging-negative"
          : "converging-neutral";
  }

  return {
    status,
    platforms: platformList,
    dominantDirection,
    confidenceScore: clampedConfidence,
    divergentPlatforms: null,
  };
}

/**
 * Generates a normalized story key from text and index name.
 * Lowercase → strip punctuation → drop stop words → first 6 significant words → append index slug.
 *
 * Example:
 *   "Federal Reserve raises rates amid Iran tensions" + "Fed Policy Sentiment"
 *   → "federal-reserve-raises-rates-amid-iran-fed-policy-sentiment"
 */
export function generateStoryKey(text: string, indexName: string): string {
  // Normalize to lowercase
  const lower = text.toLowerCase();

  // Strip punctuation (keep alphanumeric and spaces)
  const stripped = lower.replace(/[^a-z0-9\s]/g, "");

  // Split into words and filter out stop words
  const words = stripped
    .split(/\s+/)
    .filter((w) => w.length > 0 && !STOP_WORDS.has(w));

  // Take first 6 significant words
  const significant = words.slice(0, 6);

  // Slugify the index name: lowercase, replace spaces with hyphens
  const indexSlug = indexName.toLowerCase().replace(/\s+/g, "-");

  // Join all with hyphens
  return [...significant, indexSlug].join("-");
}

/**
 * Checks whether the convergence threshold is met for firing a cross-platform event.
 * Returns true only when ALL four conditions hold:
 *   1. status is converging-positive or converging-negative
 *   2. confidenceScore >= 0.65
 *   3. At least 2 platforms in agreement (platforms.length >= 2)
 *   4. No cross-platform event fired for this storyKey in the last 30 minutes
 */
export function shouldFireConvergenceEvent(
  storyKey: string,
  state: PlatformState,
): boolean {
  if (
    state.status !== "converging-positive" &&
    state.status !== "converging-negative"
  ) {
    return false;
  }

  if (state.confidenceScore < 0.65) {
    return false;
  }

  if (state.platforms.length < 2) {
    return false;
  }

  const lastFired = convergenceCooldownMap.get(storyKey);
  if (lastFired !== undefined && Date.now() - lastFired < THIRTY_MINUTES_MS) {
    return false;
  }

  return true;
}

/**
 * Records that a cross-platform convergence event was fired for this storyKey.
 * Updates the cooldown map.
 */
export function recordConvergenceEventFired(storyKey: string): void {
  convergenceCooldownMap.set(storyKey, Date.now());
}

/**
 * Marks a storyKey as divergent so the next generateSocialOracleHeadline call
 * for this story receives sentimentDirection: "divergent".
 */
export function setDivergentFlag(storyKey: string): void {
  divergentFlagMap.set(storyKey, true);
}

/**
 * Checks whether a storyKey has the divergent flag set.
 */
export function getDivergentFlag(storyKey: string): boolean {
  return divergentFlagMap.get(storyKey) === true;
}

/**
 * Clears the divergent flag for a storyKey after it has been consumed.
 */
export function clearDivergentFlag(storyKey: string): void {
  divergentFlagMap.delete(storyKey);
}
