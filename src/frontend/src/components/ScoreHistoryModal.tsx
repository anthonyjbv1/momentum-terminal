import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useOracleTick } from "../contexts/OracleTickContext";
import { useCountdown } from "../hooks/useCountdown";
import {
  Area,
  CartesianGrid,
  Line,
  LineChart,
  Tooltip as RechartsTooltip,
  ReferenceLine,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";
interface ScoreHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  indexName: string;
  indexSubLabel: string;
  currentScore: number;
  scores?: number[];
}

interface ChartPoint {
  tick: number;
  value: number;
}

function CustomTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { value: number }[];
  label?: number;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div
      style={{
        backgroundColor: "#000000",
        border: "1px solid #2a2a2a",
        borderRadius: "6px",
        padding: "8px 12px",
      }}
    >
      <p
        style={{
          color: "#6b6b6b",
          fontSize: "0.7rem",
          margin: "0 0 2px",
        }}
      >
        Tick {label}
      </p>
      <p
        style={{
          color: "#ffffff",
          fontSize: "0.875rem",
          fontFamily: "monospace",
          fontWeight: 600,
          margin: 0,
        }}
      >
        {payload[0].value.toFixed(2)} pts
      </p>
    </div>
  );
}

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div
      style={{
        flex: 1,
        padding: "0.625rem 0.75rem",
        borderRadius: "0.5rem",
        backgroundColor: "#111111",
        border: "1px solid #2a2a2a",
        display: "flex",
        flexDirection: "column",
        gap: "0.25rem",
      }}
    >
      <span
        style={{
          color: "#6b6b6b",
          fontSize: "0.55rem",
          textTransform: "uppercase",
          letterSpacing: "0.1em",
          fontWeight: 600,
        }}
      >
        {label}
      </span>
      <span
        style={{
          color,
          fontSize: "0.9rem",
          fontFamily: "monospace",
          fontWeight: 700,
          letterSpacing: "-0.01em",
        }}
      >
        {value}
      </span>
    </div>
  );
}

