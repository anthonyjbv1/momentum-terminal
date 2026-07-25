// LMSR pricing domain — public API mixin.
// Exposes the read-only subsidy-reserve getters over the shared API. The
// allocate/redeem pricing paths stay in main.mo and call into
// lib/lmsr-pricing.mo directly; only the public query endpoints live here.

import Map "mo:core/Map";
import Types "../types/lmsr-pricing";
import LMSR "../lib/lmsr-pricing";

mixin (subsidyReserves : Map.Map<Text, Float>) {
  /// Returns the per-index subsidy reserve map as a flat array of
  /// (assetName, reserve) pairs. PUBLIC query — no auth restriction; the
  /// Oracle Health Panel reads this to render the reserve breakdown.
  public query func getSubsidyReserves() : async Types.SubsidyReserveMap {
    LMSR.getSubsidyReserves(subsidyReserves);
  };

  /// Returns the summed total of every per-index subsidy reserve entry.
  /// PUBLIC query — no auth restriction; the Oracle Health Panel reads this
  /// to render the total reserve figure.
  public query func getTotalSubsidyReserve() : async Float {
    LMSR.getTotalSubsidyReserve(subsidyReserves);
  };
};
