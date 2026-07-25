// Positions domain — library implementation.
// Pure, stateless short mark-to-market, velocity circuit-breaker, and
// short-entry spread-multiplier helpers. Actor state (positions map,
// tickHistory ring buffer, allocations map) is passed in by the caller so
// this module stays free of actor coupling.

import Array "mo:core/Array";
import Float "mo:core/Float";
import Map "mo:core/Map";
import Principal "mo:core/Principal";
import Types "../types/positions";

module {
  /// Short mark-to-market value for a single short leg.
  ///
  /// shortPositionValue = shortUnits × (2 × shortEntryScore − currentBaseScore)
  ///
  /// Floored at 0.0 so a short can never display negative value — the user
  /// loses their allocated capital but cannot go into negative territory.
  public func shortMarkToMarket(
    shortUnits : Float,
    shortEntryScore : Float,
    currentBaseScore : Float,
  ) : Float {
    let inverse = 2.0 * shortEntryScore - currentBaseScore;
    let floored = if (inverse < 0.0) { 0.0 } else { inverse };
    shortUnits * floored;
  };

  /// Long mark-to-market value for portfolio display.
  ///
  /// longPositionValue = longUnits × currentBaseScore
  ///
  /// The spread-adjusted exit price is only applied at actual redemption,
  /// not as a persistent deduction from displayed position value.
  public func longMarkToMarket(
    longUnits : Float,
    currentBaseScore : Float,
  ) : Float {
    longUnits * currentBaseScore;
  };

  /// Weighted-average entry score for adding to an existing leg.
  ///
  /// ((existingUnits × existingEntryScore) + (newUnits × currentBaseScore))
  ///   / (existingUnits + newUnits)
  ///
  /// Returns currentBaseScore when existingUnits == 0.0.
  public func weightedEntryScore(
    existingUnits : Float,
    existingEntryScore : Float,
    newUnits : Float,
    currentBaseScore : Float,
  ) : Float {
    if (existingUnits == 0.0) {
      currentBaseScore;
    } else {
      let totalUnits = existingUnits + newUnits;
      ((existingUnits * existingEntryScore) + (newUnits * currentBaseScore)) / totalUnits;
    };
  };

  /// 5-tick velocity for the velocity circuit breaker.
  ///
  /// `tickHistory` is the flattened chronological sequence of
  /// (assetName, score) pairs across all ticks (main.mo flattens its
  /// `[TickRecord]` into this shape before calling). This function filters
  /// by `assetName`, takes the last 5 entries, and computes the average
  /// absolute point change per tick between consecutive entries.
  /// Returns 0.0 when fewer than 2 ticks are available.
  public func scoreVelocity(
    tickHistory : [(Text, Float)],
    assetName : Text,
  ) : Float {
    // Collect the scores for this asset in chronological order.
    var scores : [Float] = [];
    for ((name, score) in tickHistory.values()) {
      if (name == assetName) {
        scores := Array_append(scores, [score]);
      };
    };

    if (scores.size() < 2) {
      return 0.0;
    };

    // Take the last 5 entries.
    let start = if (scores.size() > 5) { scores.size() - 5 } else { 0 };
    let window = Array_slice(scores, start, scores.size());

    if (window.size() < 2) {
      return 0.0;
    };

    // Sum absolute consecutive differences, then average over (count - 1) gaps.
    var sumAbs : Float = 0.0;
    var i = 1;
    while (i < window.size()) {
      let diff = window[i] - window[i - 1];
      sumAbs += Float.abs(diff);
      i += 1;
    };
    sumAbs / Float.fromInt(window.size() - 1);
  };

  /// Whether the velocity circuit breaker is active for an asset.
  ///
  /// True when the 5-tick velocity exceeds 3.0 points per tick. Blocks new
  /// short entries only — existing short holders can still redeem.
  public func circuitBreakerActive(
    tickHistory : [(Text, Float)],
    assetName : Text,
  ) : Bool {
    scoreVelocity(tickHistory, assetName) > 3.0;
  };

  /// 20-tick moving average of an asset's score from the tickHistory ring
  /// buffer. Returns 0.0 when no ticks are available.
  public func scoreMovingAverage(
    tickHistory : [(Text, Float)],
    assetName : Text,
  ) : Float {
    var scores : [Float] = [];
    for ((name, score) in tickHistory.values()) {
      if (name == assetName) {
        scores := Array_append(scores, [score]);
      };
    };

    if (scores.size() == 0) {
      return 0.0;
    };

    let start = if (scores.size() > 20) { scores.size() - 20 } else { 0 };
    let window = Array_slice(scores, start, scores.size());

    var sum : Float = 0.0;
    for (s in window.values()) {
      sum += s;
    };
    sum / Float.fromInt(window.size());
  };

  /// Short-entry spread multiplier based on how far the current score has
  /// risen above the 20-tick moving average.
  ///
  /// - > 30 points above → 2.0×
  /// - > 20 points above → 1.5×
  /// - > 10 points above → 1.25×
  /// - otherwise → 1.0×
  ///
  /// Applies only to new short entries. The crisis override spread of 1.0
  /// takes precedence over all multipliers when active (handled by the
  /// caller before this function is consulted).
  public func shortSpreadMultiplier(
    currentBaseScore : Float,
    movingAverage : Float,
  ) : Float {
    let delta = currentBaseScore - movingAverage;
    if (delta > 30.0) {
      2.0;
    } else if (delta > 20.0) {
      1.5;
    } else if (delta > 10.0) {
      1.25;
    } else {
      1.0;
    };
  };

  // ─── Internal array helpers (avoid mo:core/Array import churn) ─────────────
  // Small local helpers so this module stays self-contained for the slice /
  // append operations the velocity / moving-average functions need.

  func Array_append(arr : [Float], item : [Float]) : [Float] {
    let n = arr.size();
    let m = item.size();
    Array.tabulate(
      n + m,
      func(i) {
        if (i < n) { arr[i] } else { item[i - n] };
      },
    );
  };

  func Array_slice(arr : [Float], from : Nat, to : Nat) : [Float] {
    let len = if (to > arr.size()) { arr.size() } else { to };
    if (from >= len) { return [] };
    Array.tabulate(
      len - from,
      func(i) { arr[from + i] },
    );
  };
};
