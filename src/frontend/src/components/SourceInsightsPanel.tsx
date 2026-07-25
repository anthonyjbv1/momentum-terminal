import { Minus, TrendingDown, TrendingUp } from "lucide-react";
import { useLoyalty } from "../contexts/LoyaltyContext";
import { useInsightsData } from "../hooks/useInsightsData";
import type { Holding } from "../types/backendEnums";
import { LoyaltyTierBadge } from "./LoyaltyTierBadge";
import { TierProgressBar } from "./TierProgressBar";

// Synthetic yield rate constant: 0.068% per hour
const HOURLY_YIELD_RATE = 0.00068;
const NS_PER_MS = 1_000_000n;

// OKLCH color tokens for momentum indicator
const COLOR_POSITIVE = "oklch(0.72 0.19 145)";
const COLOR_NEGATIVE = "oklch(0.65 0.22 25)";

interface SourceInsightsPanelProps {
  /** Index name — used to pull per-index live data from the Oracle */
  indexName: string;
  /** Full Holding object for the asset (optional — panel still renders without it) */
  holding?: Holding;
  /** Buy price of the asset */
  buyPrice?: number;
  /** Redeem price of the asset */
  redeemPrice?: number;
}

function BreakEvenTimer({
  holding,
  buyPrice,
  redeemPrice,
}: {
  holding: Holding;
  buyPrice: number;
  redeemPrice: number;
}) {
  const spread = buyPrice - redeemPrice;
  const totalUnits = holding.units + holding.accruedYield;

  // hoursToBreakEven = spread / (totalUnits * HOURLY_YIELD_RATE)
  const hoursToBreakEven =
    totalUnits > 0 ? spread / (totalUnits * HOURLY_YIELD_RATE) : null;

  // Elapsed hours since yield started
  const nowMs = BigInt(Date.now());
  const startMs =
    holding.yieldStartTime > 0n ? holding.yieldStartTime / NS_PER_MS : nowMs;
  const elapsedMs = nowMs > startMs ? nowMs - startMs : 0n;
  const elapsedHours = Number(elapsedMs) / (1000 * 3600);
  const isComplete = elapsedHours >= 24;

  return (
    <div className="mt-3 pt-3 border-t border-border/30">
      <p className="text-[10px] uppercase tracking-widest font-semibold text-primary mb-1.5">
        Break-even Timer
      </p>
      {isComplete ? (
        <p
          className="text-xs font-mono font-semibold"
          style={{ color: "oklch(0.75 0.18 255)" }}
        >
          ⚡ Break-even Reached
        </p>
      ) : hoursToBreakEven !== null ? (
        <p className="text-muted-foreground text-xs leading-relaxed">
          Estimated break-even in:{" "}
          <span className="text-foreground font-mono font-semibold">
            {hoursToBreakEven.toFixed(1)} hours
          </span>
        </p>
      ) : (
        <p className="text-muted-foreground text-xs">
          Allocate to start earning yield.
        </p>
      )}
      <p className="text-[10px] text-muted-foreground mt-1 font-mono">
        Yield rate: 0.068%/hr · Synthetic liquidity reward
      </p>
    </div>
  );
}

/** Loyalty Tier section shown inside the expanded panel when a holding exists */
function LoyaltySection({ holding: _holding }: { holding: Holding }) {
  const { tier, progressPercent, daysUntilNextTier, nextTier } = useLoyalty();

  // Effective yield = base rate (tier benefit is exit spread reduction)
  const effectiveHourlyRate = HOURLY_YIELD_RATE;
  const effectiveHourlyPct = (effectiveHourlyRate * 100).toFixed(4);

  return (
    <div className="mt-3 pt-3 border-t border-border/30 space-y-3">
      {/* Header row: label + badge */}
      <div className="flex items-center justify-between">
        <p className="text-[10px] uppercase tracking-widest font-semibold text-primary">
          Loyalty Tier
        </p>
        <LoyaltyTierBadge
          tierName={tier.name}
          tierColor={tier.color}
          spreadReduction={tier.spreadReduction}
        />
      </div>

      {/* Effective Yield */}
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-widest font-semibold text-muted-foreground">
          Effective Yield
        </span>
        <span
          className="text-xs font-mono font-semibold"
          style={{ color: tier.color }}
        >
          {effectiveHourlyPct}%/hr
        </span>
      </div>

      {/* Tier Progress Bar */}
      <TierProgressBar
        progressPercent={progressPercent}
        daysUntilNextTier={daysUntilNextTier}
        nextTierName={nextTier?.name ?? null}
        tierName={tier.name}
        tierColor={tier.color}
      />
    </div>
  );
}

