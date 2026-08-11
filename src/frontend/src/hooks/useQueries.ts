import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useAuth } from "../contexts/AuthContext";
import { useLoyalty } from "../contexts/LoyaltyContext";
import { useOracleTick } from "../contexts/OracleTickContext";
import { FALLBACK_ASSET_DEFS } from "../data/fallbackAssets";
import type {
  AccountStatus,
  AssetPrice,
  Holding,
  NewsEvent,
  Transaction,
  UserProfile,
} from "../types/backendEnums";
import { loadFromCache, saveToCache } from "../utils/cacheUtils";
import { useActor } from "./useActor";

// ── Derived capacity type ─────────────────────────────────────────────────────

export interface AssetPriceWithCapacity extends AssetPrice {
  effectiveCapacity: number; // maxAllocation × (1 − volatilityBuffer)
  isAtCapacity: boolean; // currentAllocated >= effectiveCapacity
  capacityUsedPercent: number; // 0–100
  activeSpread: number; // live spread derived from buyPrice − baseScore
  isVolatilitySpread: boolean; // true when spread is widened to 1.0 (Hot event)
}

export function computeCapacity(asset: AssetPrice): AssetPriceWithCapacity {
  const effectiveCapacity = asset.maxAllocation * (1 - asset.volatilityBuffer);
  const isAtCapacity = asset.currentAllocated >= effectiveCapacity;
  const capacityUsedPercent =
    effectiveCapacity > 0
      ? Math.min(100, (asset.currentAllocated / effectiveCapacity) * 100)
      : 0;
  const activeSpread = Number.parseFloat(
    (asset.buyPrice - asset.baseScore).toFixed(2),
  );
  const isVolatilitySpread = activeSpread >= 1.0;
  return {
    ...asset,
    effectiveCapacity,
    isAtCapacity,
    capacityUsedPercent,
    activeSpread,
    isVolatilitySpread,
  };
}

// ── Stable serialized key for asset data ─────────────────────────────────────
export function assetStableKey(assets: AssetPrice[]): string {
  return assets
    .map(
      (a) =>
        `${a.name}:${a.baseScore}:${a.buyPrice}:${a.redeemPrice}:${a.currentAllocated}`,
    )
    .join("|");
}

// Admin polling interval (10 seconds)
const ADMIN_REFETCH_INTERVAL_MS = 10_000;

// ── Asset Prices ─────────────────────────────────────────────────────────────

