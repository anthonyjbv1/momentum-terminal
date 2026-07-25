/**
 * Legacy re-export — new code should use useLoyalty() from LoyaltyContext.
 * Kept for any remaining consumers that haven't been migrated yet.
 */
export type { TierName } from "../contexts/LoyaltyContext";
export type { LoyaltyTierConfig as LoyaltyTierState } from "../contexts/LoyaltyContext";
