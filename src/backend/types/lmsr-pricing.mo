// LMSR pricing domain — type definitions.
// Cross-cutting primitives (Text, Float, Int) come from mo:core and the
// composition root; this module owns only the LMSR-specific shapes.

module {
  /// Liquidity parameter for the LMSR cost function. Fixed at 5000.0 per the
  /// project's user preferences — NOT admin-configurable (excluded by
  /// doNotBuild). Defined here as a typed constant so lib and mixin share one
  /// source of truth.
  public let LMSR_B : Float = 5000.0;

  /// Floor on the computed LMSR spread so prices never collapse to a zero
  /// spread when one outcome dominates the market.
  public let LMSR_MIN_SPREAD : Float = 0.5;

  /// Multiplier applied to the raw (1 - marginalPrice) term before clamping
  /// against LMSR_MIN_SPREAD. Scales the LMSR marginal-price gap into the
  /// spread magnitude used by allocate/redeem pricing.
  public let LMSR_SCALE_FACTOR : Float = 3.0;

  /// Per-index subsidy reserve entry: the cumulative spread revenue credited
  /// for a single index. Stored in a Map<Text, Float> keyed by asset name.
  public type SubsidyReserveEntry = (Text, Float);

  /// Snapshot of the per-index subsidy reserves returned by
  /// getSubsidyReserves(). A flat array of (assetName, reserve) pairs so it
  /// crosses the shared-API boundary cleanly.
  public type SubsidyReserveMap = [SubsidyReserveEntry];
};