export function useAssetPrices() {
  const { actor, isFetching: actorFetching } = useActor();
  const queryClient = useQueryClient();
  const { userAccount } = useAuth();
  const userId = userAccount?.email ?? "";

  // ── Loyalty tier — drives dynamic spread reduction ────────────────────────
  const { tier } = useLoyalty();
  const BASE_SPREAD = 0.5;

  // Read OracleTickContext scores — these are the sole pipeline output source.
  // useOracleTick() is called at hook level (valid), not inside queryFn.
  const { finalScores } = useOracleTick();

  // Serialize finalScores into a stable string so TanStack Query treats each
  // new tick as a distinct query key and re-runs pricing automatically.
  const finalScoresKey = Array.from(finalScores.entries())
    .map(([k, v]) => `${k}:${v}`)
    .join("|");

  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional run-once cache hydration — queryClient is stable
  useEffect(() => {
    const existing = queryClient.getQueryData<AssetPriceWithCapacity[]>([
      "assetPrices",
    ]);
    if (!existing || existing.length === 0) {
      const cached = loadFromCache(userId);
      if (cached && cached.assets.length > 0) {
        queryClient.setQueryData<AssetPriceWithCapacity[]>(
          ["assetPrices"],
          cached.assets,
        );
      }
    }
  }, []);

  // ── Cold-start fallback: seed from FALLBACK_ASSET_DEFS after 3s ─────────────
  // If the actor has not initialized within 3 seconds of mount (e.g. after
  // localStorage clear), force-seed the Query cache so the skeleton resolves.
  // Once the actor does resolve and the real Query executes, its data overwrites
  // this seed automatically via TanStack Query's normal cache update behavior.
  // The enabled gate on the Query below is NOT modified — this is purely additive.
  function buildFallbackAssets(): AssetPriceWithCapacity[] {
    const roundTo2 = (n: number) => Math.round(n * 100) / 100;
    return FALLBACK_ASSET_DEFS.map((def) => {
      const base = roundTo2(def.baseScore);
      const spread = Math.max(0.1, def.spread);
      const buyPrice = roundTo2(base + spread);
      let redeemPrice = roundTo2(base - spread);
      if (redeemPrice < 0) redeemPrice = 0.01;
      return computeCapacity({
        name: def.name,
        category: def.category,
        baseScore: base,
        buyPrice,
        redeemPrice,
        maxAllocation: def.maxAllocation,
        volatilityBuffer: def.volatilityBuffer,
        currentAllocated: 0,
      });
    });
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional run-once timeout — queryClient and buildFallbackAssets are stable
  useEffect(() => {
    const timeout = setTimeout(() => {
      const existing = queryClient.getQueryData(["assetPrices"]);
      if (!existing || (existing as unknown[]).length === 0) {
        queryClient.setQueryData(["assetPrices"], buildFallbackAssets());
      }
    }, 3000);
    return () => clearTimeout(timeout);
  }, []);

  const query = useQuery<AssetPriceWithCapacity[]>({
    // Include finalScoresKey so the query re-runs on every Oracle tick.
    queryKey: ["assetPrices", finalScoresKey],
    queryFn: async () => {
      if (!actor) return [];
      const roundTo2 = (n: number) => Math.round(n * 100) / 100;

      // Read local holdings from localStorage to compute real per-index capacity usage
      let localHoldingsMap: Record<string, { units: number }> = {};
      try {
        const raw = localStorage.getItem("sentimentam_local_holdings_v5");
        if (raw) {
          localHoldingsMap = JSON.parse(raw) as Record<
            string,
            { units: number }
          >;
        }
      } catch {
        /* ignore */
      }

      // Phase 1 skipped — all 53 assets built from FALLBACK_ASSET_DEFS in Phase 2.
      const result: AssetPriceWithCapacity[] = [];

      // ── Append Oracle-scored indices that the backend didn't return ────────
      // Without this, God-Tier indices absent from the canister would never
      // surface in assetPrices and AssetList.mergeAssets would keep using
      // static FALLBACK_ASSETS values.
      const ACTIVE_INDICES = FALLBACK_ASSET_DEFS.map((d) => d.name);
      const missingCount = ACTIVE_INDICES.filter((name) => !result.find((r) => r.name === name)).length;
      for (const indexName of ACTIVE_INDICES) {
        if (!result.find((r) => r.name === indexName)) {
          const fallback = FALLBACK_ASSET_DEFS.find(
            (a) => a.name === indexName,
          );

          if (fallback) {
            const oracleScore = finalScores.get(indexName);

            const resolvedBase =
              oracleScore !== undefined && oracleScore > 0
                ? oracleScore
                : fallback.baseScore > 0
                  ? fallback.baseScore
                  : 50.0;
            const base = roundTo2(resolvedBase);

            // ── Pricing for fallback-appended indices ───────────────────────
            // These indices are absent from the backend response, so there are
            // no backend-returned buy/redeem prices to use. The frontend
            // applies a static BASE_SPREAD (reduced by loyalty tier) only — no
            // LMSR override, no crisis override, no circuit-breaker re-pricing.
            const MINIMUM_SPREAD = 0.1;
            const MAX_SPREAD = 1.5;
            const loyaltyReduction = tier?.spreadReduction ?? 0;

            // Compute currentAllocated first so spread can widen with utilization
            const localUnits = localHoldingsMap[indexName]?.units ?? 0;
            const effectiveCapacity = fallback.maxAllocation * (1 - fallback.volatilityBuffer);
            // Rough allocated estimate using base score before spread is known
            const currentAllocated = localUnits * (base - MINIMUM_SPREAD);

            // Dynamic spread: widens linearly from BASE_SPREAD to MAX_SPREAD as utilization rises
            const utilization = effectiveCapacity > 0 ? Math.min(1, currentAllocated / effectiveCapacity) : 0;
            const dynamicSpread = BASE_SPREAD + (MAX_SPREAD - BASE_SPREAD) * utilization;
            const fallbackSpread = Math.max(
              MINIMUM_SPREAD,
              dynamicSpread - loyaltyReduction,
            );
            const fallbackBuyPrice = roundTo2(base + fallbackSpread);
            let fallbackRedeemPrice = roundTo2(base - fallbackSpread);
            if (fallbackRedeemPrice < 0) fallbackRedeemPrice = 0.01;

            const redeemForCapacity = fallbackRedeemPrice;

            result.push(
              computeCapacity({
                name: fallback.name,
                category: fallback.category,
                baseScore: base,
                buyPrice: fallbackBuyPrice,
                redeemPrice: redeemForCapacity,
                maxAllocation: fallback.maxAllocation,
                volatilityBuffer: fallback.volatilityBuffer,
                currentAllocated,
              }),
            );
          }
        }
      }

      return result;
      // ─────────────────────────────────────────────────────────────────────
    },
    enabled: !!actor && !actorFetching,
    // staleTime: Infinity — this query is driven entirely by the finalScoresKey
    // in the query key. It does not self-refresh on a timer. OracleTickContext
    // is the sole pipeline executor; changing finalScoresKey triggers re-pricing.
    staleTime: Number.POSITIVE_INFINITY,
    refetchInterval: false,
    placeholderData: (prev) => prev,
  });

  // Alias the query key to the canonical ["assetPrices"] key so all existing
  // consumers (queryClient.getQueryData(["assetPrices"]), invalidateQueries, etc.)
  // continue to work unchanged. We write the priced result into the base key
  // whenever the scoring-keyed query produces fresh data.
  // biome-ignore lint/correctness/useExhaustiveDependencies: query.data identity triggers this intentionally; queryClient is stable
  useEffect(() => {
    if (query.data && query.data.length > 0) {
      queryClient.setQueryData<AssetPriceWithCapacity[]>(
        ["assetPrices"],
        query.data,
      );
    }
  }, [query.data]);

  const assetsKey = query.data ? assetStableKey(query.data) : "";

  // biome-ignore lint/correctness/useExhaustiveDependencies: assetsKey is a stable derived string — queryClient and saveToCache are stable references
  useEffect(() => {
    const assets = query.data;
    if (!assets || assets.length === 0) return;

    const walletBalance =
      queryClient.getQueryData<number>(["walletBalance"]) ?? 0;
    const holdings =
      queryClient.getQueryData<Array<[string, Holding]>>(["holdings"]) ?? [];

    const holdingsValue = holdings.reduce((sum, [assetName, holding]) => {
      const assetPrice = assets.find((a) => a.name === assetName);
      if (!assetPrice || holding.units <= 0) return sum;
      return sum + holding.units * assetPrice.redeemPrice;
    }, 0);

    const totalPortfolioValue = walletBalance + holdingsValue;
    saveToCache(userId, assets, totalPortfolioValue);
  }, [assetsKey]);

  return query;
}

// ── Wallet Balance ────────────────────────────────────────────────────────────

export function useWallet() {
  const { actor, isFetching: actorFetching } = useActor();
  const ORACLE_REFETCH_INTERVAL_MS = 60_000;

  return useQuery<number>({
    queryKey: ["walletBalance"],
    queryFn: async () => {
      if (!actor) return 1000;
      return actor.getWalletBalance();
    },
    enabled: !!actor && !actorFetching,
    refetchInterval: ORACLE_REFETCH_INTERVAL_MS,
  });
}

// ── Holdings ─────────────────────────────────────────────────────────────────

export function useHoldings() {
  const { actor, isFetching: actorFetching } = useActor();
  const ORACLE_REFETCH_INTERVAL_MS = 60_000;

  return useQuery<Array<[string, Holding]>>({
    queryKey: ["holdings"],
    queryFn: async () => {
      if (!actor) return [];
      return actor.getAllHoldings();
    },
    enabled: !!actor && !actorFetching,
    refetchInterval: ORACLE_REFETCH_INTERVAL_MS,
  });
}

// ── Next Refresh Time ─────────────────────────────────────────────────────────

export function useNextRefreshTime() {
  const { actor, isFetching: actorFetching } = useActor();
  const ORACLE_REFETCH_INTERVAL_MS = 60_000;

  return useQuery<bigint>({
    queryKey: ["nextRefreshTimeNs"],
    queryFn: async () => {
      if (!actor) return BigInt(0);
      return actor.getNextRefreshTimeNs();
    },
    enabled: !!actor && !actorFetching,
    refetchInterval: ORACLE_REFETCH_INTERVAL_MS,
  });
}

// ── Transaction History ───────────────────────────────────────────────────────

export function useTransactionHistory() {
  const { actor, isFetching: actorFetching } = useActor();

  return useQuery<Transaction[]>({
    queryKey: ["transactionHistory"],
    queryFn: async () => {
      if (!actor) return [];
      return actor.getTransactionHistory();
    },
    enabled: !!actor && !actorFetching,
  });
}

// ── User Profile ──────────────────────────────────────────────────────────────

export function useGetCallerUserProfile() {
  const { actor, isFetching: actorFetching } = useActor();

  const query = useQuery<UserProfile | null>({
    queryKey: ["currentUserProfile"],
    queryFn: async () => {
      if (!actor) throw new Error("Actor not available");
      return actor.getCallerUserProfile();
    },
    enabled: !!actor && !actorFetching,
    retry: false,
  });

  return {
    ...query,
    isLoading: actorFetching || query.isLoading,
    isFetched: !!actor && query.isFetched,
  };
}

// ── Mutations ─────────────────────────────────────────────────────────────────

export function useAllocateFunds() {
  const { actor } = useActor();
  const queryClient = useQueryClient();

  return useMutation<
    boolean,
    Error,
    { assetName: string; allocationAmount: number }
  >({
    mutationFn: async ({ assetName, allocationAmount }) => {
      if (!actor) throw new Error("Actor not ready");
      let success: boolean;
      try {
        success = await actor.allocateFunds(assetName, allocationAmount);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (
          msg.toLowerCase().includes("capacity") ||
          msg.toLowerCase().includes("max")
        ) {
          throw new Error("Capacity reached — this index is fully allocated.");
        }
        if (msg.toLowerCase().includes("paused")) {
          throw new Error(
            "Trading is currently paused. Please try again later.",
          );
        }
        throw new Error("Allocation failed. Please try again.");
      }
      if (!success) {
        const prices = queryClient.getQueryData<AssetPriceWithCapacity[]>([
          "assetPrices",
        ]);
        const asset = prices?.find((p) => p.name === assetName);
        if (asset?.isAtCapacity) {
          throw new Error("Capacity reached — this index is fully allocated.");
        }
        throw new Error("Insufficient wallet balance");
      }
      return success;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["walletBalance"] });
      queryClient.invalidateQueries({ queryKey: ["holdings"] });
      queryClient.invalidateQueries({ queryKey: ["assetPrices"] });
      queryClient.invalidateQueries({ queryKey: ["cooldownStatus"] });
      queryClient.invalidateQueries({ queryKey: ["currentUserProfile"] });
    },
  });
}