/**
 * Formats a sentiment score into a signed string with one decimal place.
 * Positive: "+1.2 pts", Negative: "−1.2 pts" (Unicode minus), Zero: "0.0 pts"
 */
function formatImpact(score: number): string {
  const abs = Math.abs(score).toFixed(1);
  if (score > 0) return `+${abs} pts`;
  if (score < 0) return `\u2212${abs} pts`; // Unicode minus sign
  return `${abs} pts`;
}

/** Maps confidence tier to the display color used in the Audit Modal */
function getTierColor(tier: "high" | "moderate" | "low"): string {
  if (tier === "high") return "oklch(0.72 0.19 145)"; // signature green
  if (tier === "moderate") return "oklch(0.75 0.18 85)"; // amber
  return "oklch(0.65 0.22 25)"; // red
}

/**
 * Active Driver + Sentiment Drivers column.
 * Reads per-index live data from the Oracle dispatched headline log.
 */
function ActiveDriverColumn({ indexName }: { indexName: string }) {
  const { activeDriver } = useInsightsData(indexName);

  const score = activeDriver?.sentimentScore ?? 0;
  const isPositive = score > 0;
  const isNegative = score < 0;

  return (
    <div className="px-6 py-4 border-b sm:border-b-0 sm:border-r border-border/50">
      {/* Active Driver */}
      <div className="mb-3 pb-3 border-b border-border/30">
        <p className="text-[10px] uppercase tracking-widest font-semibold text-primary mb-2">
          Active Driver
        </p>

        {activeDriver ? (
          <div className="space-y-2.5">
            {/* Headline — quote-style callout */}
            <div className="pl-2 border-l-2 border-border/60">
              <p className="text-xs text-foreground leading-relaxed line-clamp-3 font-medium">
                {activeDriver.headline}
              </p>
            </div>

            {/* Momentum indicator */}
            <div className="flex items-center gap-1.5">
              {isPositive ? (
                <TrendingUp
                  className="w-3.5 h-3.5 shrink-0"
                  style={{ color: COLOR_POSITIVE }}
                />
              ) : isNegative ? (
                <TrendingDown
                  className="w-3.5 h-3.5 shrink-0"
                  style={{ color: COLOR_NEGATIVE }}
                />
              ) : (
                <Minus className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
              )}
              <span
                className="text-xs font-mono font-semibold tracking-tight"
                style={{
                  color: isPositive
                    ? COLOR_POSITIVE
                    : isNegative
                      ? COLOR_NEGATIVE
                      : undefined,
                }}
              >
                Impact: {formatImpact(score)}
              </span>
            </div>
          </div>
        ) : (
          <p className="text-muted-foreground text-xs italic">
            Awaiting geopolitical/macro catalyst…
          </p>
        )}
      </div>

      {/* Sentiment Drivers — metadata of the active driver, not pipeline math */}
      <p className="text-[10px] uppercase tracking-widest font-semibold text-primary mb-2">
        Sentiment Drivers
      </p>
      <ul className="space-y-1.5 list-disc list-inside">
        {activeDriver?.source ? (
          <>
            <li className="text-muted-foreground text-xs leading-relaxed">
              Primary Source:{" "}
              <span className="text-foreground font-medium">
                {activeDriver.source}
              </span>
            </li>
            <li className="text-muted-foreground text-xs leading-relaxed">
              Narrative Category:{" "}
              <span className="text-foreground font-medium">
                {getNarrativeCategory(activeDriver.headline)}
              </span>
            </li>
          </>
        ) : (
          <>
            <li className="text-muted-foreground text-xs leading-relaxed">
              Monitoring global wire feeds…
            </li>
            <li className="text-muted-foreground text-xs leading-relaxed">
              Analyzing social momentum…
            </li>
          </>
        )}
      </ul>
    </div>
  );
}

/**
 * Derives a narrative category label from a headline string.
 * Keeps the Insights panel contextual without duplicating pipeline math.
 */
