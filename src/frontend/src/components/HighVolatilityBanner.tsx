import { AlertTriangle } from "lucide-react";

interface HighVolatilityBannerProps {
  isActive: boolean;
}

/**
 * Yellow alert banner displayed when the spread is doubled due to high volatility.
 * Renders nothing when isActive is false.
 */
export function HighVolatilityBanner({ isActive }: HighVolatilityBannerProps) {
  if (!isActive) return null;

  return (
    <div
      className="flex items-center gap-2.5 px-4 py-2.5 mb-3 rounded-sm border"
      style={{
        backgroundColor: "oklch(0.82 0.18 85 / 0.08)",
        borderColor: "oklch(0.82 0.18 85 / 0.35)",
      }}
      role="alert"
      aria-live="polite"
    >
      <AlertTriangle
        className="w-3.5 h-3.5 shrink-0"
        style={{ color: "oklch(0.88 0.18 85)" }}
      />
      <p
        className="text-xs font-semibold tracking-wide"
        style={{ color: "oklch(0.92 0.16 85)" }}
      >
        High Volatility Mode Active: Spreads Adjusted.
      </p>
    </div>
  );
}