export function useRedeemAll() {
  const { actor } = useActor();
  const queryClient = useQueryClient();

  return useMutation<boolean, Error, { assetName: string }>({
    mutationFn: async ({ assetName }) => {
      if (!actor) throw new Error("Actor not ready");
      const success = await actor.redeemAll(assetName);
      if (!success) {
        const holdings = queryClient.getQueryData<Array<[string, Holding]>>([
          "holdings",
        ]);
        const holding = holdings?.find(([name]) => name === assetName)?.[1];
        if (holding && holding.units > 0) {
          throw new Error("COOLDOWN_ACTIVE");
        }
        throw new Error("No units to redeem");
      }
      return success;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["walletBalance"] });
      queryClient.invalidateQueries({ queryKey: ["holdings"] });
      queryClient.invalidateQueries({ queryKey: ["assetPrices"] });
      queryClient.invalidateQueries({ queryKey: ["cooldownStatus"] });
    },
  });
}

export function useRedeemPartial() {
  const { actor } = useActor();
  const queryClient = useQueryClient();

  return useMutation<boolean, Error, { assetName: string; units: number }>({
    mutationFn: async ({ assetName, units }) => {
      if (!actor) throw new Error("Actor not ready");
      // Mirror useRedeemAll pattern with units parameter added.
      // Falls back gracefully if backend does not expose redeemPartial yet.
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const actorAny = actor as any;
        if (typeof actorAny.redeemPartial === "function") {
          const success = await actorAny.redeemPartial(assetName, units);
          if (!success)
            throw new Error("Partial redemption rejected by backend");
          return success as boolean;
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!msg.includes("is not a function")) throw err;
      }
      // Backend endpoint not yet available — local-only path handles it.
      return true;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["walletBalance"] });
      queryClient.invalidateQueries({ queryKey: ["holdings"] });
      queryClient.invalidateQueries({ queryKey: ["assetPrices"] });
      queryClient.invalidateQueries({ queryKey: ["cooldownStatus"] });
    },
  });
}

