/**
 * SentimentArc — circular arc indicator replacing the spark line.
 * Derives directional sentiment inline from the last 15 score ticks.
 * Uses SVG strokeDasharray / strokeDashoffset — no charting library.
 */

import { useEffect, useRef, useState } from "react";

interface SentimentArcProps {
  /** Raw score array from getScoreHistory(), oldest first. */
  scores: number[];
  /** Total capital allocated to this index (asset.currentAllocated). */
  allocatedCapital: number;
  /** Called when the user clicks the arc (opens score history). */
  onClick?: () => void;
  /** aria-label for the button wrapper. */
  ariaLabel?: string;
  /** Arc size in pixels (default 80). */
  size?: number;
}

// ── Sentiment derivation ─────────────────────────────────────────────────────

type Direction = "Bullish" | "Bearish" | "Neutral";

interface SentimentResult {
  pct: number | null; // null → insufficient data
  direction: Direction;
  upTicks: number;
  downTicks: number;
  flatTicks: number;
  totalTicks: number;
}

// Minimum entries required before HEATING/COOLING/NEUTRAL label is shown
const MIN_HISTORY_FOR_LABEL = 5;

// Float noise threshold — diffs smaller than this are treated as flat
const FLAT_THRESHOLD = 0.05;

function deriveSentiment(scores: number[]): SentimentResult {
  // Fewer than MIN_HISTORY_FOR_LABEL entries → render dash + 0%, no label
  if (scores.length < MIN_HISTORY_FOR_LABEL) {
    return {
      pct: null,
      direction: "Neutral",
      upTicks: 0,
      downTicks: 0,
      flatTicks: 0,
      totalTicks: 0,
    };
  }

  // Take last 15 ticks (the caller already slices to 15, but guard here too)
  const slice = scores.slice(-15);
  let upTicks = 0;
  let downTicks = 0;
  let flatTicks = 0;

  for (let i = 1; i < slice.length; i++) {
    const diff = slice[i] - slice[i - 1];
    if (diff > FLAT_THRESHOLD) upTicks++;
    else if (diff < -FLAT_THRESHOLD) downTicks++;
    else flatTicks++;
  }

  const totalTicks = upTicks + downTicks + flatTicks;
  if (totalTicks === 0) {
    return {
      pct: null,
      direction: "Neutral",
      upTicks,
      downTicks,
      flatTicks,
      totalTicks,
    };
  }

  let direction: Direction;
  if (upTicks > downTicks && upTicks > flatTicks) direction = "Bullish";
  else if (downTicks > upTicks && downTicks > flatTicks) direction = "Bearish";
  else direction = "Neutral";

  // Fix: on the tie-break neutral path, use totalTicks (not flatTicks) so
  // the percentage is never 0% when upTicks === downTicks but flatTicks === 0.
  const dominantCount =
    direction === "Bullish"
      ? upTicks
      : direction === "Bearish"
        ? downTicks
        : totalTicks;
  const pct = Math.round((dominantCount / totalTicks) * 100);

  return { pct, direction, upTicks, downTicks, flatTicks, totalTicks };
}

// ── Volume formatter ─────────────────────────────────────────────────────────

function formatVolume(capital: number): string {
  if (!capital || capital <= 0) return "$0 Vol.";
  if (capital < 1_000) return `$${Math.round(capital)} Vol.`;
  if (capital < 1_000_000) return `$${(capital / 1_000).toFixed(1)}k Vol.`;
  return `$${(capital / 1_000_000).toFixed(1)}M Vol.`;
}

// ── Arc color ────────────────────────────────────────────────────────────────

function arcColor(direction: Direction): string {
  if (direction === "Bullish") return "#22c55e";
  if (direction === "Bearish") return "#ef4444";
  return "#6b7280";
}

// ── Component ────────────────────────────────────────────────────────────────