export function ScoreHistoryModal({
  isOpen,
  onClose,
  indexName,
  indexSubLabel,
  currentScore,
  scores = [],
}: ScoreHistoryModalProps) {
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  });

  const rawScores = scores;
  const chartData: ChartPoint[] = rawScores.map((value, i) => ({
    tick: i + 1,
    value,
  }));

  const hasData = chartData.length >= 2;
  const minVal = hasData ? Math.min(...rawScores, currentScore) : currentScore;
  const maxVal = hasData ? Math.max(...rawScores, currentScore) : currentScore;
  const avgVal = hasData
    ? rawScores.reduce((a, b) => a + b, 0) / rawScores.length
    : 50;

  const firstVal = hasData ? chartData[0].value : currentScore;
  const delta = currentScore - firstVal;
  const isUp = delta > 0;
  const isFlat = delta === 0;

  const lineColor = isFlat
    ? "oklch(0.52 0.012 240)"
    : isUp
      ? "#22c55e"
      : "#ef4444";

  const areaColor = isFlat
    ? "oklch(0.52 0.012 240)"
    : isUp
      ? "#22c55e"
      : "#ef4444";

  const areaFillOpacity = 0.12;

  const currentColor = currentScore >= avgVal ? "#22c55e" : "#ef4444";

  const { tickCount } = useOracleTick();
  const [countdown, secondsLeft] = useCountdown(undefined, tickCount);
  const isUrgent = secondsLeft <= 5;

  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768);
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  const yDomainMin = Math.floor(minVal - 2);
  const yDomainMax = Math.ceil(maxVal + 2);

  const deltaSign = delta > 0 ? "+" : "";
  const deltaArrow = delta > 0 ? "▲" : delta < 0 ? "▼" : "→";
  const deltaColor =
    delta > 0 ? "#22c55e" : delta < 0 ? "#ef4444" : "rgba(251,191,36,0.9)";

  const tickMutedColor = "#6b6b6b";

  const axisTickStyle = { fill: tickMutedColor, fontSize: 10 };

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <motion.div
          aria-modal="true"
          aria-label={`Score history for ${indexName}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3, ease: "easeOut" }}
          style={{
            position: "fixed",
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
            zIndex: 99999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "1rem",
            backgroundColor: "rgba(0,0,0,0.80)",
            backdropFilter: "blur(8px)",
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              if (e.target === e.currentTarget) onClose();
            }
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: "560px",
              borderRadius: "0.75rem",
              overflow: "hidden",
              backgroundColor: "#000000",
              border: "1px solid #2a2a2a",
              display: "flex",
              flexDirection: "column",
            }}
          >
            {/* Header */}
            <div
              style={{
                display: "flex",
                alignItems: "flex-start",
                justifyContent: "space-between",
                padding: "1.25rem 1.25rem 0 1.25rem",
              }}
            >
              <div style={{ minWidth: 0, flex: 1 }}>
                <p
                  style={{
                    color: "#ffffff",
                    fontSize: "1rem",
                    fontWeight: 700,
                    letterSpacing: "-0.01em",
                    margin: 0,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {indexName}
                </p>
                <p
                  style={{
                    color: "#6b6b6b",
                    fontSize: "0.6rem",
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: "0.12em",
                    margin: "0.25rem 0 0",
                  }}
                >
                  {indexSubLabel}
                </p>
              </div>
              {/* Synced 30s countdown timer */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.375rem",
                  padding: "0.375rem 0.625rem",
                  borderRadius: "0.375rem",
                  backgroundColor: "rgba(255,255,255,0.03)",
                  border: "1px solid #2a2a2a",
                  flexShrink: 0,
                  marginLeft: "0.75rem",
                }}
              >
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#6b6b6b"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
                <span
                  style={{
                    fontFamily: '"JetBrains Mono", "Fira Code", monospace',
                    fontSize: "11px",
                    fontWeight: 400,
                    letterSpacing: "0.025em",
                    color: isUrgent ? "#f87171" : "oklch(0.93 0.01 240 / 0.7)",
                    transition: "color 0.15s",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {countdown}
                </span>
              </div>

              <button
                type="button"
                onClick={onClose}
                aria-label="Close score history"
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: "#6b6b6b",
                  padding: "0.25rem",
                  lineHeight: 1,
                  fontSize: "1rem",
                  flexShrink: 0,
                  marginLeft: "0.75rem",
                  transition: "color 0.15s",
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.color =
                    "#ffffff";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.color =
                    "#4a4a4a";
                }}
              >
                ✕
              </button>
            </div>

            {/* Stats Row */}
            <div
              style={{
                display: "flex",
                gap: "0.5rem",
                padding: "1rem 1.25rem 0",
              }}
            >
              <StatCard
                label="Current"
                value={currentScore.toFixed(2)}
                color={currentColor}
              />
              <StatCard
                label="High"
                value={hasData ? maxVal.toFixed(2) : "—"}
                color="#22c55e"
              />
              <StatCard
                label="Low"
                value={hasData ? minVal.toFixed(2) : "—"}
                color="#ef4444"
              />
            </div>

            {/* Chart */}
            <div style={{ padding: "1rem 1.25rem 0" }}>
              {hasData ? (
                <div style={{ height: isMobile ? "180px" : "240px" }}>
                  <ResponsiveContainer width="100%" height={isMobile ? 180 : 240}>
                    <LineChart
                      data={chartData}
                      margin={{ top: 8, right: 8, bottom: 4, left: 0 }}
                    >
                      <CartesianGrid
                        strokeDasharray="3 3"
                        stroke="rgba(255,255,255,0.04)"
                        vertical={false}
                      />
                      <XAxis
                        dataKey="tick"
                        tick={axisTickStyle}
                        axisLine={false}
                        tickLine={false}
                        interval="preserveStartEnd"
                      />
                      <YAxis
                        domain={isMobile ? ["auto", "auto"] : [yDomainMin, yDomainMax]}
                        tick={axisTickStyle}
                        axisLine={false}
                        tickLine={false}
                        width={35}
                        padding={isMobile ? { top: 5, bottom: 5 } : undefined}
                      />
                      <RechartsTooltip
                        content={<CustomTooltip />}
                        cursor={{
                          stroke: "rgba(255,255,255,0.08)",
                          strokeWidth: 1,
                        }}
                      />
                      <ReferenceLine
                        y={50}
                        stroke="rgba(251,191,36,0.4)"
                        strokeDasharray="4 4"
                        label={{
                          value: "Base 50.0",
                          position: "right",
                          fill: "#b8860b",
                          fontSize: 9,
                        }}
                      />
                      <Area
                        type="monotone"
                        dataKey="value"
                        stroke="none"
                        fill={areaColor}
                        fillOpacity={areaFillOpacity}
                        isAnimationActive={false}
                      />
                      <Line
                        type="monotone"
                        dataKey="value"
                        stroke={lineColor}
                        strokeWidth={2}
                        dot={false}
                        isAnimationActive={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div
                  style={{
                    height: isMobile ? "180px" : "240px",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "0.5rem",
                  }}
                >
                  <span style={{ fontSize: "1.5rem", opacity: 0.4 }}>◌</span>
                  <p
                    style={{
                      color: "#6b6b6b",
                      fontSize: "0.8rem",
                      margin: 0,
                      fontFamily: "monospace",
                    }}
                  >
                    Awaiting data...
                  </p>
                  <p
                    style={{
                      color: "#4a4a4a",
                      fontSize: "0.7rem",
                      margin: 0,
                    }}
                  >
                    Score history builds after the first Oracle tick
                  </p>
                </div>
              )}
            </div>

            {/* Delta summary row */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "0.75rem 1.25rem 0",
              }}
            >
              <span
                style={{
                  color: deltaColor,
                  fontSize: "0.75rem",
                  fontFamily: "monospace",
                  fontWeight: 600,
                }}
              >
                CHANGE: {deltaSign}
                {delta.toFixed(2)} pts {deltaArrow}
              </span>
              <span
                style={{
                  color: "#6b6b6b",
                  fontSize: "0.7rem",
                  fontFamily: "monospace",
                }}
              >
                {rawScores.length} tick{rawScores.length !== 1 ? "s" : ""}{" "}
                recorded
              </span>
            </div>

            {/* Footer */}
            <div style={{ padding: "0.625rem 1.25rem 1.25rem" }}>
              <p
                style={{
                  color: "#4a4a4a",
                  fontSize: "0.6rem",
                  margin: 0,
                  letterSpacing: "0.04em",
                }}
              >
                Score history from last {rawScores.length} Oracle ticks ·
                updates every 30s
              </p>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