export function useDepositFunds() {
  const { actor } = useActor();
  const queryClient = useQueryClient();

  return useMutation<void, Error, number>({
    mutationFn: async (amount) => {
      if (!actor) throw new Error("Actor not available");
      return actor.depositFunds(amount);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["walletBalance"] });
    },
  });
}

export function useSaveUserProfile() {
  const { actor } = useActor();
  const queryClient = useQueryClient();

  return useMutation<void, Error, UserProfile>({
    mutationFn: async (profile) => {
      if (!actor) throw new Error("Actor not available");
      return actor.saveCallerUserProfile(profile);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["currentUserProfile"] });
    },
  });
}

// ── Admin Hooks ───────────────────────────────────────────────────────────────

export function useAdminTotalUsers() {
  const { actor, isFetching: actorFetching } = useActor();

  return useQuery<bigint>({
    queryKey: ["adminTotalUsers"],
    queryFn: async () => {
      if (!actor) return BigInt(0);
      return actor.getTotalUsers();
    },
    enabled: !!actor && !actorFetching,
    refetchInterval: ADMIN_REFETCH_INTERVAL_MS,
  });
}

export function useAdminTotalPlatformTVL() {
  const { actor, isFetching: actorFetching } = useActor();

  return useQuery<number>({
    queryKey: ["adminTotalPlatformTVL"],
    queryFn: async () => {
      if (!actor) return 0;
      return actor.getTotalPlatformTVL();
    },
    enabled: !!actor && !actorFetching,
    refetchInterval: ADMIN_REFETCH_INTERVAL_MS,
  });
}

