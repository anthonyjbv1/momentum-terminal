// LMSR pricing domain — library implementation.
// Pure, stateless LMSR cost-function math plus subsidy-reserve helpers.
// Actor state (holdings, crisis flags, subsidyReserves map) is passed in by
// the caller so this module stays free of actor coupling and reusable.

import Float "mo:core/Float";
import Map "mo:core/Map";
import Types "../types/lmsr-pricing";
import PositionTypes "../types/positions";
import PositionsLib "./positions";

module {
  /// Computes the dynamic LMSR spread for a single index from the
  /// platform-wide index allocations.
  ///
  /// term_i        = exp(q_i / LMSR_B)
  /// marginalPrice = term_i / sumExp
  /// spread_i      = max(LMSR_MIN_SPREAD, (1.0 - marginalPrice_i) * LMSR_SCALE_FACTOR)
  ///
  /// `allocations` is the full set of (assetName, units) pairs across every
  /// index; `assetName` selects which marginal price the spread is derived
  /// from. Returns a non-negative Float. If the asset is not present in the
  /// allocations map (no holdings yet), the marginal price is 1/N of the
  /// outcome count, which yields a symmetric spread — but to keep the math
  /// robust we treat a missing asset as q_i = 0.
  public func getLMSRSpread(
    allocations : Map.Map<Text, Float>,
    assetName : Text,
  ) : Float {
    // Sum of exp(q_j / LMSR_B) across every index j — the LMSR normaliser.
    var sumExp : Float = 0.0;
    var ownTerm : Float = 0.0;
    var ownFound : Bool = false;

    for ((name, units) in allocations.entries()) {
      let term = Float.exp(units / Types.LMSR_B);
      sumExp += term;
      if (name == assetName) {
        ownTerm := term;
        ownFound := true;
      };
    };

    // No allocations at all → market is empty → symmetric, minimal spread.
    if (sumExp == 0.0) {
      return Types.LMSR_MIN_SPREAD;
    };

    // If the queried asset has no holdings, its q_i is 0 → term = exp(0) = 1.
    let term_i = if (ownFound) { ownTerm } else { Float.exp(0.0) };
    let marginalPrice = term_i / sumExp;
    let rawSpread = (1.0 - marginalPrice) * Types.LMSR_SCALE_FACTOR;
    Float.max(Types.LMSR_MIN_SPREAD, rawSpread);
  };

  /// Resolves the effective spread for an asset, honouring the crisis
  /// override before falling back to LMSR.
  ///
  /// Returns 1.0 when `dynamicSpreadActive` is true AND `currentTime` is
  /// within `dynamicSpreadExpiry`. Auto-resets `dynamicSpreadActive` to false
  /// once the expiry window has passed (mutating the passed `crisisState`
  /// record) before delegating to getLMSRSpread.
  ///
  /// `crisisState` is a mutable record wrapper so the auto-reset propagates
  /// back to the caller (records are shared by reference in Motoko).
  ///
  /// `direction` (optional) tags the trade as `#long` or `#short`. When
  /// `#short`, the LMSR spread is widened by the short-entry spread
  /// multiplier based on how far `currentBaseScore` has risen above the
  /// 20-tick moving average (`movingAverage`). The crisis override spread of
  /// 1.0 takes precedence over all multipliers when active. `#long` (or
  /// null) keeps the legacy behaviour. `currentBaseScore` and
  /// `movingAverage` are ignored when `direction` is not `#short`.
  public func getSpreadForAsset(
    allocations : Map.Map<Text, Float>,
    assetName : Text,
    crisisState : {
      var dynamicSpreadActive : Bool;
      var dynamicSpreadExpiry : Int;
    },
    currentTime : Int,
    direction : ?PositionTypes.TradeDirection,
    currentBaseScore : ?Float,
    movingAverage : ?Float,
  ) : Float {
    // Crisis override takes precedence over all multipliers.
    if (crisisState.dynamicSpreadActive and currentTime <= crisisState.dynamicSpreadExpiry) {
      return 1.0;
    };
    // Auto-reset the crisis flag once the expiry window has passed.
    if (crisisState.dynamicSpreadActive and currentTime > crisisState.dynamicSpreadExpiry) {
      crisisState.dynamicSpreadActive := false;
    };

    let baseSpread = getLMSRSpread(allocations, assetName);

    // Apply the short-entry spread multiplier only for new short entries
    // when both currentBaseScore and movingAverage are supplied.
    switch (direction, currentBaseScore, movingAverage) {
      case (?#short, ?score, ?ma) {
        let multiplier = PositionsLib.shortSpreadMultiplier(score, ma);
        baseSpread * multiplier;
      };
      case (_, _, _) {
        baseSpread;
      };
    };
  };

  /// Credits `units * spread` into the per-index subsidy reserve map for the
  /// given asset. Mutates `subsidyReserves` in place by adding the
  /// spreadRevenue to the existing entry (or creating one at 0.0).
  public func creditSubsidyReserve(
    subsidyReserves : Map.Map<Text, Float>,
    assetName : Text,
    units : Float,
    spread : Float,
  ) : () {
    let spreadRevenue = units * spread;
    let current = switch (subsidyReserves.get(assetName)) {
      case (?reserve) { reserve };
      case null { 0.0 };
    };
    subsidyReserves.add(assetName, current + spreadRevenue);
  };

  /// Returns the per-index subsidy reserves as a flat array of
  /// (assetName, reserve) pairs suitable for the shared API boundary.
  public func getSubsidyReserves(
    subsidyReserves : Map.Map<Text, Float>,
  ) : Types.SubsidyReserveMap {
    subsidyReserves.toArray();
  };

  /// Returns the summed total of every per-index subsidy reserve entry.
  public func getTotalSubsidyReserve(
    subsidyReserves : Map.Map<Text, Float>,
  ) : Float {
    subsidyReserves.foldLeft(
      0.0,
      func(acc : Float, _name : Text, reserve : Float) : Float {
        acc + reserve;
      },
    );
  };
};
