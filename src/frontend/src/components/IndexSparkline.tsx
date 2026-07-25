import { useMemo } from "react";
import { Line, LineChart, ResponsiveContainer } from "recharts";
import { getSentimentLogScoresForIndex } from "../services/gsiCovarianceEngine";

interface IndexSparklineProps {
  indexName: string;
  currentScore?: number;
  onClick?: () => void;
}

const WINDOW_SIZE = 20;
const MUTED_COLOR = "oklch(0.52 0.012 240)";

export function IndexSparkline({
  indexName,
  currentScore = 50,
  onClick,
}: IndexSparklineProps) {
  const rawData = useMemo(() => {
    const scores = getSentimentLogScoresForIndex(indexName);
    const slice = scores.slice(-WINDOW_SIZE);
    return slice.map((value, i) => ({ i, value }));
  }, [indexName]);

  // When fewer than 2 real data points exist, render a flat placeholder line
  const isPlaceholder = rawData.length < 2;
  const data = isPlaceholder
    ? [0, 1, 2, 3, 4].map((i) => ({ i, value: currentScore }))
    : rawData;

  const first = data[0].value;
  const last = data[data.length - 1].value;
  const delta = last - first;

  let lineColor: string;
  let deltaSymbol: string;
  let deltaDisplay: string;

  if (isPlaceholder || delta === 0) {
    lineColor = MUTED_COLOR;
    deltaSymbol = "→";
    deltaDisplay = "±0.0";
  } else if (delta > 0) {
    lineColor = "var(--primary)"; // oklch(0.72 0.18 145) green
    deltaSymbol = "↑";
    deltaDisplay = `+${delta.toFixed(1)}`;
  } else {
    lineColor = "var(--destructive)"; // oklch(0.6 0.22 25) red
    deltaSymbol = "↓";
    deltaDisplay = delta.toFixed(1);
  }

  return (
    <div
      className={`relative w-full overflow-hidden transition-opacity duration-200 ${onClick ? "cursor-pointer opacity-80 hover:opacity-100" : ""}`}
      style={{ height: "40px" }}
      onClick={onClick}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && onClick) onClick();
      }}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      aria-label={onClick ? `View score history for ${indexName}` : undefined}
    >
      <ResponsiveContainer width="100%" height={40}>
        <LineChart
          data={data}
          margin={{ top: 4, right: 48, bottom: 4, left: 0 }}
        >
          <Line
            type="monotone"
            dataKey="value"
            stroke={lineColor}
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>

      {/* Delta label — top right, monospaced, tiny. Hidden during placeholder state. */}
      {!isPlaceholder && (
        <span
          className="absolute top-0 right-0 font-mono text-[9px] font-semibold leading-none select-none pointer-events-none"
          style={{ color: lineColor }}
        >
          {deltaSymbol} {deltaDisplay}
        </span>
      )}
    </div>
  );
}
