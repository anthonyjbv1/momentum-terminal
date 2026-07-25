import { TrendingDown, TrendingUp } from "lucide-react";
import { useEffect } from "react";

interface YieldProgressBarProps {
  /** Total dollars paid at time of allocation (locked-in cost basis) */
  costBasis: number;
  /** Current market value: liveUnits × currentRedeemPrice */
  currentValue: number;
  /** One-way flag: true once break-even has been reached for this holding */
  hasUnlockedPnL: boolean;
  /** Callback to permanently set hasUnlockedPnL = true (never reverses) */
  onUnlock: () => void;
}

export function YieldProgressBar({
  costBasis,
  currentValue,
  hasUnlockedPnL,
  onUnlock,
}: YieldProgressBarProps) {
  // All derived values must be computed BEFORE any early return so that
  // the useEffect hook below is always called unconditionally.
  const rawProfit = currentValue - costBasis;
  const adjustedProfit = rawProfit;
  const roi = costBasis > 0 ? (adjustedProfit / costBasis) * 100 : 0;
  const isAboveBreakEven = costBasis > 0 && currentValue >= costBasis;
  const progressPercent =
    costBasis > 0 ? Math.min((currentValue / costBasis) * 100, 100) : 0;

  // One-way trip: the exact moment break-even is reached, permanently unlock.
  // Guarded by the parent (unlockPnL is idempotent), so this never revertes.
  useEffect(() => {
    if (isAboveBreakEven && !hasUnlockedPnL) {
      onUnlock();
    }
  }, [isAboveBreakEven, hasUnlockedPnL, onUnlock]);

  // Guard: no cost basis means no meaningful bar to render
  if (costBasis <= 0) return null;

  const fmtDollar = (n: number) =>
    `$${Math.abs(n).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;

  // ── P&L VIEW (after one-way unlock) ────────────────────────────────────────
  if (hasUnlockedPnL) {
    // ── PROFIT ZONE (net profit >= 0) — exact existing green UI, untouched ──
    if (adjustedProfit >= 0) {
      return (
        <div className="mt-2.5 w-full">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className="inline-block w-1.5 h-1.5 rounded-full animate-pulse shrink-0"
              style={{ backgroundColor: "#4ade80" }}
            />

            <span className="text-green-400 font-mono font-bold text-xs">
              +{fmtDollar(adjustedProfit)} (+{roi.toFixed(2)}%)
            </span>

            <span
              className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-sm border text-[9px] uppercase tracking-widest font-bold"
              style={{
                backgroundColor: "rgba(74,222,128,0.08)",
                borderColor: "rgba(74,222,128,0.3)",
                color: "#4ade80",
              }}
            >
              <TrendingUp className="w-2.5 h-2.5" />
              Profit Zone
            </span>
          </div>
        </div>
      );
    }

    // ── DRAWDOWN (net profit < 0) — pulsing dot, red P&L text, and DRAWDOWN badge inline ──
    return (
      <div className="mt-2.5 w-full">
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className="inline-block w-1.5 h-1.5 rounded-full animate-pulse shrink-0"
            style={{ backgroundColor: "#ef4444" }}
          />

          <span className="text-red-400 font-mono font-bold text-xs">
            -{fmtDollar(adjustedProfit)} (-{Math.abs(roi).toFixed(2)}%)
          </span>

          <span
            className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-sm border text-[9px] uppercase tracking-widest font-bold ml-auto"
            style={{
              backgroundColor: "rgba(248,113,113,0.08)",
              borderColor: "rgba(248,113,113,0.3)",
              color: "#f87171",
            }}
          >
            <TrendingDown className="w-2.5 h-2.5" />
            Drawdown
          </span>
        </div>
      </div>
    );
  }

  // ── YIELD PROGRESS BAR (before break-even unlock) ──────────────────────────
  const progressColor = "oklch(0.55 0.22 255)";

  return (
    <div className="mt-2.5 w-full">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10px] uppercase tracking-widest font-semibold text-muted-foreground">
          Yield Progress
        </span>
        <span
          className="text-[10px] font-mono font-medium"
          style={{ color: "oklch(0.55 0 0)" }}
        >
          {progressPercent.toFixed(1)}%
        </span>
      </div>

      <div className="relative h-1.5 w-full rounded-full overflow-hidden bg-white/[0.06]">
        <div
          className="h-full rounded-full transition-all duration-1000 ease-linear"
          style={{
            width: `${progressPercent}%`,
            backgroundColor: progressColor,
          }}
        />
      </div>

      <p className="text-[9px] text-muted-foreground mt-1 font-mono">
        {fmtDollar(currentValue)} of {fmtDollar(costBasis)} to recover spread
      </p>
    </div>
  );
}
