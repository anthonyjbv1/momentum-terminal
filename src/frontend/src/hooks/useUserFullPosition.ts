import { useQuery } from "@tanstack/react-query";
import type { FullPositionView } from "../backend";
import { useActor } from "./useActor";

export interface UserFullPosition {
  longUnits: number;
  longEntryScore: number;
  longMarkToMarket: number;
  shortUnits: number;
  shortEntryScore: number;
  shortMarkToMarket: number;
}

const REFRESH_INTERVAL_MS = 30_000;
const STALE_TIME_MS = 10_000;

export function useUserFullPosition(assetName: string) {
  const { actor, isFetching: actorFetching } = useActor();

  return useQuery<UserFullPosition | null>({
    queryKey: ["userFullPosition", assetName],
    queryFn: async () => {
      if (!actor) return null;
      const result: FullPositionView =
        await actor.getUserFullPosition(assetName);
      console.log(
        "[useUserFullPosition] raw backend response:",
        JSON.stringify(result),
      );
      console.log("[useUserFullPosition] mapped output:", {
        longUnits: result?.longUnits,
        longEntryScore: result?.longEntryScore,
        longMarkToMarket: result?.longMarkToMarketValue,
        shortUnits: result?.shortUnits,
        shortEntryScore: result?.shortEntryScore,
        shortMarkToMarket: result?.shortMarkToMarketValue,
      });
      return {
        longUnits: result.longUnits,
        longEntryScore: result.longEntryScore,
        longMarkToMarket: result.longMarkToMarketValue,
        shortUnits: result.shortUnits,
        shortEntryScore: result.shortEntryScore,
        shortMarkToMarket: result.shortMarkToMarketValue,
      };
    },
    enabled: !!actor && !actorFetching && !!assetName,
    refetchInterval: REFRESH_INTERVAL_MS,
    staleTime: STALE_TIME_MS,
  });
}
