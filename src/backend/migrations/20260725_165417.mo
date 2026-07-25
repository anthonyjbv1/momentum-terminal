// Upgrade migration from the previously-deployed actor (stable signature
// recorded in .old/src/backend/dist/backend.most) to the current enhanced-
// migration actor shape. OldActor enumerates every stable field the deployed
// canister exposes; NewActor enumerates every stable field declared in main.mo.
// Constants and capability handles (URLs, API keys, baselines, the `ic`
// management-canister reference, the `assets` lookup table, etc.) were `stable`
// in the previous version but are now `transient` in main.mo — they are listed
// in OldActor (consumed/discarded) and intentionally NOT in NewActor, since
// they are re-derived on every (re)start and carry no durable state.
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

  // Asset domain (mirrors the previously-deployed `assets : [Asset]` stable
  // field — consumed and discarded in this migration since `assets` is now a
  // `transient let` re-derived on every restart).
  type AssetConfig = { maxAllocation : Float; volatilityBuffer : Float };
  type Asset = {
    baseScore : Float;
    category : Text;
    config : AssetConfig;
    name : Text;
  };

  // HTTP outcall types (mirrors main.mo's local definitions; used only to type
  // the consumed `ic` capability handle in OldActor).
  type HttpHeader = { name : Text; value : Text };
  type HttpRequestArgs = {
    url : Text;
    max_response_bytes : ?Nat64;
    headers : [HttpHeader];
    body : ?Blob;
    method : { #get; #post; #head };
    transform : ?TransformContext;
  };
  type HttpResponse = { status : Nat; headers : [HttpHeader]; body : Blob };
  type TransformContext = {
    function : shared query (TransformArgs) -> async HttpResponse;
    context : Blob;
  };
  type TransformArgs = { response : HttpResponse; context : Blob };

  // ─── OldActor / NewActor ──────────────────────────────────────────────────
  // OldActor enumerates the previously-deployed stable signature exactly as
  // recorded in .old/src/backend/dist/backend.most. Constants and capability
  // handles that were `stable` in the previous version but are now `transient`
  // in main.mo are listed here so the upgrade explicitly consumes (discards)
  // them — they are re-derived on every (re)start and carry no durable state.
  // State fields are carried forward into NewActor unchanged.
  //
  // Note: the .most encodes Map/List values with their internal representation
  // types (e.g. `{var root : Node...; var size : Nat...}` for Map, and a
  // block/element-index record for List). The abstract `Map.Map<K, V>` and
  // `List.List<T>` types used here are stable supertypes of those internal
  // representations, so the stable-compatibility check (M0169) accepts them.

  type OldActor = {
    // ── Constants / capability handles (consumed, NOT carried forward) ──
    AI_BASELINE : Float;
    BLS_API_KEY : Text;
    CONGRESS_API_KEY : Text;
    CYCLES_SAFETY_THRESHOLD : Nat;
    FINNHUB_API_KEY : Text;
    FINNHUB_URL : Text;
    HF_API_KEY : Text;
    HF_FINBERT_URL : Text;
    INITIAL_BALANCE : Float;
    MAX_NEWS_EVENTS : Nat;
    MAX_PERSISTED_HEADLINES : Nat;
    MAX_SHORT_POSITION_VALUE : Float;
    MEXICO_BASELINE : Float;
    NEUTRAL_FALLBACK : { confidence : Float; sentimentLabel : Text; source : Text };
    NEWS_API_KEY : Text;
    NEWS_URL : Text;
    OMDB_API_KEY : Text;
    PARTICIPATION_YIELD_RATE_HOURLY : Float;
    REDDIT_SUBREDDITS : [Text];
    REDDIT_WORLDNEWS_URL : Text;
    REDDIT_WSB_URL : Text;
    REDEMPTION_FEE_RATE : Float;
    TICK_INTERVAL_NS : Int;
    TIER_B_INTERVAL_NS : Int;
    TIER_C_30MIN_NS : Int;
    TIER_C_60MIN_NS : Int;
    TIER_C_INTERVAL_NS : Int;
    TMDB_API_KEY : Text;
    WARRIORS_BASELINE : Float;
    WASHINGTON_BASELINE : Float;
    YOUTUBE_API_KEY : Text;
    ic : actor { http_request : shared HttpRequestArgs -> async HttpResponse };
    assets : [Asset];

    // ── State fields (carried forward into NewActor) ──
    accessControlState : AccessControlState;
    var allocationsMap : Map.Map<Text, Float>;
    assetTrends : Map.Map<Text, TrendState>;
    crisisState : { var dynamicSpreadActive : Bool; var dynamicSpreadExpiry : Int };
    var currentCycleIndex : Nat;
    var dynamicSpreadActive : Bool;
    var dynamicSpreadExpiry : Int;
    var failures_ACLU : Nat;
    var failures_BLS : Nat;
    var failures_Congress : Nat;
    var failures_CongressTrad : Nat;
    var failures_CourtListener : Nat;
    var failures_EPA : Nat;
    var failures_FTC : Nat;
    var failures_Fed : Nat;
    var failures_GDELT : Nat;
    var failures_GlobeNewswire : Nat;
    var failures_OMDBDC : Nat;
    var failures_OMDBMarvel : Nat;
    var failures_Reddit : Nat;
    failures_RedditMap : Map.Map<Text, Nat>;
    var failures_ReliefWeb : Nat;
    var failures_SCOTUS : Nat;
    var failures_SEC : Nat;
    var failures_TMDB : Nat;
    var failures_TMDBPopular : Nat;
    var failures_USPTO : Nat;
    var failures_YouTube : Nat;
    var huggingfaceApiKey : Text;
    var isTradingPaused : Bool;
    var lastFetch_ACLU : Int;
    var lastFetch_BLS : Int;
    var lastFetch_Congress : Int;
    var lastFetch_CongressTrad : Int;
    var lastFetch_CourtListener : Int;
    var lastFetch_EPA : Int;
    var lastFetch_FTC : Int;
    var lastFetch_Fed : Int;
    var lastFetch_GDELT : Int;
    var lastFetch_GlobeNewswire : Int;
    var lastFetch_OMDBDC : Int;
    var lastFetch_OMDBMarvel : Int;
    var lastFetch_Reddit : Int;
    lastFetch_RedditMap : Map.Map<Text, Int>;
    var lastFetch_ReliefWeb : Int;
    var lastFetch_SCOTUS : Int;
    var lastFetch_SEC : Int;
    var lastFetch_TMDB : Int;
    var lastFetch_TMDBPopular : Int;
    var lastFetch_USPTO : Int;
    var lastFetch_YouTube : Int;
    var lastTickTimestamp : Int;
    var latestScoreSnapshot : [(Text, Float)];
    newsEvents : List.List<NewsEvent>;
    var nextTransactionId : Nat;
    var positions : Map.Map<PositionKey, Position>;
    processedHeadlines : List.List<ProcessedHeadline>;
    sentimentScores : Map.Map<Text, Float>;
    var spreadActive : Bool;
    var subsidyReserves : Map.Map<Text, Float>;
    var tickHeartbeat : Nat;
    tickHistoryState : { var ticks : [TickRecord] };
    transactions : List.List<Transaction>;
    userAllocationStates : Map.Map<Principal, UserAllocationState>;
    userProfiles : Map.Map<Principal, UserProfile>;
    userStatuses : Map.Map<Text, AccountStatus>;
    userTickHistory : Map.Map<Principal, [TickRecord]>;
    var volumeBackfilled : Bool;
    var volumeByIndex : Map.Map<Text, Float>;
    walletBalance : { var balance : Float };
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
  // Runs on upgrade from the previously-deployed actor (signature in
  // .old/src/backend/dist/backend.most). State fields are carried forward from
  // `old` unchanged (zero behavioral change). Constants, capability handles
  // (`ic`), and the `assets` lookup table were `stable` in the old version but
  // are now `transient` in main.mo — they are consumed here (referenced via
  // `ignore old.<field>` to suppress unused-field warnings) and discarded,
  // since they are re-derived on every (re)start and carry no durable state.

  public func migration(old : OldActor) : NewActor {
    // Explicitly consume the retired constant/capability fields so the compiler
    // and reader can see they are intentionally dropped (not silently lost).
    ignore old.AI_BASELINE;
    ignore old.BLS_API_KEY;
    ignore old.CONGRESS_API_KEY;
    ignore old.CYCLES_SAFETY_THRESHOLD;
    ignore old.FINNHUB_API_KEY;
    ignore old.FINNHUB_URL;
    ignore old.HF_API_KEY;
    ignore old.HF_FINBERT_URL;
    ignore old.INITIAL_BALANCE;
    ignore old.MAX_NEWS_EVENTS;
    ignore old.MAX_PERSISTED_HEADLINES;
    ignore old.MAX_SHORT_POSITION_VALUE;
    ignore old.MEXICO_BASELINE;
    ignore old.NEUTRAL_FALLBACK;
    ignore old.NEWS_API_KEY;
    ignore old.NEWS_URL;
    ignore old.OMDB_API_KEY;
    ignore old.PARTICIPATION_YIELD_RATE_HOURLY;
    ignore old.REDDIT_SUBREDDITS;
    ignore old.REDDIT_WORLDNEWS_URL;
    ignore old.REDDIT_WSB_URL;
    ignore old.REDEMPTION_FEE_RATE;
    ignore old.TICK_INTERVAL_NS;
    ignore old.TIER_B_INTERVAL_NS;
    ignore old.TIER_C_30MIN_NS;
    ignore old.TIER_C_60MIN_NS;
    ignore old.TIER_C_INTERVAL_NS;
    ignore old.TMDB_API_KEY;
    ignore old.WARRIORS_BASELINE;
    ignore old.WASHINGTON_BASELINE;
    ignore old.YOUTUBE_API_KEY;
    ignore old.ic;
    ignore old.assets;

    // Carry forward every state field from the previously-deployed actor.
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
