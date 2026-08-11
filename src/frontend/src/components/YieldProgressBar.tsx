import { useEffect } from "react";

interface YieldProgressBarProps {
  costBasis: number;
  currentValue: number;
  hasUnlockedPnL: boolean;
  onUnlock: () => void;
}

export function YieldProgressBar({
  costBasis,
  currentValue,
  hasUnlockedPnL,
  onUnlock,
}: YieldProgressBarProps) {
  const rawProfit = currentValue - costBasis;
  const roi = costBasis > 0 ? (rawProfit / costBasis) * 100 : 0;
  const isAboveBreakEven = costBasis > 0 && currentValue >= costBasis;

  useEffect(() => {
    if (isAboveBreakEven && !hasUnlockedPnL) {
      onUnlock();
    }
  }, [isAboveBreakEven, hasUnlockedPnL, onUnlock]);

  if (costBasis <= 0) return null;

  const fmtDollar = (n: number) =>
    `$${Math.abs(n).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;

  const profitColor = rawProfit >= 0 ? "#22c55e" : "#ef4444";
  const sign = rawProfit >= 0 ? "+" : "-";

  return (
    <div className="mt-2.5 w-full">
      <div className="flex items-center gap-2">
        <span
          className="inline-block w-1.5 h-1.5 rounded-full animate-pulse shrink-0"
          style={{ backgroundColor: profitColor }}
        />
        <span className="font-mono font-bold text-xs" style={{ color: profitColor }}>
          {sign}{fmtDollar(rawProfit)} ({sign}{Math.abs(roi).toFixed(2)}%)
        </span>
      </div>
    </div>
  );
}
