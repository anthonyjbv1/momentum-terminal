import { Skeleton } from "@/components/ui/skeleton";
import { Activity, ChevronDown } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { AssetColumnHeaders } from "../components/AssetRow";
import { LoadingState } from "../components/LoadingState";
import { VirtualizedAssetRow } from "../components/VirtualizedAssetRow";
import { useAuth } from "../contexts/AuthContext";
import { useOracleTick } from "../contexts/OracleTickContext";
import { computeCapacity, useAssetPrices } from "../hooks/useQueries";
import type { AssetPriceWithCapacity } from "../hooks/useQueries";
import { FALLBACK_ASSET_DEFS } from "../data/fallbackAssets";

const ALLOWED_INDEX_NAMES = new Set(FALLBACK_ASSET_DEFS.map((d) => d.name));

// ─── Fallback Assets ───────────────────────────────────────────────────────────────────────────────────

const FALLBACK_ASSETS: AssetPriceWithCapacity[] = FALLBACK_ASSET_DEFS.map((def) => {
  const base = def.baseScore;
  const spread = Math.max(0.1, def.spread);
  return computeCapacity({
    name: def.name,
    category: def.category,
    baseScore: base,
    buyPrice: base + spread,
    redeemPrice: base - spread,
    maxAllocation: def.maxAllocation,
    volatilityBuffer: def.volatilityBuffer,
    currentAllocated: 0,
  });
});

// ─── Asset Registry ────────────────────────────────────────────────────────────────────────────────────
// Full registry kept intact — filtering applied at render layer only.
export const allAssets = FALLBACK_ASSET_DEFS.map((def) => ({
  id: def.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
  name: def.name,
  category: def.category,
  baseScore: def.baseScore,
  subLabel: `${def.category} NARRATIVE`,
}));

export type AssetEntry = (typeof allAssets)[number];

// ─── subLabel lookup map ──────────────────────────────────────────────────────────────────────────────

export const subLabelMap: Map<string, string> = new Map(
  allAssets.map((a) => [a.name, a.subLabel]),
);

function computeDynamicSpread(currentAllocated: number, effectiveCapacity: number): number {
  const BASE_SPREAD = 0.5;
  const MAX_SPREAD = 1.5;
  if (effectiveCapacity <= 0) return BASE_SPREAD;
  const utilization = Math.min(1, currentAllocated / effectiveCapacity);
  return Number.parseFloat((BASE_SPREAD + (MAX_SPREAD - BASE_SPREAD) * utilization).toFixed(2));
}

function buildSyntheticAsset(entry: {
  name: string;
  category: string;
  baseScore: number;
  currentAllocated?: number;
}): AssetPriceWithCapacity {
  const def = FALLBACK_ASSET_DEFS.find((d) => d.name === entry.name);
  const maxAllocation = def?.maxAllocation ?? 100_000.0;
  const volatilityBuffer = def?.volatilityBuffer ?? 0.1;
  const effectiveCapacity = maxAllocation * (1 - volatilityBuffer);
  const allocated = entry.currentAllocated ?? 0;
  const spread = computeDynamicSpread(allocated, effectiveCapacity);
  return computeCapacity({
    name: entry.name,
    category: entry.category,
    baseScore: entry.baseScore,
    buyPrice: entry.baseScore + spread,
    redeemPrice: entry.baseScore - spread,
    maxAllocation,
    volatilityBuffer,
    currentAllocated: allocated,
  });
}

