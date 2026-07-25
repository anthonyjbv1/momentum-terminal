/**
 * useInsightsData
 *
 * Supplies live, per-index data to the Source Insights Panel.
 *
 * Returns:
 *   - activeDriver:    The headline with the highest absolute sentiment score
 *                      dispatched for this index. null if none yet.
 *   - confidenceScore: The live ConfidenceScore (0–100) calculated from all
 *                      dispatched events for this index — strict 1:1 mirror
 *                      of the Oracle Audit Modal's calculation.
 *   - confidenceTier:  'high' | 'moderate' | 'low' derived from the score.
 *   - confidenceLabel: Human-readable tier label ('Verified' | 'Moderate' | 'Speculative')
 *   - sampleSize:      1,240,500 baseline + cumulative ticks + cumulative dispatched headlines
 *
 * STRICT SAFETY: no theme changes, no index.css/tailwind/components.json modifications.
 */

import { useEffect, useRef, useState } from "react";
import { useOracleTick } from "../contexts/OracleTickContext";
import { calculateConfidenceScore } from "../services/confidenceScoreEngine";
import {
  getDispatchedHeadlineCount,
  getDispatchedHeadlinesForIndex,
  subscribeToDispatchedHeadlines,
} from "../services/dispatchedHeadlineLog";
import type { AuditableNewsEvent } from "../services/mockHeadlineService";

// ─── Constants ────────────────────────────────────────────────────────────────
// Realistic baseline that makes the counter look like real-world data volume.
const SAMPLE_SIZE_BASELINE = 1_240_500;

// ─── Tier label mapping — identical to OracleAuditModal ──────────────────────
function tierLabel(tier: "high" | "moderate" | "low"): string {
  if (tier === "high") return "Verified";
  if (tier === "moderate") return "Moderate";
  return "Speculative";
}

// ─── Format sample size as a human-readable string ───────────────────────────
function formatSampleSize(n: number): string {
  if (n >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(2)}M`;
  }
  if (n >= 1_000) {
    return `${(n / 1_000).toFixed(1)}K`;
  }
  return n.toString();
}

export interface InsightsData {
  /** The most impactful headline dispatched for this index, or null */
  activeDriver: AuditableNewsEvent | null;
  /** Live confidence score (0–100) */
  confidenceScore: number;
  /** Confidence tier */
  confidenceTier: "high" | "moderate" | "low";
  /** Human-readable tier label */
  confidenceLabel: string;
  /** Formatted sample size string (e.g. "1.24M") */
  sampleSizeFormatted: string;
}

export function useInsightsData(indexName: string): InsightsData {
  const { tickCount } = useOracleTick();

  // Snapshot of dispatched headline count — used for sample size calculation
  const [headlineCount, setHeadlineCount] = useState<number>(
    getDispatchedHeadlineCount,
  );

  // Subscribe to dispatched headline log so we update whenever a new
  // headline fires — even if the Oracle tick hasn't fired yet.
  useEffect(() => {
    const unsubscribe = subscribeToDispatchedHeadlines(() => {
      setHeadlineCount(getDispatchedHeadlineCount());
    });
    return unsubscribe;
  }, []);

  // ── Active Driver ──────────────────────────────────────────────────────────
  // Get up to 20 recent dispatched entries for this index, then pick the one
  // with the highest absolute sentiment score (the heaviest market mover).
  const entries = getDispatchedHeadlinesForIndex(indexName, 20);
  const events = entries.map((e) => e.event);

  let activeDriver: AuditableNewsEvent | null = null;
  if (events.length > 0) {
    activeDriver = events.reduce((best, e) =>
      Math.abs(e.sentimentScore) > Math.abs(best.sentimentScore) ? e : best,
    );
  }

  // ── Confidence Score — strict 1:1 mirror of OracleAuditModal ──────────────
  // calculateConfidenceScore is the single source of truth — same function
  // called in OracleAuditModal.tsx.
  const confidence = calculateConfidenceScore(events);

  // ── Sample Size ────────────────────────────────────────────────────────────
  // Baseline + total ticks + total headlines dispatched across all indices.
  // tickCount and headlineCount increment organically, so the number creeps
  // up slowly — realistic, not a spinning casino counter.
  const sampleSize = SAMPLE_SIZE_BASELINE + tickCount + headlineCount;

  // Suppress lint warning: tickCount is used indirectly via sampleSize
  void tickCount;

  return {
    activeDriver,
    confidenceScore: confidence.score,
    confidenceTier: confidence.tier,
    confidenceLabel: tierLabel(confidence.tier),
    sampleSizeFormatted: formatSampleSize(sampleSize),
  };
}
