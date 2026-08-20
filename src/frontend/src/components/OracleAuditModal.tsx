import {
  Activity,
  AlertTriangle,
  CheckCircle,
  Clock,
  Users,
  X,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import {
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useCrisisRegime } from "../contexts/CrisisRegimeContext";
import { FALLBACK_ASSET_DEFS } from "../data/fallbackAssets";
import { getDisplayName } from "../lib/oracle/indexCategoryRegistry";
import { calculateConfidenceScore } from "../services/confidenceScoreEngine";
import {
  getDispatchedHeadlinesForIndex,
  subscribeToDispatchedHeadlines,
} from "../services/dispatchedHeadlineLog";
import type { DispatchedHeadlineEntry } from "../services/dispatchedHeadlineLog";
import { getBeta } from "../services/gsiCovarianceEngine";
import type { AuditableNewsEvent } from "../services/mockHeadlineService";
import { getSyntheticAuditLogForIndex } from "../services/syntheticLiquidityEngine";
import type { SyntheticLiquidityAuditEntry } from "../services/syntheticLiquidityEngine";
import { getUnifiedLogForIndex } from "../services/unifiedOraclePipeline";
import type { UnifiedOracleLogEntry } from "../services/unifiedOraclePipeline";
import {
  formatSentimentScore,
  getSentimentDisplayLogic,
} from "../utils/sentimentUtils";
import { getCrisisHaltMessage } from "./AssetRow";

// ─── Source label helper ──────────────────────────────────────────────────────
const AUDIT_SOURCE_LABEL_MAP: Record<string, string> = {
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

const getAuditSourceLabel = (source: string): string => {
  if (!source?.trim()) return "NEWSWIRE";
  return (
    AUDIT_SOURCE_LABEL_MAP[source.toLowerCase().trim()] ?? source.toUpperCase()
  );
};
// ─────────────────────────────────────────────────────────────────────────────

interface OracleAuditModalProps {
  isOpen: boolean;
  onClose: () => void;
  indexName: string;
  currentScore: number;
}

interface FallthroughEntry {
  headline: string;
  indexName: string;
  source: string;
  tickId: number;
  timestamp: number;
  confidence: number;
  scoringMethod: string;
}

// ─── Circular Progress Bar ────────────────────────────────────────────────────
// Pure SVG — no external deps, no theme changes.
function ConfidenceRing({
  score,
  tier,
  dominantDirection,
}: {
  score: number;
  tier: "high" | "moderate" | "low";
  dominantDirection?: "positive" | "negative" | "mixed";
}) {
  const SIZE = 96;
  const STROKE = 7;
  const R = (SIZE - STROKE) / 2;
  const CIRCUMFERENCE = 2 * Math.PI * R;
  const progress = Math.min(100, Math.max(0, score));
  const dashOffset = CIRCUMFERENCE * (1 - progress / 100);

  const [animatedOffset, setAnimatedOffset] = useState(CIRCUMFERENCE);
  useEffect(() => {
    const id = requestAnimationFrame(() => setAnimatedOffset(dashOffset));
    return () => cancelAnimationFrame(id);
  }, [dashOffset]);

  // Derive color and label from tier + dominantDirection
  let color: string;
  let glowColor: string;
  let label: string;

  if (tier === "low") {
    color = "#f87171";
    glowColor = "rgba(248,113,113,0.35)";
    label = "LOW SIGNAL";
  } else if (tier === "high") {
    if (dominantDirection === "negative") {
      color = "#f87171";
      glowColor = "rgba(248,113,113,0.35)";
      label = "BEARISH CERTAINTY";
    } else if (dominantDirection === "mixed") {
      color = "#f59e0b";
      glowColor = "rgba(245,158,11,0.35)";
      label = "HIGH CERTAINTY";
    } else {
      // positive or undefined → green (current default behavior)
      color = "#4ade80";
      glowColor = "rgba(74,222,128,0.35)";
      label = "HIGH CERTAINTY";
    }
  } else {
    // moderate
    if (dominantDirection === "negative") {
      color = "#f87171";
      glowColor = "rgba(248,113,113,0.35)";
      label = "MODERATE BEARISH";
    } else if (dominantDirection === "mixed") {
      color = "#f59e0b";
      glowColor = "rgba(245,158,11,0.35)";
      label = "MODERATE CONFIDENCE";
    } else {
      // positive or undefined → green (current default behavior)
      color = "#4ade80";
      glowColor = "rgba(74,222,128,0.35)";
      label = "MODERATE CONFIDENCE";
    }
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "8px",
      }}
    >
      <div style={{ position: "relative", width: SIZE, height: SIZE }}>
        <svg
          width={SIZE}
          height={SIZE}
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          style={{ transform: "rotate(-90deg)" }}
          role="img"
          aria-label={`Confidence score: ${score}%`}
        >
          <title>Confidence score: {score}%</title>
          {/* Track ring */}
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={R}
            fill="none"
            stroke="rgba(255,255,255,0.07)"
            strokeWidth={STROKE}
          />
          {/* Progress arc */}
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={R}
            fill="none"
            stroke={color}
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={animatedOffset}
            style={{
              transition: "stroke-dashoffset 0.8s cubic-bezier(0.4,0,0.2,1)",
              filter: `drop-shadow(0 0 4px ${glowColor})`,
            }}
          />
        </svg>

        {/* Center label */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "1px",
          }}
        >
          <span
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontWeight: 800,
              fontSize: "1.35rem",
              color,
              lineHeight: 1,
              letterSpacing: "-0.02em",
            }}
          >
            {score}
          </span>
          <span
            style={{
              fontFamily: "'Inter', system-ui, sans-serif",
              fontSize: "0.6rem",
              color: "rgba(255,255,255,0.35)",
              fontWeight: 500,
              letterSpacing: "0.05em",
            }}
          >
            %
          </span>
        </div>
      </div>

      {/* Tier pill */}
      <span
        style={{
          fontSize: "0.6rem",
          fontWeight: 700,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color,
          background: `${color}18`,
          border: `1px solid ${color}40`,
          borderRadius: "999px",
          padding: "2px 10px",
        }}
      >
        {label}
      </span>
    </div>
  );
}

// ─── Impact Badge ─────────────────────────────────────────────────────────────
function ImpactBadge({ score }: { score: number }) {
  const display = getSentimentDisplayLogic(score);
  const formatted = score > 0 ? `+${score.toFixed(2)}` : score.toFixed(2);

  // Map color to bg/border rgba values
  const isBullish = score >= 0.5;
  const isBearish = score <= -0.5;
  const bgColor = isBullish
    ? "rgba(34,197,94,0.2)"
    : isBearish
      ? "rgba(239,68,68,0.2)"
      : "rgba(120,120,120,0.25)";
  const borderColor = isBullish
    ? "rgba(34,197,94,0.4)"
    : isBearish
      ? "rgba(239,68,68,0.4)"
      : "rgba(120,120,120,0.3)";

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "4px",
        padding: "4px 10px",
        borderRadius: "999px",
        fontSize: "0.75rem",
        fontWeight: 700,
        fontFamily: "'JetBrains Mono', monospace",
        letterSpacing: "0.04em",
        background: bgColor,
        color: display.color,
        border: `1px solid ${borderColor}`,
      }}
    >
      <span style={{ fontSize: "0.8rem", lineHeight: 1 }}>{display.icon}</span>
      {formatted}
    </span>
  );
}

// ─── QuantBadge ──────────────────────────────────────────────────────────────
// Renders a single monospace pill showing a labelled numeric value.
// Used in the Oracle Logic breakdown row: Base × Weight → Final
function QuantBadge({
  label,
  value,
  color,
  showSign = false,
}: {
  label: string;
  value: number;
  color: string;
  showSign?: boolean;
}) {
  const formatted = showSign
    ? `${value >= 0 ? "+" : ""}${value.toFixed(2)}`
    : value.toFixed(2);
  return (
    <span
      style={{
        display: "inline-flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "1px",
      }}
    >
      <span
        style={{
          fontSize: "0.55rem",
          textTransform: "uppercase",
          letterSpacing: "0.1em",
          color: "#475569",
          fontFamily: "'JetBrains Mono', monospace",
          fontWeight: 700,
          lineHeight: 1,
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: "0.75rem",
          fontFamily: "'JetBrains Mono', monospace",
          fontWeight: 700,
          color,
          background: `${color}15`,
          border: `1px solid ${color}30`,
          borderRadius: "4px",
          padding: "1px 6px",
          lineHeight: 1.4,
          minWidth: "42px",
          textAlign: "center",
        }}
      >
        {formatted}
      </span>
    </span>
  );
}

