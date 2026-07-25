import { useCallback, useEffect, useState } from "react";

const BREAK_EVEN_HOURS = 24;
const NS_PER_MS = 1_000_000n;

interface YieldProgressResult {
  /** 0–100, clamped */
  progressPercent: number;
  /** true when elapsed >= 24 hours */
  isComplete: boolean;
  /** raw elapsed hours */
  elapsedHours: number;
}

/**
 * Tracks how far along the 24-hour break-even window a holding is.
 * Updates every minute via setInterval.
 * @param yieldStartTime - nanoseconds (bigint) from the backend
 */
export function useYieldProgress(yieldStartTime: bigint): YieldProgressResult {
  const compute = useCallback((): YieldProgressResult => {
    if (yieldStartTime === 0n) {
      return { progressPercent: 0, isComplete: false, elapsedHours: 0 };
    }
    const nowMs = BigInt(Date.now());
    const startMs = yieldStartTime / NS_PER_MS;
    const elapsedMs = nowMs > startMs ? nowMs - startMs : 0n;
    const elapsedHours = Number(elapsedMs) / (1000 * 3600);
    const progressPercent = Math.min(
      (elapsedHours / BREAK_EVEN_HOURS) * 100,
      100,
    );
    const isComplete = elapsedHours >= BREAK_EVEN_HOURS;
    return { progressPercent, isComplete, elapsedHours };
  }, [yieldStartTime]);

  const [result, setResult] = useState<YieldProgressResult>(compute);

  // Recompute when yieldStartTime changes (compute already captures yieldStartTime via useCallback)
  useEffect(() => {
    setResult(compute());
  }, [compute]);

  // Tick every minute
  useEffect(() => {
    const interval = setInterval(() => {
      setResult(compute());
    }, 60_000);
    return () => clearInterval(interval);
  }, [compute]);

  return result;
}
