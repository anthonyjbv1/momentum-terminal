/**
 * useNewsEventDispatcher.ts
 *
 * THIN SUBSCRIBER — no polling loop, no queue draining, no JIT scoring.
 *
 * OracleTickContext is the single source of truth for the Oracle heartbeat.
 * This hook exists solely to bridge OracleTickContext's lastDispatchedHeadline
 * into the NewsDispatcherState shape that NewsEventContext (and NewsFeedSidebar)
 * depend on for rendering the live news feed sidebar.
 *
 * ARCHITECTURAL NOTE:
 *   The 60-second interval, initHeadlineQueue(), dequeueHeadlines(), and
 *   analyzeSentiment() calls that previously lived here have been fully removed.
 *   They now live exclusively in OracleTickContext.tsx.
 */

import { useOracleTick } from "../contexts/OracleTickContext";
import type { NewsEvent } from "../types/backendEnums";
import { NewsEventCategory } from "../types/backendEnums";

export interface NewsDispatcherState {
  lastEvent: NewsEvent | null;
  lastDispatchedAt: Date | null;
  error: string | null;
  isSyncing: boolean;
  manualRefresh: () => void;
}

function mapCategory(indexName: string): NewsEventCategory {
  if (indexName === "AI Index") return NewsEventCategory.AI;
  if (indexName === "China Index") return NewsEventCategory.Mexico;
  if (indexName === "Russia Index") return NewsEventCategory.Warriors;
  return NewsEventCategory.Washington;
}

/**
 * Reads the lastDispatchedHeadline from OracleTickContext and re-shapes it
 * into the NewsDispatcherState interface consumed by NewsEventContext.
 *
 * NewsFeedSidebar watches lastEvent — every time OracleTickContext fires a
 * headline-bearing tick, this value changes and the sidebar updates.
 */
export function useNewsEventDispatcher(): NewsDispatcherState {
  const { lastDispatchedHeadline } = useOracleTick();

  const lastEvent: NewsEvent | null = lastDispatchedHeadline
    ? {
        headline: lastDispatchedHeadline.headline,
        sentimentScore: lastDispatchedHeadline.sentimentScore,
        category: mapCategory(lastDispatchedHeadline.indexName),
        relatedIndex: lastDispatchedHeadline.indexName,
      }
    : null;

  return {
    lastEvent,
    lastDispatchedAt: lastDispatchedHeadline ? new Date() : null,
    error: null,
    isSyncing: false,
    manualRefresh: () => {},
  };
}
