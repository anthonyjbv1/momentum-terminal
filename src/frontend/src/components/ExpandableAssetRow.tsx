import { ChevronDown } from "lucide-react";
import { useCallback, useState } from "react";
import type { AssetPriceWithCapacity } from "../hooks/useQueries";
import { useAllocateFunds, useHoldings } from "../hooks/useQueries";
import { AssetRow } from "./AssetRow";
import { SourceInsightsPanel } from "./SourceInsightsPanel";

interface ExpandableAssetRowProps {
  asset: AssetPriceWithCapacity;
  index: number;
  /** Whether the user is currently in a cool-down period for this asset */
  cooldownActive?: boolean;
  /** Optional subtext displayed beneath the asset name (e.g. 'BASKETBALL SENTIMENT') */
  subLabel?: string;
}

export function ExpandableAssetRow({
  asset,
  index,
  cooldownActive = false,
  subLabel,
}: ExpandableAssetRowProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const { data: allHoldings } = useHoldings();
  const allocateMutation = useAllocateFunds();

  // Find the holding for this asset to pass to SourceInsightsPanel
  const holding = allHoldings?.find(([name]) => name === asset.name)?.[1];

  // Detect if a successful allocation just happened (mutation succeeded)
  const justAllocated = allocateMutation.isSuccess;

  const effectiveCooldown = cooldownActive || justAllocated;

  // Stable callback — won't cause child re-renders due to new function refs
  const handleToggle = useCallback(() => {
    setIsExpanded((prev) => !prev);
  }, []);

  return (
    <>
      {/* Asset row content */}
      <AssetRow
        asset={asset}
        index={index}
        cooldownActive={effectiveCooldown}
        subLabel={subLabel}
        onInsightsToggle={handleToggle}
        isInsightsExpanded={isExpanded}
      />

      {/* Expandable Source Insights Panel */}
      {isExpanded && (
        <div
          className="border-t border-border/50 bg-white/[0.01]"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <SourceInsightsPanel
            indexName={asset.name}
            holding={holding}
            buyPrice={asset.buyPrice}
            redeemPrice={asset.redeemPrice}
          />
        </div>
      )}
    </>
  );
}
