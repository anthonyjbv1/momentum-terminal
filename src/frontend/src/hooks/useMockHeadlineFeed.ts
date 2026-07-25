import { useEffect, useRef, useState } from "react";
import { getNextHeadline } from "../services/mockHeadlineService";
import type { AuditableNewsEvent } from "../services/mockHeadlineService";

// Aligned to the Oracle tick interval (60 seconds)
const POLL_INTERVAL_MS = 60_000;

/**
 * Polls the local mock headline service on mount and every 60 seconds,
 * aligned with the Oracle tick interval.
 * Returns the current headline filtered to active indexes only.
 * No network requests are made; all data is sourced from the local array.
 */
export function useMockHeadlineFeed(): AuditableNewsEvent {
  const [currentHeadline, setCurrentHeadline] = useState<AuditableNewsEvent>(
    () => getNextHeadline(),
  );
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    intervalRef.current = setInterval(() => {
      setCurrentHeadline(getNextHeadline());
    }, POLL_INTERVAL_MS);

    return () => {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, []);

  return currentHeadline;
}
