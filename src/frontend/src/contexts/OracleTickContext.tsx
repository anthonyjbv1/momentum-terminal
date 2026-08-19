/**
 * OracleTickContext
 *
 * SINGLE SOURCE OF TRUTH for the Oracle heartbeat.
 *
 * forcedIndex support: if a QueuedHeadline has forcedIndex set, routeHeadline()
 * is bypassed entirely and the headline is dispatched directly to that index
 * with a correlation weight of 1.0. This is the brute-force demo override.
 */

import { useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";

import { FALLBACK_ASSET_DEFS } from "../data/fallbackAssets";
import { SHOW_SCORING_METHOD } from "../lib/oracle/debugConfig";
import type { IndexName } from "../lib/oracle/entityValidator";
import { routeHeadline } from "../lib/oracle/entityValidator";
import { analyzeSentiment } from "../lib/oracle/finbertService";
import { getMaxBaseImpact } from "../lib/oracle/indexCategoryRegistry";
import { getImpactMultiplier } from "../lib/oracle/sourceTierRegistry";
import { fetchPlatformAllocatedByIndex } from "../services/capacityTierService";
import {
  annotateHeadlineWithInverse,
  recordDispatchedHeadline,
} from "../services/dispatchedHeadlineLog";
import {
  ACTIVE_INDICES,
  ALL_INDICES,
  computeWeightedGSI,
} from "../services/gsiCovarianceEngine";
import {
  type ActorWithFedBLS,
  dequeueForcedIndexHeadline,
  dequeueHeadlines,
  getQueueLength,
  getSourceNameForTier,
  initHeadlineQueue,
} from "../services/headlineQueueService";
import { getActivePreemptions } from "../services/netOrderFlowEngine";
import {
  clearDivergentFlag,
  evaluatePlatformState,
  generateStoryKey,
  getDivergentFlag,
  recordConvergenceEventFired,
  recordPlatformSignal,
  setDivergentFlag,
  shouldFireConvergenceEvent,
} from "../services/platformDivergenceDetector";
import {
  type SocialHeadlineInput,
  generateSocialOracleHeadline,
} from "../services/socialHeadlineGenerator";
import { runOraclePipelineForAll } from "../services/unifiedOraclePipeline";
import type { TickHeadline } from "../services/unifiedOraclePipeline";
import type { AssetPrice, Holding } from "../types/backendEnums";
import { NewsEventCategory } from "../types/backendEnums";
import { useAuth } from "./AuthContext";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface OracleTickContextValue {
  finalScores: Map<string, number>;
  currentGSI: number | null;
  tickCount: number;
  secondsLeft: number;
  lastDispatchedHeadline: TickHeadline | null;
  activePreemptions: Map<
    string,
    {
      triggered: boolean;
      adjustment: number;
      confirmed: boolean;
      convictionScore: number;
      direction: number;
    }
  >;
  scoreHistoryMap: Map<string, number[]>;
  platformAllocatedByIndex: Record<string, number>;
  platformVolumeByIndex: Record<string, number>;
}

// ─── Context ───────────────────────────────────────────────────────────────────

const OracleTickContext = createContext<OracleTickContextValue>({
  finalScores: new Map(),
  currentGSI: null,
  tickCount: 0,
  secondsLeft: 30,
  lastDispatchedHeadline: null,
  activePreemptions: new Map(),
  scoreHistoryMap: new Map(),
  platformAllocatedByIndex: {},
  platformVolumeByIndex: {},
});

// ─── Provider ────────────────────────────────────────────────────────────────────

// Fix A4 — Category-aware tick interval resolver.
// The setInterval baseline uses DEFAULT (30_000). Per-category intervals will
// be wired to individual index tick logic in Part B. Do not change the actual
// setInterval firing rate here — use DEFAULT for the interval itself.

// ─── Mobile tick-rate throttle ────────────────────────────────────────────────
const TICK_INTERVALS: Record<string, number> = {
  MACRO: 30_000,
  GEOPOLITICAL: 35_000,
  CULTURAL: 17_000,
  DEFAULT: 30_000,
};

function getTickInterval(category: string): number {
  return TICK_INTERVALS[category] ?? TICK_INTERVALS.DEFAULT;
}

// ─── Burst Override Threshold ────────────────────────────────────────────────
// When queue depth reaches this value, the probabilistic drain table is
// suspended and a guaranteed minimum of BURST_MIN_DRAIN headlines are
// processed. Prevents sentiment debt during high-volume news events.
const BURST_THRESHOLD = 5;
const BURST_MIN_DRAIN = 2;

export function OracleTickProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const { isAuthenticated } = useAuth();
  const [secondsLeft, setSecondsLeft] = useState(30);
  const secondsLeftRef = useRef(30);

  const [tickState, setTickState] = useState<OracleTickContextValue>({
    finalScores: new Map(),
    currentGSI: null,
    tickCount: 0,
    secondsLeft: 30,
    lastDispatchedHeadline: null,
    activePreemptions: new Map(),
    scoreHistoryMap: new Map(),
    platformAllocatedByIndex: {},
    platformVolumeByIndex: {},
  });

  const platformAllocatedRef = useRef<Record<string, number>>({});
  const platformVolumeRef = useRef<Record<string, number>>({});

  const tickStateRef = useRef(tickState);
  useEffect(() => {
    tickStateRef.current = tickState;
  }, [tickState]);

  // Per-index score history — last 15 finalScores per index, keyed by index name.
  // Stored in a ref so it never triggers re-renders; exposed via the hook as a
  // stable Map<string, number[]> reference that SentimentArc reads on each render.
  const scoreHistoryRef = useRef<Map<string, number[]>>(new Map());

  // ── Per-Headline Sentiment Decay Store ────────────────────────────────────────
  // Tracks every non-zero rawNewsImpact contribution applied to each index.
  // Each entry records the delta, the tickId it fired on, and its half-life.
  // A pre-tick pass computes decayed residuals and unwinds stale contributions
  // before rawOracleScores is handed to runOraclePipelineForAll().
  const impactContributionStoreRef = useRef<
    Map<string, Array<{ delta: number; tickId: number; halfLifeTicks: number }>>
  >(new Map());

  // Monotonically incrementing tick counter used by the decay store.
  // A ref so it mutates without triggering re-renders.
  const tickIdRef = useRef<number>(0);

  // Session-wide headline count per index — accumulated across all ticks,
  // persisted to mt_headline_counts so activityFactor survives page refresh.
  const sessionHeadlineCountsRef = useRef<Record<string, number>>((() => {
    try {
      const raw = localStorage.getItem("mt_headline_counts");
      if (raw) return JSON.parse(raw) as Record<string, number>;
    } catch { /* ignore */ }
    return {};
  })());

  useEffect(() => {
    // ── Seed dispatched headline log from localStorage ────────────────────────
    try {
      const raw = localStorage.getItem("mt_persisted_headlines");
      if (raw) {
        const parsed = JSON.parse(raw) as Array<{
          text: string;
          targetIndex: string;
          impact: number;
          sentimentLabel: string;
          confidence: number;
          sourceTier: number;
          source?: string;
          timestamp: number;
        }>;
        if (Array.isArray(parsed) && parsed.length > 0) {
          const sorted = [...parsed].sort((a, b) => a.timestamp - b.timestamp);
          for (const ph of sorted) {
            const tier = Math.max(1, Math.min(5, Number(ph.sourceTier))) as 1 | 2 | 3 | 4 | 5;
            const sourceName = ph.source ?? getSourceNameForTier(tier);
            recordDispatchedHeadline({
              headline: ph.text,
              sentimentScore: ph.impact,
              category: NewsEventCategory.Washington,
              relatedIndex: ph.targetIndex,
              source: sourceName,
              sourceTier: tier,
              rationale: `[localStorage History · ${
                ph.impact > 0 ? "positive" : ph.impact < 0 ? "negative" : "neutral"
              } @ ${(ph.confidence * 100).toFixed(0)}%] Impact: ${ph.impact >= 0 ? "+" : ""}${ph.impact.toFixed(2)}`,
            });
          }
          console.info(`[OracleTick] Seeded ${sorted.length} persisted headlines from localStorage on mount.`);
        }
      } else {
        console.info("[OracleTick] No persisted headlines in localStorage — feed will populate after first tick.");
      }
    } catch (err) {
      console.warn("[OracleTick] Failed to parse persisted headlines from localStorage.", err);
    }

    // ── Fast initial render from localStorage backup ────────────────────────
    let localHistoryRestored = false;
    try {
      const rawHistory = localStorage.getItem("momentum_oracle_score_history_v1");
      if (rawHistory) {
        const parsed = JSON.parse(rawHistory);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          const historyMap = new Map<string, number[]>();
          for (const [indexName, scores] of Object.entries(parsed)) {
            if (Array.isArray(scores)) {
              const clean = (scores as number[]).filter(Number.isFinite);
              historyMap.set(indexName, clean.slice(-720));
            }
          }
          if (historyMap.size > 0) {
            scoreHistoryRef.current = historyMap;
            setTickState((prev) => ({
              ...prev,
              scoreHistoryMap: historyMap,
            }));
            localHistoryRestored = true;
            console.info(`[OracleTick] Restored score history from localStorage: ${historyMap.size} indexes.`);
          }
        }
      }
    } catch {
      // localStorage read failed — continue
    }

    console.info("[OracleTick] Canister hydration skipped — using localStorage.");
    void localHistoryRestored; // suppress unused warning
  }, [isAuthenticated]);

  const runTick = useCallback(async () => {
    try {
    // Advance the monotonic tick counter for this tick run.
    const currentTickId = ++tickIdRef.current;

    const cachedAssets =
      queryClient.getQueryData<AssetPrice[]>(["assetPrices"]) ?? [];

    // ── STEP 3+4: Per-Headline Sentiment Decay — pre-tick pass ───────────────
    // Compute a decayAdjustment for each index by summing the decayed residuals
    // of all prior contributions in impactContributionStoreRef. The residual for
    // each contribution is delta * (decayFactor - 1.0), which is always ≤ 0 —
    // it partially unwinds the original contribution as it ages.
    //   age=0            → residual=0      (no adjustment yet)
    //   age=halfLifeTicks → residual=-0.5*delta  (half the original delta unwound)
    //   age>halfLifeTicks*3 → pruned (fully decayed, no longer meaningful)
    const decayAdjustments: Record<string, number> = {};
    for (const indexName of ALL_INDICES) {
      const contributions = impactContributionStoreRef.current.get(indexName);
      if (!contributions || contributions.length === 0) {
        decayAdjustments[indexName] = 0;
        continue;
      }

      let totalResidual = 0;
      const surviving: Array<{
        delta: number;
        tickId: number;
        halfLifeTicks: number;
      }> = [];

      for (const contribution of contributions) {
        const age = currentTickId - contribution.tickId;
        // Prune contributions that are fully decayed (age > halfLifeTicks * 3)
        if (age > contribution.halfLifeTicks * 3) continue;

        const decayFactor = 0.5 ** (age / contribution.halfLifeTicks);
        const decayFactorPrev = 0.5 ** ((age - 1) / contribution.halfLifeTicks);
        const residual = contribution.delta * (decayFactor - decayFactorPrev);
        totalResidual += residual;
        surviving.push(contribution);
      }

      // Write pruned list back to the store
      impactContributionStoreRef.current.set(indexName, surviving);
      decayAdjustments[indexName] = totalResidual;
    }

    // Priority-ordered rawOracleScores construction:
    //   1st — tickStateRef.current.finalScores (carry-forward from last tick)
    //   2nd — cachedAssets.baseScore (React Query cache fallback)
    //   3rd — FALLBACK_ASSET_DEFS.baseScore (cold-start safety net)
    // Iterates ALL_INDICES as the loop source — not cachedAssets — so the
    // pipeline always sees all indexes regardless of cache state.
    const rawOracleScores: Record<string, number> = {};

    for (const indexName of ALL_INDICES) {
      const oracleCarryForward =
        tickStateRef.current.finalScores.get(indexName);
      const cachedBase = cachedAssets.find(
        (a) => a.name === indexName,
      )?.baseScore;
      const fallbackBase =
        FALLBACK_ASSET_DEFS.find((a) => a.name === indexName)?.baseScore ?? 50;

      const baseScore = oracleCarryForward ?? cachedBase ?? fallbackBase;

      // ── STEP 5: Apply decay adjustment ─────────────────────────────────────
      // The decayAdjustment is always ≤ 0 — it unwinds prior headline
      // contributions as they age. Clamped to Math.max(0, ...) so the score
      // can never be pushed below 0 by decay alone.
      const adjustment = decayAdjustments[indexName] ?? 0;
      const rawVal = Math.max(0, baseScore + adjustment);
      if (["Progressivism Sentiment","Traditionalism Sentiment","Masculism Sentiment","Feminism Sentiment","NASCAR Sentiment"].includes(indexName)) {
        console.debug(`[OracleTick][DEBUG] ${indexName}: carryFwd=${oracleCarryForward}, cachedBase=${cachedBase}, fallbackBase=${fallbackBase}, baseScore=${baseScore}, rawVal=${rawVal}`);
      }
      rawOracleScores[indexName] = rawVal;
    }

    const cachedHoldings =
      queryClient.getQueryData<Array<[string, Holding]>>(["holdings"]) ?? [];

    const holdings = Object.keys(rawOracleScores).map((name) => {
      const redeemPrice = (rawOracleScores[name] ?? 50) - 0.5;
      const holding = cachedHoldings.find(([n]) => n === name)?.[1];
      return {
        indexName: name,
        allocated: holding ? holding.units * redeemPrice : 0,
      };
    });

    // ── BURST OVERRIDE SAFETY VALVE ──────────────────────────────────────────
    // Fires BEFORE the probabilistic roll. If queue depth >= BURST_THRESHOLD,
    // skip the probability table and drain a guaranteed minimum of
    // BURST_MIN_DRAIN headlines (or whatever is left if fewer remain).
    // This is a floor, not a ceiling — the probabilistic roll is skipped
    // entirely during burst; normal drain resumes once depth < threshold.
    const queueDepth = getQueueLength();
    let drainCount: number;

    if (queueDepth >= BURST_THRESHOLD) {
      drainCount = Math.min(BURST_MIN_DRAIN, queueDepth);
      console.info(
        `[Oracle] Burst override active — queue depth: ${queueDepth}`,
      );
    } else {
      // Normal probabilistic drain table (60% / 25% / 15%) — unchanged.
      const roll = Math.random();
      drainCount = roll < 0.6 ? 1 : roll < 0.85 ? 2 : 3;
    }

    const rawHeadlines = await dequeueHeadlines(drainCount);

    // Fix 2 — Tier 3 / social starvation guard.
    // If the normal FIFO drain produced no social (forcedIndex) headlines this
    // tick, force-dequeue one additional entry from the queue that carries a
    // forcedIndex (social/Tier 3). This is additive — the normal drain count
    // and BURST_THRESHOLD/BURST_MIN_DRAIN are unchanged. If no forcedIndex
    // entries are waiting, this is a no-op.
    const hadSocialThisTick = rawHeadlines.some((h) => h.forcedIndex);
    if (!hadSocialThisTick && getQueueLength() > 0) {
      const bonusSocial = dequeueForcedIndexHeadline();
      if (bonusSocial) {
        rawHeadlines.push(bonusSocial);
      }
    }

    const scoredHeadlines = await Promise.all(
      rawHeadlines.map(async (queued) => {
        // Skip FinBERT for structured data sources (Forbes/YouTube/Twitch/Spotify)
        // that have a forcedIndex and sourceLabelOverride — they don't need Gradio classification.
        if (queued.forcedIndex && queued.sourceLabelOverride) {
          const s = queued.sentimentScore;
          const label =
            typeof s === "number" && s > 0
              ? "positive"
              : typeof s === "number" && s < 0
                ? "negative"
                : "neutral"; // zero or undefined → neutral so direction=0 and finalImpact=0
          return {
            ...queued,
            label: label as "positive" | "negative" | "neutral",
            confidence: 0.75,
            scoringMethod: "neutral_fallback" as const,
          };
        }
        const sentiment = await analyzeSentiment(
          queued.text,
          queued.sentimentScore,
        );
        return {
          ...queued,
          label: sentiment.label,
          confidence: sentiment.confidence,
          scoringMethod: sentiment.scoringMethod,
        };
      }),
    );

    const headlineMap = new Map<string, TickHeadline>();
    let lastHeadlineThisTick: TickHeadline | null = null;

    for (const scored of scoredHeadlines) {
      // ── BRUTE-FORCE OVERRIDE: if forcedIndex is set, bypass routeHeadline() ──
      // This guarantees demo headlines always show their correct God-Tier badge.
      let weightMap: Map<IndexName, number>;
      if (scored.forcedIndex) {
        weightMap = new Map([[scored.forcedIndex as IndexName, 1.0]]);
        console.info(
          `[OracleTick] forcedIndex override: "${scored.forcedIndex}" — routing engine bypassed.`,
        );
      } else {
        weightMap = routeHeadline(scored.text);
      }

      // ── Finnhub / Social Fallback Routing ────────────────────────────────
      // When routeHeadline() returns an empty weightMap, run keyword matching
      // against five fallback groups. Headlines with a forcedIndex never reach
      // here — they are handled by the forcedIndex branch above.
      // Routing priority: most-matches-wins. If tied, first group in array
      // order wins. If no group scores at least 1 match, the headline is
      // discarded. A headline is only ever routed to ONE fallback index.
      if (weightMap.size === 0) {
        const lowerText = scored.text.toLowerCase();

        const FALLBACK_GROUPS: Array<{
          index: string;
          keywords: string[];
        }> = [
          {
            index: "Fed Policy Sentiment",
            keywords: [
              "fed",
              "rate",
              "inflation",
              "fomc",
              "tariff",
              "trade war",
              "sanctions",
              "dollar",
              "treasury",
              "yield",
              "recession",
              "gdp",
              "unemployment",
              "jobs",
              "hiring",
              "layoffs",
              "markets",
              "stocks",
              "wall street",
              "interest rate",
              "economy",
              "economic",
            ],
          },
          {
            index: "MENA Stability Sentiment",
            keywords: [
              "iran",
              "oil",
              "opec",
              "mena",
              "middle east",
              "hormuz",
              "war",
              "conflict",
              "military",
              "troops",
              "ceasefire",
              "missile",
              "strike",
              "bombing",
              "nuclear",
              "protest",
              "coup",
              "tension",
              "geopolitical",
              "ukraine",
              "russia",
              "china",
              "taiwan",
              "israel",
              "gaza",
              "lebanon",
              "syria",
              "saudi",
              "gulf",
            ],
          },
          {
            index: "AI Regulation Risk Sentiment",
            keywords: [
              "chip",
              "ai",
              "regulation",
              "semiconductor",
              "export",
              "tech",
              "technology",
              "silicon valley",
              "google",
              "microsoft",
              "openai",
              "nvidia",
              "antitrust",
              "data privacy",
              "surveillance",
              "automation",
              "robot",
              "algorithm",
              "platform",
              "big tech",
              "congress",
              "legislation",
              "bill",
              "policy",
            ],
          },
          {
            index: "Traditionalism Sentiment",
            keywords: [
              "supreme court",
              "abortion",
              "religious",
              "church",
              "family",
              "marriage",
              "gender",
              "immigration",
              "border",
              "conservative",
              "tradition",
              "parental rights",
              "school",
              "curriculum",
              "faith",
              "second amendment",
              "guns",
              "crime",
            ],
          },
          {
            index: "Progressivism Sentiment",
            keywords: [
              "climate",
              "environment",
              "renewable",
              "lgbtq",
              "equality",
              "diversity",
              "inclusion",
              "civil rights",
              "voting rights",
              "healthcare",
              "student loans",
              "minimum wage",
              "union",
              "workers",
              "progressive",
              "social justice",
              "police reform",
              "protest",
            ],
          },
        ];

        // Most-matches-wins: count keyword hits per group, pick the highest.
        let bestIndex: string | null = null;
        let bestCount = 0;

        for (const group of FALLBACK_GROUPS) {
          const count = group.keywords.filter((kw) =>
            lowerText.includes(kw),
          ).length;
          if (count > bestCount) {
            bestCount = count;
            bestIndex = group.index;
          }
          // Ties: first group in array order wins (no update when count === bestCount)
        }

        if (bestIndex && bestCount > 0) {
          weightMap = new Map([[bestIndex as IndexName, 1.0]]);
        }
      }
      // ─────────────────────────────────────────────────────────────────────

      if (weightMap.size === 0) continue;

      const direction =
        scored.label === "negative" ? -1 : scored.label === "neutral" ? 0 : 1;

      // Fix A1 — tier multiplier resolved from unified SOURCE_TIER_REGISTRY.
      // Replaces the inline hardcoded ternary chain that previously lived here.
      const tierMultiplier = getImpactMultiplier(scored.sourceTier);

      // Preserve the original source field from the queue push so that feed
      // label mapping (getSourceLabel) sees "reddit", "finnhub", "ftc", etc.
      // Fall back to a random tier name only when no source was set.
      const sourceName = scored.source
        ? scored.source
        : getSourceNameForTier(scored.sourceTier);
      const tierLabel = `Tier ${scored.sourceTier}`;

      for (const [targetIndex, correlationWeight] of weightMap) {
        // Resolve category from FALLBACK_ASSET_DEFS so each target index gets
        // a category-aware base impact cap via indexCategoryRegistry.
        // The registry normalises case so "MACRO", "GEOPOLITICAL", "CULTURAL"
        // all resolve correctly to their respective maxBaseImpact values.
        const indexDef = FALLBACK_ASSET_DEFS.find(
          (a) => a.name === targetIndex,
        );
        const indexCategory = indexDef?.category;
        const baseImpactRaw =
          scored.confidence * getMaxBaseImpact(indexCategory);
        const baseImpact = Number(baseImpactRaw.toFixed(2));

        const finalImpact = Number(
          (
            baseImpactRaw *
            direction *
            tierMultiplier *
            correlationWeight
          ).toFixed(2),
        );

        const methodLabel =
          scored.scoringMethod === "lexicon"
            ? "LEXICON"
            : scored.scoringMethod === "neutral_fallback"
              ? "NEUTRAL"
              : "FINBERT";

        // ── Neutral Fallback Capture Log ────────────────────────────────────
        // Write every neutral_fallback headline to localStorage so it can be
        // reviewed in the Oracle Audit Modal for lexicon expansion.
        // This block must NEVER throw — tick execution is never interrupted.
        if (scored.scoringMethod === "neutral_fallback") {
          try {
            const existing = localStorage.getItem(
              "momentum_fallthrough_log_v1",
            );
            const log: Array<{
              headline: string;
              indexName: string;
              source: string;
              tickId: number;
              timestamp: number;
              confidence: number;
              scoringMethod: string;
            }> = existing ? JSON.parse(existing) : [];
            log.push({
              headline: scored.text,
              indexName: targetIndex,
              source: scored.source ?? "unknown",
              tickId: tickIdRef.current,
              timestamp: Date.now(),
              confidence: scored.confidence,
              scoringMethod: "neutral_fallback",
            });
            const pruned = log.length > 500 ? log.slice(log.length - 500) : log;
            localStorage.setItem(
              "momentum_fallthrough_log_v1",
              JSON.stringify(pruned),
            );
          } catch {
            // silent fail — never block tick execution
          }
        }
        // ────────────────────────────────────────────────────────────────────

        // ── FinBERT Log ──────────────────────────────────────────────────────
        // Write every headline that reached FinBERT classification OR resolved
        // to neutral_fallback to localStorage for lexicon expansion review.
        // This block must NEVER throw — tick execution is never interrupted.
        if (
          scored.scoringMethod === "finbert" ||
          scored.scoringMethod === "neutral_fallback"
        ) {
          try {
            const existingFinbert = localStorage.getItem(
              "momentum_finbert_log_v1",
            );
            const finbertLog: Array<{
              headline: string;
              indexName: string;
              source: string;
              tickId: number;
              timestamp: number;
              confidence: number;
              scoringMethod: string;
              suggestedDirection: string;
            }> = existingFinbert ? JSON.parse(existingFinbert) : [];

            let suggestedDirection = "review";
            if (scored.scoringMethod === "finbert") {
              suggestedDirection =
                scored.label === "positive" ? "positive" : "negative";
            }

            finbertLog.push({
              headline: scored.text,
              indexName: targetIndex,
              source: scored.source ?? "unknown",
              tickId: tickIdRef.current,
              timestamp: Date.now(),
              confidence: scored.confidence,
              scoringMethod: scored.scoringMethod,
              suggestedDirection,
            });

            const prunedFinbert =
              finbertLog.length > 2000
                ? finbertLog.slice(finbertLog.length - 2000)
                : finbertLog;
            localStorage.setItem(
              "momentum_finbert_log_v1",
              JSON.stringify(prunedFinbert),
            );
          } catch {
            // silent fail — never block tick execution
          }
        }
        // ────────────────────────────────────────────────────────────────────

        const methodPrefix = SHOW_SCORING_METHOD ? `${methodLabel}: ` : "";

        const rationale =
          `[${sourceName} · ${tierLabel}] ${methodPrefix}${scored.label} @ ${(
            scored.confidence * 100
          ).toFixed(0)}% confidence. ` +
          `Base: ${baseImpact >= 0 ? "+" : ""}${baseImpact.toFixed(2)} × Tier: ${tierMultiplier.toFixed(
            2,
          )} × Weight: ${correlationWeight.toFixed(2)} → Final: ${
            finalImpact >= 0 ? "+" : ""
          }${finalImpact.toFixed(2)}`;

        const uiEntry: TickHeadline = {
          indexName: targetIndex,
          sentimentScore: finalImpact,
          headline: scored.text,
          source: sourceName,
          rationale,
          baseImpact,
          tierMultiplier,
          correlationWeight,
          weight: correlationWeight,
        };

        // Fix 1 — forcedIndex propagation: pass scored.forcedIndex through to the
        // dispatch log entry so NewsFeedSidebar's fallback filter can read it even
        // when relatedIndex was derived from the weightMap rather than set directly.
        const dispatchEvent = {
          headline: scored.text,
          sentimentScore: finalImpact,
          category: NewsEventCategory.Washington,
          relatedIndex: targetIndex,
          source: sourceName,
          sourceTier: scored.sourceTier,
          rationale,
          baseImpact,
          tierMultiplier,
          correlationWeight,
          weight: correlationWeight,
          scoringMethod: scored.scoringMethod,
          ...(scored.forcedIndex ? { forcedIndex: scored.forcedIndex } : {}),
        };
        recordDispatchedHeadline(
          dispatchEvent as Parameters<typeof recordDispatchedHeadline>[0],
        );

        // ── Non-blocking social Oracle event injection ─────────────────────
        // For social source headlines (reddit, youtube, twitter), synthesize a
        // second Oracle-voiced headline via the AI generator and inject it into
        // the dispatch log as a separate ORACLE-SOCIAL event.
        //
        // Timing:
        //   - Wire-triggered (triggerHeadline present): 90s delay to reflect
        //     real narrative sequencing after the wire event fires.
        //   - Metric-only (forcedIndex set, no trigger): fire immediately.
        //
        // This is strictly fire-and-forget — the main tick cycle is never
        // blocked. Failures are silently swallowed.
        // Structured data sources (YouTube subscriber counts, Twitch viewers, etc.)
        // already carry the correct label — don't synthesize a social Oracle headline
        // that would land in the same dedup bucket with a random tier-2 source name.
        const isSocialSource =
          !scored.sourceLabelOverride &&
          (scored.source === "reddit" ||
           scored.source === "youtube" ||
           scored.source === "twitter");

        if (isSocialSource) {
          const sentimentDir =
            scored.label === "positive"
              ? "positive"
              : scored.label === "negative"
                ? "negative"
                : "neutral";

          // Negate confidence for negative signals to produce a signed score
          const signedScore =
            scored.label === "negative"
              ? -Math.abs(scored.confidence)
              : Math.abs(scored.confidence);

          const platform =
            scored.source === "reddit"
              ? "reddit"
              : scored.source === "youtube"
                ? "youtube"
                : scored.source === "twitter"
                  ? "twitter"
                  : "cross-platform";

          const socialInput: SocialHeadlineInput = {
            platform,
            indexName: targetIndex,
            sentimentDirection: sentimentDir,
            sentimentScore: signedScore,
            engagementMetric:
              scored.engagementScore ?? scored.commentCount ?? 0,
            engagementLabel:
              scored.engagementScore !== undefined
                ? "upvotes"
                : scored.commentCount !== undefined
                  ? "comments"
                  : "interactions",
            sampleWindowDays: 1,
            triggerHeadline: scored.forcedIndex ? null : scored.text,
            platformContext: scored.source ?? platform,
          };

          // If forcedIndex is set (DC/Marvel social with no wire trigger),
          // fire immediately. Otherwise delay 90s.
          const delayMs = scored.forcedIndex ? 0 : 90_000;

          // ── Step 1: Record platform signal for divergence/convergence tracking ──
          // Generate a stable story key before the setTimeout so it's captured
          // in closure correctly regardless of delay.
          const storyKey = generateStoryKey(scored.text, targetIndex);

          // ── Step 3: Check divergent flag from prior evaluation for this story ──
          // If a previous tick flagged this story as divergent, override the
          // direction so the AI prompt reflects the contested narrative state.
          const wasDivergent = getDivergentFlag(storyKey);
          const effectiveSentimentDir: SocialHeadlineInput["sentimentDirection"] =
            wasDivergent ? "divergent" : sentimentDir;
          if (wasDivergent) {
            clearDivergentFlag(storyKey);
          }

          setTimeout(() => {
            generateSocialOracleHeadline({
              ...socialInput,
              sentimentDirection: effectiveSentimentDir,
            })
              .then((socialHeadline) => {
                const socialEvent = {
                  headline: socialHeadline.headlineText,
                  sentimentScore: socialHeadline.scoreImpact,
                  category: NewsEventCategory.Washington,
                  relatedIndex: socialHeadline.indexName,
                  source: "ORACLE-SOCIAL" as const,
                  rationale: `Oracle synthesis: ${socialHeadline.platform} ${socialHeadline.sentimentDirection} signal`,
                  baseImpact: socialHeadline.scoreImpact,
                  scoringMethod: "social-synthesis",
                  forcedIndex: socialHeadline.indexName,
                };
                recordDispatchedHeadline(
                  socialEvent as Parameters<typeof recordDispatchedHeadline>[0],
                );

                // ── Feed injection: trigger an independent feed update so the
                // social headline surfaces immediately when this setTimeout fires,
                // rather than waiting for the next tick cycle.
                const socialTickHeadline: TickHeadline = {
                  indexName: socialHeadline.indexName,
                  sentimentScore: socialHeadline.scoreImpact,
                  headline: socialHeadline.headlineText,
                  source: "ORACLE-SOCIAL",
                  rationale: `Oracle synthesis: ${socialHeadline.platform} ${socialHeadline.sentimentDirection} signal`,
                  baseImpact: socialHeadline.scoreImpact,
                  tierMultiplier: 1,
                  correlationWeight: 1,
                  weight: 1,
                };
                setTickState((prev) => ({
                  ...prev,
                  lastDispatchedHeadline: socialTickHeadline,
                }));

                // ── Step 1: Record the platform signal ──────────────────────
                recordPlatformSignal(
                  storyKey,
                  platform as "reddit" | "twitter" | "youtube",
                  targetIndex,
                  sentimentDir,
                  signedScore,
                  socialInput.engagementMetric,
                  Date.now(),
                );

                // ── Step 2: Evaluate platform state ─────────────────────────
                const platformState = evaluatePlatformState(storyKey);

                // ── Step 3: Flag divergent stories ───────────────────────────
                if (platformState.status === "divergent") {
                  setDivergentFlag(storyKey);
                }

                // ── Step 4: Fire cross-platform convergence event ────────────
                if (shouldFireConvergenceEvent(storyKey, platformState)) {
                  recordConvergenceEventFired(storyKey);

                  const crossInput: SocialHeadlineInput = {
                    platform: "cross-platform",
                    indexName: targetIndex,
                    sentimentDirection:
                      platformState.dominantDirection === "positive"
                        ? "positive"
                        : "negative",
                    sentimentScore:
                      platformState.dominantDirection === "positive"
                        ? platformState.confidenceScore
                        : -platformState.confidenceScore,
                    engagementMetric: 0,
                    engagementLabel: "interactions",
                    sampleWindowDays: 1,
                    triggerHeadline: scored.text,
                    platformContext: "cross-platform",
                  };

                  // Non-blocking: fire-and-forget
                  setTimeout(() => {
                    generateSocialOracleHeadline(crossInput)
                      .then((crossHeadline) => {
                        const crossEvent = {
                          headline: crossHeadline.headlineText,
                          sentimentScore: crossHeadline.scoreImpact,
                          category: NewsEventCategory.Washington,
                          relatedIndex: crossHeadline.indexName,
                          source: "ORACLE-SOCIAL" as const,
                          rationale: `Oracle synthesis: cross-platform ${crossHeadline.sentimentDirection} convergence`,
                          baseImpact: crossHeadline.scoreImpact,
                          scoringMethod: "social-synthesis",
                          forcedIndex: crossHeadline.indexName,
                        };
                        recordDispatchedHeadline(
                          crossEvent as Parameters<
                            typeof recordDispatchedHeadline
                          >[0],
                        );
                      })
                      .catch(() => {
                        // Never crash — silently ignore failures
                      });
                  }, 0);
                }

                // ── Step 5: insufficient-data → do nothing (fall through) ───
              })
              .catch(() => {
                // Never crash — silently ignore failures
              });
          }, delayMs);
        }
        // ──────────────────────────────────────────────────────────────────────

        lastHeadlineThisTick = uiEntry;

        // Persist processed headline to localStorage
        try {
          const stored = JSON.parse(localStorage.getItem("mt_persisted_headlines") ?? "[]") as Array<unknown>;
          stored.push({
            text: scored.text,
            targetIndex,
            impact: finalImpact,
            sentimentLabel: scored.label,
            confidence: scored.confidence,
            sourceTier: scored.sourceTier,
            source: scored.source,
            timestamp: Date.now(),
          });
          const capped = stored.slice(-200);
          localStorage.setItem("mt_persisted_headlines", JSON.stringify(capped));
        } catch { /* ignore */ }

        const effectiveImpact = finalImpact === 0 ? 0 : finalImpact;
        if (effectiveImpact === 0 && !scored.sourceLabelOverride) {
          console.debug(
            `[OracleTick] Neutral headline skipped: "${scored.text.slice(0, 60)}..."`,
          );
          continue;
        }

        const existing = headlineMap.get(targetIndex);
        if (existing) {
          headlineMap.set(targetIndex, {
            ...existing,
            sentimentScore: Number(
              (existing.sentimentScore + finalImpact).toFixed(2),
            ),
            headline: scored.text,
            headlineCount: (existing.headlineCount ?? 1) + 1,
          });
        } else {
          headlineMap.set(targetIndex, { ...uiEntry, headlineCount: 1 });
        }
      }
    }

    // Accumulate session-wide headline counts and persist for activityFactor
    for (const [idxName, entry] of headlineMap) {
      const count = entry.headlineCount ?? 1;
      sessionHeadlineCountsRef.current[idxName] =
        (sessionHeadlineCountsRef.current[idxName] ?? 0) + count;
    }
    try {
      localStorage.setItem(
        "mt_headline_counts",
        JSON.stringify(sessionHeadlineCountsRef.current),
      );
    } catch { /* ignore */ }

    const output = runOraclePipelineForAll({
      rawOracleScores,
      holdings,
      headlineMap,
      platformAllocatedByIndex: platformAllocatedRef.current,
      nowMs: Date.now(),
    });

    // ── Net Order Flow tick log entry population ──────────────────────────────
    // The Net Order Flow engine (evaluatePreemption) runs inside the pipeline
    // for each index and produces a conviction score and adjustment. Wire those
    // values into the tick log entry object here so the display layer can show
    // non-zero values when capital is actively moving into or out of an index.
    // getActivePreemptions() holds the freshly computed results for THIS tick
    // (clearExpiredPreemptions() was called at the start of runOraclePipelineForAll).
    const activePreemptionsThisTick = getActivePreemptions();
    for (const entry of output.tickEntries) {
      const preemption = activePreemptionsThisTick.get(entry.indexName);
      // Cast to allow writing the extended fields that OracleAuditModal.tsx's
      // ExtendedTickEntry interface already declares as optional.
      const extEntry = entry as typeof entry & {
        netOrderFlowDelta?: number;
        concentration?: number;
      };
      extEntry.netOrderFlowDelta = preemption?.adjustment ?? 0;
      // convictionScore is clamped to [-1, +1] by the engine — express as
      // a signed percentage concentration value for the display layer.
      extEntry.concentration =
        preemption !== undefined
          ? Math.round(Math.abs(preemption.convictionScore) * 1000) / 10
          : 0;
    }

    // ── Thread inverse relationship data into the dispatched headline log ─────
    // The pipeline's second pass tagged tick entries that triggered an inverse
    // signal. We annotate the most recently dispatched headline for that primary
    // index so NewsFeedSidebar can render the secondary inverse pill.
    for (const entry of output.tickEntries) {
      if (
        entry.inverseAffectedIndex !== undefined &&
        entry.inverseImpact !== undefined
      ) {
        annotateHeadlineWithInverse(
          entry.indexName,
          entry.inverseAffectedIndex,
          entry.inverseImpact,
        );
      }
    }

    // ── STEP 2: Write non-zero rawNewsImpact contributions to the decay store ─
    // For each index that received a headline impact this tick, push an entry
    // with the raw delta, this tickId, and a category-aware half-life.
    //   MACRO       → 8 ticks  (~4 min at 30s intervals)
    //   GEOPOLITICAL → 6 ticks (~3.5 min at 35s intervals)
    //   CULTURAL    → 4 ticks  (~1 min at 17s intervals)
    for (const entry of output.tickEntries) {
      const { indexName, rawNewsImpact } = entry;
      if (rawNewsImpact === 0 || !Number.isFinite(rawNewsImpact)) continue;

      const indexDef = FALLBACK_ASSET_DEFS.find((a) => a.name === indexName);
      const category = (indexDef?.category ?? "").toLowerCase();

      let halfLifeTicks: number;
      if (category === "macro") {
        halfLifeTicks = 8;
      } else if (category === "geopolitical") {
        halfLifeTicks = 6;
      } else {
        // cultural and all others
        halfLifeTicks = 4;
      }

      const storeEntry = {
        delta: rawNewsImpact,
        tickId: currentTickId,
        halfLifeTicks,
      };
      const existing = impactContributionStoreRef.current.get(indexName) ?? [];
      impactContributionStoreRef.current.set(indexName, [
        ...existing,
        storeEntry,
      ]);
    }

    // Fetch platform-wide allocated totals from canister (fire-and-update, non-blocking).
    // Runs on every tick so the capacity bar always reflects the true platform aggregate.
    fetchPlatformAllocatedByIndex()
      .then((allocated) => {
        platformAllocatedRef.current = allocated;
      })
      .catch(() => {
        // silent fail — never block tick execution
      });

    // Load platform volume per index from localStorage.
    try {
      const raw = localStorage.getItem("mt_volume_by_index");
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, number>;
        platformVolumeRef.current = parsed;
      }
    } catch { /* ignore */ }

    const finalScoreRecord: Record<string, number> = {};
    for (const [name, score] of output.finalScores.entries()) {
      finalScoreRecord[name] = score;
    }
    const newGSI = computeWeightedGSI(finalScoreRecord);

    setTickState((prev) => {
      const scoresChanged = [...output.finalScores.entries()].some(
        ([k, v]) => prev.finalScores.get(k) !== v,
      );
      const nextScores = scoresChanged
        ? new Map([...prev.finalScores, ...output.finalScores])
        : prev.finalScores;
      const currentPreemptions = getActivePreemptions();
      const preemptionsChanged =
        currentPreemptions.size !== prev.activePreemptions.size ||
        [...currentPreemptions.entries()].some(([k, v]) => {
          const p = prev.activePreemptions.get(k);
          return (
            !p || p.adjustment !== v.adjustment || p.triggered !== v.triggered
          );
        });
      const nextPreemptions = preemptionsChanged
        ? new Map(currentPreemptions)
        : prev.activePreemptions;
      return {
        finalScores: nextScores,
        currentGSI: newGSI,
        tickCount: prev.tickCount + 1,
        lastDispatchedHeadline: lastHeadlineThisTick,
        activePreemptions: nextPreemptions,
        scoreHistoryMap: scoreHistoryRef.current,
        platformAllocatedByIndex: platformAllocatedRef.current,
        platformVolumeByIndex: platformVolumeRef.current,
      };
    });

    try {
      const scoresObj: Record<string, number> = {};
      output.finalScores.forEach((score, name) => {
        scoresObj[name] = score;
      });
      localStorage.setItem(
        "momentum_oracle_scores_v1",
        JSON.stringify(scoresObj),
      );
    } catch {
      // localStorage write failed — silently continue
    }

    // Persist full score history to localStorage so it survives page refresh.
    // This is a backup — the canister is the authoritative source, but this
    // ensures the UI has data immediately on mount even if the canister
    // is temporarily unreachable or the user is offline.
    try {
      const historyObj: Record<string, number[]> = {};
      for (const [indexName, scores] of scoreHistoryRef.current.entries()) {
        historyObj[indexName] = scores;
      }
      localStorage.setItem(
        "momentum_oracle_score_history_v1",
        JSON.stringify(historyObj),
      );
    } catch {
      // localStorage write failed — silently continue
    }

    // Populate per-index score history after writing the new finalScores.
    // scoreHistoryRef is a module-level ref — no re-render triggered.
    for (const [indexName, score] of output.finalScores.entries()) {
      if (!Number.isFinite(score)) continue;
      const existing = scoreHistoryRef.current.get(indexName) ?? [];
      scoreHistoryRef.current.set(indexName, [...existing, score].slice(-720));
    }
    } catch (err) {
      console.error("[OracleTick] ERROR:", err);
    }
  }, [queryClient]);

  // ── Fix 4: Pre-populate finalScores from FALLBACK_ASSET_DEFS on mount ────────
  // Eliminates the cold-start race condition where useAssetPrices fires before
  // the first Oracle tick has written any scores to the context.
  useEffect(() => {
    let savedScores: Record<string, number> = {};
    try {
      const raw = localStorage.getItem("momentum_oracle_scores_v1");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") {
          savedScores = parsed;
        }
      }
    } catch {
      // localStorage read failed — fall through to baseScore
    }

    const initialScores = new Map<string, number>();
    for (const asset of FALLBACK_ASSET_DEFS) {
      const saved = savedScores[asset.name];
      const score =
        typeof saved === "number" &&
        Number.isFinite(saved) &&
        saved > 0 &&
        saved <= 200
          ? saved
          : asset.baseScore;
      initialScores.set(asset.name, score);
    }
    setTickState((prev) => ({
      ...prev,
      finalScores: initialScores,
      scoreHistoryMap: scoreHistoryRef.current,
    }));
  }, []);

  useEffect(() => {
    let cleanupQueue: (() => void) | null = null;

    cleanupQueue = initHeadlineQueue(null as unknown as ActorWithFedBLS);

    const initialTimeout = setTimeout(() => {
      runTick();
    }, 500);
    // Baseline loop cadence: DEFAULT interval (30_000 ms).
    // Per-index category-aware intervals (getTickInterval) are wired in Part B.
    const interval = setInterval(() => {
      runTick();
    }, TICK_INTERVALS.DEFAULT);

    return () => {
      if (cleanupQueue) cleanupQueue();
      clearTimeout(initialTimeout);
      clearInterval(interval);
    };
  }, [runTick]);

  // Single shared countdown — all components read from here, always in sync.
  useEffect(() => {
    const countdownInterval = setInterval(() => {
      if (document.hidden) return;
      setSecondsLeft((prev) => {
        const next = Math.max(0, prev - 1);
        secondsLeftRef.current = next;
        return next;
      });
    }, 1000);
    return () => clearInterval(countdownInterval);
  }, []);

  // Reset to 30 whenever a new Oracle tick fires.
  const prevTickCount = useRef(tickState.tickCount);
  useEffect(() => {
    if (tickState.tickCount !== prevTickCount.current) {
      prevTickCount.current = tickState.tickCount;
      setSecondsLeft(30);
      secondsLeftRef.current = 30;
    }
  }, [tickState.tickCount]);

  const contextValue: OracleTickContextValue = {
    ...tickState,
    secondsLeft,
  };

  return (
    <OracleTickContext.Provider value={contextValue}>
      {children}
    </OracleTickContext.Provider>
  );
}

export function useOracleTick(): OracleTickContextValue {
  return useContext(OracleTickContext);
}

// Exported for use in Part B per-index tick wiring
export { getTickInterval, TICK_INTERVALS };