// ─── Dispatched Timeline Entry ────────────────────────────────────────────────
// Shows a headline from the dispatched log with a "consumed by tick" status badge.
function DispatchedTimelineEntry({
  entry,
  isLast,
}: {
  entry: DispatchedHeadlineEntry;
  isLast: boolean;
}) {
  const { event, dispatchedAt, consumedByTickId } = entry;
  const fallbackRationale =
    "Sentiment reflects current market dynamics and macroeconomic conditions for this index.";
  const dotColor = getSentimentDisplayLogic(event.sentimentScore).color;

  const dispatchTime = new Date(dispatchedAt).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  return (
    <div style={{ display: "flex", gap: "16px", position: "relative" }}>
      {/* Vertical connector */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          flexShrink: 0,
        }}
      >
        <div
          style={{
            width: "12px",
            height: "12px",
            borderRadius: "50%",
            marginTop: "4px",
            flexShrink: 0,
            background: dotColor,
            border: `2px solid ${dotColor}`,
            boxShadow: `0 0 6px ${dotColor}60`,
          }}
        />
        {!isLast && (
          <div
            style={{
              width: "1px",
              flex: 1,
              background: "rgba(255,255,255,0.1)",
              marginTop: "4px",
              minHeight: "32px",
            }}
          />
        )}
      </div>

      {/* Content */}
      <div style={{ paddingBottom: "24px", flex: 1, minWidth: 0 }}>
        {/* Top row: impact badge + dispatch time + consumed status */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: "8px",
            gap: "8px",
            flexWrap: "wrap",
          }}
        >
          <ImpactBadge score={event.sentimentScore} />
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <span
              style={{
                fontSize: "0.6rem",
                color: "#475569",
                fontFamily: "'JetBrains Mono', monospace",
              }}
            >
              {dispatchTime}
            </span>
            {consumedByTickId !== null ? (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "3px",
                  fontSize: "0.58rem",
                  fontWeight: 700,
                  color: "#4ade80",
                  background: "rgba(74,222,128,0.1)",
                  border: "1px solid rgba(74,222,128,0.25)",
                  borderRadius: "999px",
                  padding: "1px 6px",
                  fontFamily: "'JetBrains Mono', monospace",
                }}
              >
                <CheckCircle style={{ width: "8px", height: "8px" }} />
                Applied · Tick #{consumedByTickId}
              </span>
            ) : (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "3px",
                  fontSize: "0.58rem",
                  fontWeight: 700,
                  color: "#f59e0b",
                  background: "rgba(245,158,11,0.1)",
                  border: "1px solid rgba(245,158,11,0.25)",
                  borderRadius: "999px",
                  padding: "1px 6px",
                  fontFamily: "'JetBrains Mono', monospace",
                }}
              >
                <Clock style={{ width: "8px", height: "8px" }} />
                Pending
              </span>
            )}
          </div>
        </div>

        {/* Source label + classification badge row */}
        {(event.source || event.scoringMethod) && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              marginBottom: "4px",
              flexWrap: "wrap",
            }}
          >
            {event.source && (
              <span
                style={{
                  fontSize: "0.65rem",
                  fontWeight: 600,
                  color: "#86efac",
                  textTransform: "uppercase",
                  letterSpacing: "0.1em",
                }}
              >
                {getAuditSourceLabel(event.source)}
              </span>
            )}
            {event.scoringMethod &&
              (() => {
                const method = event.scoringMethod;
                const badgeStyle: CSSProperties =
                  method === "lexicon"
                    ? {
                        color: "#F59E0B",
                        background: "rgba(245,158,11,0.10)",
                        border: "1px solid rgba(245,158,11,0.30)",
                      }
                    : method === "finbert"
                      ? {
                          color: "#3B82F6",
                          background: "rgba(59,130,246,0.10)",
                          border: "1px solid rgba(59,130,246,0.30)",
                        }
                      : {
                          color: "#6B7280",
                          background: "rgba(107,114,128,0.10)",
                          border: "1px solid rgba(107,114,128,0.30)",
                        };
                const badgeLabel =
                  method === "lexicon"
                    ? "LEXICON"
                    : method === "finbert"
                      ? "FINBERT"
                      : "NEUTRAL";
                return (
                  <span
                    style={{
                      ...badgeStyle,
                      fontSize: "9px",
                      fontWeight: 700,
                      letterSpacing: "0.12em",
                      textTransform: "uppercase",
                      borderRadius: "3px",
                      padding: "1px 5px",
                      lineHeight: 1.4,
                    }}
                  >
                    {badgeLabel}
                  </span>
                );
              })()}
          </div>
        )}
        <p
          style={{
            fontSize: "0.875rem",
            fontWeight: 700,
            color: "#f1f5f9",
            lineHeight: 1.4,
            marginBottom: "6px",
          }}
        >
          {event.headline}
        </p>

        <div
          style={{
            borderLeft: "2px solid rgba(134,239,172,0.3)",
            paddingLeft: "10px",
          }}
        >
          {/* FinBERT confidence prose line */}
          <p
            style={{
              fontSize: "0.72rem",
              fontStyle: "italic",
              color: "#94a3b8",
              lineHeight: 1.5,
              marginBottom: event.baseImpact != null ? "8px" : "0",
            }}
          >
            <span
              style={{ color: "#86efac", fontStyle: "normal", fontWeight: 600 }}
            >
              Oracle Logic:{" "}
            </span>
            {(() => {
              const raw = event.rationale ?? fallbackRationale;
              // Remove formula decomposition: "Base: +X.XX × Tier: X.XX × Weight: X.XX → "
              // Keep everything before it and replace "Final:" with "Oracle Impact:"
              const stripped = raw
                .replace(
                  /\s*Base:\s*[+\-]?\d+\.?\d*\s*×\s*Tier:\s*\d+\.?\d*\s*×\s*Weight:\s*[+\-]?\d+\.?\d*\s*→\s*/g,
                  "",
                )
                .replace(/Final:/g, " Oracle Impact:");
              return stripped;
            })()}
          </p>

          {/* QuantBadge row — two-value pipeline: DIRECTIONAL FACTOR → IMPACT */}
          {event.baseImpact != null && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                flexWrap: "wrap",
              }}
            >
              <QuantBadge
                label="Directional Factor"
                value={
                  event.correlationWeight ??
                  (event.weight != null && event.weight <= 1
                    ? event.weight
                    : 1.0)
                }
                color="#f59e0b"
                showSign={(event.correlationWeight ?? event.weight ?? 1) < 0}
              />
              <span
                style={{
                  fontSize: "0.7rem",
                  color: "#475569",
                  fontFamily: "'JetBrains Mono', monospace",
                  fontWeight: 700,
                  lineHeight: 1,
                  userSelect: "none",
                }}
              >
                →
              </span>
              <QuantBadge
                label="Impact"
                value={event.sentimentScore}
                color={event.sentimentScore >= 0 ? "#4ade80" : "#f87171"}
                showSign={true}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Synthetic Liquidity Entry ────────────────────────────────────────────────
function SyntheticLiquidityEntry({
  entry,
  isLast,
}: {
  entry: SyntheticLiquidityAuditEntry;
  isLast: boolean;
}) {
  const impact = entry.reflexiveImpact;
  const isPositive = impact >= 0;
  const formattedImpact = `${isPositive ? "+" : ""}${impact.toFixed(2)}`;
  const pct = (entry.userAllocationRatio * 100).toFixed(1);

  return (
    <div style={{ display: "flex", gap: "16px", position: "relative" }}>
      {/* Vertical connector */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          flexShrink: 0,
        }}
      >
        <div
          style={{
            width: "12px",
            height: "12px",
            borderRadius: "50%",
            marginTop: "4px",
            flexShrink: 0,
            background: "#60a5fa",
            border: "2px solid #60a5fa",
            boxShadow: "0 0 6px rgba(96,165,250,0.5)",
          }}
        />
        {!isLast && (
          <div
            style={{
              width: "1px",
              flex: 1,
              background: "rgba(255,255,255,0.1)",
              marginTop: "4px",
              minHeight: "32px",
            }}
          />
        )}
      </div>

      {/* Content */}
      <div style={{ paddingBottom: "24px", flex: 1, minWidth: 0 }}>
        {/* Badge */}
        <div style={{ marginBottom: "8px" }}>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "5px",
              padding: "4px 10px",
              borderRadius: "999px",
              fontSize: "0.72rem",
              fontWeight: 700,
              fontFamily: "'JetBrains Mono', monospace",
              letterSpacing: "0.04em",
              background: "rgba(96,165,250,0.1)",
              color: "#60a5fa",
              border: "1px solid rgba(96,165,250,0.35)",
            }}
          >
            <Users style={{ width: "11px", height: "11px" }} />
            {formattedImpact}
          </span>
        </div>

        <p
          style={{
            fontSize: "0.875rem",
            fontWeight: 700,
            color: "#f1f5f9",
            lineHeight: 1.4,
            marginBottom: "6px",
          }}
        >
          <span style={{ color: "#93c5fd", fontWeight: 600 }}>
            Crowd Signal —{" "}
          </span>
          Synthetic Liquidity (Open Interest)
        </p>

        {/* Allocation ratio sub-line */}
        <p
          style={{
            fontSize: "0.72rem",
            color: "#60a5fa",
            fontFamily: "'JetBrains Mono', monospace",
            marginBottom: "6px",
          }}
        >
          Allocation share: {pct}% of platform capital
        </p>

        <div
          style={{
            borderLeft: "2px solid rgba(96,165,250,0.3)",
            paddingLeft: "10px",
          }}
        >
          <p
            style={{
              fontSize: "0.75rem",
              fontStyle: "italic",
              color: "#94a3b8",
              lineHeight: 1.6,
            }}
          >
            <span
              style={{ color: "#93c5fd", fontStyle: "normal", fontWeight: 600 }}
            >
              Oracle Logic:{" "}
            </span>
            {entry.rationale}
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Beta sensitivity tier helper ────────────────────────────────────────────
function getBetaSensitivityLabel(beta: number): string {
  if (beta >= 1.0) return "Sensitivity: High";
  if (beta >= 0.5) return "Sensitivity: Moderate";
  if (beta > 0) return "Sensitivity: Low";
  return "Sensitivity: Inverse";
}
// ─────────────────────────────────────────────────────────────────────────────

// ─── Extended tick entry type for display-layer Net Order Flow fields ─────────
// These optional fields are added to the log entry object at the display layer.
// The engine type (UnifiedOracleLogEntry) is not modified.
interface ExtendedTickEntry extends UnifiedOracleLogEntry {
  netOrderFlowDelta?: number;
  concentration?: number;
}
// ─────────────────────────────────────────────────────────────────────────────

// ─── Index Short Codes ────────────────────────────────────────────────────────
const INDEX_SHORT_CODES: Record<string, string> = {
  "Traditionalism Sentiment Index": "TRAD VALUES",
  "Progressivism Sentiment Index": "PROG VALUES",
  "Fed Policy Sentiment": "FED POLICY",
  "MENA Stability Sentiment": "MENA",
  "AI Regulation Risk Sentiment": "AI & TECH",
};

// ─── Display Names are sourced from indexCategoryRegistry.ts (getDisplayName). ─

// ─── Pipeline step definition for ranked breakdown ───────────────────────────
interface PipelineStep {
  symbol: string;
  label: string;
  delta: number;
}

function getPipelineSteps(entry: ExtendedTickEntry): PipelineStep[] {
  const steps: PipelineStep[] = [
    { symbol: "①", label: "Mean Reversion", delta: entry.thetaAdjustment },
    { symbol: "②", label: "Oracle News", delta: entry.rawNewsImpact },
    { symbol: "③", label: "Global Pulse", delta: entry.tidalDelta },
    { symbol: "④", label: "Open Interest", delta: entry.liquidityPremium },
    {
      symbol: "⚡",
      label: "Stream #4",
      delta: entry.preemptionFired ? (entry.preemptionAdjustment ?? 0) : 0,
    },
    {
      symbol: "⇄",
      label: "Inverse Signal",
      delta:
        entry.inverseAffectedIndex && entry.inverseImpact !== undefined
          ? entry.inverseImpact
          : 0,
    },
  ];
  return steps;
}

function getTopContributor(steps: PipelineStep[]): PipelineStep | null {
  let top: PipelineStep | null = null;
  for (const step of steps) {
    if (top === null || Math.abs(step.delta) > Math.abs(top.delta)) {
      top = step;
    }
  }
  return top && Math.abs(top.delta) > 0.0001 ? top : null;
}

