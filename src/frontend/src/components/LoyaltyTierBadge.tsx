import { useEffect, useRef, useState } from "react";
import type { TierName } from "../contexts/LoyaltyContext";

interface LoyaltyTierBadgeProps {
  tierName: TierName;
  tierColor: string;
  spreadReduction: number;
}

const TIER_GLOW: Record<TierName, string> = {
  Standard: "none",
  Bronze: "0 0 10px oklch(0.62 0.12 55 / 0.55)",
  Silver: "0 0 10px oklch(0.78 0.04 240 / 0.55)",
  Gold: "0 0 14px oklch(0.82 0.18 85 / 0.65)",
  Obsidian: "0 0 16px oklch(0.68 0.22 290 / 0.70)",
};

const TIER_BG: Record<TierName, string> = {
  Standard: "oklch(0.18 0 0)",
  Bronze: "oklch(0.62 0.12 55 / 0.15)",
  Silver: "oklch(0.78 0.04 240 / 0.15)",
  Gold: "oklch(0.82 0.18 85 / 0.15)",
  Obsidian: "oklch(0.68 0.22 290 / 0.15)",
};

const TIER_BORDER: Record<TierName, string> = {
  Standard: "oklch(0.35 0 0)",
  Bronze: "oklch(0.62 0.12 55 / 0.5)",
  Silver: "oklch(0.78 0.04 240 / 0.5)",
  Gold: "oklch(0.82 0.18 85 / 0.6)",
  Obsidian: "oklch(0.68 0.22 290 / 0.6)",
};

/**
 * Small pill badge showing the current loyalty tier with an optional level-up glow animation.
 */
export function LoyaltyTierBadge({
  tierName,
  tierColor,
  spreadReduction,
}: LoyaltyTierBadgeProps) {
  const prevTierRef = useRef<TierName>(tierName);
  const [isGlowing, setIsGlowing] = useState(false);

  useEffect(() => {
    if (prevTierRef.current !== tierName) {
      // Tier increased — trigger glow animation
      setIsGlowing(true);
      const timeout = setTimeout(() => setIsGlowing(false), 2000);
      prevTierRef.current = tierName;
      return () => clearTimeout(timeout);
    }
  }, [tierName]);

  const tierEmoji: Record<TierName, string> = {
    Standard: "◈",
    Bronze: "◆",
    Silver: "◆",
    Gold: "★",
    Obsidian: "✦",
  };

  return (
    <div className="flex items-center gap-2">
      <span
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-sm text-[10px] font-semibold uppercase tracking-widest border transition-all duration-500"
        style={{
          color: tierColor,
          backgroundColor: TIER_BG[tierName],
          borderColor: TIER_BORDER[tierName],
          boxShadow: isGlowing
            ? TIER_GLOW[tierName]
            : tierName !== "Standard"
              ? `0 0 6px ${tierColor.replace(")", " / 0.25)").replace("oklch(", "oklch(")}`
              : "none",
          animation: isGlowing ? "tier-level-up 2s ease-out" : "none",
        }}
      >
        <span>{tierEmoji[tierName]}</span>
        {tierName}
      </span>
      <span
        className="text-[10px] font-mono font-semibold"
        style={{ color: tierColor }}
      >
        Exit: {(0.5 - spreadReduction).toFixed(2)}
      </span>
    </div>
  );
}
