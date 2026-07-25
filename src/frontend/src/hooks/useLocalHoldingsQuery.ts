/**
 * useLocalHoldingsQuery
 *
 * Drop-in replacement for useHoldings() that reads from LocalHoldingsContext
 * (localStorage) instead of the Motoko backend actor.
 *
 * Returns the same shape as the TanStack query: { data, isLoading }
 * so existing consumers (AssetRow, PortfolioHeader) need minimal changes.
 */

import { useLocalHoldings } from "../contexts/LocalHoldingsContext";

export function useLocalHoldingsQuery() {
  const { holdings, isLoading } = useLocalHoldings();
  return {
    data: holdings,
    isLoading,
  };
}
