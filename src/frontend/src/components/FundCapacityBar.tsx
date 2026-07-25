import { Skeleton } from "@/components/ui/skeleton";
import type { AssetPriceWithCapacity } from "../hooks/useQueries";

interface FundCapacityBarProps {
  asset: AssetPriceWithCapacity;
  isLoading?: boolean;
}

/**
 * Thin progress bar (≤6px) showing remaining Fund Capacity for an asset.
 * The filled portion represents remaining capacity; depletes as funds are allocated.
 */
export function FundCapacityBar({
  asset,
  isLoading = false,
}: FundCapacityBarProps) {
  if (isLoading) {
    return (
      <div className="px-6 pt-1 pb-3">
        <Skeleton className="h-1 w-full rounded-full bg-white/5" />
      </div>
    );
  }

  const { effectiveCapacity, currentAllocated, isAtCapacity } = asset;

  // Remaining capacity as a percentage (0–100)
  const remainingCapacity = Math.max(0, effectiveCapacity - currentAllocated);
  const remainingPercent =
    effectiveCapacity > 0
      ? Math.min(100, (remainingCapacity / effectiveCapacity) * 100)
      : 0;

  // Color based on how much is left
  const barColor = isAtCapacity
    ? "bg-destructive/50"
    : remainingPercent < 20
      ? "bg-amber-500/60"
      : remainingPercent < 50
        ? "bg-primary/50"
        : "bg-primary/70";

  const formatDollars = (n: number) =>
    n >= 1000 ? `$${(n / 1000).toFixed(0)}k` : `$${n.toFixed(0)}`;

  return (
    <div className="px-6 pt-1 pb-3 space-y-1">
      {/* Label row */}
      <div className="flex items-center justify-between gap-4">
        <span className="text-[9px] uppercase tracking-widest text-muted-foreground/60 font-medium whitespace-nowrap">
          Fund Capacity
        </span>
        <span
          className={`text-[9px] font-mono font-medium whitespace-nowrap ${
            isAtCapacity ? "text-destructive/80" : "text-muted-foreground/60"
          }`}
        >
          {isAtCapacity
            ? "Full"
            : `${formatDollars(remainingCapacity)} remaining`}
        </span>
      </div>

      {/* Thin progress bar — fill = remaining capacity */}
      <div className="relative h-[3px] w-full rounded-full bg-white/[0.06] overflow-hidden">
        <div
          className={`absolute left-0 top-0 h-full rounded-full transition-all duration-700 ${barColor}`}
          style={{ width: `${remainingPercent}%` }}
        />
      </div>
    </div>
  );
}
