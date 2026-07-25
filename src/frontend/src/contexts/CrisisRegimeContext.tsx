/**
 * CrisisRegimeContext
 *
 * Provides global isCrisisMode state derived from the GSI Covariance Engine.
 * Updated every Oracle refresh cycle via the useAssetPrices hook.
 *
 * STRICT SAFETY: No modifications to index.css, tailwind.config.js, or
 * components.json. All color logic is applied via inline Tailwind utility
 * classes conditionally in consuming components.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import {
  getCrisisTriggerIndices,
  getIsCrisisMode,
  getRedemptionFeeRate,
} from "../services/gsiCovarianceEngine";
import { useOracleTick } from "./OracleTickContext";

interface CrisisRegimeContextValue {
  isCrisisMode: boolean;
  redemptionFeeRate: number; // 0.02 normal, 0.05 in crisis
  /** Index names that caused the current crisis to trigger. Empty when not in crisis. */
  crisisTriggerIndices: ReadonlySet<string>;
  /** Called by the Oracle refresh hook after updateCrisisRegime() runs. */
  syncCrisisState: (crisisActive: boolean) => void;
}

const CrisisRegimeContext = createContext<CrisisRegimeContextValue>({
  isCrisisMode: false,
  redemptionFeeRate: 0.02,
  crisisTriggerIndices: new Set(),
  syncCrisisState: () => {},
});

export function CrisisRegimeProvider({ children }: { children: ReactNode }) {
  const [isCrisisMode, setIsCrisisMode] = useState(false);

  const syncCrisisState = useCallback((crisisActive: boolean) => {
    setIsCrisisMode(crisisActive);
  }, []);

  // Sync crisis state on every Oracle tick (tickCount change).
  // This replaces the 5s polling interval — state now updates immediately
  // after the pipeline runs and updateCrisisRegime() writes to the engine.
  const { tickCount } = useOracleTick();

  // biome-ignore lint/correctness/useExhaustiveDependencies: tickCount is the intended trigger; getIsCrisisMode reads engine singleton
  useEffect(() => {
    const engineState = getIsCrisisMode();
    setIsCrisisMode((prev) => (prev !== engineState ? engineState : prev));
  }, [tickCount]);

  // Fallback: also poll every 5 seconds in case the OracleTickContext hasn't
  // fired yet (e.g. on initial mount before the first 2s delay).
  // Ref-based equality check prevents setState from firing when value hasn't changed.
  const prevCrisisRef = useRef<boolean | null>(null);
  useEffect(() => {
    const interval = setInterval(() => {
      const current = getIsCrisisMode();
      if (current !== prevCrisisRef.current) {
        prevCrisisRef.current = current;
        setIsCrisisMode(current);
      }
    }, 5_000);
    return () => clearInterval(interval);
  }, []);

  const redemptionFeeRate = getRedemptionFeeRate();
  const crisisTriggerIndices = getCrisisTriggerIndices();

  return (
    <CrisisRegimeContext.Provider
      value={{
        isCrisisMode,
        redemptionFeeRate,
        crisisTriggerIndices,
        syncCrisisState,
      }}
    >
      {children}
    </CrisisRegimeContext.Provider>
  );
}

export function useCrisisRegime(): CrisisRegimeContextValue {
  return useContext(CrisisRegimeContext);
}
