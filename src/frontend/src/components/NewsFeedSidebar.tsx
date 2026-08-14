import { ScrollArea } from "@/components/ui/scroll-area";
import {
  ChevronDown,
  ChevronUp,
  Minus,
  Newspaper,
  TrendingDown,
  TrendingUp,
  X,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNewsEvent } from "../contexts/NewsEventContext";
import { SHOW_SCORING_METHOD } from "../lib/oracle/debugConfig";
import {
  getAllDispatchedHeadlines,
  subscribeToDispatchedHeadlines,
} from "../services/dispatchedHeadlineLog";
import type { DispatchedHeadlineEntry } from "../services/dispatchedHeadlineLog";
import { isActiveIndex } from "../services/mockHeadlineService";
import type { AuditableNewsEvent } from "../services/mockHeadlineService";
import type { NewsEvent } from "../types/backendEnums";
import {
  formatSentimentScore,
  getSentimentDisplayLogic,
} from "../utils/sentimentUtils";

// ─── ACTIVE INDEX FILTER — God-Tier roster ────────────────────────────────────
const ACTIVE_INDEXES = new Set([
  "AI Regulation Risk Sentiment",
  "Fed Policy Sentiment",
  "MENA Stability Sentiment",
  "Traditionalism Sentiment",
  "Progressivism Sentiment",
  "Masculism Sentiment",
  "Feminism Sentiment",
  "F1 Constructor Sentiment",
  "NASCAR Sentiment",
  "Obesity Drug Sentiment",
  "Whole Food & Wellness Sentiment",
]);
// ─────────────────────────────────────────────────────────────────────────────

const INDEX_SHORT_NAMES: Record<string, string> = {
  "Fed Policy Sentiment": "FED POLICY",
  "MENA Stability Sentiment": "MENA",
  "AI Regulation Risk Sentiment": "AI & TECH",
  "Traditionalism Sentiment": "TRAD VALUES",
  "Progressivism Sentiment": "PROG VALUES",
  "Masculism Sentiment": "MASCULINITY",
  "Feminism Sentiment": "FEMINISM WAVE",
  "F1 Constructor Sentiment": "F1 CONSTRUCTOR",
  "NASCAR Sentiment": "NASCAR",
  "Obesity Drug Sentiment": "OBESITY DRUG",
  "Whole Food & Wellness Sentiment": "WELLNESS",
};

// ─── Category filter tabs — matches Markets tab taxonomy ─────────────────────
type FeedCategoryFilter =
  | "all"
  | "macro"
  | "geopolitical"
  | "cultural"
  | "sports"
  | "health"
  | "technology"
  | "individuals"
  | "universities"
  | "regional";

const FEED_CATEGORY_TABS: { value: FeedCategoryFilter; label: string }[] = [
  { value: "all", label: "ALL" },
  { value: "macro", label: "MACRO" },
  { value: "geopolitical", label: "GEOPOLITICAL" },
  { value: "technology", label: "TECHNOLOGY" },
  { value: "cultural", label: "CULTURAL" },
  { value: "sports", label: "SPORTS" },
  { value: "health", label: "HEALTH" },
  { value: "individuals", label: "INDIVIDUALS" },
  { value: "universities", label: "UNIVERSITIES" },
  { value: "regional", label: "REGIONAL" },
];

