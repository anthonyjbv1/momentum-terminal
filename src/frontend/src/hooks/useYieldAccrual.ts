import { useEffect, useRef, useState } from "react";

// Synthetic yield rate: 0.068% per hour = 0.00068 per hour
const HOURLY_YIELD_RATE = 0.00068;
// Per-minute increment factor (base, before multiplier)
const PER_MINUTE_BASE_RATE = HOURLY_YIELD_RATE / 60;

// Tier benefit is exit spread reduction — yield accrues at flat base rate for all tiers.
function getLoyaltyMultiplier(_allocationTimestamp: bigint): number {
  return 1.0;
}

interface UseYieldAccrualParams {
  /** Base units from the backend (authoritative) */
  baseUnits: number;
  /** Accrued yield already stored on the backend */
  accruedYield: number;
  /** Allocation timestamp in nanoseconds (bigint) — used to derive loyalty multiplier */
  allocationTimestamp?: bigint;
}

/**
 * Returns a live-accruing unit count that increments every minute
 * based on the 0.068%/hr synthetic yield rate scaled by the loyalty multiplier.
 * Resets to the authoritative backend value whenever baseUnits or accruedYield changes.
 */
export function useYieldAccrual({
  baseUnits,
  accruedYield,
  allocationTimestamp,
}: UseYieldAccrualParams): number {
  // Total units = backend units + backend accrued yield (already issued)
  const authoritative = baseUnits + accruedYield;

  const [liveUnits, setLiveUnits] = useState(authoritative);
  const authoritativeRef = useRef(authoritative);
  const allocationTimestampRef = useRef(allocationTimestamp);

  // Keep allocationTimestamp ref current without triggering re-subscription
  useEffect(() => {
    allocationTimestampRef.current = allocationTimestamp;
  }, [allocationTimestamp]);

  // When backend data refreshes, reset to the new authoritative value
  useEffect(() => {
    authoritativeRef.current = authoritative;
    setLiveUnits(authoritative);
  }, [authoritative]);

  // Tick every minute to add synthetic micro-units with loyalty multiplier
  useEffect(() => {
    if (baseUnits <= 0) return;

    const interval = setInterval(() => {
      const multiplier = allocationTimestampRef.current
        ? getLoyaltyMultiplier(allocationTimestampRef.current)
        : 1.0;
      const increment =
        authoritativeRef.current * PER_MINUTE_BASE_RATE * multiplier;
      authoritativeRef.current = authoritativeRef.current + increment;
      setLiveUnits(authoritativeRef.current);
    }, 60_000); // every 60 seconds

    return () => clearInterval(interval);
  }, [baseUnits]);

  return liveUnits;
}