// ─── Unified Tick Entry ───────────────────────────────────────────────────────
function UnifiedTickEntry({
  entry,
  isLast,
  isHighlighted,
  entryRef,
}: {
  entry: ExtendedTickEntry;
  isLast: boolean;
  isHighlighted?: boolean;
  entryRef?: (el: HTMLDivElement | null) => void;
}) {
  const time = new Date(entry.timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  // Dot color: green when a headline fired (news-driven), gray otherwise
  const dotColor = entry.headlineUsed ? "#86efac" : "#475569";

  const finalDelta =
    entry.finalScore - entry.previousScore + (entry.inverseImpact ?? 0);
  const finalDeltaFormatted =
    finalDelta > 0
      ? `+${finalDelta.toFixed(2)}`
      : finalDelta < 0
        ? finalDelta.toFixed(2)
        : "0.00";
  const finalDeltaColor =
    finalDelta > 0 ? "#4ade80" : finalDelta < 0 ? "#f87171" : "#6b7280";

  /** Returns the inline color for a signed numeric delta */
  const deltaColor = (v: number) =>
    v > 0 ? "#4ade80" : v < 0 ? "#f87171" : "#6b7280";

  /** Formats a signed numeric delta with explicit + */
  const fmt = (v: number, decimals = 3) =>
    v > 0
      ? `+${v.toFixed(decimals)}`
      : v < 0
        ? v.toFixed(decimals)
        : `+0.${"0".repeat(decimals)}`;

  return (
    <div
      ref={entryRef}
      data-tick-entry="true"
      style={{
        display: "flex",
        gap: "14px",
        position: "relative",
        borderRadius: "8px",
        padding: isHighlighted ? "4px 8px 4px 4px" : "0",
        marginBottom: isHighlighted ? "0" : "0",
        transition: "background 0.3s ease, border-color 0.3s ease",
        background: isHighlighted ? "rgba(34,197,94,0.06)" : "transparent",
        border: isHighlighted
          ? "1px solid rgba(34,197,94,0.35)"
          : "1px solid transparent",
      }}
    >
      {/* Dot + connector */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          flexShrink: 0,
        }}
      >
        <div
          style={{
            width: "10px",
            height: "10px",
            borderRadius: "50%",
            marginTop: "4px",
            flexShrink: 0,
            background: dotColor,
            border: `2px solid ${dotColor}`,
            boxShadow: `0 0 5px ${dotColor}60`,
          }}
        />
        {!isLast && (
          <div
            style={{
              width: "1px",
              flex: 1,
              background: "rgba(255,255,255,0.08)",
              marginTop: "4px",
              minHeight: "28px",
            }}
          />
        )}
      </div>

      {/* Content */}
      <div style={{ paddingBottom: "20px", flex: 1, minWidth: 0 }}>
        {/* Header row: velocity badge (if boosted) + timestamp */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            gap: "6px",
            marginBottom: "6px",
          }}
        >
          {/* Velocity boost badge — only renders when velocityMultiplier > 1.0 */}
          {(entry.velocityMultiplier ?? 1.0) > 1.0 &&
            (() => {
              const vm = entry.velocityMultiplier ?? 1.0;
              const isAmber = vm <= 1.3;
              return (
                <span
                  style={{
                    fontSize: "9px",
                    fontWeight: 700,
                    letterSpacing: "0.10em",
                    textTransform: "uppercase",
                    borderRadius: "3px",
                    padding: "1px 5px",
                    lineHeight: 1.4,
                    fontFamily: "'JetBrains Mono', monospace",
                    color: isAmber ? "#F59E0B" : "#FF6B35",
                    background: isAmber
                      ? "rgba(146,64,14,0.35)"
                      : "rgba(124,45,18,0.35)",
                    border: isAmber
                      ? "1px solid rgba(245,158,11,0.35)"
                      : "1px solid rgba(255,107,53,0.35)",
                  }}
                >
                  {(() => {
                    const multiplierLabel = isAmber ? "1.3×" : "1.5×";
                    const count = entry.headlineUsed?.headlineCount;
                    const countSuffix =
                      count && count > 0
                        ? ` (${count} ${count === 1 ? "headline" : "headlines"})`
                        : "";
                    return `⚡ ${multiplierLabel} Velocity${countSuffix}`;
                  })()}
                </span>
              );
            })()}
          <span
            style={{
              fontSize: "0.65rem",
              color: "#475569",
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            {time}
          </span>
        </div>

        {/* Pipeline breakdown — compact grid */}
        <div
          className="flex-col sm:flex-row px-[10px] py-[8px] sm:px-[12px] sm:py-[10px]"
          style={{
            background: "#000000",
            border: "1px solid #2a2a2a",
            borderRadius: "8px",
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: "0.68rem",
          }}
        >
          {/* Step 1: Mean Reversion (was Theta) */}
          <div
            className="flex flex-col sm:flex-row sm:justify-between"
            style={{
              marginBottom: "4px",
            }}
          >
            <span style={{ color: "#64748b" }}>
              ① Mean Reversion (Δt={entry.deltaHours.toFixed(3)}h{entry.revertTarget !== undefined ? `, target=${entry.revertTarget}` : ""})
            </span>
            <span style={{ color: deltaColor(entry.thetaAdjustment) }}>
              {fmt(entry.thetaAdjustment)} → {entry.decayedScore.toFixed(2)}
            </span>
          </div>

          {/* Step 2: Oracle News (was News Impact) */}
          <div
            className="flex flex-col sm:flex-row sm:justify-between"
            style={{
              marginBottom: "4px",
            }}
          >
            <span style={{ color: "#64748b" }}>
              ② Oracle News
              {entry.headlineUsed
                ? ` (${getAuditSourceLabel(entry.headlineUsed.source ?? "")})`
                : " (none)"}
            </span>
            <span
              style={{
                color: getSentimentDisplayLogic(entry.rawNewsImpact).color,
              }}
            >
              {getSentimentDisplayLogic(entry.rawNewsImpact).icon}{" "}
              {formatSentimentScore(entry.rawNewsImpact)} →{" "}
              {entry.postNewsScore.toFixed(2)}
            </span>
          </div>

          {/* Step 3: Global Pulse (was Tidal) */}
          <div
            className="flex flex-col sm:flex-row sm:justify-between"
            style={{
              marginBottom: "4px",
            }}
          >
            <span style={{ color: "#64748b" }}>
              ③ Global Pulse ({getBetaSensitivityLabel(entry.betaValue)}, ΔGSI=
              {entry.gsiChange >= 0 ? "+" : ""}
              {entry.gsiChange.toFixed(2)})
            </span>
            <span style={{ color: deltaColor(entry.tidalDelta) }}>
              {fmt(entry.tidalDelta)} → {entry.postTidalScore.toFixed(2)}
            </span>
          </div>

          {/* Step 4: Open Interest (was Liquidity) */}
          <div
            className="flex flex-col sm:flex-row sm:justify-between"
            style={{
              borderTop: "1px solid rgba(255,255,255,0.06)",
              paddingTop: "4px",
              marginTop: "2px",
            }}
          >
            <span style={{ color: "#64748b" }}>
              ④ Open Interest ({(entry.allocationRatio * 100).toFixed(1)}% platform alloc)
            </span>
            <span style={{ color: deltaColor(entry.liquidityPremium) }}>
              {fmt(entry.liquidityPremium)} →{" "}
              <span style={{ color: "#f1f5f9", fontWeight: 700 }}>
                {entry.finalScore.toFixed(2)}
              </span>
            </span>
          </div>

          {/* Step 5: Net Order Flow — always renders */}
          <div
            className="flex flex-col sm:flex-row sm:justify-between"
            style={{
              borderTop: "1px solid rgba(255,255,255,0.06)",
              paddingTop: "4px",
              marginTop: "2px",
            }}
          >
            <span style={{ color: "#64748b" }}>
              ⑤ Net Order Flow ({((entry.concentration ?? 0) * 100).toFixed(1)}%
              concentration)
            </span>
            <span style={{ color: deltaColor(entry.netOrderFlowDelta ?? 0) }}>
              {fmt(entry.netOrderFlowDelta ?? 0)} →{" "}
              <span style={{ color: "#f1f5f9", fontWeight: 700 }}>
                {entry.finalScore.toFixed(2)}
              </span>
            </span>
          </div>

          {/* Step 4b: Stream #4 Pre-emption (only renders when triggered) */}
          {entry.preemptionFired && (
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                borderTop: "1px solid rgba(255,255,255,0.06)",
                paddingTop: "4px",
                marginTop: "2px",
              }}
            >
              <span style={{ color: "#64748b" }}>
                ⚡ Stream #4{" "}
                <span
                  style={{
                    color: entry.preemptionConfirmed ? "#4ade80" : "#fbbf24",
                    fontSize: "0.6rem",
                  }}
                >
                  {entry.preemptionConfirmed ? "CONFIRMED" : "UNCONFIRMED"}
                </span>
              </span>
              <span
                style={{
                  color:
                    (entry.preemptionAdjustment ?? 0) >= 0
                      ? "#4ade80"
                      : "#f87171",
                  fontWeight: 700,
                }}
              >
                {(entry.preemptionAdjustment ?? 0) >= 0 ? "+" : ""}
                {(entry.preemptionAdjustment ?? 0).toFixed(2)} PRE-EMPTION
              </span>
            </div>
          )}

          {/* Step 5: Inverse Signal (only renders when an inverse adjustment fired) */}
          {entry.inverseAffectedIndex &&
            entry.inverseImpact !== undefined &&
            entry.inverseImpact !== 0 && (
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  borderTop: "1px solid rgba(255,255,255,0.06)",
                  paddingTop: "4px",
                  marginTop: "2px",
                }}
              >
                <span style={{ color: "#64748b" }}>
                  ⇄ Inverse Signal →{" "}
                  <span style={{ color: "#94a3b8" }}>
                    {INDEX_SHORT_CODES[entry.inverseAffectedIndex] ??
                      entry.inverseAffectedIndex}
                  </span>
                </span>
                <span
                  style={{
                    color: deltaColor(entry.inverseImpact),
                    fontWeight: 700,
                  }}
                >
                  {fmt(entry.inverseImpact, 2)}
                </span>
              </div>
            )}

          {/* TOP CONTRIBUTOR */}
          {(() => {
            const steps = getPipelineSteps(entry);
            const top = getTopContributor(steps);
            return (
              <div
                style={{
                  borderTop: "1px solid rgba(255,255,255,0.06)",
                  marginTop: "6px",
                  paddingTop: "6px",
                }}
              >
                {/* TOP CONTRIBUTOR row */}
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    width: "100%",
                    padding: "2px 0",
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: "0.68rem",
                  }}
                >
                  <span
                    style={{
                      color: "#475569",
                      fontWeight: 700,
                      letterSpacing: "0.04em",
                    }}
                  >
                    TOP CONTRIBUTOR
                  </span>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "6px",
                    }}
                  >
                    {top ? (
                      <span style={{ color: "#94a3b8" }}>
                        <span style={{ color: "#64748b" }}>
                          {top.symbol} {top.label}
                        </span>
                        {"  "}
                        <span
                          style={{
                            color: deltaColor(top.delta),
                            fontWeight: 700,
                          }}
                        >
                          {fmt(top.delta, 2)}
                        </span>
                      </span>
                    ) : (
                      <span style={{ color: "#475569", fontStyle: "italic" }}>
                        None this tick
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })()}
        </div>

        {/* Net delta summary — bold red/green */}
        <div
          style={{
            marginTop: "6px",
            display: "flex",
            alignItems: "center",
            gap: "6px",
            fontSize: "0.65rem",
            color: "#475569",
            fontFamily: "'JetBrains Mono', monospace",
          }}
        >
          <span>Net Δ:</span>
          <span
            style={{
              color: finalDeltaColor,
              fontWeight: 800,
              fontSize: "0.72rem",
            }}
          >
            {finalDeltaFormatted}
          </span>
          <span>
            ({entry.previousScore.toFixed(2)} → {entry.finalScore.toFixed(2)})
          </span>
        </div>

        {/* Headline snippet when a news event fired this tick */}
        {entry.headlineUsed && (
          <p
            style={{
              marginTop: "6px",
              fontSize: "0.68rem",
              color: "#94a3b8",
              fontStyle: "italic",
              lineHeight: 1.5,
              fontFamily: "'Inter', system-ui, sans-serif",
              borderLeft: "2px solid rgba(134,239,172,0.25)",
              paddingLeft: "8px",
            }}
          >
            {entry.headlineUsed.headline}
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Contributor color map ────────────────────────────────────────────────────
const CONTRIBUTOR_LEGEND = [
  { label: "Mean Reversion", color: "#22c55e" },
  { label: "Oracle News", color: "#ef4444" },
  { label: "Global Pulse", color: "#f59e0b" },
  { label: "Open Interest", color: "#8b5cf6" },
  { label: "Net Order Flow", color: "#3b82f6" },
];

// ─── Contributor Radar Chart ──────────────────────────────────────────────────

// Ordered axes — must match the 5 pipeline contributors
const RADAR_AXES = [
  {
    contributor: "Mean Reversion",
    color: "#22c55e",
    extractor: (e: ExtendedTickEntry) => e.thetaAdjustment ?? 0,
  },
  {
    contributor: "Oracle News",
    color: "#ef4444",
    extractor: (e: ExtendedTickEntry) => e.rawNewsImpact ?? 0,
  },
  {
    contributor: "Global Pulse",
    color: "#f59e0b",
    extractor: (e: ExtendedTickEntry) => e.tidalDelta ?? 0,
  },
  {
    contributor: "Open Interest",
    color: "#8b5cf6",
    extractor: (e: ExtendedTickEntry) => e.liquidityPremium ?? 0,
  },
  {
    contributor: "Net Order Flow",
    color: "#3b82f6",
    extractor: (e: ExtendedTickEntry) => e.netOrderFlowDelta ?? 0,
  },
] as const;

const N_AXES = RADAR_AXES.length; // 5

/** Convert polar (angle in radians, radius) to cartesian, centered at (cx, cy) */
function polarToCartesian(
  cx: number,
  cy: number,
  r: number,
  angleRad: number,
): [number, number] {
  return [cx + r * Math.cos(angleRad), cy + r * Math.sin(angleRad)];
}

/** Build an annular wedge SVG path between two radii and two angles */
function buildWedgePath(
  cx: number,
  cy: number,
  innerR: number,
  outerR: number,
  startAngle: number,
  endAngle: number,
): string {
  const [x1, y1] = polarToCartesian(cx, cy, outerR, startAngle);
  const [x2, y2] = polarToCartesian(cx, cy, outerR, endAngle);
  const [x3, y3] = polarToCartesian(cx, cy, innerR, endAngle);
  const [x4, y4] = polarToCartesian(cx, cy, innerR, startAngle);
  const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;
  return [
    `M ${x1} ${y1}`,
    `A ${outerR} ${outerR} 0 ${largeArc} 1 ${x2} ${y2}`,
    `L ${x3} ${y3}`,
    `A ${innerR} ${innerR} 0 ${largeArc} 0 ${x4} ${y4}`,
    "Z",
  ].join(" ");
}

interface RadarTickData {
  contributor: string;
  color: string;
  value: number; // 0–100, normalised within this tick
  rawAbs: number; // absolute |delta|
  rawSigned: number; // signed delta for display
}

function computeRadarValues(entry: ExtendedTickEntry): RadarTickData[] {
  const raws = RADAR_AXES.map((ax) => ({
    contributor: ax.contributor,
    color: ax.color,
    rawSigned: ax.extractor(entry),
    rawAbs: Math.abs(ax.extractor(entry)),
  }));
  const maxAbs = Math.max(...raws.map((r) => r.rawAbs), 0.0001);
  return raws.map((r) => ({ ...r, value: (r.rawAbs / maxAbs) * 100 }));
}

function computeRadarAvgValues(entries: ExtendedTickEntry[]): RadarTickData[] {
  if (entries.length === 0) {
    return RADAR_AXES.map((ax) => ({
      contributor: ax.contributor,
      color: ax.color,
      value: 0,
      rawAbs: 0,
      rawSigned: 0,
    }));
  }
  const avgs = RADAR_AXES.map((ax) => {
    const sum = entries.reduce((acc, e) => acc + Math.abs(ax.extractor(e)), 0);
    const sumSigned = entries.reduce((acc, e) => acc + ax.extractor(e), 0);
    return {
      contributor: ax.contributor,
      color: ax.color,
      rawAbs: sum / entries.length,
      rawSigned: sumSigned / entries.length,
    };
  });
  const maxAbs = Math.max(...avgs.map((a) => a.rawAbs), 0.0001);
  return avgs.map((a) => ({ ...a, value: (a.rawAbs / maxAbs) * 100 }));
}

// ─── Pure SVG radar spider chart ─────────────────────────────────────────────
function RadarSpider({
  data,
  width = 260,
  height = 220,
}: {
  data: RadarTickData[];
  width?: number;
  height?: number;
}) {
  const cx = width / 2;
  const cy = height / 2;
  // Leave margin for labels
  const maxR = Math.min(cx, cy) - 32;

  // Angles: start at top (−π/2), evenly spaced clockwise
  const angles = RADAR_AXES.map(
    (_, i) => -Math.PI / 2 + (2 * Math.PI * i) / N_AXES,
  );

  // Grid rings at 25%, 50%, 75%, 100%
  const gridLevels = [0.25, 0.5, 0.75, 1.0];

  // Build grid ring paths (inline polygon builder — buildPolygonPath removed with wedge refactor)
  const gridPaths = gridLevels.map((lvl) => {
    const pts = angles.map((a) => polarToCartesian(cx, cy, maxR * lvl, a));
    return pts
      .map(
        (p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(2)},${p[1].toFixed(2)}`,
      )
      .join(" ")
      .concat(" Z");
  });

  // Axis endpoints (at 100%)
  const axisEndpoints = angles.map((a) => polarToCartesian(cx, cy, maxR, a));

  // Wedge segments — one annular wedge per axis
  const GAP_ANGLE = 0.04;
  const wedges = data.map((d, i) => {
    const startAngle = angles[i] + GAP_ANGLE;
    const endAngle = angles[(i + 1) % N_AXES] - GAP_ANGLE;
    const outerR = Math.max(8, Math.min(maxR - 2, maxR * (d.value / 100)));
    const gridLevels = [0.25, 0.5, 0.75, 1.0];
    const gridRadii = gridLevels.map((l) => (maxR - 2) * l);
    const snappedR = gridRadii.reduce((prev, curr) =>
      Math.abs(curr - outerR) < Math.abs(prev - outerR) ? curr : prev,
    );
    const finalOuterR = Math.max(8, snappedR);
    const innerR = 4;
    return {
      path: buildWedgePath(cx, cy, innerR, finalOuterR, startAngle, endAngle),
      color: d.color,
      value: d.value,
    };
  });

  // Label positions — shifted to midpoint angle between vertices, pushed further out
  // Explicit per-axis anchors based on final label angles after midAngle shift:
  // axis 0 Mean Reversion (-54°) → start
  // axis 1 Oracle News (18°) → start
  // axis 2 Global Pulse (54°) → middle
  // axis 3 Open Interest (90°) → end
  // axis 4 Net Order Flow (126°) → end
  const anchors: Array<"start" | "middle" | "end"> = [
    "start",
    "start",
    "middle",
    "end",
    "end",
  ];
  const labelPositions = angles.map((a, i) => {
    const midAngle = a + Math.PI / 5;
    const [lx, ly] = polarToCartesian(cx, cy, maxR + 16, midAngle);
    // Wrap long labels onto two lines
    const words = RADAR_AXES[i].contributor.split(" ");
    return {
      x: lx,
      y: ly,
      anchor: anchors[i],
      words,
      color: RADAR_AXES[i].color,
    };
  });

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{ overflow: "visible" }}
      aria-label="Contributor radar chart"
      role="img"
    >
      <title>Contributor radar chart showing 5 pipeline component values</title>

      {/* Grid rings */}
      {gridPaths.map((d, i) => (
        <path
          key={`grid-${gridLevels[i]}`}
          d={d}
          fill="none"
          stroke="rgba(255,255,255,0.15)"
          strokeWidth={1}
          strokeDasharray={i === 3 ? "none" : "3 3"}
        />
      ))}

      {/* Axis lines from center to edge */}
      {axisEndpoints.map(([ex, ey], i) => (
        <line
          key={`axis-${RADAR_AXES[i].contributor}`}
          x1={cx}
          y1={cy}
          x2={ex}
          y2={ey}
          stroke="rgba(255,255,255,0.18)"
          strokeWidth={1}
        />
      ))}

      {/* Wedge segments */}
      {wedges.map((w) => (
        <path
          key={w.color}
          d={w.path}
          fill={w.color}
          fillOpacity={0.75}
          stroke={w.color}
          strokeWidth={1.5}
          strokeOpacity={1}
          strokeLinejoin="round"
          style={{ transition: "d 0.35s cubic-bezier(0.4,0,0.2,1)" }}
        />
      ))}

      {/* Axis labels */}
      {labelPositions.map((lp, i) => {
        const lineH = 11;
        const totalH = lp.words.length * lineH;
        const startY = lp.y - (totalH - lineH) / 2;
        return (
          <g key={`label-${RADAR_AXES[i].contributor}`}>
            {lp.words.map((word, wi) => (
              <text
                key={`${RADAR_AXES[i].contributor}-word-${wi}`}
                x={lp.x}
                y={startY + wi * lineH}
                textAnchor={lp.anchor}
                dominantBaseline="central"
                fill={lp.color}
                fontSize={8.5}
                fontFamily="'Inter', system-ui, sans-serif"
                fontWeight={600}
                letterSpacing="0.03em"
              >
                {word}
              </text>
            ))}
          </g>
        );
      })}
    </svg>
  );
}

// ─── Main chart wrapper with click-to-open detail card ───────────────────────
type RadarViewMode = "single" | "averaged";

function SentimentLineChart({
  tickEntries,
}: {
  indexName: string;
  tickEntries: ExtendedTickEntry[];
  selectedTickIndex: number | null;
  onSelectTick: (chartDataIndex: number, tickLogIndex: number | null) => void;
}) {
  const [viewMode, setViewMode] = useState<RadarViewMode>("single");
  // Index into tickEntries for single-tick navigation (0 = most recent)
  const [singleTickIdx, setSingleTickIdx] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const hasData = tickEntries.length > 0;

  // Clamp singleTickIdx when entries change
  const clampedIdx = Math.min(
    singleTickIdx,
    Math.max(0, tickEntries.length - 1),
  );

  // Per-tick radar values for currently selected tick
  const selectedEntry = tickEntries[clampedIdx] ?? null;
  const singleTickData = useMemo(
    () => (selectedEntry ? computeRadarValues(selectedEntry) : null),
    [selectedEntry],
  );

  // Average across all ticks
  const avgData = useMemo(
    () => computeRadarAvgValues(tickEntries),
    [tickEntries],
  );

  // Which data set to render in the spider
  const displayData =
    viewMode === "single" && singleTickData ? singleTickData : avgData;

  // Reset tick index when mode switches
  const handleSetMode = useCallback((mode: RadarViewMode) => {
    setViewMode(mode);
    setSingleTickIdx(0);
  }, []);

  // Prev / Next navigation in single-tick mode
  const canGoPrev = clampedIdx < tickEntries.length - 1;
  const canGoNext = clampedIdx > 0;

  const handlePrev = useCallback(() => {
    setSingleTickIdx((i) => Math.min(i + 1, tickEntries.length - 1));
  }, [tickEntries.length]);

  const handleNext = useCallback(() => {
    setSingleTickIdx((i) => Math.max(i - 1, 0));
  }, []);

  // Hint label
  const hintLabel = (() => {
    if (!hasData) return null;
    if (viewMode === "single" && selectedEntry) {
      return `Tick #${selectedEntry.tickId} · ${clampedIdx === 0 ? "latest" : `${clampedIdx + 1} of ${tickEntries.length}`}`;
    }
    return `Avg across ${tickEntries.length} tick${tickEntries.length !== 1 ? "s" : ""}`;
  })();

  return (
    <div style={{ marginBottom: "16px" }}>
      {/* ── Mode toggle pill ── */}
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          marginBottom: "10px",
        }}
      >
        <div
          style={{
            display: "inline-flex",
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.10)",
            borderRadius: "999px",
            padding: "2px",
            gap: "2px",
          }}
        >
          {(["single", "averaged"] as RadarViewMode[]).map((mode) => {
            const active = viewMode === mode;
            return (
              <button
                key={mode}
                type="button"
                data-ocid={`radar_chart.${mode}_mode.tab`}
                onClick={() => handleSetMode(mode)}
                style={{
                  padding: "4px 14px",
                  borderRadius: "999px",
                  border: active
                    ? "1px solid rgba(74,222,128,0.35)"
                    : "1px solid transparent",
                  cursor: "pointer",
                  fontSize: "0.6rem",
                  fontWeight: 700,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  fontFamily: "'Inter', system-ui, sans-serif",
                  transition:
                    "background 0.2s ease, color 0.2s ease, border-color 0.2s ease",
                  background: active ? "rgba(74,222,128,0.12)" : "transparent",
                  color: active ? "#4ade80" : "rgba(74,222,128,0.4)",
                  boxShadow: active ? "0 1px 6px rgba(74,222,128,0.2)" : "none",
                }}
              >
                {mode === "single" ? "Single Tick" : "Averaged"}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Navigation row (single-tick mode only) ── */}
      {viewMode === "single" && hasData && tickEntries.length > 1 && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "10px",
            marginBottom: "6px",
          }}
        >
          <button
            type="button"
            data-ocid="radar_chart.prev_tick.button"
            aria-label="Previous tick"
            disabled={!canGoPrev}
            onClick={handlePrev}
            style={{
              width: "24px",
              height: "24px",
              borderRadius: "50%",
              border: "1px solid rgba(255,255,255,0.13)",
              background: canGoPrev ? "rgba(255,255,255,0.06)" : "transparent",
              color: canGoPrev ? "#94a3b8" : "#2d3748",
              cursor: canGoPrev ? "pointer" : "default",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "0.7rem",
              lineHeight: 1,
              transition: "background 0.15s, color 0.15s",
              padding: 0,
            }}
          >
            ‹
          </button>
          <span
            style={{
              fontSize: "0.6rem",
              color: "#475569",
              fontFamily: "'JetBrains Mono', monospace",
              letterSpacing: "0.06em",
              minWidth: "80px",
              textAlign: "center",
            }}
          >
            {selectedEntry ? `Tick #${selectedEntry.tickId}` : "—"}
          </span>
          <button
            type="button"
            data-ocid="radar_chart.next_tick.button"
            aria-label="Next tick"
            disabled={!canGoNext}
            onClick={handleNext}
            style={{
              width: "24px",
              height: "24px",
              borderRadius: "50%",
              border: "1px solid rgba(255,255,255,0.13)",
              background: canGoNext ? "rgba(255,255,255,0.06)" : "transparent",
              color: canGoNext ? "#94a3b8" : "#2d3748",
              cursor: canGoNext ? "pointer" : "default",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "0.7rem",
              lineHeight: 1,
              transition: "background 0.15s, color 0.15s",
              padding: 0,
            }}
          >
            ›
          </button>
        </div>
      )}

      {/* Chart area */}
      <div
        ref={containerRef}
        style={{
          width: "100%",
          height: 220,
          position: "relative",
        }}
      >
        <div
          data-ocid="radar_chart.canvas_target"
          aria-label={
            viewMode === "single"
              ? "Selected tick breakdown"
              : "Averaged breakdown"
          }
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            background: "none",
            border: "none",
            padding: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {!hasData ? (
            <div
              style={{
                fontSize: "0.72rem",
                color: "#475569",
                fontStyle: "italic",
                fontFamily: "'Inter', system-ui, sans-serif",
              }}
            >
              Awaiting Oracle ticks to populate chart...
            </div>
          ) : (
            <RadarSpider data={displayData} width={260} height={210} />
          )}
        </div>
      </div>

      {/* Mode label */}
      {hasData && hintLabel && (
        <div
          style={{
            textAlign: "center",
            fontSize: "0.55rem",
            color: "#334155",
            fontFamily: "'JetBrains Mono', monospace",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            marginTop: "2px",
            transition: "color 0.2s ease",
          }}
        >
          {hintLabel}
        </div>
      )}

      {/* Legend */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "10px",
          flexWrap: "wrap",
          marginTop: "6px",
          marginBottom: "4px",
          paddingLeft: "2px",
        }}
      >
        {CONTRIBUTOR_LEGEND.map((item) => (
          <span
            key={item.label}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "4px",
              fontSize: "0.6rem",
              fontWeight: 600,
              color: "#475569",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              fontFamily: "'Inter', system-ui, sans-serif",
              whiteSpace: "nowrap",
            }}
          >
            <span
              style={{
                color: item.color,
                fontSize: "0.75rem",
                lineHeight: 1,
              }}
            >
              ●
            </span>
            {item.label}
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── Main Modal ───────────────────────────────────────────────────────────────
export default function OracleAuditModal({
  isOpen,
  onClose,
  indexName,
  currentScore,
}: OracleAuditModalProps) {
  const [showConfidenceInfo, setShowConfidenceInfo] = useState(false);
  // Re-render trigger so unified log entries refresh when modal is open
  const [tickRefresh, setTickRefresh] = useState(0);
  // Fallthrough Log accordion state
  const [fallthroughOpen, setFallthroughOpen] = useState(false);
  const [fallthroughLog, setFallthroughLog] = useState<FallthroughEntry[]>([]);
  const [clearConfirm, setClearConfirm] = useState(false);
  // Enhancement 1: selected tick index (chart point → tick log link)
  const [selectedTickIndex, setSelectedTickIndex] = useState<number | null>(
    null,
  );
  // Enhancement 1: refs map for tick log entry divs
  const tickRefs = useRef<Map<number, HTMLDivElement | null>>(new Map());

  // Live dispatched headlines — re-read whenever a new headline is dispatched
  const [dispatchedEntries, setDispatchedEntries] = useState<
    DispatchedHeadlineEntry[]
  >(() => getDispatchedHeadlinesForIndex(indexName, 5));

  // Subscribe to new dispatched headlines so the modal updates in real time.
  // Also bump tickRefresh on every headline dispatch — a dispatched headline
  // means a tick just processed, so we want unified log entries to re-read
  // from the same render cycle so the Score Calculation panel stays in sync.
  useEffect(() => {
    if (!isOpen) return;
    // Refresh immediately on open in case headlines arrived while modal was closed
    setDispatchedEntries(getDispatchedHeadlinesForIndex(indexName, 5));
    setTickRefresh((n) => n + 1);

    const unsubscribe = subscribeToDispatchedHeadlines(() => {
      setDispatchedEntries(getDispatchedHeadlinesForIndex(indexName, 5));
      setTickRefresh((n) => n + 1);
    });
    return unsubscribe;
  }, [isOpen, indexName]);

  // Synthetic Liquidity audit entries for this index (up to 3 most recent)
  // biome-ignore lint/correctness/useExhaustiveDependencies: tickRefresh is a manual re-render counter, not a true dependency
  const syntheticEntries = useMemo(() => {
    return getSyntheticAuditLogForIndex(indexName, 3);
  }, [indexName, tickRefresh]);

  // Unified tick log entries for this index (last 3 ticks).
  // Re-reads from the log whenever: indexName changes, tickRefresh is bumped
  // (by the dispatched headlines subscription above), or currentScore changes
  // (which signals the parent index card has received a new tick, so the log
  // must be re-read in the same render cycle to keep the Score Calculation
  // panel atomically consistent with the card).
  // biome-ignore lint/correctness/useExhaustiveDependencies: tickRefresh is a manual re-render counter; currentScore signals a new tick has arrived
  const unifiedEntries = useMemo((): ExtendedTickEntry[] => {
    return getUnifiedLogForIndex(indexName, 3) as ExtendedTickEntry[];
  }, [indexName, tickRefresh, currentScore]);

  // Extract the raw AuditableNewsEvent objects for backwards-compatible calcs
  const events: AuditableNewsEvent[] = useMemo(
    () => dispatchedEntries.map((e) => e.event),
    [dispatchedEntries],
  );

  // Score Calculation panel values — all three are sourced atomically from the
  // most recent unified tick log entry so they are always mathematically
  // consistent: PREVIOUS SCORE + TICK IMPACT = CURRENT SCORE.
  //
  // TICK IMPACT is the true net delta across all pipeline steps
  // (finalScore − previousScore), NOT just rawNewsImpact which is step 2 only.
  // Using rawNewsImpact caused Tick Impact to show +0.00 when decay/tidal/
  // liquidity steps moved the score but no headline fired — making the
  // math identity impossible to satisfy.
  //
  // CURRENT SCORE is sourced from the same tick entry (latestTick.finalScore)
  // rather than the currentScore prop, which updates on a different render
  // cycle and caused the panel to show values from two different ticks
  // simultaneously.
  //
  // If no tick entry exists yet, fall back gracefully to the live prop value.
  const safeCurrentScore = Number.isFinite(currentScore) ? currentScore : 50.0;
  const { panelPreviousScore, panelTickImpact, panelCurrentScore } =
    useMemo(() => {
      const latestTick = unifiedEntries[0] ?? null;
      if (!latestTick) {
        return {
          panelPreviousScore: safeCurrentScore,
          panelTickImpact: 0,
          panelCurrentScore: safeCurrentScore,
        };
      }
      // Use the tick log entry's own previousScore field if populated by the
      // pipeline. Fall back to derivation only if the field is absent/undefined.
      const prev = latestTick.previousScore ?? latestTick.finalScore;
      const final = latestTick.finalScore;
      // True net delta = finalScore − previousScore (sum of all five pipeline
      // step deltas). This guarantees prev + impact === final exactly.
      const impact = final - prev;
      return {
        panelPreviousScore: prev,
        panelTickImpact: impact,
        panelCurrentScore: final,
      };
    }, [unifiedEntries, safeCurrentScore]);

  // Confidence score — calculated from actually dispatched events for this index
  const confidence = useMemo(() => calculateConfidenceScore(events), [events]);

  // Dominant direction from the last-5 event window (UI display only — does not affect engine)
  const dominantDirection = useMemo((): "positive" | "negative" | "mixed" => {
    if (events.length === 0) return "mixed";
    let pos = 0;
    let neg = 0;
    for (const e of events) {
      if (e.sentimentScore > 0) pos++;
      else if (e.sentimentScore < 0) neg++;
    }
    if (neg > pos) return "negative";
    if (pos > neg) return "positive";
    return "mixed";
  }, [events]);

  // Crisis regime state — halt banner shows on whichever index(es) triggered the crisis
  const { isCrisisMode, crisisTriggerIndices } = useCrisisRegime();
  const showHaltBanner = isCrisisMode && crisisTriggerIndices.has(indexName);
  // Derive category-aware crisis alert message from index definition
  const indexCategory =
    FALLBACK_ASSET_DEFS.find((a) => a.name === indexName)?.category ?? "";
  const crisisHaltMessage = getCrisisHaltMessage(indexCategory);

  // Fetch current β from the covariance engine (reads from in-memory cache)
  const beta = useMemo(() => getBeta(indexName), [indexName]);
  const betaFormatted = beta >= 0 ? `+${beta.toFixed(2)}` : beta.toFixed(2);
  const betaColor = beta < 0 ? "#f87171" : "#4ade80";

  const tickImpactFormatted =
    panelTickImpact >= 0
      ? `+${panelTickImpact.toFixed(2)}`
      : panelTickImpact.toFixed(2);

  // Refresh unified log entries every 30s while modal is open
  useEffect(() => {
    if (!isOpen) return;
    const id = setInterval(() => setTickRefresh((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, [isOpen]);

  // Close on Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        if (showConfidenceInfo) {
          setShowConfidenceInfo(false);
        } else {
          onClose();
        }
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [isOpen, onClose, showConfidenceInfo]);

  // Reset confidence info panel when modal closes
  useEffect(() => {
    if (!isOpen) {
      setShowConfidenceInfo(false);
    }
  }, [isOpen]);

  // Prevent body scroll when open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  const modalContent = (
    <AnimatePresence>
      {isOpen && (
        <motion.dialog
          open
          aria-label={`${getDisplayName(indexName)} Oracle Audit Trail`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3, ease: "easeOut" }}
          onClick={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
          style={{
            position: "fixed",
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
            zIndex: 99998,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "16px",
            fontFamily: "'Inter', system-ui, sans-serif",
            background: "rgba(0, 0, 0, 0.80)",
            backdropFilter: "blur(8px)",
            WebkitBackdropFilter: "blur(8px)",
          }}
        >

          {/* Modal panel */}
          <div
            style={{
              width: "100%",
              maxWidth: "520px",
              maxHeight: "88vh",
              background: "#000000",
              border: "1px solid #2a2a2a",
              borderRadius: "16px",
              boxShadow: "0 25px 60px rgba(0,0,0,0.8)",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
          >
            {/* Header */}
            <div
              style={{
                padding: "20px 24px 16px",
                borderBottom: "1px solid rgba(255,255,255,0.08)",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                flexShrink: 0,
                background: "#000000",
              }}
            >
              <h2
                style={{
                  fontSize: "1rem",
                  fontWeight: 700,
                  color: "#f1f5f9",
                  letterSpacing: "0.01em",
                  margin: 0,
                }}
              >
                {getDisplayName(indexName)} Oracle Audit Trail
              </h2>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close audit modal"
                data-ocid="audit_modal.close_button"
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  padding: "6px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#94a3b8",
                  borderRadius: "8px",
                  transition: "color 0.15s, background 0.15s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = "#f1f5f9";
                  e.currentTarget.style.background = "rgba(255,255,255,0.08)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = "#94a3b8";
                  e.currentTarget.style.background = "none";
                }}
              >
                <X style={{ width: "18px", height: "18px" }} strokeWidth={2} />
              </button>
            </div>

            {/* Scrollable body */}
            <div
              style={{ overflowY: "auto", flex: 1 }}
              onClick={(e) => {
                // Dismiss tick highlight when clicking outside a tick entry
                const target = e.target as HTMLElement;
                if (!target.closest("[data-tick-entry]")) {
                  setSelectedTickIndex(null);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") setSelectedTickIndex(null);
              }}
              role="presentation"
            >
              <div style={{ padding: "20px 24px 24px" }}>
                {/* Crisis Halt Banner */}
                {showHaltBanner && (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: "12px",
                      borderRadius: "10px",
                      border: "1px solid rgba(245,158,11,0.4)",
                      background: "rgba(245,158,11,0.12)",
                      padding: "12px 16px",
                      marginBottom: "16px",
                    }}
                  >
                    <AlertTriangle
                      style={{
                        width: "16px",
                        height: "16px",
                        color: "#fbbf24",
                        flexShrink: 0,
                        marginTop: "1px",
                      }}
                    />
                    <p
                      style={{
                        fontSize: "0.75rem",
                        fontWeight: 600,
                        color: "#fcd34d",
                        lineHeight: 1.5,
                        margin: 0,
                      }}
                    >
                      {crisisHaltMessage}
                    </p>
                  </div>
                )}

                {/* ── Confidence Score Card ── */}
                <div
                  style={{
                    position: "relative",
                    borderRadius: "12px",
                    border: "1px solid rgba(255,255,255,0.08)",
                    background: "#000000",
                    padding: "20px 16px",
                    marginBottom: "12px",
                    display: "flex",
                    alignItems: "center",
                    gap: "20px",
                  }}
                >
                  {/* Left: ring */}
                  <div style={{ flexShrink: 0 }}>
                    <ConfidenceRing
                      score={confidence.score}
                      tier={confidence.tier}
                      dominantDirection={dominantDirection}
                    />
                  </div>

                  {/* Right: label + rationale */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p
                      style={{
                        fontSize: "0.6rem",
                        color: "#64748b",
                        textTransform: "uppercase",
                        letterSpacing: "0.14em",
                        fontWeight: 700,
                        margin: "0 0 6px 0",
                      }}
                    >
                      Oracle Confidence Score
                    </p>
                    <p
                      style={{
                        fontSize: "0.78rem",
                        color: "#94a3b8",
                        lineHeight: 1.55,
                        margin: 0,
                        fontStyle: "italic",
                      }}
                    >
                      {confidence.rationale}
                    </p>
                  </div>

                  {/* ? Info button — bottom-right corner of the card */}
                  <button
                    type="button"
                    aria-label="How the confidence score is calculated"
                    data-ocid="confidence_info.open_modal_button"
                    onClick={() => setShowConfidenceInfo((v) => !v)}
                    style={{
                      position: "absolute",
                      bottom: "10px",
                      right: "10px",
                      width: "20px",
                      height: "20px",
                      borderRadius: "50%",
                      border: "1px solid rgba(255,255,255,0.2)",
                      background: showConfidenceInfo
                        ? "rgba(134,239,172,0.15)"
                        : "rgba(255,255,255,0.07)",
                      color: showConfidenceInfo ? "#86efac" : "#94a3b8",
                      fontSize: "0.65rem",
                      fontWeight: 700,
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      lineHeight: 1,
                      transition:
                        "background 0.15s, color 0.15s, border-color 0.15s",
                      flexShrink: 0,
                    }}
                    onMouseEnter={(e) => {
                      if (!showConfidenceInfo) {
                        e.currentTarget.style.background =
                          "rgba(255,255,255,0.12)";
                        e.currentTarget.style.color = "#f1f5f9";
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!showConfidenceInfo) {
                        e.currentTarget.style.background =
                          "rgba(255,255,255,0.07)";
                        e.currentTarget.style.color = "#94a3b8";
                      }
                    }}
                  >
                    ?
                  </button>
                </div>

                {/* Score Calculation Box */}
                <div
                  style={{
                    borderRadius: "10px",
                    border: "1px solid rgba(255,255,255,0.1)",
                    background: "#000000",
                    padding: "16px",
                    marginBottom: "16px",
                  }}
                >
                  <p
                    style={{
                      fontSize: "0.65rem",
                      color: "#64748b",
                      textTransform: "uppercase",
                      letterSpacing: "0.12em",
                      fontWeight: 600,
                      margin: "0 0 14px 0",
                    }}
                  >
                    Score Calculation
                  </p>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: "12px",
                      flexWrap: "wrap",
                      fontFamily: "'JetBrains Mono', monospace",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        gap: "2px",
                      }}
                    >
                      <span
                        style={{
                          fontSize: "0.6rem",
                          color: "#64748b",
                          textTransform: "uppercase",
                          letterSpacing: "0.1em",
                          fontWeight: 600,
                        }}
                      >
                        Previous Score
                      </span>
                      <span
                        style={{
                          fontWeight: 700,
                          color: "#e2e8f0",
                          fontSize: "1.1rem",
                        }}
                      >
                        {panelPreviousScore.toFixed(2)}
                      </span>
                    </div>
                    <span
                      style={{
                        color: "#475569",
                        fontWeight: 700,
                        fontSize: "1.25rem",
                      }}
                    >
                      +
                    </span>
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        gap: "2px",
                      }}
                    >
                      <span
                        style={{
                          fontSize: "0.6rem",
                          color: "#64748b",
                          textTransform: "uppercase",
                          letterSpacing: "0.1em",
                          fontWeight: 600,
                        }}
                      >
                        Tick Impact
                      </span>
                      <span
                        style={{
                          fontWeight: 700,
                          fontSize: "1.1rem",
                          color: panelTickImpact >= 0 ? "#4ade80" : "#f87171",
                        }}
                      >
                        {tickImpactFormatted}
                      </span>
                    </div>
                    <span
                      style={{
                        color: "#475569",
                        fontWeight: 700,
                        fontSize: "1.25rem",
                      }}
                    >
                      =
                    </span>
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        gap: "2px",
                      }}
                    >
                      <span
                        style={{
                          fontSize: "0.6rem",
                          color: "#64748b",
                          textTransform: "uppercase",
                          letterSpacing: "0.1em",
                          fontWeight: 600,
                        }}
                      >
                        Current Score
                      </span>
                      <span
                        style={{
                          fontWeight: 700,
                          color: "#86efac",
                          fontSize: "1.1rem",
                        }}
                      >
                        {panelCurrentScore.toFixed(2)}
                      </span>
                    </div>
                  </div>

                  {/* Global Sensitivity β row */}
                  <div
                    style={{
                      marginTop: "14px",
                      paddingTop: "12px",
                      borderTop: "1px solid rgba(255,255,255,0.07)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                    }}
                  >
                    <span
                      style={{
                        fontSize: "0.7rem",
                        color: "#64748b",
                        textTransform: "uppercase",
                        letterSpacing: "0.1em",
                        fontWeight: 600,
                        fontFamily: "'Inter', system-ui, sans-serif",
                      }}
                    >
                      Global Sensitivity (β)
                    </span>
                    <span
                      style={{
                        fontFamily: "'JetBrains Mono', monospace",
                        fontWeight: 700,
                        fontSize: "0.9rem",
                        color: betaColor,
                        letterSpacing: "0.04em",
                      }}
                    >
                      {betaFormatted}
                    </span>
                  </div>
                </div>

                {/* Historical Sentiment Chart */}
                <SentimentLineChart
                  indexName={indexName}
                  tickEntries={unifiedEntries}
                  selectedTickIndex={selectedTickIndex}
                  onSelectTick={(_chartDataIndex, tickLogIndex) => {
                    setSelectedTickIndex((prev) => {
                      // Toggle off if same tick selected again
                      if (tickLogIndex !== null && prev === tickLogIndex)
                        return null;
                      return tickLogIndex;
                    });
                    // Scroll to tick log entry if matched
                    if (tickLogIndex !== null) {
                      // Small delay to allow highlight render before scroll
                      setTimeout(() => {
                        tickRefs.current.get(tickLogIndex)?.scrollIntoView({
                          behavior: "smooth",
                          block: "nearest",
                        });
                      }, 50);
                    }
                  }}
                />

                {/* Divider */}
                <div
                  style={{
                    borderTop: "1px solid rgba(255,255,255,0.07)",
                    marginBottom: "16px",
                  }}
                />

                {/* Timeline — News Events (dispatched, live) */}
                <div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      marginBottom: "16px",
                    }}
                  >
                    <p
                      style={{
                        fontSize: "0.65rem",
                        color: "#64748b",
                        textTransform: "uppercase",
                        letterSpacing: "0.12em",
                        fontWeight: 600,
                        margin: 0,
                      }}
                    >
                      Last 5 Dispatched Headlines
                    </p>
                    {dispatchedEntries.length > 0 && (
                      <span
                        style={{
                          fontSize: "0.6rem",
                          color: "#4ade80",
                          fontFamily: "'JetBrains Mono', monospace",
                          background: "rgba(74,222,128,0.08)",
                          border: "1px solid rgba(74,222,128,0.2)",
                          borderRadius: "999px",
                          padding: "2px 8px",
                        }}
                      >
                        Live Feed
                      </span>
                    )}
                  </div>
                  {dispatchedEntries.length === 0 ? (
                    <div
                      style={{
                        textAlign: "center",
                        padding: "20px 0",
                        fontSize: "0.75rem",
                        color: "#475569",
                        fontStyle: "italic",
                      }}
                    >
                      <Clock
                        style={{
                          width: "16px",
                          height: "16px",
                          margin: "0 auto 8px",
                          opacity: 0.4,
                        }}
                      />
                      Awaiting first dispatched headline for {indexName}...
                      <p
                        style={{
                          marginTop: "6px",
                          fontSize: "0.65rem",
                          color: "#334155",
                        }}
                      >
                        Headlines are dispatched every 5 minutes
                      </p>
                    </div>
                  ) : (
                    <div>
                      {dispatchedEntries.map((entry, idx) => (
                        <DispatchedTimelineEntry
                          key={`dispatched-${entry.event.relatedIndex}-${entry.dispatchedAt}`}
                          entry={entry}
                          isLast={idx === dispatchedEntries.length - 1}
                        />
                      ))}
                    </div>
                  )}
                </div>

                {/* Timeline — Synthetic Liquidity Entries */}
                {syntheticEntries.length > 0 && (
                  <div style={{ marginTop: "8px" }}>
                    {/* Section label */}
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                        marginBottom: "16px",
                      }}
                    >
                      <div
                        style={{
                          flex: 1,
                          height: "1px",
                          background: "rgba(96,165,250,0.2)",
                        }}
                      />
                      <span
                        style={{
                          fontSize: "0.6rem",
                          color: "#60a5fa",
                          textTransform: "uppercase",
                          letterSpacing: "0.14em",
                          fontWeight: 700,
                          whiteSpace: "nowrap",
                        }}
                      >
                        Crowd Impact
                      </span>
                      <div
                        style={{
                          flex: 1,
                          height: "1px",
                          background: "rgba(96,165,250,0.2)",
                        }}
                      />
                    </div>

                    <div>
                      {syntheticEntries.map((entry, idx) => (
                        <SyntheticLiquidityEntry
                          key={`synth-${entry.indexName}-${entry.timestamp}`}
                          entry={entry}
                          isLast={idx === syntheticEntries.length - 1}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {/* ── Unified Tick Log ── */}
                <div style={{ marginTop: "16px" }}>
                  {/* Section divider + label */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      marginBottom: "14px",
                    }}
                  >
                    <div
                      style={{
                        flex: 1,
                        height: "1px",
                        background: "rgba(134,239,172,0.15)",
                      }}
                    />
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "5px",
                      }}
                    >
                      <Activity
                        style={{
                          width: "11px",
                          height: "11px",
                          color: "#86efac",
                        }}
                      />
                      <span
                        style={{
                          fontSize: "0.6rem",
                          color: "#86efac",
                          textTransform: "uppercase",
                          letterSpacing: "0.14em",
                          fontWeight: 700,
                          whiteSpace: "nowrap",
                        }}
                      >
                        Unified Tick Log
                      </span>
                    </div>
                    <div
                      style={{
                        flex: 1,
                        height: "1px",
                        background: "rgba(134,239,172,0.15)",
                      }}
                    />
                  </div>

                  {unifiedEntries.length === 0 ? (
                    <p
                      style={{
                        fontSize: "0.75rem",
                        color: "#475569",
                        fontStyle: "italic",
                        textAlign: "center",
                        padding: "12px 0",
                      }}
                    >
                      Awaiting first Oracle tick...
                    </p>
                  ) : (
                    <div>
                      {unifiedEntries.map((entry, idx) => (
                        <UnifiedTickEntry
                          key={`unified-${entry.indexName}-${entry.tickId}`}
                          entry={entry}
                          isLast={idx === unifiedEntries.length - 1}
                          isHighlighted={selectedTickIndex === idx}
                          entryRef={(el) => {
                            tickRefs.current.set(idx, el);
                          }}
                        />
                      ))}
                    </div>
                  )}
                </div>

                {/* ── Fallthrough Log ── */}
                {(() => {
                  // Compute total count for this index from localStorage (always fresh on render)
                  let totalCount = 0;
                  try {
                    const raw = localStorage.getItem(
                      "momentum_fallthrough_log_v1",
                    );
                    if (raw) {
                      const all: FallthroughEntry[] = JSON.parse(raw);
                      totalCount = all.filter(
                        (e) => e.indexName === indexName,
                      ).length;
                    }
                  } catch {
                    // ignore
                  }

                  const handleToggle = () => {
                    const opening = !fallthroughOpen;
                    setFallthroughOpen(opening);
                    if (opening) {
                      try {
                        const raw = localStorage.getItem(
                          "momentum_fallthrough_log_v1",
                        );
                        const all: FallthroughEntry[] = raw
                          ? JSON.parse(raw)
                          : [];
                        const filtered = all
                          .filter((e) => e.indexName === indexName)
                          .sort((a, b) => b.timestamp - a.timestamp)
                          .slice(0, 50);
                        setFallthroughLog(filtered);
                      } catch {
                        setFallthroughLog([]);
                      }
                    }
                  };

                  const handleClear = (e: ReactMouseEvent) => {
                    e.stopPropagation();
                    try {
                      localStorage.removeItem("momentum_fallthrough_log_v1");
                    } catch {
                      // silent fail
                    }
                    setFallthroughLog([]);
                    setClearConfirm(true);
                    setTimeout(() => setClearConfirm(false), 2000);
                  };

                  return (
                    <div
                      data-ocid="fallthrough_log.section"
                      style={{ marginTop: "16px" }}
                    >
                      {/* Section divider + accordion header */}
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "8px",
                          marginBottom: "0",
                        }}
                      >
                        <div
                          style={{
                            flex: 1,
                            height: "1px",
                            background: "rgba(107,114,128,0.2)",
                          }}
                        />
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "5px",
                          }}
                        >
                          <span
                            style={{
                              fontSize: "0.6rem",
                              color: "#6b7280",
                              textTransform: "uppercase",
                              letterSpacing: "0.14em",
                              fontWeight: 700,
                              whiteSpace: "nowrap",
                            }}
                          >
                            Fallthrough Log
                          </span>
                        </div>
                        <div
                          style={{
                            flex: 1,
                            height: "1px",
                            background: "rgba(107,114,128,0.2)",
                          }}
                        />
                      </div>

                      {/* Accordion trigger row */}
                      <button
                        type="button"
                        data-ocid="fallthrough_log.toggle"
                        onClick={handleToggle}
                        style={{
                          width: "100%",
                          display: "flex",
                          alignItems: "flex-start",
                          justifyContent: "space-between",
                          gap: "10px",
                          padding: "10px 0 8px",
                          background: "none",
                          border: "none",
                          cursor: "pointer",
                          textAlign: "left",
                        }}
                      >
                        {/* Left: chevron + label + subtext */}
                        <div
                          style={{
                            display: "flex",
                            alignItems: "flex-start",
                            gap: "8px",
                            flex: 1,
                            minWidth: 0,
                          }}
                        >
                          {/* Chevron — rotates on open */}
                          <svg
                            viewBox="0 0 16 16"
                            fill="none"
                            stroke="#6b7280"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            style={{
                              width: "13px",
                              height: "13px",
                              flexShrink: 0,
                              marginTop: "2px",
                              transform: fallthroughOpen
                                ? "rotate(90deg)"
                                : "rotate(0deg)",
                              transition: "transform 0.2s ease",
                            }}
                            aria-hidden="true"
                          >
                            <polyline points="6 3 11 8 6 13" />
                          </svg>
                          <div>
                            <span
                              style={{
                                display: "block",
                                fontSize: "0.68rem",
                                fontWeight: 700,
                                color: "#94a3b8",
                                letterSpacing: "0.08em",
                                textTransform: "uppercase",
                              }}
                            >
                              Fallthrough Log
                            </span>
                            <span
                              style={{
                                display: "block",
                                fontSize: "0.6rem",
                                color: "#475569",
                                marginTop: "2px",
                                lineHeight: 1.4,
                              }}
                            >
                              Headlines that resolved to neutral_fallback —
                              review for lexicon expansion
                            </span>
                          </div>
                        </div>

                        {/* Right: count badge + clear button */}
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "8px",
                            flexShrink: 0,
                          }}
                        >
                          <span
                            data-ocid="fallthrough_log.count_badge"
                            style={{
                              fontSize: "9px",
                              fontWeight: 700,
                              letterSpacing: "0.08em",
                              color: "#6b7280",
                              background: "rgba(107,114,128,0.10)",
                              border: "1px solid rgba(107,114,128,0.25)",
                              borderRadius: "3px",
                              padding: "1px 6px",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {clearConfirm
                              ? "0 captured"
                              : `${totalCount} captured`}
                          </span>
                          <button
                            type="button"
                            data-ocid="fallthrough_log.clear_button"
                            onClick={handleClear}
                            style={{
                              background: "none",
                              border: "none",
                              cursor: "pointer",
                              fontSize: "0.62rem",
                              fontWeight: 600,
                              color: clearConfirm ? "#4ade80" : "#ef4444aa",
                              padding: "2px 4px",
                              borderRadius: "3px",
                              whiteSpace: "nowrap",
                              transition: "color 0.15s",
                              lineHeight: 1,
                            }}
                          >
                            {clearConfirm ? "Log cleared" : "Clear Log"}
                          </button>
                        </div>
                      </button>

                      {/* Accordion body */}
                      {fallthroughOpen && (
                        <div
                          data-ocid="fallthrough_log.panel"
                          style={{
                            borderTop: "1px solid rgba(107,114,128,0.15)",
                            paddingTop: "10px",
                          }}
                        >
                          {fallthroughLog.length === 0 ? (
                            <p
                              data-ocid="fallthrough_log.empty_state"
                              style={{
                                fontSize: "0.72rem",
                                color: "#475569",
                                fontStyle: "italic",
                                textAlign: "center",
                                padding: "12px 0",
                              }}
                            >
                              No fallthroughs recorded for this index yet
                            </p>
                          ) : (
                            <div className="overflow-x-auto">
                              {fallthroughLog.map((entry, idx) => (
                                <div
                                  key={`fallthrough-${entry.tickId}-${entry.timestamp}-${idx}`}
                                  data-ocid={`fallthrough_log.item.${idx + 1}`}
                                  style={{
                                    paddingBottom: "10px",
                                    marginBottom:
                                      idx < fallthroughLog.length - 1
                                        ? "10px"
                                        : 0,
                                    borderBottom:
                                      idx < fallthroughLog.length - 1
                                        ? "1px solid rgba(107,114,128,0.10)"
                                        : "none",
                                  }}
                                >
                                  {/* Headline text */}
                                  <p
                                    style={{
                                      fontSize: "0.8rem",
                                      fontWeight: 600,
                                      color: "#cbd5e1",
                                      lineHeight: 1.45,
                                      marginBottom: "6px",
                                      wordBreak: "break-word",
                                    }}
                                  >
                                    {entry.headline}
                                  </p>

                                  {/* Meta row: source badge + time + tick */}
                                  <div
                                    style={{
                                      display: "flex",
                                      alignItems: "center",
                                      gap: "8px",
                                      flexWrap: "wrap",
                                    }}
                                  >
                                    {/* Source badge — muted gray, matching NEUTRAL badge style */}
                                    <span
                                      style={{
                                        fontSize: "9px",
                                        fontWeight: 700,
                                        letterSpacing: "0.12em",
                                        textTransform: "uppercase",
                                        color: "#6B7280",
                                        background: "rgba(107,114,128,0.10)",
                                        border:
                                          "1px solid rgba(107,114,128,0.30)",
                                        borderRadius: "3px",
                                        padding: "1px 5px",
                                        lineHeight: 1.4,
                                      }}
                                    >
                                      {entry.source}
                                    </span>

                                    {/* Timestamp */}
                                    <span
                                      style={{
                                        fontSize: "0.65rem",
                                        color: "#475569",
                                        fontFamily:
                                          "'JetBrains Mono', monospace",
                                      }}
                                    >
                                      {new Date(
                                        entry.timestamp,
                                      ).toLocaleTimeString([], {
                                        hour: "2-digit",
                                        minute: "2-digit",
                                      })}
                                    </span>

                                    {/* Tick ID */}
                                    <span
                                      style={{
                                        fontSize: "0.6rem",
                                        color: "#334155",
                                        fontFamily:
                                          "'JetBrains Mono', monospace",
                                      }}
                                    >
                                      Tick #{entry.tickId}
                                    </span>

                                    {/* Confidence */}
                                    <span
                                      style={{
                                        fontSize: "0.6rem",
                                        color: "#334155",
                                        fontFamily:
                                          "'JetBrains Mono', monospace",
                                      }}
                                    >
                                      {(entry.confidence * 100).toFixed(0)}%
                                      conf
                                    </span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            </div>
          </div>
        </motion.dialog>
      )}
    </AnimatePresence>
  );

  // ─── Confidence Info Panel (portal, fixed position — never cut off) ──────────
  const confidenceInfoPanel = showConfidenceInfo
    ? createPortal(
        <div
          data-ocid="confidence_info.panel"
          style={{
            position: "fixed",
            bottom: "80px",
            right: "24px",
            zIndex: 999999,
            width: "280px",
            maxHeight: "60vh",
            overflowY: "auto",
            background: "#000000",
            border: "1px solid #2a2a2a",
            borderRadius: "12px",
            padding: "20px",
            fontFamily: "'Inter', system-ui, sans-serif",
            boxShadow:
              "0 20px 50px rgba(0,0,0,0.85), 0 0 0 1px rgba(255,255,255,0.04)",
          }}
        >
          {/* Header row */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: "16px",
            }}
          >
            <span
              style={{
                fontSize: "0.75rem",
                fontWeight: 700,
                color: "#f1f5f9",
                letterSpacing: "0.02em",
              }}
            >
              Oracle Confidence Score
            </span>
            <button
              type="button"
              aria-label="Close confidence info"
              data-ocid="confidence_info.close_button"
              onClick={() => setShowConfidenceInfo(false)}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: "4px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#64748b",
                borderRadius: "6px",
                transition: "color 0.15s, background 0.15s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = "#f1f5f9";
                e.currentTarget.style.background = "rgba(255,255,255,0.08)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = "#64748b";
                e.currentTarget.style.background = "none";
              }}
            >
              <X style={{ width: "14px", height: "14px" }} strokeWidth={2} />
            </button>
          </div>

          {/* Section: Tier Weighting */}
          <p
            style={{
              fontSize: "0.6rem",
              color: "#86efac",
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.12em",
              margin: "0 0 6px 0",
            }}
          >
            Tier Weighting
          </p>
          <p
            style={{
              fontSize: "0.72rem",
              color: "#94a3b8",
              lineHeight: 1.65,
              margin: "0 0 16px 0",
            }}
          >
            Source authority is weighted by tier: Tier 1 (Reuters, Bloomberg,
            AP, WSJ, FT) = 100%, Tier 2 (BBC, CNBC, Al Jazeera) = 70%, Tier 3
            (Industry publications) = 40%, Tier 4 (Unverified sources) = 10%.
            Momentum score = average tier weight of all sources used.
          </p>

          {/* Divider */}
          <div
            style={{
              height: "1px",
              background: "rgba(255,255,255,0.07)",
              margin: "0 0 16px 0",
            }}
          />

          {/* Section: Agreement Bonus */}
          <p
            style={{
              fontSize: "0.6rem",
              color: "#86efac",
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.12em",
              margin: "0 0 6px 0",
            }}
          >
            Agreement Bonus
          </p>
          <p
            style={{
              fontSize: "0.72rem",
              color: "#94a3b8",
              lineHeight: 1.65,
              margin: "0 0 16px 0",
            }}
          >
            +15% is added when all sources in this update share the same
            sentiment direction (all bullish or all bearish).
          </p>

          {/* Divider */}
          <div
            style={{
              height: "1px",
              background: "rgba(255,255,255,0.07)",
              margin: "0 0 16px 0",
            }}
          />

          {/* Section: Volume Multiplier */}
          <p
            style={{
              fontSize: "0.6rem",
              color: "#86efac",
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.12em",
              margin: "0 0 6px 0",
            }}
          >
            Volume Multiplier
          </p>
          <p
            style={{
              fontSize: "0.72rem",
              color: "#94a3b8",
              lineHeight: 1.65,
              margin: 0,
            }}
          >
            +10% is added when 5 or more distinct sources contributed to this
            Oracle update.
          </p>
        </div>,
        document.body,
      )
    : null;

  return (
    <>
      {createPortal(modalContent, document.body)}
      {confidenceInfoPanel}
    </>
  );
}
