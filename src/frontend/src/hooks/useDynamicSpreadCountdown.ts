import { useEffect, useRef, useState } from "react";

const DYNAMIC_SPREAD_DURATION_MS = 10 * 60 * 1000; // 10 minutes in ms

/**
 * Tracks when a dynamic spread (isActive = true) was first detected and returns
 * a live "M:SS" countdown string for the remaining duration (10 minutes).
 * Returns null when the spread is not active or the countdown has expired.
 */
export function useDynamicSpreadCountdown(isActive: boolean): string | null {
  // Timestamp (ms) when the dynamic spread was first detected in this session
  const activationTimeRef = useRef<number | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  useEffect(() => {
    if (!isActive) {
      // Spread deactivated — clear tracking
      activationTimeRef.current = null;
      setSecondsLeft(null);
      return;
    }

    // Record activation time if not already set
    if (activationTimeRef.current === null) {
      activationTimeRef.current = Date.now();
    }

    const computeSecondsLeft = () => {
      if (activationTimeRef.current === null) return 0;
      const elapsed = Date.now() - activationTimeRef.current;
      return Math.max(
        0,
        Math.round((DYNAMIC_SPREAD_DURATION_MS - elapsed) / 1000),
      );
    };

    setSecondsLeft(computeSecondsLeft());

    const interval = setInterval(() => {
      const secs = computeSecondsLeft();
      setSecondsLeft(secs);
      if (secs <= 0) {
        clearInterval(interval);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [isActive]);

  if (!isActive || secondsLeft === null || secondsLeft <= 0) return null;

  const minutes = Math.floor(secondsLeft / 60);
  const secs = secondsLeft % 60;
  return `${minutes}:${secs.toString().padStart(2, "0")}`;
}
