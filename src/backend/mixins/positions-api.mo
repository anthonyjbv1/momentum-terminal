// Positions domain — public API mixin.
// Exposes the short allocation, short redemption, and read-only position
// getters over the shared API. State slices (positions map, tickHistory,
// allocations map, subsidy reserves, wallet balance wrapper, crisis state,
// current time, short cap) are injected via the mixin parameters.
//
// The wallet balance is passed as a mutable record wrapper so deductions and
// credits propagate back to the actor's `var walletBalance` (records are
// shared by reference in Motoko, mirroring the crisisState pattern in
// lib/lmsr-pricing.mo). The current base score for an asset is derived from
// the last matching entry in the tickHistory ring buffer — that is the
// asset's most recent committed score, which is the price a new allocation
// is struck against.

import Float "mo:core/Float";
import Map "mo:core/Map";
import Order "mo:core/Order";
import Principal "mo:core/Principal";
import Text "mo:core/Text";
import Types "../types/positions";
import LMSR "../lib/lmsr-pricing";
import PositionsLib "../lib/positions";

mixin (
  positions : Map.Map<Types.PositionKey, Types.Position>,
  tickHistory : [(Text, Float)],
  allocations : Map.Map<Text, Float>,
  subsidyReserves : Map.Map<Text, Float>,
  walletBalance : { var balance : Float },
  maxShortPositionValue : Float,
  crisisState : {
    var dynamicSpreadActive : Bool;
    var dynamicSpreadExpiry : Int;
  },
  currentTime : Int,
  volumeByIndex : Map.Map<Text, Float>,
) {
  // Map.get / Map.add use an IMPLICIT compare argument (not positional). The
  // binding MUST be named exactly `compare` so mo:core/Map picks it up as the
  // implicit argument for every positions.get / positions.add call below.
  // `transient` keeps this function value OUT of stable storage (function
  // types are non-stable; a bare `let` in a mixin is implicitly stable → M0131).
  transient let compare = func(a : Types.PositionKey, b : Types.PositionKey) : Order.Order {
    let (p1, t1) = a;
    let (p2, t2) = b;
    let c = Principal.compare(p1, p2);
    if (c != #equal) c else Text.compare(t1, t2);
  };

  /// The most recent committed score for `assetName` from the tickHistory
  /// ring buffer. This is the asset's current base score — the price a new
  /// allocation is struck against. Returns null when no tick has been
  /// recorded for the asset.
  func currentBaseScoreFor(assetName : Text) : ?Float {
    var latest : ?Float = null;
    for ((name, score) in tickHistory.values()) {
      if (name == assetName) {
        latest := ?score;
      };
    };
    latest;
  };

  /// Formats a Float as a 2-decimal money string (e.g. 500.0 → "500.00").
  /// Used so the cap-exceeded error message matches the spec exactly. Works
  /// by post-processing `Float.toText`: appends ".00" when there is no
  /// fractional part, or pads a single fractional digit with a trailing 0.
  func formatMoney(value : Float) : Text {
    let raw = value.toText();
    // Locate the decimal point (if any) by scanning the text.
    var dotIndex : ?Nat = null;
    var i = 0;
    for (c in raw.chars()) {
      if (c == '.') { dotIndex := ?i };
      i += 1;
    };
    switch (dotIndex) {
      case null { raw # ".00" };
      case (?dot) {
        let fracLen = raw.size() - dot - 1;
        if (fracLen == 0) { raw # "00" } else if (fracLen == 1) { raw # "0" } else { raw };
      };
    };
  };

  /// Opens or adds to a short position on `assetName` for the caller.
  ///
  /// Mirrors allocateFunds with the following differences:
  /// - writes to shortUnits / shortEntryScore (weighted-average on add).
  /// - enforces the per-user-per-asset short cap (maxShortPositionValue):
  ///   rejects when shortUnits × currentBaseScore would exceed the cap
  ///   after the new allocation.
  /// - spread is charged on entry (baseScore + spread), identical to long.
  /// - subsidy reserve is credited identically to long entry.
  /// - the velocity circuit breaker blocks new short entries when the
  ///   5-tick velocity exceeds 3.0 points/tick.
  /// - the short-entry spread multiplier widens the LMSR spread when the
  ///   current score is elevated above the 20-tick moving average.
  public shared ({ caller }) func allocateShort(
    assetName : Text,
    allocationAmount : Float,
  ) : async Types.AllocateShortResult {
    // (1) Resolve the current base score for the asset.
    let baseScore = switch (currentBaseScoreFor(assetName)) {
      case (?score) { score };
      case null {
        return #err("Unknown asset: no score data available for '" # assetName # "'.");
      };
    };

    // (2) Velocity circuit breaker — blocks new short entries when the
    //     5-tick velocity exceeds 3.0 points/tick. Existing short holders
    //     can still redeem (handled in redeemShort).
    if (PositionsLib.circuitBreakerActive(tickHistory, assetName)) {
      return #err(
        "Circuit breaker active: score velocity exceeds threshold. Please wait for score velocity to normalize before opening new short positions."
      );
    };

    // (3) Compute the LMSR spread for short entry. Passing direction=#short
    //     with the current base score and 20-tick moving average applies the
    //     elevated-score spread multiplier inside getSpreadForAsset. The
    //     crisis override spread of 1.0 takes precedence over all multipliers.
    let movingAverage = PositionsLib.scoreMovingAverage(tickHistory, assetName);
    let spread = LMSR.getSpreadForAsset(
      allocations,
      assetName,
      crisisState,
      currentTime,
      ?#short,
      ?baseScore,
      ?movingAverage,
    );

    // (4) Allocate price = baseScore + spread (user pays the spread premium
    //     to enter, identical to a long allocation).
    let allocatePrice = baseScore + spread;

    // (5) Units to short = allocation amount / allocate price.
    let unitsToShort = allocationAmount / allocatePrice;

    // Load the caller's existing position (or a zeroed default).
    let key : Types.PositionKey = (caller, assetName);
    let existing = switch (positions.get(key)) {
      case (?pos) { pos };
      case null {
        {
          longUnits = 0.0;
          longEntryScore = 0.0;
          shortUnits = 0.0;
          shortEntryScore = 0.0;
          openedAt = currentTime;
        };
      };
    };

    // (6) Enforce the per-user-per-asset short cap. The post-allocation
    //     short position value is (existingShortUnits + unitsToShort) ×
    //     baseScore; reject if it would exceed the cap.
    let projectedShortUnits = existing.shortUnits + unitsToShort;
    let projectedShortValue = projectedShortUnits * baseScore;
    if (projectedShortValue > maxShortPositionValue) {
      return #err(
        "Short position cap exceeded: total short position value would exceed $"
        # formatMoney(maxShortPositionValue)
        # " per user per asset. Reduce your allocation amount and try again."
      );
    };

    // (7) Compute the new shortEntryScore as a weighted average when adding
    //     to an existing short position.
    let newShortEntryScore = PositionsLib.weightedEntryScore(
      existing.shortUnits,
      existing.shortEntryScore,
      unitsToShort,
      baseScore,
    );

    // (8) Deduct the allocation amount from the wallet balance.
    if (walletBalance.balance < allocationAmount) {
      return #err("Insufficient balance: wallet has $" # formatMoney(walletBalance.balance) # ", allocation requires $" # formatMoney(allocationAmount) # ".");
    };
    walletBalance.balance -= allocationAmount;

    // Volume only ever increases — accumulate the dollar value of this short entry.
    let prevVolume = switch (volumeByIndex.get(assetName)) {
      case (?v) { v };
      case null { 0.0 };
    };
    volumeByIndex.add(assetName, prevVolume + allocationAmount);

    // (9) Update the positions map with the new shortUnits and shortEntryScore.
    let updatedPosition : Types.Position = {
      existing with
      shortUnits = projectedShortUnits;
      shortEntryScore = newShortEntryScore;
    };
    positions.add(key, updatedPosition);

    // (10) Credit the spread revenue into the per-index subsidy reserve,
    //      identical to long entry.
    LMSR.creditSubsidyReserve(
      subsidyReserves,
      assetName,
      unitsToShort,
      spread,
    );

    // (11) Return the units actually opened.
    #ok({ unitsOpened = unitsToShort });
  };

  /// Redeems `unitsToRedeem` short units on `assetName` for the caller.
  ///
  /// Mirrors redeemFunds with the following differences:
  /// - redemption value uses the short MTM formula (floored at 0.0).
  /// - spread is applied on exit: user receives shortPositionValue −
  ///   (shortUnits × spread).
  /// - subsidy reserve is credited identically to long redemption.
  /// - on full redemption, shortUnits and shortEntryScore reset to 0.0.
  /// - partial redemption updates shortUnits and shortEntryScore using
  ///   the weighted-average logic in reverse.
  public shared ({ caller }) func redeemShort(
    assetName : Text,
    unitsToRedeem : Float,
  ) : async Types.RedeemShortResult {
    // (1) Resolve the current base score for the asset.
    let baseScore = switch (currentBaseScoreFor(assetName)) {
      case (?score) { score };
      case null {
        return #err("Unknown asset: no score data available for '" # assetName # "'.");
      };
    };

    // (2) Look up the caller's short position.
    let key : Types.PositionKey = (caller, assetName);
    let existing = switch (positions.get(key)) {
      case (?pos) { pos };
      case null {
        return #err("No position found for asset '" # assetName # "'.");
      };
    };

    // (3) Reject if there is no short position or insufficient short units.
    if (existing.shortUnits < unitsToRedeem) {
      return #err(
        "Insufficient short units: you have " # existing.shortUnits.toText()
        # " short units, requested " # unitsToRedeem.toText() # "."
      );
    };

    // (4) Compute the short mark-to-market value for the units being
    //     redeemed, floored at 0.0.
    let shortPositionValue = PositionsLib.shortMarkToMarket(
      unitsToRedeem,
      existing.shortEntryScore,
      baseScore,
    );

    // (5) Compute the spread on exit. Null direction keeps the legacy
    //     long-style behaviour — the short-entry spread multiplier does NOT
    //     apply on redemption.
    let spread = LMSR.getSpreadForAsset(
      allocations,
      assetName,
      crisisState,
      currentTime,
      null,
      null,
      null,
    );

    // (6) Redemption value = shortPositionValue − (unitsToRedeem × spread).
    let redemptionValue = shortPositionValue - (unitsToRedeem * spread);

    // (7) Credit the wallet balance with the redemption value.
    walletBalance.balance += Float.max(0.0, redemptionValue);

    // Volume only ever increases — accumulate the dollar value of this short
    // redemption, even though the short position decreases.
    let prevVolume = switch (volumeByIndex.get(assetName)) {
      case (?v) { v };
      case null { 0.0 };
    };
    volumeByIndex.add(assetName, prevVolume + redemptionValue);

    // (8) Credit the spread revenue into the per-index subsidy reserve.
    LMSR.creditSubsidyReserve(
      subsidyReserves,
      assetName,
      unitsToRedeem,
      spread,
    );

    // (9) / (10) Update the short leg. On full redemption, reset to 0.0.
    //     On partial redemption, decrement shortUnits; shortEntryScore is
    //     unchanged because the entry score is the same for all units in
    //     the leg (reverse weighted average collapses to the same value).
    let remainingShortUnits = existing.shortUnits - unitsToRedeem;
    let updatedPosition : Types.Position = {
      existing with
      shortUnits = remainingShortUnits;
      shortEntryScore = if (remainingShortUnits == 0.0) { 0.0 } else { existing.shortEntryScore };
    };
    positions.add(key, updatedPosition);

    // (11) Return the dollar value credited to the wallet.
    #ok({ valueCredited = redemptionValue });
  };

  /// Returns the caller's short leg on `assetName`: shortUnits,
  /// shortEntryScore, and the current floored mark-to-market value.
  public shared query ({ caller }) func getUserShortPosition(
    assetName : Text,
  ) : async Types.ShortPositionView {
    let key : Types.PositionKey = (caller, assetName);
    switch (positions.get(key)) {
      case (?pos) {
        let baseScore = switch (currentBaseScoreFor(assetName)) {
          case (?score) { score };
          case null { 0.0 };
        };
        {
          shortUnits = pos.shortUnits;
          shortEntryScore = pos.shortEntryScore;
          markToMarketValue = PositionsLib.shortMarkToMarket(
            pos.shortUnits,
            pos.shortEntryScore,
            baseScore,
          );
        };
      };
      case null {
        {
          shortUnits = 0.0;
          shortEntryScore = 0.0;
          markToMarketValue = 0.0;
        };
      };
    };
  };

  /// Returns both the long and short legs of the caller's position on
  /// `assetName` in a single call, each with its own mark-to-market value.
  public shared query ({ caller }) func getUserFullPosition(
    assetName : Text,
  ) : async Types.FullPositionView {
    let key : Types.PositionKey = (caller, assetName);
    let baseScore = switch (currentBaseScoreFor(assetName)) {
      case (?score) { score };
      case null { 0.0 };
    };
    switch (positions.get(key)) {
      case (?pos) {
        {
          longUnits = pos.longUnits;
          longEntryScore = pos.longEntryScore;
          longMarkToMarketValue = PositionsLib.longMarkToMarket(
            pos.longUnits,
            baseScore,
          );
          shortUnits = pos.shortUnits;
          shortEntryScore = pos.shortEntryScore;
          shortMarkToMarketValue = PositionsLib.shortMarkToMarket(
            pos.shortUnits,
            pos.shortEntryScore,
            baseScore,
          );
        };
      };
      case null {
        {
          longUnits = 0.0;
          longEntryScore = 0.0;
          longMarkToMarketValue = 0.0;
          shortUnits = 0.0;
          shortEntryScore = 0.0;
          shortMarkToMarketValue = 0.0;
        };
      };
    };
  };

  /// Returns the current 5-tick velocity for `assetName` and whether the
  /// circuit breaker is currently blocking new short entries.
  public query func getCircuitBreakerStatus(
    assetName : Text,
  ) : async Types.CircuitBreakerStatus {
    let velocity = PositionsLib.scoreVelocity(tickHistory, assetName);
    { velocity; breakerActive = velocity > 3.0 };
  };

  /// Returns the global per-user-per-asset short position cap
  /// (MAX_SHORT_POSITION_VALUE) so the frontend can display it before a
  /// user attempts a short allocation.
  public query func getShortPositionCap() : async Float {
    maxShortPositionValue;
  };
};