function mergeAssets(
  backendAssets: AssetPriceWithCapacity[],
): AssetPriceWithCapacity[] {
  const backendMap = new Map<string, AssetPriceWithCapacity>(
    backendAssets.map((a) => [a.name, a]),
  );

  return allAssets.map((entry) => {
    const live = backendMap.get(entry.name);
    if (live) return live;
    return buildSyntheticAsset(entry);
  });
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────────────────────────

function AssetRowSkeleton() {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-0 px-6 py-5 border-b border-border">
      <div className="hidden sm:block w-8 shrink-0">
        <Skeleton className="h-3 w-4 bg-white/5" />
      </div>
      <div className="flex-1">
        <Skeleton className="h-4 w-32 bg-white/5 mb-2" />
        <Skeleton className="h-3 w-48 bg-white/5" />
        <Skeleton className="h-[3px] w-full bg-white/5 mt-4 rounded-full" />
      </div>
      <div className="flex items-center gap-6 sm:gap-10">
        <Skeleton className="h-8 w-16 bg-white/5" />
        <Skeleton className="h-8 w-20 bg-white/5" />
        <Skeleton className="h-8 w-20 bg-white/5" />
        <Skeleton className="h-8 w-28 bg-white/5" />
      </div>
    </div>
  );
}

// ─── Category Tabs ─────────────────────────────────────────────────────────────────────────────────

// B2: Updated to reflect new index categories
const CATEGORY_TABS = [
  "ALL",
  "MACRO",
  "GEOPOLITICAL",
  "TECHNOLOGY",
  "CULTURAL",
  "SPORTS",
  "HEALTH",
  "INDIVIDUALS",
  "UNIVERSITIES",
  "REGIONAL",
] as const;
type CategoryTab = (typeof CATEGORY_TABS)[number];

// ─── Main Component ──────────────────────────────────────────────────────────────────────────────────

