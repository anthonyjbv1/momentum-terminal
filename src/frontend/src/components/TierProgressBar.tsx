import type { TierName } from "../contexts/LoyaltyContext";

interface TierProgressBarProps {
  progressPercent: number;
  daysUntilNextTier: number | null;
  nextTierName: TierName | null;
  tierName: TierName;
  tierColor: string;
}

const TIER_TRACK_COLOR: Record<TierName, string> = {
  Standard: "oklch(0.45 0 0)",
  Bronze: "oklch(0.62 0.12 55)",
  Silver: "oklch(0.78 0.04 240)",
  Gold: "oklch(0.82 0.18 85)",
  Obsidian: "oklch(0.68 0.22 290)",
};

export function TierProgressBar({
  progressPercent,
  daysUntilNextTier,
  nextTierName,
  tierName,
  tierColor,
}: TierProgressBarProps) {
  const isMaxTier = daysUntilNextTier === null;
  const clampedPercent = Math.min(100, Math.max(0, progressPercent));
  const barColor = TIER_TRACK_COLOR[tierName] ?? tierColor;

  const timeLabel = (() => {
    if (isMaxTier) return null;
    if (daysUntilNextTier === 0) return "< 1d";
    return `${daysUntilNextTier}d`;
  })();

  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10px] uppercase tracking-widest font-semibold text-muted-foreground">
          Tier Progress
        </span>
        <span
          className="text-[10px] font-mono font-medium"
          style={{ color: isMaxTier ? "oklch(0.68 0.22 290)" : tierColor }}
        >
          {isMaxTier ? "✓ Max Tier" : nextTierName ? `→ ${nextTierName}` : ""}
        </span>
      </div>

      <div className="relative h-1 w-full rounded-full overflow-hidden bg-white/[0.06]">
        <div
          className="h-full rounded-full transition-all duration-1000 ease-linear"
          style={{
            width: `${clampedPercent}%`,
            backgroundColor: barColor,
          }}
        />
      </div>

      <p
        className="text-[9px] font-mono mt-1"
        style={{
          color: isMaxTier ? "oklch(0.68 0.22 290)" : "oklch(0.45 0 0)",
        }}
      >
        {isMaxTier
          ? "Obsidian Tier — 1.50× Multiplier Active"
          : timeLabel && nextTierName
            ? `${timeLabel} until ${nextTierName} Tier`
            : ""}
      </p>
    </div>
  );
}