export function useAdminOracleStatus() {
  const { actor, isFetching: actorFetching } = useActor();

  return useQuery<string>({
    queryKey: ["adminOracleStatus"],
    queryFn: async () => {
      if (!actor) return "UNKNOWN";
      return actor.getOracleStatus();
    },
    enabled: !!actor && !actorFetching,
    refetchInterval: ADMIN_REFETCH_INTERVAL_MS,
  });
}

export function useAdminRecentTransactions(limit = 20) {
  const { actor, isFetching: actorFetching } = useActor();

  return useQuery<Transaction[]>({
    queryKey: ["adminRecentTransactions", limit],
    queryFn: async () => {
      if (!actor) return [];
      return actor.getRecentTransactions(BigInt(limit));
    },
    enabled: !!actor && !actorFetching,
    refetchInterval: ADMIN_REFETCH_INTERVAL_MS,
  });
}

export function useAdminSentimentScores() {
  const { actor, isFetching: actorFetching } = useActor();

  return useQuery<Array<[string, number]>>({
    queryKey: ["adminSentimentScores"],
    queryFn: async () => {
      if (!actor) return [];
      return actor.getSentimentScores();
    },
    enabled: !!actor && !actorFetching,
    refetchInterval: ADMIN_REFETCH_INTERVAL_MS,
  });
}

export function useAdminLatestHeadlines(limit = 10) {
  const { actor, isFetching: actorFetching } = useActor();

  return useQuery<NewsEvent[]>({
    queryKey: ["adminLatestHeadlines", limit],
    queryFn: async () => {
      if (!actor) return [];
      return actor.getLatestHeadlines(BigInt(limit));
    },
    enabled: !!actor && !actorFetching,
    refetchInterval: ADMIN_REFETCH_INTERVAL_MS,
  });
}

export function useAdminAllUsers() {
  const { actor, isFetching: actorFetching } = useActor();

  return useQuery<Array<[string, number, number, number, AccountStatus]>>({
    queryKey: ["adminAllUsers"],
    queryFn: async () => {
      if (!actor) return [];
      return actor.getAllUsers();
    },
    enabled: !!actor && !actorFetching,
    refetchInterval: ADMIN_REFETCH_INTERVAL_MS,
  });
}