// Map from canonical index name → lowercase category (matches fallbackAssets.ts)
const INDEX_CATEGORY_MAP: Record<string, FeedCategoryFilter> = {
  // ── Core ──────────────────────────────────────────────────────────────────
  "Fed Policy Sentiment": "macro",
  "MENA Stability Sentiment": "geopolitical",
  "AI Regulation Risk Sentiment": "technology",
  "Traditionalism Sentiment": "cultural",
  "Progressivism Sentiment": "cultural",
  "Masculism Sentiment": "cultural",
  "Feminism Sentiment": "cultural",
  "F1 Constructor Sentiment": "sports",
  "NASCAR Sentiment": "sports",
  "Obesity Drug Sentiment": "health",
  "Whole Food & Wellness Sentiment": "health",
  // ── Individuals ───────────────────────────────────────────────────────────
  "Elon Musk Sentiment": "individuals",
  "MrBeast Sentiment": "individuals",
  "Kai Cenat Sentiment": "individuals",
  "Drake Sentiment": "individuals",
  "Adin Ross Sentiment": "individuals",
  "Patrick Mahomes Sentiment": "individuals",
  "Kendrick Lamar Sentiment": "individuals",
  "Jensen Huang Sentiment": "individuals",
  "Mark Zuckerberg Sentiment": "individuals",
  "Warren Buffett Sentiment": "individuals",
  "Larry Ellison Sentiment": "individuals",
  "Jeff Bezos Sentiment": "individuals",
  "Larry Page Sentiment": "individuals",
  "Sergey Brin Sentiment": "individuals",
  "Michael Dell Sentiment": "individuals",
  // ── Sports ────────────────────────────────────────────────────────────────
  "Kansas City Chiefs Sentiment": "sports",
  "Denver Broncos Sentiment": "sports",
  "F1 Ferrari Sentiment": "sports",
  "FC Barcelona Sentiment": "sports",
  "France National Team Sentiment": "sports",
  "F1 McLaren Sentiment": "sports",
  "Real Madrid CF Sentiment": "sports",
  "F1 Mercedes Sentiment": "sports",
  "Spain National Team Sentiment": "sports",
  // ── Universities ──────────────────────────────────────────────────────────
  "University of Michigan Sentiment": "universities",
  "Ohio State University Sentiment": "universities",
  "Harvard University Sentiment": "universities",
  "Yale University Sentiment": "universities",
  // ── Health ────────────────────────────────────────────────────────────────
  "Type 2 Diabetes Sentiment": "health",
  "Alzheimer's Sentiment": "health",
  "Seasonal Influenza Sentiment": "health",
  "Ozempic Sentiment": "health",
  "Wegovy Sentiment": "health",
  "Mental Health Sentiment": "health",
  "Cancer Research Sentiment": "health",
  // ── Regional ──────────────────────────────────────────────────────────────
  "California Sentiment": "regional",
  "New York Sentiment": "regional",
  "Florida Sentiment": "regional",
  "Texas Sentiment": "regional",
  "China Sentiment": "regional",
  "Germany Sentiment": "regional",
  "United States Sentiment": "regional",
};

function isSpecificIndex(relatedIndex: string): boolean {
  return (
    relatedIndex === relatedIndex.toUpperCase() &&
    relatedIndex.includes("INDEX")
  );
}