export function AssetList() {
  const { data: assets, isLoading } = useAssetPrices();
  const [activeCategory, setActiveCategory] = useState<CategoryTab>("ALL");
  const { userAccount } = useAuth();
  const userId = userAccount?.email ?? "";
  const hasAllocKey = userId
    ? `${userId}_momentum_has_allocated`
    : "momentum_has_allocated";

  // finalScores from the local Oracle ticker — updated every 60s independently
  // of the TanStack Query refetch cycle. Used to patch baseScore on each card
  // so React.memo in AssetRow detects a prop change and triggers a re-render.
  const { finalScores } = useOracleTick();

  const hasLoadedOnceRef = useRef(false);
  if (assets && assets.length > 0) {
    hasLoadedOnceRef.current = true;
  }

  // ── Hard skeleton timeout (5 s) ───────────────────────────────────────────
  // Regardless of actor/query state, skeleton MUST expire after 5 seconds.
  // This fires once on mount and never resets — AssetList stays mounted.
  const [skeletonExpired, setSkeletonExpired] = useState(false);
  useEffect(() => {
    const timeout = setTimeout(() => setSkeletonExpired(true), 5000);
    return () => clearTimeout(timeout);
  }, []);
  // ─────────────────────────────────────────────────────────────────────────

  const showSkeleton =
    !hasLoadedOnceRef.current && isLoading && !skeletonExpired;

  // ─── Collapsible info blocks ───────────────────────────────────────────────────
  const spreadCollapseKey = "momentum_spread_collapsed";
  const cooldownCollapseKey = "momentum_cooldown_collapsed";

  const [isSpreadInfoCollapsed, setIsSpreadInfoCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    const saved = localStorage.getItem(spreadCollapseKey);
    if (saved !== null) return saved === "true";
    return localStorage.getItem(hasAllocKey) === "true";
  });
  const [isCooldownInfoCollapsed, setIsCooldownInfoCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    const saved = localStorage.getItem(cooldownCollapseKey);
    if (saved !== null) return saved === "true";
    return localStorage.getItem(hasAllocKey) === "true";
  });

  const toggleSpreadCollapsed = (collapsed: boolean) => {
    setIsSpreadInfoCollapsed(collapsed);
    localStorage.setItem(spreadCollapseKey, String(collapsed));
  };
  const toggleCooldownCollapsed = (collapsed: boolean) => {
    setIsCooldownInfoCollapsed(collapsed);
    localStorage.setItem(cooldownCollapseKey, String(collapsed));
  };

  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === hasAllocKey && e.newValue === "true") {
        setIsSpreadInfoCollapsed(true);
        localStorage.setItem(spreadCollapseKey, "true");
        setIsCooldownInfoCollapsed(true);
        localStorage.setItem(cooldownCollapseKey, "true");
      }
    };
    window.addEventListener("storage", handleStorageChange);
    return () => window.removeEventListener("storage", handleStorageChange);
  }, [hasAllocKey]);
  // ──────────────────────────────────────────────────────────────────────────────

  const resolvedAssets = useMemo<AssetPriceWithCapacity[]>(() => {
    let base: AssetPriceWithCapacity[];
    if (assets && assets.length > 0) {
      base = mergeAssets(assets);
    } else if (!isLoading || skeletonExpired) {
      // If skeleton expired but data hasn't arrived yet, use FALLBACK_ASSETS
      // directly (static base scores) so the user always sees something.
      base =
        skeletonExpired && !(assets && assets.length > 0)
          ? FALLBACK_ASSETS
          : mergeAssets([]);
    } else {
      base = FALLBACK_ASSETS;
    }

    // Apply latest pipeline finalScores so every card receives an updated
    // baseScore object — breaking React.memo equality and forcing a re-render.
    if (finalScores.size === 0) return base;

    return base.map((asset) => {
      const pipelineScore = finalScores.get(asset.name);
      if (pipelineScore === undefined) return asset;

      const roundTo2 = (n: number) => Math.round(n * 100) / 100;
      const newBase = roundTo2(pipelineScore);

      // If the backend has returned authoritative prices, preserve them across the tick.
      // The LMSR spread only changes when allocations change, not when the Oracle tick
      // updates the baseScore. Only recompute prices for fallback/synthetic assets that
      // never had a backend read (backendSpread undefined).
      if (asset.backendSpread !== undefined) {
        return computeCapacity({
          ...asset,
          baseScore: newBase,
          buyPrice: roundTo2(newBase + asset.backendSpread),
          redeemPrice: roundTo2(newBase - asset.backendSpread),
          backendSpread: asset.backendSpread,
        });
      }

      // Fallback path: asset came from FALLBACK_ASSET_DEFS, buildSyntheticAsset, or a
      // fallback push. Recompute prices around the new base using the preserved spread.
      const spreadOffset = roundTo2(asset.buyPrice - asset.baseScore);
      return computeCapacity({
        ...asset,
        baseScore: newBase,
        buyPrice: roundTo2(newBase + spreadOffset),
        redeemPrice: roundTo2(newBase - spreadOffset),
        backendSpread: asset.backendSpread,
      });
    });
  }, [assets, isLoading, finalScores, skeletonExpired]);

  // ── DISPLAY FILTER: only show the 7 allowed indexes ──────────────────────
  // Applied after merging — all underlying data and logic remain intact.
  const allowedAssets = useMemo<AssetPriceWithCapacity[]>(
    () => {
      return resolvedAssets.filter((a) => ALLOWED_INDEX_NAMES.has(a.name));
    },
    [resolvedAssets],
  );
  // ─────────────────────────────────────────────────────────────────────

  const filteredAssets = useMemo<AssetPriceWithCapacity[]>(() => {
    if (activeCategory === "ALL") return allowedAssets;
    return allowedAssets.filter((a) => a.category === activeCategory);
  }, [allowedAssets, activeCategory]);

  const counts = useMemo(
    () => ({
      ALL: allowedAssets.length,
      MACRO: allowedAssets.filter((a) => a.category === "MACRO").length,
      GEOPOLITICAL: allowedAssets.filter((a) => a.category === "GEOPOLITICAL")
        .length,
      TECHNOLOGY: allowedAssets.filter((a) => a.category === "TECHNOLOGY")
        .length,
      CULTURAL: allowedAssets.filter((a) => a.category === "CULTURAL").length,
      SPORTS: allowedAssets.filter((a) => a.category === "SPORTS").length,
      HEALTH: allowedAssets.filter((a) => a.category === "HEALTH").length,
      INDIVIDUALS: allowedAssets.filter((a) => a.category === "INDIVIDUALS").length,
      UNIVERSITIES: allowedAssets.filter((a) => a.category === "UNIVERSITIES").length,
      REGIONAL: allowedAssets.filter((a) => a.category === "REGIONAL").length,
    }),
    [allowedAssets],
  );

  return (
    <main className="flex-1 w-full max-w-5xl mx-auto px-4 sm:px-6 py-10">
      {/* Section header */}
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-1">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary animate-pulse-subtle" />
          <span className="text-primary text-xs font-semibold uppercase tracking-widest">
            Live Indices
          </span>
        </div>
        <h2 className="text-foreground text-2xl font-bold tracking-tight">
          Narratives
        </h2>
        <p className="text-muted-foreground text-sm mt-1.5 max-w-lg">
          Allocate capital to gain exposure to proprietary narrative indices.
          Prices are Oracle-driven and updated in real time.
        </p>
      </div>

      {/* Fixed Spread Info Block — collapsible */}
      {allowedAssets.length > 0 ? (
        <div
          style={{
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: "0.5rem",
            overflow: "hidden",
            marginBottom: "0.75rem",
          }}
        >
          {/* Clickable header */}
          <button
            type="button"
            onClick={() => toggleSpreadCollapsed(!isSpreadInfoCollapsed)}
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "0.625rem 0.875rem",
              background: "none",
              border: "none",
              cursor: "pointer",
              backgroundColor: "rgba(255,255,255,0.02)",
            }}
          >
            <span
              style={{
                color: "#8E8E93",
                fontSize: "0.6875rem",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                fontWeight: 500,
                display: "flex",
                alignItems: "center",
                gap: "0.375rem",
              }}
            >
              DYNAMIC SPREAD: LMSR
            </span>
            <ChevronDown
              size={14}
              style={{
                color: "#8E8E93",
                transform: isSpreadInfoCollapsed
                  ? "rotate(-90deg)"
                  : "rotate(0deg)",
                transition: "transform 0.2s ease",
              }}
            />
          </button>
          {/* Collapsible content */}
          {!isSpreadInfoCollapsed && (
            <div style={{ padding: "0 0.875rem 0.75rem 0.875rem" }}>
              <div className="flex items-center gap-3 px-4 py-3 rounded-sm bg-white/[0.03]">
                <div className="w-1 h-8 rounded-full bg-primary/60 shrink-0" />
                <Activity className="w-4 h-4 text-primary/60 shrink-0" />
                <div>
                  <p className="text-foreground text-xs font-medium">
                    Dynamic Spread: LMSR
                  </p>
                  <p className="text-muted-foreground text-xs mt-0.5">
                    Buy price = Momentum Score + dynamic spread · Redeem price =
                    Momentum Score − dynamic spread
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div
          style={{
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: "0.5rem",
            overflow: "hidden",
            marginBottom: "0.75rem",
          }}
        >
          <button
            type="button"
            onClick={() => toggleSpreadCollapsed(!isSpreadInfoCollapsed)}
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "0.625rem 0.875rem",
              background: "none",
              border: "none",
              cursor: "pointer",
              backgroundColor: "rgba(255,255,255,0.02)",
            }}
          >
            <span
              style={{
                color: "#8E8E93",
                fontSize: "0.6875rem",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                fontWeight: 500,
                display: "flex",
                alignItems: "center",
                gap: "0.375rem",
              }}
            >
              Standard Spread: ±0.5
            </span>
            <ChevronDown
              size={14}
              style={{
                color: "#8E8E93",
                transform: isSpreadInfoCollapsed
                  ? "rotate(-90deg)"
                  : "rotate(0deg)",
                transition: "transform 0.2s ease",
              }}
            />
          </button>
          {!isSpreadInfoCollapsed && (
            <div style={{ padding: "0 0.875rem 0.75rem 0.875rem" }}>
              <div className="flex items-center gap-3 px-4 py-3 rounded-sm bg-white/[0.03]">
                <div className="w-1 h-8 rounded-full bg-primary/60 shrink-0" />
                <div>
                  <p className="text-foreground text-xs font-medium">
                    Standard Spread:{" "}
                    <span className="font-mono text-primary">±0.5</span>
                  </p>
                  <p className="text-muted-foreground text-xs mt-0.5">
                    Buy price = Momentum Score + 0.5 · Redeem price = Momentum
                    Score − 0.5
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Oracle Cool-down Period Info Block — collapsible */}
      <div
        style={{
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: "0.5rem",
          overflow: "hidden",
          marginBottom: "1.5rem",
        }}
      >
        {/* Clickable header */}
        <button
          type="button"
          onClick={() => toggleCooldownCollapsed(!isCooldownInfoCollapsed)}
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "0.625rem 0.875rem",
            background: "none",
            border: "none",
            cursor: "pointer",
            backgroundColor: "rgba(255,255,255,0.02)",
          }}
        >
          <span
            style={{
              color: "#8E8E93",
              fontSize: "0.6875rem",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              fontWeight: 500,
              display: "flex",
              alignItems: "center",
              gap: "0.375rem",
            }}
          >
            Oracle Cool-down Period
          </span>
          <ChevronDown
            size={14}
            style={{
              color: "#8E8E93",
              transform: isCooldownInfoCollapsed
                ? "rotate(-90deg)"
                : "rotate(0deg)",
              transition: "transform 0.2s ease",
            }}
          />
        </button>
        {/* Collapsible content */}
        {!isCooldownInfoCollapsed && (
          <div style={{ padding: "0 0.875rem 0.75rem 0.875rem" }}>
            <div className="flex items-center gap-3 px-4 py-3 rounded-sm bg-white/[0.03]">
              <div className="w-1 h-8 rounded-full bg-muted/40 shrink-0" />
              <div>
                <p className="text-foreground text-xs font-medium">
                  Oracle Cool-down Period
                </p>
                <p className="text-muted-foreground text-xs mt-0.5">
                  After allocating, you must wait for the next Oracle cycle
                  before redeeming. This ensures your position is priced through
                  at least one full sentiment cycle, maintaining Oracle
                  integrity.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Category filter tabs — mobile: horizontal scroll; desktop: flex-wrap */}
      <div className="flex items-center gap-1 mb-4 overflow-x-auto scrollbar-hide md:flex-wrap md:overflow-visible">
        {CATEGORY_TABS.map((tab) => {
          const isActive = activeCategory === tab;
          const count = counts[tab];
          return (
            <button
              type="button"
              key={tab}
              onClick={() => setActiveCategory(tab)}
              data-ocid={`assetlist.filter.${tab.toLowerCase()}`}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-sm border text-xs font-semibold uppercase tracking-wider whitespace-nowrap transition-all duration-150 shrink-0 ${
                isActive
                  ? "bg-primary/15 border-primary/40 text-primary"
                  : "bg-transparent border-border/50 text-muted-foreground hover:border-border hover:text-foreground/70"
              }`}
            >
              {tab}
              <span
                className={`inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-[3px] text-[9px] font-bold tabular-nums ${
                  isActive
                    ? "bg-primary/20 text-primary"
                    : "bg-white/[0.06] text-muted-foreground"
                }`}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Asset list */}
      {showSkeleton ? (
        <div className="rounded-sm overflow-hidden">
          <AssetColumnHeaders />
          <LoadingState />
          {[...Array(3)].map((_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton array, never reordered
            <AssetRowSkeleton key={i} />
          ))}
        </div>
      ) : (
        <div className="rounded-sm overflow-hidden">
          <AssetColumnHeaders />
          {filteredAssets.length === 0 ? (
            <div className="px-6 py-12 text-center">
              <p className="text-muted-foreground text-sm">
                No assets in this category.
              </p>
            </div>
          ) : (
            filteredAssets.map((asset, index) => (
              <VirtualizedAssetRow
                key={asset.name}
                asset={asset}
                index={index}
                subLabel={subLabelMap.get(asset.name) ?? ""}
              />
            ))
          )}
        </div>
      )}
    </main>
  );
}
