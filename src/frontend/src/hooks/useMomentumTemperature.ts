// src/frontend/src/hooks/useMomentumTemperature.ts

import { useMemo } from "react";
import { useOracleTick } from "../contexts/OracleTickContext";
import { getSentimentLogScoresForIndex } from "../services/gsiCovarianceEngine";
import {
  type MomentumTemperature,
  computeMomentumTemperature,
} from "../services/momentumTemperature";

export function useMomentumTemperature(
  indexName: string,
  category: string,
): MomentumTemperature {
  const { tickCount } = useOracleTick();

  // tickCount is intentional: it cache-busts this memo on every Oracle tick
  // so the temperature recomputes from fresh sentimentLog data each cycle.
  // biome-ignore lint/correctness/useExhaustiveDependencies: tickCount is an intentional cache-bust signal
  return useMemo(() => {
    const scoreHistory = getSentimentLogScoresForIndex(indexName);
    return computeMomentumTemperature(indexName, category, scoreHistory);
  }, [indexName, category, tickCount]);
}