export function SentimentArc({
  scores,
  allocatedCapital,
  onClick,
  ariaLabel,
  size = 80,
}: SentimentArcProps) {
  const SIZE = size;
  const STROKE = 6;
  const R = (SIZE - STROKE) / 2; // radius
  const CX = SIZE / 2;
  const CY = SIZE / 2;
  const CIRCUMFERENCE = 2 * Math.PI * R;

  const sentiment = deriveSentiment(scores);
  const color = arcColor(sentiment.direction);

  // ── NEUTRAL → HEATING pulse ───────────────────────────────────────────────
  // prevSentimentRef tracks the previous direction so we can detect the exact
  // NEUTRAL → Bullish (HEATING) transition and trigger a one-shot pulse.
  const prevSentimentRef = useRef<Direction | null>(null);
  const [isPulsing, setIsPulsing] = useState(false);

  useEffect(() => {
    const prev = prevSentimentRef.current;
    const current = sentiment.direction;

    // Always update the ref for the next render
    prevSentimentRef.current = current;

    // Fire ONLY on the strict NEUTRAL → HEATING transition
    if (prev === "Neutral" && current === "Bullish") {
      setIsPulsing(true);
      const timerId = setTimeout(() => {
        setIsPulsing(false);
      }, 600);
      return () => clearTimeout(timerId);
    }
  }, [sentiment.direction]);

  // Arc fill: use pct / 100 * CIRCUMFERENCE; if null (insufficient data) render track only
  const fillFraction = sentiment.pct !== null ? sentiment.pct / 100 : 0;
  const dashArray = CIRCUMFERENCE;
  // SVG arc starts at right (3 o'clock). Rotate -90° to start at top (12 o'clock).
  const dashOffset = CIRCUMFERENCE * (1 - fillFraction);

  const percentLabel = sentiment.pct !== null ? `${sentiment.pct}%` : "--";

  const inner = (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "3px",
        cursor: onClick ? "pointer" : "default",
      }}
    >
      {/* SVG arc — animate-pulse class fires for 600ms on NEUTRAL → HEATING */}
      <svg
        width={SIZE}
        height={SIZE}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        aria-hidden="true"
        className={isPulsing ? "animate-pulse" : undefined}
        style={{ display: "block" }}
      >
        {/* Track — full circle, muted */}
        <circle
          cx={CX}
          cy={CY}
          r={R}
          fill="none"
          stroke="rgba(255,255,255,0.08)"
          strokeWidth={STROKE}
        />

        {/* Colored arc overlay — sweeps from 12 o'clock clockwise */}
        {sentiment.pct !== null && sentiment.pct > 0 && (
          <circle
            cx={CX}
            cy={CY}
            r={R}
            fill="none"
            stroke={color}
            strokeWidth={STROKE}
            strokeDasharray={dashArray}
            strokeDashoffset={dashOffset}
            strokeLinecap="round"
            style={{ transform: "rotate(-90deg)", transformOrigin: "center" }}
          />
        )}

        {/* Directional arrow — rendered ABOVE the percentage */}
        <text
          x={CX}
          y={CY - SIZE * 0.125}
          textAnchor="middle"
          dominantBaseline="middle"
          fill={sentiment.pct !== null ? color : "#6b7280"}
          fontSize={Math.round(SIZE * 0.175)}
          fontWeight="700"
          fontFamily="'Inter', system-ui, sans-serif"
        >
          {sentiment.direction === "Bullish"
            ? "↑"
            : sentiment.direction === "Bearish"
              ? "↓"
              : "—"}
        </text>

        {/* Percentage below the arrow */}
        <text
          x={CX}
          y={CY + SIZE * 0.1}
          textAnchor="middle"
          dominantBaseline="middle"
          fill="#ffffff"
          fontSize={Math.round(SIZE * 0.175)}
          fontWeight="700"
          fontFamily="'JetBrains Mono', 'Courier New', monospace"
          letterSpacing="-0.5"
        >
          {percentLabel}
        </text>
      </svg>

      {/* HEATING / RECOVERING / COOLING / NEUTRAL trajectory label — only when >= 5 entries */}
      {sentiment.pct !== null &&
        (() => {
          const currentScore =
            scores.length > 0 ? scores[scores.length - 1] : null;
          // Score floor guard: HEATING is overridden to RECOVERING when the absolute
          // score is below 42 — prevents misleading HEATING on suppressed indexes.
          const RECOVERING_THRESHOLD = 42;
          const isRecovering =
            sentiment.direction === "Bullish" &&
            currentScore !== null &&
            currentScore < RECOVERING_THRESHOLD;

          const label = isRecovering
            ? "RECOVERING"
            : sentiment.direction === "Bullish"
              ? "HEATING"
              : sentiment.direction === "Bearish"
                ? "COOLING"
                : "NEUTRAL";

          const labelColor =
            sentiment.direction === "Bullish"
              ? "#4ade80" // green for both HEATING and RECOVERING
              : sentiment.direction === "Bearish"
                ? "#f87171"
                : "#6b7280";

          return (
            <span
              style={{
                fontSize: "0.5rem",
                fontFamily: "'Inter', system-ui, sans-serif",
                fontWeight: 700,
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                lineHeight: 1,
                color: labelColor,
              }}
            >
              {label}
            </span>
          );
        })()}

      {/* Volume below arc */}
      <span
        style={{
          fontSize: "0.6rem",
          fontFamily: "'JetBrains Mono', 'Courier New', monospace",
          color: "#6b7280",
          letterSpacing: "0.04em",
          lineHeight: 1,
        }}
      >
        {formatVolume(allocatedCapital)}
      </span>
    </div>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label={ariaLabel}
        style={{
          background: "none",
          border: "none",
          padding: 0,
          margin: 0,
          cursor: "pointer",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: "0.5rem",
          outline: "none",
          opacity: 0.85,
          transition: "opacity 0.15s ease",
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLButtonElement).style.opacity = "1";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.opacity = "0.85";
        }}
        onFocus={(e) => {
          (e.currentTarget as HTMLButtonElement).style.opacity = "1";
        }}
        onBlur={(e) => {
          (e.currentTarget as HTMLButtonElement).style.opacity = "0.85";
        }}
      >
        {inner}
      </button>
    );
  }

  return inner;
}
