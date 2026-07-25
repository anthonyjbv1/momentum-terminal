/**
 * Dispatched Headline Log
 *
 * Single source of truth for headlines that have actually been dispatched
 * through the Oracle pipeline. Both the Oracle Feed sidebar and the
 * Audit Modal read from this log — so a headline that appears in the feed
 * is guaranteed to be the same one recorded in the Unified Tick Log.
 *
 * WRITE: called by useNewsEventDispatcher immediately when a headline fires.
 * READ:  called by OracleAuditModal and NewsFeedSidebar to show "live" events.
 *
 * STRICT SAFETY: no UI, no theme changes. Pure TypeScript service.
 */

import type { AuditableNewsEvent } from "./mockHeadlineService";

export interface DispatchedHeadlineEntry {
  /** The headline event that was dispatched */
  event: AuditableNewsEvent;
  /** Unix timestamp (ms) when this headline was dispatched */
  dispatchedAt: number;
  /**
   * The tick ID that consumed this headline (set by the pipeline after
   * the headline is applied to the Oracle). null until consumed.
   */
  consumedByTickId: number | null;
}

// In-memory log — capped at 100 entries per index
const _log: DispatchedHeadlineEntry[] = [];
const MAX_LOG_SIZE = 100;

/**
 * Records a newly dispatched headline. Called immediately when a headline
 * fires in the news dispatcher — before any Oracle tick consumes it.
 */
export function recordDispatchedHeadline(event: AuditableNewsEvent): void {
  const entry: DispatchedHeadlineEntry = {
    event,
    dispatchedAt: Date.now(),
    consumedByTickId: null,
  };
  _log.push(entry);

  // Enforce cap
  if (_log.length > MAX_LOG_SIZE) {
    _log.splice(0, _log.length - MAX_LOG_SIZE);
  }

  // Notify listeners
  _notifyListeners();
}

/**
 * Marks the most recent unconsumed headline for a given index as consumed
 * by a specific tick. Called by the unified pipeline after applying the headline.
 */
export function markHeadlineConsumed(indexName: string, tickId: number): void {
  // Find the most recent unconsumed entry for this index and mark it
  for (let i = _log.length - 1; i >= 0; i--) {
    const entry = _log[i];
    if (
      entry.event.relatedIndex === indexName &&
      entry.consumedByTickId === null
    ) {
      entry.consumedByTickId = tickId;
      break;
    }
  }
}

/**
 * Returns the last N dispatched headlines for a specific index, most recent first.
 * Used by the Oracle Audit Modal "Last 5 Influencing Events" section.
 */
export function getDispatchedHeadlinesForIndex(
  indexName: string,
  count = 5,
): DispatchedHeadlineEntry[] {
  return _log
    .filter((e) => e.event.relatedIndex === indexName)
    .slice(-count)
    .reverse();
}

/**
 * Returns all dispatched headlines across all indices, most recent first.
 * Used by the Oracle Feed sidebar to show a live, ordered feed.
 */
export function getAllDispatchedHeadlines(
  count = 50,
): DispatchedHeadlineEntry[] {
  return _log.slice(-count).reverse();
}

/**
 * Returns the total number of dispatched headlines logged so far.
 * Used by components to detect new entries and trigger re-renders.
 */
export function getDispatchedHeadlineCount(): number {
  return _log.length;
}

// ─── Listener pattern for reactive updates ────────────────────────────────────
// Components that need to react to new dispatched headlines can subscribe here.

type Listener = () => void;
const _listeners = new Set<Listener>();

function _notifyListeners(): void {
  for (const fn of _listeners) {
    fn();
  }
}

/**
 * Annotates the most recently dispatched headline for a given index with
 * inverse relationship data from the pipeline's second pass. Called from
 * OracleTickContext immediately after runOraclePipelineForAll returns.
 */
export function annotateHeadlineWithInverse(
  indexName: string,
  inverseAffectedIndex: string,
  inverseImpact: number,
): void {
  for (let i = _log.length - 1; i >= 0; i--) {
    const entry = _log[i];
    if (entry.event.relatedIndex === indexName) {
      entry.event.inverseAffectedIndex = inverseAffectedIndex;
      entry.event.inverseImpact = inverseImpact;
      break;
    }
  }
  // Notify subscribers so the Oracle Feed re-reads the now-annotated entry.
  // Previously missing — the feed never received a re-render signal after
  // the inverse fields were written, causing the pill to vanish immediately.
  _notifyListeners();
}

export function subscribeToDispatchedHeadlines(fn: Listener): () => void {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}
