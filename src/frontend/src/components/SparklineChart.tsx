interface SparklineChartProps {
  scores: number[]; // array of 2–15 score values, oldest first
  width?: number; // default 200
  height?: number; // default 28
  indexId?: string; // unique ID for gradient — prevents bleed across cards
}

/**
 * Pure-SVG inline sparkline — no chart libraries.
 * Renders nothing if scores.length < 2.
 * Line color: green if trending up >+0.5, red if trending down >−0.5, gray if flat.
 * Gradient fill below the line at 20% opacity at top, transparent at bottom.
 */
export function SparklineChart({
  scores,
  width = 200,
  height = 28,
  indexId = "default",
}: SparklineChartProps) {
  const gradientId = `sparkline-fill-${indexId.replace(/[^a-z0-9]/gi, "-")}`;

  if (scores.length < 2) return null;

  const oldest = scores[0];
  const newest = scores[scores.length - 1];

  let lineColor: string;
  if (newest > oldest + 0.5) {
    lineColor = "#22c55e"; // green — trending up
  } else if (newest < oldest - 0.5) {
    lineColor = "#ef4444"; // red — trending down
  } else {
    lineColor = "#6b7280"; // gray — flat
  }

  const min = Math.min(...scores);
  const max = Math.max(...scores);
  const range = max - min;

  // Map score value → SVG y coordinate (2px padding top/bottom)
  const toY = (v: number): number => {
    if (range === 0) return height / 2;
    return 2 + (height - 4) * (1 - (v - min) / range);
  };

  // Evenly space points across the width
  const toX = (i: number): number =>
    scores.length === 1 ? 0 : (i / (scores.length - 1)) * width;

  const points = scores.map((v, i) => ({ x: toX(i), y: toY(v) }));

  // Polyline points string
  const pointsString = points.map((p) => `${p.x},${p.y}`).join(" ");

  // First and last x coordinates for closing the polygon to the bottom
  const firstX = points[0].x;
  const lastX = points[points.length - 1].x;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      overflow="visible"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={lineColor} stopOpacity={0.2} />
          <stop offset="100%" stopColor={lineColor} stopOpacity={0} />
        </linearGradient>
      </defs>

      {/* Gradient fill area — polygon closed to the bottom edge */}
      <polygon
        points={`${firstX},${height} ${pointsString} ${lastX},${height}`}
        fill={`url(#${gradientId})`}
        stroke="none"
      />

      {/* Score line on top */}
      <polyline
        points={pointsString}
        fill="none"
        stroke={lineColor}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
