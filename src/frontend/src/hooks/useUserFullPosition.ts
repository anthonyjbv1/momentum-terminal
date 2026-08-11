import { useLocalHoldings } from "../contexts/LocalHoldingsContext";
import { useOracleTick } from "../contexts/OracleTickContext";

export interface UserFullPosition {
  longUnits: number;
  longEntryScore: number;
  longMarkToMarket: number;
  shortUnits: number;
  shortEntryScore: number;
  shortMarkToMarket: number;
}

const SPREAD = 0.5;

export function useUserFullPosition(assetName: string) {
  const { shortPositions } = useLocalHoldings();
  const { finalScores } = useOracleTick();

  const short = shortPositions.get(assetName);
  const currentScore = finalScores.get(assetName) ?? 50;

  // Short MTM: dollar-based. P&L = percent move from entry * dollars invested.
  // Profit when score falls, loss when it rises, capped at full loss.
  const shortMTM = short && short.entryScore > 0
    ? Math.max(0, short.dollars + ((short.entryScore - currentScore) / short.entryScore) * short.dollars)
    : 0;

  const data: UserFullPosition = {
    longUnits: 0,
    longEntryScore: 0,
    longMarkToMarket: 0,
    shortUnits: short?.units ?? 0,
    shortEntryScore: short?.entryScore ?? 0,
    shortMarkToMarket: shortMTM,
  };

  return { data, isLoading: false, isError: false };
}