function getNarrativeCategory(headline: string): string {
  const h = headline.toLowerCase();
  if (
    h.includes("conflict") ||
    h.includes("military") ||
    h.includes("war") ||
    h.includes("escalat") ||
    h.includes("ceasefire") ||
    h.includes("nato") ||
    h.includes("sanctions") ||
    h.includes("troops")
  )
    return "Geopolitical Conflict";
  if (
    h.includes("fed") ||
    h.includes("rate") ||
    h.includes("inflation") ||
    h.includes("gdp") ||
    h.includes("treasury") ||
    h.includes("cpi") ||
    h.includes("stimulus") ||
    h.includes("imf") ||
    h.includes("central bank")
  )
    return "Macro / Monetary Policy";
  if (
    h.includes("ai") ||
    h.includes("openai") ||
    h.includes("deepmind") ||
    h.includes("chip") ||
    h.includes("nvidia") ||
    h.includes("model") ||
    h.includes("azure")
  )
    return "Technology / AI Sector";
  if (
    h.includes("earnings") ||
    h.includes("stock") ||
    h.includes("revenue") ||
    h.includes("s&p") ||
    h.includes("market") ||
    h.includes("invest")
  )
    return "Equity Markets";
  if (
    h.includes("trade") ||
    h.includes("tariff") ||
    h.includes("export") ||
    h.includes("import") ||
    h.includes("belt and road") ||
    h.includes("infrastructure")
  )
    return "Trade & Investment";
  if (
    h.includes("energy") ||
    h.includes("oil") ||
    h.includes("rare earth") ||
    h.includes("nuclear")
  )
    return "Energy & Resources";
  if (h.includes("regulat") || h.includes("bill") || h.includes("law"))
    return "Regulatory / Legislative";
  return "Macroeconomic Catalyst";
}

/** Credibility column — live mirror of Oracle Audit Modal confidence score */
function CredibilityColumn({
  indexName,
  children,
}: { indexName: string; children?: React.ReactNode }) {
  const { confidenceScore, confidenceTier, confidenceLabel } =
    useInsightsData(indexName);

  const tierColor = getTierColor(confidenceTier);

  return (
    <div className="px-6 py-4 border-b sm:border-b-0 sm:border-r border-border/50">
      <p className="text-[10px] uppercase tracking-widest font-semibold text-primary mb-2">
        Credibility
      </p>
      <p className="text-muted-foreground text-xs leading-relaxed">
        Oracle Confidence:{" "}
        <span className="font-mono font-semibold" style={{ color: tierColor }}>
          {confidenceScore}%
        </span>{" "}
        <span style={{ color: tierColor }}>({confidenceLabel})</span>
      </p>

      {/* Loyalty Tier — shown when holding has units (passed as children) */}
      {children}
    </div>
  );
}

/** Sample Size column — organic cumulative counter */
function SampleSizeColumn({
  indexName,
  children,
}: {
  indexName: string;
  children?: React.ReactNode;
}) {
  const { sampleSizeFormatted } = useInsightsData(indexName);

  return (
    <div className="px-6 py-4">
      <p className="text-[10px] uppercase tracking-widest font-semibold text-primary mb-2">
        Sample Size
      </p>
      <p className="text-muted-foreground text-xs leading-relaxed">
        Analyzed{" "}
        <span className="text-foreground font-mono font-semibold">
          {sampleSizeFormatted}
        </span>{" "}
        data points.
      </p>

      {/* Break-even Timer — only shown when holding has units */}
      {children}
    </div>
  );
}

export function SourceInsightsPanel({
  indexName,
  holding,
  buyPrice,
  redeemPrice,
}: SourceInsightsPanelProps) {
  const showBreakEven =
    holding !== undefined &&
    holding.units > 0 &&
    buyPrice !== undefined &&
    redeemPrice !== undefined;

  const showLoyalty = holding !== undefined && holding.units > 0;

  return (
    <div
      className="grid grid-cols-1 sm:grid-cols-3 gap-0 border-t border-border"
      style={{ backgroundColor: "#0A0A0A" }}
    >
      {/* Column 1: Active Driver + Sentiment Drivers */}
      <ActiveDriverColumn indexName={indexName} />

      {/* Column 2: Credibility + Loyalty Tier */}
      <CredibilityColumn indexName={indexName}>
        {showLoyalty && <LoyaltySection holding={holding!} />}
      </CredibilityColumn>

      {/* Column 3: Sample Size + Break-even Timer */}
      <SampleSizeColumn indexName={indexName}>
        {showBreakEven && (
          <BreakEvenTimer
            holding={holding!}
            buyPrice={buyPrice!}
            redeemPrice={redeemPrice!}
          />
        )}
      </SampleSizeColumn>
    </div>
  );
}