export function useAdminSetUserStatus() {
  const { actor } = useActor();
  const queryClient = useQueryClient();

  return useMutation<void, Error, { username: string; status: AccountStatus }>({
    mutationFn: async ({ username, status }) => {
      if (!actor) throw new Error("Actor not available");
      return actor.setUserStatus(username, status);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["adminAllUsers"] });
    },
  });
}

// ── Subsidy Reserves ──────────────────────────────────────────────────────────
// Per-index subsidy reserve map: Array<[indexName, reserveAmount]>.
// getTotalSubsidyReserve() returns the summed Float total of all per-index
// reserves. Both are PUBLIC queries — no auth restriction.

export function useSubsidyReserves() {
  const { actor, isFetching: actorFetching } = useActor();
  const ORACLE_REFETCH_INTERVAL_MS = 60_000;

  return useQuery<Array<[string, number]>>({
    queryKey: ["subsidyReserves"],
    queryFn: async () => {
      if (!actor) return [];
      return actor.getSubsidyReserves();
    },
    enabled: !!actor && !actorFetching,
    refetchInterval: ORACLE_REFETCH_INTERVAL_MS,
  });
}

export function useTotalSubsidyReserve() {
  const { actor, isFetching: actorFetching } = useActor();
  const ORACLE_REFETCH_INTERVAL_MS = 60_000;

  return useQuery<number>({
    queryKey: ["totalSubsidyReserve"],
    queryFn: async () => {
      if (!actor) return 0;
      return actor.getTotalSubsidyReserve();
    },
    enabled: !!actor && !actorFetching,
    refetchInterval: ORACLE_REFETCH_INTERVAL_MS,
  });
}

// ── HuggingFace API Key ───────────────────────────────────────────────────────
// Admin-gated backend methods for managing the HuggingFace API key used by the
// sentiment pipeline. setHuggingFaceKey persists the key on the canister;
// getHuggingFaceKeyStatus returns a human-readable status string (e.g. "SET",
// "UNSET"). isCallerAdmin gates the admin UI surface.

export function useSetHuggingFaceKey() {
  const { actor } = useActor();
  const queryClient = useQueryClient();

  return useMutation<void, Error, string>({
    mutationFn: async (key) => {
      if (!actor) throw new Error("Actor not available");
      return actor.setHuggingFaceKey(key);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["huggingface-key-status"] });
    },
  });
}

export function useHuggingFaceKeyStatus() {
  const { actor, isFetching: actorFetching } = useActor();

  return useQuery<string>({
    queryKey: ["huggingface-key-status"],
    queryFn: async () => {
      if (!actor) return "UNKNOWN";
      return actor.getHuggingFaceKeyStatus();
    },
    enabled: !!actor && !actorFetching,
  });
}

// ── Finnhub API Key ───────────────────────────────────────────────────────────
// Admin-gated backend methods for managing the Finnhub API key used by the
// market data pipeline. setFinnhubKey persists the key on the canister;
// getFinnhubKeyStatus returns a human-readable status string (e.g. "SET",
// "UNSET"). Mirrors the HuggingFace key hooks exactly (same error handling,
// same mutation shape, same query return type).

export function useSetFinnhubKey() {
  const { actor } = useActor();
  const queryClient = useQueryClient();

  return useMutation<void, Error, string>({
    mutationFn: async (key) => {
      if (!actor) throw new Error("Actor not available");
      return actor.setFinnhubKey(key);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["finnhub-key-status"] });
    },
  });
}

export function useFinnhubKeyStatus() {
  const { actor, isFetching: actorFetching } = useActor();

  return useQuery<string>({
    queryKey: ["finnhub-key-status"],
    queryFn: async () => {
      if (!actor) return "UNKNOWN";
      return actor.getFinnhubKeyStatus();
    },
    enabled: !!actor && !actorFetching,
  });
}

export function useIsCallerAdmin() {
  const { actor, isFetching: actorFetching } = useActor();

  return useQuery<boolean>({
    queryKey: ["is-caller-admin"],
    queryFn: async () => {
      if (!actor) return false;
      try {
        return await actor.isCallerAdmin();
      } catch {
        // The backend traps (rejects) for unregistered principals.
        // Treat a trapping query as "not admin" so the gate resolves to
        // a concrete boolean instead of leaving .data undefined forever.
        return false;
      }
    },
    retry: false,
    enabled: !!actor && !actorFetching,
  });
}
