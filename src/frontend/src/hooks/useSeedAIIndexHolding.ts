/**
 * useSeedAIIndexHolding
 *
 * On the very first session (no backend holdings seeded yet), calls
 * actor.allocateFunds("AI Index", 7550) to add 100 units at the fallback
 * buy price of $75.50/unit.
 *
 * Guards:
 *  - Runs only once per device via localStorage flag "sentimentam_holdings_seeded"
 *  - Waits until the actor is ready before attempting the call
 *  - Does NOT touch wallet balance or activity log (WalletContext handles those)
 */

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { useActor } from "./useActor";

const HOLDINGS_SEEDED_FLAG = "sentimentam_holdings_seeded";

// Must match WalletContext constants
const AI_INDEX_NAME = "AI Regulation Risk Sentiment";
const AI_INDEX_SEED_COST = 7550; // 100 units × $75.50

export function useSeedAIIndexHolding(): void {
  const { actor } = useActor();
  const queryClient = useQueryClient();
  const hasAttempted = useRef(false);

  useEffect(() => {
    // Guard: already seeded or already attempted this session
    if (hasAttempted.current) return;
    if (localStorage.getItem(HOLDINGS_SEEDED_FLAG) === "true") return;
    if (!actor) return;

    hasAttempted.current = true;

    actor
      .allocateFunds(AI_INDEX_NAME, AI_INDEX_SEED_COST)
      .then((success) => {
        if (success) {
          localStorage.setItem(HOLDINGS_SEEDED_FLAG, "true");
          // Refresh holdings and wallet queries so the UI reflects the new position
          queryClient.invalidateQueries({ queryKey: ["holdings"] });
          queryClient.invalidateQueries({ queryKey: ["walletBalance"] });
          queryClient.invalidateQueries({ queryKey: ["assetPrices"] });
        }
      })
      .catch(() => {
        // If the call fails (e.g. backend not ready), reset the attempt flag
        // so we can retry on the next render cycle once the actor is stable.
        hasAttempted.current = false;
      });
  }, [actor, queryClient]);
}
