import React from "react";
import { useIntersectionObserver } from "../hooks/useIntersectionObserver";
import type { AssetPriceWithCapacity } from "../hooks/useQueries";
import { ExpandableAssetRow } from "./ExpandableAssetRow";

interface VirtualizedAssetRowProps {
  asset: AssetPriceWithCapacity;
  index: number;
  cooldownActive?: boolean;
  /** Optional subtext displayed beneath the asset name (e.g. 'BASKETBALL SENTIMENT') */
  subLabel?: string;
}

/**
 * Estimated height of a collapsed ExpandableAssetRow in pixels.
 * This value must match the actual rendered height to prevent scroll jank
 * when rows swap between placeholder and full content.
 *
 * Breakdown:
 *   - py-5 (20px top + 20px bottom) + content (~100px) + FundCapacityBar (3px) + border (1px)
 *   ≈ 160px
 */
const COLLAPSED_ROW_HEIGHT = 160;

/**
 * Lightweight virtualization wrapper using IntersectionObserver.
 *
 * - When the row is within the viewport (plus a 200px margin for smooth pre-loading),
 *   it renders the full ExpandableAssetRow with all interactive functionality.
 * - When the row is outside the viewport, it renders a fixed-height placeholder div
 *   that preserves the row's space in the layout, preventing scroll position jumps.
 * - Rows revert to the placeholder when they leave the viewport, releasing DOM complexity.
 * - The `data-asset-name` attribute enables programmatic scroll-to from the NewsFeedSidebar
 *   when a user clicks a specific index pill.
 * - Wrapped in React.memo with a custom comparator so the card only re-renders when
 *   baseScore, buyPrice, or redeemPrice changes — preventing simultaneous 7-card reflows
 *   during Oracle ticks where only some (or no) scores changed.
 */
function VirtualizedAssetRowInner({
  asset,
  index,
  cooldownActive,
  subLabel,
}: VirtualizedAssetRowProps) {
  const isMobile = window.innerWidth < 768;
  const rootMargin = isMobile ? "50px 0px" : "200px 0px";
  const [ref, isVisible] = useIntersectionObserver<HTMLDivElement>({
    rootMargin,
    threshold: 0,
  });

  return (
    <div
      ref={ref}
      data-asset-name={asset.name}
      style={{ minHeight: isVisible ? undefined : COLLAPSED_ROW_HEIGHT }}
    >
      {isVisible ? (
        <ExpandableAssetRow
          asset={asset}
          index={index}
          cooldownActive={cooldownActive}
          subLabel={subLabel}
        />
      ) : (
        <div
          className="border-b border-border bg-transparent"
          style={{ height: COLLAPSED_ROW_HEIGHT }}
          aria-hidden="true"
        />
      )}
    </div>
  );
}

function areVirtualizedAssetRowPropsEqual(
  prev: {
    asset: {
      baseScore: number;
      buyPrice: number;
      redeemPrice: number;
      backendSpread?: number;
    };
  },
  next: {
    asset: {
      baseScore: number;
      buyPrice: number;
      redeemPrice: number;
      backendSpread?: number;
    };
  },
): boolean {
  return (
    prev.asset.baseScore === next.asset.baseScore &&
    prev.asset.buyPrice === next.asset.buyPrice &&
    prev.asset.redeemPrice === next.asset.redeemPrice &&
    prev.asset.backendSpread === next.asset.backendSpread
  );
}

export const VirtualizedAssetRow = React.memo(
  VirtualizedAssetRowInner,
  areVirtualizedAssetRowPropsEqual,
);
