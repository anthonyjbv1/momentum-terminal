// Upgrade migration from the previously-deployed actor (whose stable signature
// is the NewActor of migrations/20260725_165417.mo) to the current enhanced-
// migration actor shape. This migration adds a single new stable field,
// `finnhubApiKey : Text`, to support the settable Finnhub API key pattern
// (mirroring the existing `huggingfaceApiKey` field). Every other stable field
// is carried forward from `old` unchanged.
//
// Self-contained: only mo:core imports. All types are inlined so the chain
// replays correctly forever, regardless of future changes to project types.

import Map "mo:core/Map";
import List "mo:core/List";
import Nat64 "mo:core/Nat64";

module {
  // ─── Inlined shared types (must match main.mo's local type definitions) ───

  type UserRole = { #admin; #user; #guest };

  type AccessControlState = {
    var adminAssigned : Bool;
    userRoles : Map.Map<Principal, UserRole>;
  };

  type TrendDirection = { #up; #down };

  type TrendState = {
    direction : TrendDirection;
    remainingDuration : Nat;
    stepSize : Float;
  };

  type TransactionType = {
    #buy;
    #sell;
    #deposit;
    #withdrawal;
    #redeemAll;
    #shortAllocate;
    #shortRedeem;
  };

  type Transaction = {
    id : Nat;
    timestamp : Int;
    amount : Float;
    assetName : ?Text;
    units : ?Float;
    transactionType : TransactionType;
    username : Text;
    dollarAmount : ?Float;
    assetInvolved : ?Text;
  };

  type NewsEventCategory = { #AI; #Mexico; #Warriors; #Washington };

  type NewsEvent = {
    headline : Text;
    sentimentScore : Float;
    category : NewsEventCategory;
    relatedIndex : ?Text;
  };

  type UserProfile = { name : Text; username : Text };

  type UserAllocationState = { lastAllocationCycle : ?Nat };

  type AccountStatus = { #Active; #Suspended };

  type TickRecord = {
    tickIndex : Nat;
    timestamp : Int;
    scores : [(Text, Float)];
    gsiValue : Float;
    topHeadline : ?Text;
  };

  type ProcessedHeadline = {
    text : Text;
    targetIndex : Text;
    impact : Float;
    sentimentLabel : Text;
    confidence : Float;
    sourceTier : Nat;
    timestamp : Int;
  };

  // Position domain (mirrors types/positions.mo Position + PositionKey).
  type PositionKey = (Principal, Text);
  type Position = {
    longUnits : Float;
    longEntryScore : Float;
    shortUnits : Float;
    shortEntryScore : Float;
    openedAt : Int;
  };

  // ─── OldActor / NewActor ──────────────────────────────────────────────────
  // OldActor EXACTLY mirrors the NewActor of migrations/20260725_165417.mo
  // (the previously-deployed stable signature). NewActor = OldActor PLUS
  // `var finnhubApiKey : Text` (the new settable Finnhub API key field).

  type OldActor = {
    var spreadActive : Bool;
    var dynamicSpreadActive : Bool;
    var dynamicSpreadExpiry : Int;
    var currentCycleIndex : Nat;
    var isTradingPaused : Bool;
    subsidyReserves : Map.Map<Text, Float>;
    crisisState : { var dynamicSpreadActive : Bool; var dynamicSpreadExpiry : Int };
    accessControlState : AccessControlState;
    lastFetch_RedditMap : Map.Map<Text, Int>;
    failures_RedditMap : Map.Map<Text, Nat>;
    var lastFetch_Reddit : Int;
    var lastFetch_GDELT : Int;
    var lastFetch_YouTube : Int;
    var lastFetch_TMDB : Int;
    var lastFetch_TMDBPopular : Int;
    var lastFetch_OMDBMarvel : Int;
    var lastFetch_OMDBDC : Int;
    var lastFetch_BLS : Int;
    var lastFetch_ReliefWeb : Int;
    var lastFetch_USPTO : Int;
    var lastFetch_Fed : Int;
    var lastFetch_Congress : Int;
    var lastFetch_CongressTrad : Int;
    var lastFetch_FTC : Int;
    var lastFetch_SCOTUS : Int;
    var lastFetch_EPA : Int;
    var lastFetch_ACLU : Int;
    var lastFetch_CourtListener : Int;
    var lastFetch_SEC : Int;
    var lastFetch_GlobeNewswire : Int;
    var failures_Reddit : Nat;
    var failures_GDELT : Nat;
    var failures_YouTube : Nat;
    var failures_TMDB : Nat;
    var failures_TMDBPopular : Nat;
    var failures_OMDBMarvel : Nat;
    var failures_OMDBDC : Nat;
    var failures_BLS : Nat;
    var failures_ReliefWeb : Nat;
    var failures_USPTO : Nat;
    var failures_Fed : Nat;
    var failures_Congress : Nat;
    var failures_CongressTrad : Nat;
    var failures_FTC : Nat;
    var failures_SCOTUS : Nat;
    var failures_EPA : Nat;
    var failures_ACLU : Nat;
    var failures_CourtListener : Nat;
    var failures_SEC : Nat;
    var failures_GlobeNewswire : Nat;
    userTickHistory : Map.Map<Principal, [TickRecord]>;
    tickHistoryState : { var ticks : [TickRecord] };
    var latestScoreSnapshot : [(Text, Float)];
    var tickHeartbeat : Nat;
    var huggingfaceApiKey : Text;
    processedHeadlines : List.List<ProcessedHeadline>;
    userProfiles : Map.Map<Principal, UserProfile>;
    walletBalance : { var balance : Float };
    var nextTransactionId : Nat;
    transactions : List.List<Transaction>;
    newsEvents : List.List<NewsEvent>;
    var lastTickTimestamp : Int;
    assetTrends : Map.Map<Text, TrendState>;
    positions : Map.Map<PositionKey, Position>;
    allocationsMap : Map.Map<Text, Float>;
    volumeByIndex : Map.Map<Text, Float>;
    var volumeBackfilled : Bool;
    userAllocationStates : Map.Map<Principal, UserAllocationState>;
    sentimentScores : Map.Map<Text, Float>;
    userStatuses : Map.Map<Text, AccountStatus>;
  };

  type NewActor = {
    var spreadActive : Bool;
    var dynamicSpreadActive : Bool;
    var dynamicSpreadExpiry : Int;
    var currentCycleIndex : Nat;
    var isTradingPaused : Bool;
    subsidyReserves : Map.Map<Text, Float>;
    crisisState : { var dynamicSpreadActive : Bool; var dynamicSpreadExpiry : Int };
    accessControlState : AccessControlState;
    lastFetch_RedditMap : Map.Map<Text, Int>;
    failures_RedditMap : Map.Map<Text, Nat>;
    var lastFetch_Reddit : Int;
    var lastFetch_GDELT : Int;
    var lastFetch_YouTube : Int;
    var lastFetch_TMDB : Int;
    var lastFetch_TMDBPopular : Int;
    var lastFetch_OMDBMarvel : Int;
    var lastFetch_OMDBDC : Int;
    var lastFetch_BLS : Int;
    var lastFetch_ReliefWeb : Int;
    var lastFetch_USPTO : Int;
    var lastFetch_Fed : Int;
    var lastFetch_Congress : Int;
    var lastFetch_CongressTrad : Int;
    var lastFetch_FTC : Int;
    var lastFetch_SCOTUS : Int;
    var lastFetch_EPA : Int;
    var lastFetch_ACLU : Int;
    var lastFetch_CourtListener : Int;
    var lastFetch_SEC : Int;
    var lastFetch_GlobeNewswire : Int;
    var failures_Reddit : Nat;
    var failures_GDELT : Nat;
    var failures_YouTube : Nat;
    var failures_TMDB : Nat;
    var failures_TMDBPopular : Nat;
    var failures_OMDBMarvel : Nat;
    var failures_OMDBDC : Nat;
    var failures_BLS : Nat;
    var failures_ReliefWeb : Nat;
    var failures_USPTO : Nat;
    var failures_Fed : Nat;
    var failures_Congress : Nat;
    var failures_CongressTrad : Nat;
    var failures_FTC : Nat;
    var failures_SCOTUS : Nat;
    var failures_EPA : Nat;
    var failures_ACLU : Nat;
    var failures_CourtListener : Nat;
    var failures_SEC : Nat;
    var failures_GlobeNewswire : Nat;
    userTickHistory : Map.Map<Principal, [TickRecord]>;
    tickHistoryState : { var ticks : [TickRecord] };
    var latestScoreSnapshot : [(Text, Float)];
    var tickHeartbeat : Nat;
    var huggingfaceApiKey : Text;
    var finnhubApiKey : Text;
    processedHeadlines : List.List<ProcessedHeadline>;
    userProfiles : Map.Map<Principal, UserProfile>;
    walletBalance : { var balance : Float };
    var nextTransactionId : Nat;
    transactions : List.List<Transaction>;
    newsEvents : List.List<NewsEvent>;
    var lastTickTimestamp : Int;
    assetTrends : Map.Map<Text, TrendState>;
    positions : Map.Map<PositionKey, Position>;
    allocationsMap : Map.Map<Text, Float>;
    volumeByIndex : Map.Map<Text, Float>;
    var volumeBackfilled : Bool;
    userAllocationStates : Map.Map<Principal, UserAllocationState>;
    sentimentScores : Map.Map<Text, Float>;
    userStatuses : Map.Map<Text, AccountStatus>;
  };

  // ─── migration ────────────────────────────────────────────────────────────
  // Runs on upgrade from the previously-deployed actor (signature = NewActor of
  // migrations/20260725_165417.mo). Every existing state field is carried forward
  // from `old` unchanged. The new `finnhubApiKey` field is initialized to the
  // empty string (default for the new settable Finnhub API key — the operator
  // sets the live value via `setFinnhubKey()` after upgrade).

  public func migration(old : OldActor) : NewActor {
    {
      var spreadActive = old.spreadActive;
      var dynamicSpreadActive = old.dynamicSpreadActive;
      var dynamicSpreadExpiry = old.dynamicSpreadExpiry;
      var currentCycleIndex = old.currentCycleIndex;
      var isTradingPaused = old.isTradingPaused;
      subsidyReserves = old.subsidyReserves;
      crisisState = old.crisisState;
      accessControlState = old.accessControlState;
      lastFetch_RedditMap = old.lastFetch_RedditMap;
      failures_RedditMap = old.failures_RedditMap;
      var lastFetch_Reddit = old.lastFetch_Reddit;
      var lastFetch_GDELT = old.lastFetch_GDELT;
      var lastFetch_YouTube = old.lastFetch_YouTube;
      var lastFetch_TMDB = old.lastFetch_TMDB;
      var lastFetch_TMDBPopular = old.lastFetch_TMDBPopular;
      var lastFetch_OMDBMarvel = old.lastFetch_OMDBMarvel;
      var lastFetch_OMDBDC = old.lastFetch_OMDBDC;
      var lastFetch_BLS = old.lastFetch_BLS;
      var lastFetch_ReliefWeb = old.lastFetch_ReliefWeb;
      var lastFetch_USPTO = old.lastFetch_USPTO;
      var lastFetch_Fed = old.lastFetch_Fed;
      var lastFetch_Congress = old.lastFetch_Congress;
      var lastFetch_CongressTrad = old.lastFetch_CongressTrad;
      var lastFetch_FTC = old.lastFetch_FTC;
      var lastFetch_SCOTUS = old.lastFetch_SCOTUS;
      var lastFetch_EPA = old.lastFetch_EPA;
      var lastFetch_ACLU = old.lastFetch_ACLU;
      var lastFetch_CourtListener = old.lastFetch_CourtListener;
      var lastFetch_SEC = old.lastFetch_SEC;
      var lastFetch_GlobeNewswire = old.lastFetch_GlobeNewswire;
      var failures_Reddit = old.failures_Reddit;
      var failures_GDELT = old.failures_GDELT;
      var failures_YouTube = old.failures_YouTube;
      var failures_TMDB = old.failures_TMDB;
      var failures_TMDBPopular = old.failures_TMDBPopular;
      var failures_OMDBMarvel = old.failures_OMDBMarvel;
      var failures_OMDBDC = old.failures_OMDBDC;
      var failures_BLS = old.failures_BLS;
      var failures_ReliefWeb = old.failures_ReliefWeb;
      var failures_USPTO = old.failures_USPTO;
      var failures_Fed = old.failures_Fed;
      var failures_Congress = old.failures_Congress;
      var failures_CongressTrad = old.failures_CongressTrad;
      var failures_FTC = old.failures_FTC;
      var failures_SCOTUS = old.failures_SCOTUS;
      var failures_EPA = old.failures_EPA;
      var failures_ACLU = old.failures_ACLU;
      var failures_CourtListener = old.failures_CourtListener;
      var failures_SEC = old.failures_SEC;
      var failures_GlobeNewswire = old.failures_GlobeNewswire;
      userTickHistory = old.userTickHistory;
      tickHistoryState = old.tickHistoryState;
      var latestScoreSnapshot = old.latestScoreSnapshot;
      var tickHeartbeat = old.tickHeartbeat;
      var huggingfaceApiKey = old.huggingfaceApiKey;
      var finnhubApiKey = "";
      processedHeadlines = old.processedHeadlines;
      userProfiles = old.userProfiles;
      walletBalance = old.walletBalance;
      var nextTransactionId = old.nextTransactionId;
      transactions = old.transactions;
      newsEvents = old.newsEvents;
      var lastTickTimestamp = old.lastTickTimestamp;
      assetTrends = old.assetTrends;
      positions = old.positions;
      allocationsMap = old.allocationsMap;
      volumeByIndex = old.volumeByIndex;
      var volumeBackfilled = old.volumeBackfilled;
      userAllocationStates = old.userAllocationStates;
      sentimentScores = old.sentimentScores;
      userStatuses = old.userStatuses;
    };
  };
};
