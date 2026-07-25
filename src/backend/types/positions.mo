// Positions domain — type definitions.
// Owns the per-user-asset Position record, short/long mark-to-market view
// shapes, the velocity circuit-breaker status, and the allocate/redeem-short
// result variants. Cross-cutting primitives (Principal, Text, Float, Int)
// come from mo:core and the composition root.

import Principal "mo:core/Principal";

module {
  /// Composite key for the per-user-asset position map: (userPrincipal, assetName).
  /// Replaces the previous assetName-only key so positions are isolated per user.
  public type PositionKey = (Principal, Text);

  /// Per-user-asset position. Replaces the legacy single `units : Float`
  /// Holding with separate long/short legs, each carrying its own
  /// weighted-average entry score, plus the original open timestamp.
  ///
  /// - longUnits / longEntryScore: long leg; 0.0 when no long position exists.
  /// - shortUnits / shortEntryScore: short leg; 0.0 when no short position exists.
  /// - openedAt: timestamp of the first position open in this index,
  ///   preserved from the legacy allocationTimestamp during migration.
  public type Position = {
    longUnits : Float;
    longEntryScore : Float;
    shortUnits : Float;
    shortEntryScore : Float;
    openedAt : Int;
  };

  /// Direction tag passed to spread pricing so short entries can apply the
  /// elevated-score spread multiplier. `#long` keeps the legacy behaviour.
  public type TradeDirection = {
    #long;
    #short;
  };

  /// Read-only view of a user's short leg on a single asset, returned by
  /// getUserShortPosition. `markToMarketValue` is the floored short MTM
  /// (shortUnits × (2 × shortEntryScore − currentBaseScore), clamped at 0.0).
  public type ShortPositionView = {
    shortUnits : Float;
    shortEntryScore : Float;
    markToMarketValue : Float;
  };

  /// Read-only view of both legs of a user's position on a single asset,
  /// returned by getUserFullPosition. Each leg carries its own MTM value.
  public type FullPositionView = {
    longUnits : Float;
    longEntryScore : Float;
    longMarkToMarketValue : Float;
    shortUnits : Float;
    shortEntryScore : Float;
    shortMarkToMarketValue : Float;
  };

  /// Velocity circuit-breaker status for a single asset, returned by
  /// getCircuitBreakerStatus. `velocity` is the absolute point change per
  /// tick averaged over the last 5 ticks; `breakerActive` is true when
  /// velocity exceeds 3.0 points/tick, which blocks new short entries.
  public type CircuitBreakerStatus = {
    velocity : Float;
    breakerActive : Bool;
  };

  /// Result of allocateShort. `#ok` carries the units actually opened;
  /// `#err` carries a descriptive error message (cap exceeded, circuit
  /// breaker active, insufficient balance, unknown asset, etc.).
  public type AllocateShortResult = {
    #ok : { unitsOpened : Float };
    #err : Text;
  };

  /// Result of redeemShort. `#ok` carries the dollar value credited to the
  /// wallet; `#err` carries a descriptive error message.
  public type RedeemShortResult = {
    #ok : { valueCredited : Float };
    #err : Text;
  };
};
