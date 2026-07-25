import { useEffect, useRef, useState } from "react";

/**
 * useCountdown
 *
 * Accepts an optional `tickCount` from OracleTickContext.
 * When tickCount increments (i.e., the Oracle fires), the countdown resets to 60.
 * Decrements by 1 every second via a local setInterval.
 *
 * Returns a tuple `[display, secondsLeft]`:
 *   - `display` is a formatted "M:SS" string (e.g., "0:59", "0:09", "0:00").
 *   - `secondsLeft` is the raw numeric seconds remaining (e.g., for color cues).
 *
 * Legacy signature (nextRefreshTimeNs: bigint | undefined) is kept for
 * backwards compatibility but is no longer used — the local timer is the
 * source of truth.
 */
export function useCountdown(
  _nextRefreshTimeNs?: bigint | undefined,
  tickCount?: number,
): [string, number] {
  const [secondsLeft, setSecondsLeft] = useState(30);
  // Track the last tickCount we've seen so we can detect a new Oracle tick.
  const lastTickRef = useRef<number | undefined>(tickCount);

  // Reset to 60 the moment a new Oracle tick arrives.
  useEffect(() => {
    if (tickCount !== undefined && tickCount !== lastTickRef.current) {
      lastTickRef.current = tickCount;
      setSecondsLeft(30);
    }
  }, [tickCount]);

  // Decrement every second.
  useEffect(() => {
    const interval = setInterval(() => {
      if (document.hidden) return;
      setSecondsLeft((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const minutes = Math.floor(secondsLeft / 60);
  const secs = secondsLeft % 60;
  const display = `${minutes}:${secs.toString().padStart(2, "0")}`;
  return [display, secondsLeft] as const;
}