function relatedIndexToAssetName(relatedIndex: string): string {
  return relatedIndex.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

function SentimentIcon({
  score,
  size = "sm",
}: { score: number; size?: "sm" | "md" }) {
  const cls = size === "md" ? "w-4 h-4 shrink-0" : "w-3 h-3 shrink-0";
  const { icon, colorClass } = getSentimentDisplayLogic(score);
  if (icon === "↗") return <TrendingUp className={`${cls} ${colorClass}`} />;
  if (icon === "↘") return <TrendingDown className={`${cls} ${colorClass}`} />;
  return <Minus className={`${cls} text-gray-400`} />;
}

function SentimentBadge({
  score,
  large = false,
}: { score: number; large?: boolean }) {
  const { colorClass } = getSentimentDisplayLogic(score);
  return (
    <span
      className={`font-mono font-semibold tabular-nums ${colorClass} ${
        large ? "text-xs" : "text-[10px]"
      }`}
    >
      {formatSentimentScore(score)}
    </span>
  );
}

interface RelatedIndexPillProps {
  relatedIndex: string;
  isActive: boolean;
  onClick: (relatedIndex: string) => void;
}

function RelatedIndexPill({
  relatedIndex,
  isActive,
  onClick,
}: RelatedIndexPillProps) {
  const specific = isSpecificIndex(relatedIndex);

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onClick(relatedIndex);
  };

  if (specific) {
    return (
      <button
        type="button"
        onClick={handleClick}
        className={`inline-flex items-center px-1.5 py-0.5 rounded-[3px] border text-[9px] font-semibold uppercase tracking-wider transition-all duration-150 cursor-pointer ${
          isActive
            ? "bg-primary/30 border-primary/60 text-primary shadow-[0_0_6px_rgba(0,200,255,0.25)]"
            : "bg-primary/10 border-primary/25 text-primary/70 hover:bg-primary/20 hover:border-primary/40 hover:text-primary"
        }`}
        title={`Filter by ${relatedIndex}`}
      >
        {INDEX_SHORT_NAMES[relatedIndex] ?? relatedIndex}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className={`inline-flex items-center px-1.5 py-0.5 rounded-[3px] border text-[9px] font-semibold uppercase tracking-wider transition-all duration-150 cursor-pointer ${
        isActive
          ? "bg-white/15 border-white/30 text-foreground/90"
          : "bg-[#1f1f1f] border-white/10 text-muted-foreground/70 hover:bg-white/[0.08] hover:border-white/20 hover:text-muted-foreground"
      }`}
      title={`Filter by ${relatedIndex}`}
    >
      {INDEX_SHORT_NAMES[relatedIndex] ?? relatedIndex}
    </button>
  );
}

type DisplayEvent = NewsEvent & {
  source?: string;
  rationale?: string;
  sourceTier?: number;
  scoringMethod?: string;
  /** The paired inverse index that received a dampened counter-signal this tick. */
  inverseAffectedIndex?: string;
  /** The dampened inverse impact applied to the paired index. */
  inverseImpact?: number;
};

// ─── Deduplicated card type — wraps DisplayEvent + multi-source metadata ─────
interface DeduplicatedEvent {
  event: DisplayEvent;
  /** Number of additional sources that carried the same headline in the same 60s window */
  extraSourceCount: number;
  /** Stable key derived from headline + relatedIndex — safe for React reconciliation */
  stableKey: string;
}

// ─── Render-time deduplication ────────────────────────────────────────────────
// Groups by exact headline text. Within each group, keeps the highest-impact
// event as the representative. Collapses events within a 60-second window into
// a single card with a "+N sources" pill. Underlying data is never mutated.
const DEDUP_WINDOW_MS = 60_000; // 60 seconds

function deduplicateEvents(
  entries: DispatchedHeadlineEntry[],
): DeduplicatedEvent[] {
  // Map: headline text → array of matching entries (all already filtered to active indexes)
  const groups = new Map<string, DispatchedHeadlineEntry[]>();

  for (const entry of entries) {
    const key = entry.event.headline;
    if (!key) continue;
    const bucket = groups.get(key);
    if (bucket) {
      bucket.push(entry);
    } else {
      groups.set(key, [entry]);
    }
  }

  const result: DeduplicatedEvent[] = [];

  for (const [, bucket] of groups) {
    if (bucket.length === 0) continue;

    // Sort bucket by dispatchedAt descending — most recent first
    const sorted = bucket
      .slice()
      .sort((a, b) => b.dispatchedAt - a.dispatchedAt);
    const representative = sorted[0];
    const mostRecentTs = representative.dispatchedAt;

    // Count entries within the 60s window of the most recent entry
    const withinWindow = sorted.filter(
      (e) => mostRecentTs - e.dispatchedAt <= DEDUP_WINDOW_MS,
    );

    // Among those in the window, find the highest absolute-impact instance
    const highestImpact = withinWindow.reduce<DispatchedHeadlineEntry>(
      (best, e) =>
        Math.abs(e.event.sentimentScore) > Math.abs(best.event.sentimentScore)
          ? e
          : best,
      withinWindow[0],
    );

    // extraSourceCount = additional sources beyond the representative card
    const extraSourceCount = withinWindow.length - 1;

    const dedupedEvent: DisplayEvent = {
      ...highestImpact.event,
    } as DisplayEvent;

    result.push({
      event: dedupedEvent,
      extraSourceCount,
      stableKey: `${dedupedEvent.relatedIndex ?? ""}::${dedupedEvent.headline}`,
    });
  }

  // Sort result by most recent dispatchedAt across all matching entries so
  // the feed ordering is preserved after deduplication
  const tsMap = new Map<string, number>();
  for (const entry of entries) {
    const key = entry.event.headline;
    if (!key) continue;
    const existing = tsMap.get(key) ?? 0;
    if (entry.dispatchedAt > existing) tsMap.set(key, entry.dispatchedAt);
  }

  result.sort((a, b) => {
    const ta = tsMap.get(a.event.headline) ?? 0;
    const tb = tsMap.get(b.event.headline) ?? 0;
    return tb - ta;
  });

  return result;
}
// ─────────────────────────────────────────────────────────────────────────────

// ─── Source label helper ─────────────────────────────────────────────────────
const SOURCE_LABEL_MAP: Record<string, string> = {
  finnhub: "FINNHUB",
  bloomberg: "BLOOMBERG",
  reuters: "REUTERS",
  federal_reserve: "FEDERAL RESERVE",
  "federal reserve": "FEDERAL RESERVE",
  bls: "ECONOMIC DATA",
  congress: "CONGRESS",
  gdelt: "GEOPOLITICAL",
  reliefweb: "HUMANITARIAN",
  scotus: "SCOTUS",
  ftc: "REGULATORY",
  uspto: "REGULATORY",
  epa: "REGULATORY",
  aclu: "POLICY",
  courtlistener: "POLICY",
  reddit: "SOCIAL",
  social: "SOCIAL",
  youtube: "YOUTUBE",
  omdb: "ENTERTAINMENT DATA",
};

const getSourceLabel = (event: DisplayEvent): string => {
  const src = event.source?.trim();
  if (!src) return "NEWSWIRE";
  const lc = src.toLowerCase();
  return SOURCE_LABEL_MAP[lc] ?? src.toUpperCase();
};
// ─────────────────────────────────────────────────────────────────────────────

function SourceTierBadge({ event }: { event: DisplayEvent }) {
  const label = getSourceLabel(event);
  const isSocial =
    label.toLowerCase().includes("reddit") ||
    label.toLowerCase().includes("social") ||
    label.toLowerCase().includes("stocktwits") ||
    label.toLowerCase().includes("youtube");

  const scoringMethodLabel =
    event.scoringMethod === "lexicon"
      ? "LEXICON"
      : event.scoringMethod === "finbert"
        ? "FINBERT"
        : event.scoringMethod === "neutral_fallback"
          ? "NEUTRAL"
          : null;

  const scoringBadgeStyle: React.CSSProperties | undefined =
    scoringMethodLabel === "LEXICON"
      ? {
          color: "#F59E0B",
          borderColor: "rgba(245,158,11,0.35)",
          backgroundColor: "rgba(245,158,11,0.08)",
        }
      : scoringMethodLabel === "FINBERT"
        ? {
            color: "#3B82F6",
            borderColor: "rgba(59,130,246,0.35)",
            backgroundColor: "rgba(59,130,246,0.08)",
          }
        : scoringMethodLabel === "NEUTRAL"
          ? {
              color: "#6B7280",
              borderColor: "rgba(107,114,128,0.35)",
              backgroundColor: "rgba(107,114,128,0.08)",
            }
          : undefined;

  return (
    <div className="flex items-center gap-1.5 mb-1">
      <span
        className={`text-[10px] uppercase tracking-[0.2em] font-medium ${
          isSocial ? "text-orange-400/70" : "text-slate-400"
        }`}
      >
        {label}
      </span>
      {SHOW_SCORING_METHOD && scoringMethodLabel && scoringBadgeStyle && (
        <span
          style={{
            ...scoringBadgeStyle,
            fontSize: "9px",
            fontWeight: 700,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            border: "1px solid",
            borderRadius: "3px",
            padding: "1px 5px",
            lineHeight: 1.4,
          }}
        >
          {scoringMethodLabel}
        </span>
      )}
    </div>
  );
}

interface HeadlineItemProps {
  event: DisplayEvent;
  extraSourceCount: number;
  isLatest?: boolean;
  isExpanded: boolean;
  onToggle: () => void;
  activeIndexFilter: string | null;
  onIndexPillClick: (relatedIndex: string) => void;
}

function HeadlineItem({
  event,
  extraSourceCount,
  isLatest,
  isExpanded,
  onToggle,
  activeIndexFilter,
  onIndexPillClick,
}: HeadlineItemProps) {
  const { label: sentimentLabel } = getSentimentDisplayLogic(
    event.sentimentScore,
  );
  const sentimentBg =
    sentimentLabel === "Bullish"
      ? "bg-green-400/10 border-green-400/20 text-green-400"
      : sentimentLabel === "Bearish"
        ? "bg-red-400/10 border-red-400/20 text-red-400"
        : "bg-white/[0.04] border-border text-gray-400";

  const pillIndex = event.relatedIndex ?? "";
  const isPillActive = activeIndexFilter === pillIndex;

  // Show pill for any God-Tier active index
  const showPill = pillIndex && ACTIVE_INDEXES.has(pillIndex);

  return (
    <div
      className={`border-b border-border last:border-b-0 transition-colors duration-200 ${
        isExpanded ? "bg-white/[0.04]" : isLatest ? "bg-primary/5" : ""
      }`}
    >
      <button
        type="button"
        onClick={onToggle}
        className={`w-full text-left px-3 py-3 cursor-pointer transition-colors duration-150 group ${
          isExpanded ? "bg-white/[0.03]" : "hover:bg-white/[0.03]"
        }`}
        aria-expanded={isExpanded}
      >
        {isLatest && !isExpanded && (
          <div className="flex items-center gap-1.5 mb-1.5">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
            <span className="text-primary text-[9px] uppercase tracking-widest font-semibold">
              Latest
            </span>
          </div>
        )}
        {/* Source tier dateline — always renders */}
        <div className="flex items-center justify-between">
          <SourceTierBadge event={event} />
          {/* Multi-source indicator pill — renders when 2+ sources carried same headline */}
          {extraSourceCount > 0 && (
            <span
              className="inline-flex items-center px-1.5 py-0.5 rounded-[3px] border border-border/50 bg-white/[0.04] text-[8px] font-semibold uppercase tracking-wider text-muted-foreground/60 mb-1 shrink-0"
              title={`${extraSourceCount + 1} sources carried this headline within 60 seconds`}
            >
              +{extraSourceCount} source{extraSourceCount > 1 ? "s" : ""}
            </span>
          )}
        </div>
        <p className="text-foreground/85 text-[11px] leading-relaxed font-medium mb-2 pr-4 relative overflow-hidden line-clamp-2 sm:line-clamp-none">
          {event.headline}
          <span className="absolute right-0 top-0 text-muted-foreground/50 group-hover:text-muted-foreground transition-colors">
            {isExpanded ? (
              <ChevronUp className="w-3 h-3" />
            ) : (
              <ChevronDown className="w-3 h-3" />
            )}
          </span>
        </p>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          {showPill ? (
            <RelatedIndexPill
              relatedIndex={pillIndex}
              isActive={isPillActive}
              onClick={onIndexPillClick}
            />
          ) : (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded-[3px] border border-white/10 bg-[#1f1f1f] text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/70">
              —
            </span>
          )}
          {event.inverseAffectedIndex !== undefined &&
            event.inverseImpact !== undefined && (
              <span
                className={`inline-flex items-center gap-0.5 px-1 py-0.5 rounded-[3px] border text-[7px] font-normal tracking-wide ${
                  event.inverseImpact < 0
                    ? "bg-red-950/60 border-red-800/50 text-red-400/80"
                    : "bg-green-950/60 border-green-800/50 text-green-400/80"
                }`}
                title={`Inverse signal: ${event.inverseImpact > 0 ? "+" : ""}${event.inverseImpact.toFixed(2)} pts applied to ${event.inverseAffectedIndex}`}
              >
                <span
                  className={
                    event.inverseImpact < 0
                      ? "text-red-400/80"
                      : "text-green-400/80"
                  }
                >
                  {event.inverseImpact > 0 ? "↑" : "↓"}
                </span>
                <span>
                  {INDEX_SHORT_NAMES[event.inverseAffectedIndex] ??
                    event.inverseAffectedIndex}
                </span>
                <sup className="text-[6px] font-semibold tracking-wider text-amber-400/80 uppercase ml-0.5">
                  INV
                </sup>
              </span>
            )}
          <div className="flex items-center gap-1">
            <SentimentIcon score={event.sentimentScore} />
            <SentimentBadge score={event.sentimentScore} />
          </div>
        </div>
      </button>

      <div
        className={`overflow-hidden transition-all duration-300 ease-in-out ${
          isExpanded ? "max-h-48 opacity-100" : "max-h-0 opacity-0"
        }`}
      >
        <div className="px-3 pb-3 pt-1 border-t border-border/50 bg-white/[0.02]">
          {isLatest && (
            <div className="flex items-center gap-1.5 mb-2">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
              <span className="text-primary text-[9px] uppercase tracking-widest font-semibold">
                Latest Event
              </span>
            </div>
          )}
          <p className="text-foreground/90 text-[11px] leading-relaxed mb-3">
            {event.headline}
          </p>
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-0.5">
              <span className="text-muted-foreground text-[9px] uppercase tracking-wider font-medium">
                Index
              </span>
              {showPill ? (
                <RelatedIndexPill
                  relatedIndex={pillIndex}
                  isActive={isPillActive}
                  onClick={onIndexPillClick}
                />
              ) : (
                <span className="inline-flex items-center px-1.5 py-0.5 rounded-[3px] border border-white/10 bg-[#1f1f1f] text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/70 self-start">
                  —
                </span>
              )}
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-muted-foreground text-[9px] uppercase tracking-wider font-medium">
                Sentiment
              </span>
              <div className="flex items-center gap-1">
                <SentimentIcon score={event.sentimentScore} size="md" />
                <SentimentBadge score={event.sentimentScore} large />
              </div>
            </div>
            <div className="flex flex-col gap-0.5 col-span-2">
              <span className="text-muted-foreground text-[9px] uppercase tracking-wider font-medium">
                Signal
              </span>
              <span
                className={`inline-flex items-center self-start px-1.5 py-0.5 rounded-[3px] border text-[9px] font-semibold uppercase tracking-wider ${sentimentBg}`}
              >
                {sentimentLabel} · Impact{" "}
                {formatSentimentScore(event.sentimentScore)} pts
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Pinned High-Impact Headline ─────────────────────────────────────────────

function computePinnedEntry(): DispatchedHeadlineEntry | null {
  const WINDOW_MS = 300_000; // ~10 ticks at 30s each
  const now = Date.now();

  let candidates = getAllDispatchedHeadlines(100).filter(
    (e) =>
      e.dispatchedAt >= now - WINDOW_MS && isActiveIndex(e.event.relatedIndex),
  );

  if (candidates.length < 3) {
    candidates = getAllDispatchedHeadlines(50).filter((e) =>
      isActiveIndex(e.event.relatedIndex),
    );
  }

  if (candidates.length === 0) return null;

  return candidates
    .slice()
    .sort(
      (a, b) =>
        Math.abs(b.event.sentimentScore) - Math.abs(a.event.sentimentScore),
    )[0];
}

interface PinnedHeadlinePanelProps {
  updateTick: number;
}

function PinnedHeadlinePanel({ updateTick: _tick }: PinnedHeadlinePanelProps) {
  void _tick;
  const pinned = computePinnedEntry();

  if (!pinned) return null;

  const { event } = pinned;
  const score = event.sentimentScore;
  const isPositive = score > 0;
  const isNegative = score < 0;

  const badgeBg = isNegative
    ? "bg-red-600 text-white"
    : isPositive
      ? "bg-green-700 text-white"
      : "bg-amber-600 text-white";

  const impactColor = isNegative
    ? "text-red-400"
    : isPositive
      ? "text-green-400"
      : "text-amber-400";

  const borderAccent = isNegative
    ? "border-l-red-500"
    : isPositive
      ? "border-l-green-500"
      : "border-l-amber-500";

  const cardBg = isNegative
    ? "bg-red-950/30"
    : isPositive
      ? "bg-green-950/30"
      : "bg-amber-950/20";

  const sourceTierLabel = getSourceLabel(event as DisplayEvent);
  const sourceTierColor =
    sourceTierLabel === "SOCIAL" ? "text-orange-400/70" : "text-slate-400";

  const shortName =
    INDEX_SHORT_NAMES[event.relatedIndex ?? ""] ?? event.relatedIndex ?? "—";

  const impactSign = isPositive ? "+" : "";
  const impactDisplay = `Impact ${impactSign}${score.toFixed(2)} pts`;

  return (
    <div
      className={`mx-3 my-2 rounded-md border-l-[3px] border border-border/40 ${borderAccent} ${cardBg} overflow-hidden shrink-0 w-full max-w-full`}
      data-ocid="feed-pinned-high-impact"
    >
      <div className="flex items-center justify-between px-2.5 pt-2 pb-1">
        <div className="flex items-center gap-1.5">
          <Zap className="w-3 h-3 text-amber-400 shrink-0" />
          <span
            className={`inline-flex items-center px-1.5 py-0.5 rounded-[3px] text-[9px] font-extrabold uppercase tracking-widest ${badgeBg}`}
          >
            HIGH IMPACT
          </span>
        </div>
        <span className="text-muted-foreground/50 text-[9px] font-medium whitespace-nowrap">
          Pinned · last 10 ticks
        </span>
      </div>

      <p className="px-2.5 pb-1.5 text-foreground text-[11px] font-semibold leading-relaxed">
        {event.headline}
      </p>

      <div className="flex items-center gap-2 px-2.5 pb-2 flex-wrap">
        <span className="inline-flex items-center px-1.5 py-0.5 rounded-[3px] border border-primary/25 bg-primary/10 text-[9px] font-semibold uppercase tracking-wider text-primary/80">
          {shortName}
        </span>

        <span
          className={`text-[9px] uppercase tracking-[0.15em] font-medium ${sourceTierColor}`}
        >
          {sourceTierLabel}
        </span>

        <span
          className={`font-mono text-[10px] font-bold tabular-nums ml-auto ${impactColor}`}
        >
          {impactDisplay}
        </span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

// ─── CSS-only Oracle pulse animation — injected once ────────────────────────
const ORACLE_PULSE_STYLE = `
@keyframes oracle-breathe {
  0%, 100% {
    opacity: 0.35;
    transform: scale(1);
    box-shadow: 0 0 0 0 rgba(var(--color-primary-rgb, 0, 200, 100), 0);
  }
  50% {
    opacity: 0.7;
    transform: scale(1.18);
    box-shadow: 0 0 0 8px rgba(var(--color-primary-rgb, 0, 200, 100), 0);
  }
}
@keyframes oracle-ring-pulse {
  0% {
    transform: scale(0.85);
    opacity: 0.6;
  }
  60% {
    transform: scale(1.35);
    opacity: 0;
  }
  100% {
    transform: scale(1.35);
    opacity: 0;
  }
}
`;

function OracleEmptyState() {
  return (
    <>
      <style>{ORACLE_PULSE_STYLE}</style>
      <div
        className="flex flex-col items-center justify-center px-6 py-12 text-center"
        data-ocid="feed.empty_state"
      >
        {/* Pulsing Oracle icon */}
        <div className="relative flex items-center justify-center mb-5">
          {/* Outer ring — slow expanding pulse */}
          <div
            className="absolute w-14 h-14 rounded-full border border-primary/20"
            style={{
              animation: "oracle-ring-pulse 2.4s ease-out infinite",
            }}
          />
          {/* Second ring — offset phase */}
          <div
            className="absolute w-14 h-14 rounded-full border border-primary/15"
            style={{
              animation: "oracle-ring-pulse 2.4s ease-out infinite 0.8s",
            }}
          />
          {/* Core icon container */}
          <div
            className="relative z-10 flex items-center justify-center w-10 h-10 rounded-full bg-primary/8 border border-primary/25"
            style={{
              animation: "oracle-breathe 2.4s ease-in-out infinite",
            }}
          >
            <Newspaper className="w-4 h-4 text-primary/60" />
          </div>
        </div>

        {/* Primary text */}
        <p className="text-foreground/70 text-[13px] font-semibold tracking-tight mb-1.5">
          Awaiting first Oracle signal
        </p>

        {/* Secondary text */}
        <p className="text-muted-foreground/50 text-[11px] leading-relaxed max-w-[200px]">
          The Oracle fires every 30 seconds. Your first headline is incoming.
        </p>

        {/* Live indicator */}
        <div className="flex items-center gap-1.5 mt-4">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary/60 animate-pulse" />
          <span className="text-primary/50 text-[9px] uppercase tracking-widest font-semibold">
            System live
          </span>
        </div>
      </div>
    </>
  );
}
// ─────────────────────────────────────────────────────────────────────────────

export function NewsFeedSidebar() {
  const { lastEvent } = useNewsEvent();
  // Store full DispatchedHeadlineEntry records so deduplication has access to
  // dispatchedAt timestamps. DisplayEvent mapping happens at render time only.
  const [rawEntries, setRawEntries] = useState<DispatchedHeadlineEntry[]>([]);
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  const [activeFilter, setActiveFilter] = useState<FeedCategoryFilter>("all");
  const [activeIndexFilter, setActiveIndexFilter] = useState<string | null>(
    null,
  );
  const [pinnedUpdateTick, setPinnedUpdateTick] = useState<number>(0);
  const prevLastEventRef = useRef<NewsEvent | null>(null);

  useEffect(() => {
    const handleNewDispatch = () => {
      const all = getAllDispatchedHeadlines(50)
        .map((e) => {
          // Fix 3 — forcedIndex fallback: if relatedIndex is missing or not in
          // the active set but the entry carries a forcedIndex that IS active,
          // promote forcedIndex → relatedIndex so the display filter passes it.
          // Only entries with a non-empty, active forcedIndex benefit — genuinely
          // unrouted headlines (no forcedIndex) are never passed through.
          const eventForcedIndex = (
            e.event as AuditableNewsEvent & { forcedIndex?: string }
          ).forcedIndex;
          if (
            !isActiveIndex(e.event.relatedIndex) &&
            eventForcedIndex &&
            isActiveIndex(eventForcedIndex)
          ) {
            return {
              ...e,
              event: { ...e.event, relatedIndex: eventForcedIndex },
            };
          }
          return e;
        })
        .filter((e) => isActiveIndex(e.event.relatedIndex));
      setRawEntries(all.slice(0, 50));
      setPinnedUpdateTick((t) => t + 1);
      setExpandedIndex((prev) => (prev !== null ? prev + 1 : null));
    };

    handleNewDispatch();
    const unsubscribe = subscribeToDispatchedHeadlines(handleNewDispatch);
    return unsubscribe;
  }, []);

  // Fallback path: if lastEvent arrives before the dispatch log subscription
  // fires, inject it directly so the feed never misses the very first event.
  useEffect(() => {
    if (lastEvent && lastEvent !== prevLastEventRef.current) {
      prevLastEventRef.current = lastEvent;
      if (!isActiveIndex(lastEvent.relatedIndex)) return;
      setPinnedUpdateTick((t) => t + 1);
      setExpandedIndex((prev) => (prev !== null ? prev + 1 : null));
    }
  }, [lastEvent]);

  // ── Category + index filter — applied to raw entries before dedup ─────────
  const categoryFilteredEntries =
    activeFilter === "all"
      ? rawEntries
      : rawEntries.filter(
          (e) =>
            INDEX_CATEGORY_MAP[e.event.relatedIndex ?? ""] === activeFilter,
        );

  const indexFilteredEntries = activeIndexFilter
    ? categoryFilteredEntries.filter(
        (e) => (e.event.relatedIndex ?? "") === activeIndexFilter,
      )
    : categoryFilteredEntries;

  // ── Render-time deduplication ─────────────────────────────────────────────
  const dedupedEvents = deduplicateEvents(indexFilteredEntries);

  const handleToggle = (index: number) => {
    setExpandedIndex((prev) => (prev === index ? null : index));
  };

  const handleFilterChange = (filter: FeedCategoryFilter) => {
    setActiveFilter(filter);
    setExpandedIndex(null);
    setActiveIndexFilter(null);
  };

  const handleIndexPillClick = useCallback((relatedIndex: string) => {
    setActiveIndexFilter((prev) =>
      prev === relatedIndex ? null : relatedIndex,
    );
    setExpandedIndex(null);

    if (isSpecificIndex(relatedIndex)) {
      const assetName = relatedIndexToAssetName(relatedIndex);
      setTimeout(() => {
        const el = document.querySelector<HTMLElement>(
          `[data-asset-name="${assetName}"]`,
        );
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
          el.style.transition = "box-shadow 0.3s ease";
          el.style.boxShadow = "0 0 0 1px oklch(0.72 0.18 145 / 0.5)";
          setTimeout(() => {
            el.style.boxShadow = "";
          }, 1500);
        }
      }, 100);
    }
  }, []);

  const clearIndexFilter = () => {
    setActiveIndexFilter(null);
    setExpandedIndex(null);
  };

  // True empty = no raw entries have arrived yet (first-load, pre-first-tick)
  const isTrueEmpty = rawEntries.length === 0;

  return (
    <aside className="flex flex-col h-full w-full lg:w-[280px] lg:shrink-0 bg-background border-l border-border/50 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-3 border-b border-border/50 shrink-0">
        <div className="flex items-center gap-2">
          <Newspaper className="w-3.5 h-3.5 text-primary/70 shrink-0" />
          <span className="text-foreground text-xs font-semibold uppercase tracking-widest">
            Oracle Feed
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
          <span className="text-primary text-[9px] uppercase tracking-widest font-semibold">
            Live
          </span>
        </div>
      </div>

      {activeIndexFilter && (
        <div className="flex items-center justify-between px-3 py-1.5 bg-primary/5 border-b border-primary/20 shrink-0">
          <span className="text-primary text-[10px] font-semibold uppercase tracking-wider">
            Filtered:{" "}
            {INDEX_SHORT_NAMES[activeIndexFilter] ?? activeIndexFilter}
          </span>
          <button
            type="button"
            onClick={clearIndexFilter}
            className="text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Clear index filter"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* Pinned high-impact headline — only show when events exist */}
      {!isTrueEmpty && <PinnedHeadlinePanel updateTick={pinnedUpdateTick} />}

      {/* Filter tabs — always visible so users understand the UI structure */}
      <div className="flex items-center gap-1 px-3 py-2 border-b border-border/50 shrink-0 overflow-x-auto">
        {FEED_CATEGORY_TABS.map((tab) => {
          const isActive = activeFilter === tab.value;
          return (
            <button
              type="button"
              key={tab.value}
              onClick={() => handleFilterChange(tab.value)}
              data-ocid={`feed.filter.${tab.value}`}
              className={`inline-flex items-center px-2 py-0.5 rounded-[3px] border text-[9px] font-semibold uppercase tracking-wider whitespace-nowrap transition-all duration-150 ${
                isActive
                  ? "bg-primary/15 border-primary/40 text-primary"
                  : "bg-transparent border-border/40 text-muted-foreground hover:border-border hover:text-foreground/70"
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      <ScrollArea className="flex-1 min-h-0">
        <div>
          {/* True empty state — no events have arrived yet */}
          {isTrueEmpty ? (
            <OracleEmptyState />
          ) : dedupedEvents.length === 0 ? (
            /* Filter-empty state — events exist but none match current filter */
            <div className="px-3 py-8 text-center" data-ocid="feed.empty_state">
              <div className="flex items-center justify-center gap-2 mb-2">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                <span className="text-primary text-[10px] uppercase tracking-widest font-semibold">
                  No signals for this filter
                </span>
              </div>
              <p className="text-muted-foreground/60 text-[10px] leading-relaxed">
                No headlines in this category yet. Switch to ALL to see all
                Oracle signals.
              </p>
            </div>
          ) : (
            dedupedEvents.map(({ event, extraSourceCount, stableKey }, idx) => (
              <HeadlineItem
                key={stableKey}
                event={event}
                extraSourceCount={extraSourceCount}
                isLatest={idx === 0}
                isExpanded={expandedIndex === idx}
                onToggle={() => handleToggle(idx)}
                activeIndexFilter={activeIndexFilter}
                onIndexPillClick={handleIndexPillClick}
              />
            ))
          )}
        </div>
      </ScrollArea>
    </aside>
  );
}
