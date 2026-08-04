// redeploy trigger — 2026-04-26
// Draft 391 — Cycles balance circuit breaker for Tier C sources
import Array "mo:core/Array";
import Map "mo:core/Map";
import Float "mo:core/Float";
import Time "mo:core/Time";
import Nat "mo:core/Nat";
import Nat32 "mo:core/Nat32";
import Nat64 "mo:core/Nat64";
import ExperimentalCycles "mo:core/Cycles";

import List "mo:core/List";
import Int "mo:core/Int";
import Text "mo:core/Text";
import Runtime "mo:core/Runtime";
import Principal "mo:core/Principal";
import Char "mo:core/Char";
import Debug "mo:core/Debug";
import Error "mo:core/Error";

import AccessControl "mo:caffeineai-authorization/access-control";
import MixinAuthorization "mo:caffeineai-authorization/MixinAuthorization";
import Timer "mo:core/Timer";

import LMSRTypes "types/lmsr-pricing";
import LMSR "lib/lmsr-pricing";
import LMSRMixin "mixins/lmsr-pricing-api";


import PositionTypes "types/positions";
import PositionsLib "lib/positions";
import PositionsMixin "mixins/positions-api";

import OQL "mo:caffeineai-oql";
import Entity "mo:caffeineai-oql/Entity";
import TextValue "mo:caffeineai-oql/TextValue";
import FloatValue "mo:caffeineai-oql/FloatValue";
import IntValue "mo:caffeineai-oql/IntValue";
import Expose "mo:caffeineai-oql/Expose";


actor {
  var spreadActive : Bool;
  var dynamicSpreadActive : Bool;
  var dynamicSpreadExpiry : Int;
  var currentCycleIndex : Nat;
  transient let INITIAL_BALANCE : Float = 1000.0;
  transient let REDEMPTION_FEE_RATE : Float = 0.02;
  transient let MAX_SHORT_POSITION_VALUE : Float = 500.0;
  var isTradingPaused : Bool;

  // ─── LMSR Subsidy Reserves ───────────────────────────────────────────────
  // Per-index cumulative spread revenue credited on every allocate/redeem.
  // Persisted via enhanced orthogonal persistence (top-level var in actor).
  var subsidyReserves : Map.Map<Text, Float>;

  // Mutable record wrapper so the crisis auto-reset inside
  // LMSR.getSpreadForAsset propagates back to the actor's state vars.
  let crisisState : { var dynamicSpreadActive : Bool; var dynamicSpreadExpiry : Int };

  let accessControlState : AccessControl.AccessControlState;
  // Grant admin access to local development principal
  accessControlState.userRoles.add(
    Principal.fromText("mqwym-doh3o-3aec2-enqnm-d6ucm-7f4mb-ue3p2-lkc7n-hvzr2-fzytp-pqe"),
    #admin,
  );
  accessControlState.adminAssigned := true;
  include MixinAuthorization(accessControlState);
  include LMSRMixin(subsidyReserves);

  // ─── HTTP Outcall Types ───────────────────────────────────────────────────
  type HttpHeader = { name : Text; value : Text };
  type HttpRequestArgs = {
    url : Text;
    max_response_bytes : ?Nat64;
    headers : [HttpHeader];
    body : ?Blob;
    method : { #get; #post; #head };
    transform : ?TransformContext;
  };
  type TransformContext = {
    function : shared query (TransformArgs) -> async HttpResponse;
    context : Blob;
  };
  type TransformArgs = {
    response : HttpResponse;
    context : Blob;
  };
  type HttpResponse = {
    status : Nat;
    headers : [HttpHeader];
    body : Blob;
  };

  // Management canister reference for HTTP outcalls
  transient let ic : actor {
    http_request : HttpRequestArgs -> async HttpResponse;
  } = actor "aaaaa-aa";

  // ─── Response Header Sanitizer ────────────────────────────────────────────
  public query func transform(args : TransformArgs) : async HttpResponse {
    {
      status = args.response.status;
      headers = [];
      body = args.response.body;
    };
  };

  // ─── Tiered Polling Cadence (cycle-burn reduction) ────────────────────────
  // Tier A — Critical (Finnhub): no rate limit applied here
  // Tier B — Important: 5-minute minimum between outcalls (Reddit, GDELT)
  // Tier C — Low priority: 15-minute minimum between outcalls (YouTube, TMDB,
  //           OMDB, BLS, ReliefWeb, USPTO, Fed, Congress, FTC, SCOTUS, EPA, ACLU)
  //
  // The frontend may call these functions at any cadence — the canister enforces
  // the minimum interval and returns a cached empty response when the gate is
  // closed, consuming zero HTTP outcall cycles.

  transient let TIER_B_INTERVAL_NS : Int = 300_000_000_000;    // 5 minutes
  transient let TIER_C_INTERVAL_NS : Int = 900_000_000_000;    // 15 minutes
  transient let TIER_C_30MIN_NS    : Int = 1_800_000_000_000;  // 30 minutes
  transient let TIER_C_60MIN_NS    : Int = 3_600_000_000_000;  // 60 minutes

  // Circuit breaker threshold — when balance drops below this value, all Tier C
  // source fetches are paused for that heartbeat interval. Tier A (Finnhub) and
  // Tier B (Reddit, GDELT) are never affected. Timestamps are NOT updated when
  // the circuit breaker fires so sources retry on the next call once balance recovers.
  transient let CYCLES_SAFETY_THRESHOLD : Nat = 500_000_000_000; // 500B cycles

  // Per-subreddit last-fetch timestamps — each subreddit gets its own independent gate.
  // Keyed by subreddit name (e.g. "worldnews"). 0 = never fetched, always allow first call.
  let lastFetch_RedditMap   : Map.Map<Text, Int>;
  // Per-subreddit consecutive failure counters — keyed by subreddit name.
  let failures_RedditMap    : Map.Map<Text, Nat>;

  // Per-source last-fetch timestamps (0 = never fetched, always allow first call)
  var lastFetch_Reddit      : Int; // retained for resetRedditBackoff() compat
  var lastFetch_GDELT       : Int;
  var lastFetch_YouTube     : Int;
  var lastFetch_TMDB        : Int;
  var lastFetch_TMDBPopular : Int;
  var lastFetch_OMDBMarvel  : Int;
  var lastFetch_OMDBDC      : Int;
  var lastFetch_BLS         : Int;
  var lastFetch_ReliefWeb   : Int;
  var lastFetch_USPTO       : Int;
  var lastFetch_Fed         : Int;
  var lastFetch_Congress    : Int;
  var lastFetch_CongressTrad : Int;
  var lastFetch_FTC         : Int;
  var lastFetch_SCOTUS      : Int;
  var lastFetch_EPA         : Int;
  var lastFetch_ACLU        : Int;
  var lastFetch_CourtListener : Int;
  var lastFetch_SEC         : Int;
  var lastFetch_GlobeNewswire : Int;

  // Per-source consecutive failure counters (reset on success)
  var failures_Reddit      : Nat; // retained for resetRedditBackoff() compat
  var failures_GDELT       : Nat;
  var failures_YouTube     : Nat;
  var failures_TMDB        : Nat;
  var failures_TMDBPopular : Nat;
  var failures_OMDBMarvel  : Nat;
  var failures_OMDBDC      : Nat;
  var failures_BLS         : Nat;
  var failures_ReliefWeb   : Nat;
  var failures_USPTO       : Nat;
  var failures_Fed         : Nat;
  var failures_Congress    : Nat;
  var failures_CongressTrad : Nat;
  var failures_FTC         : Nat;
  var failures_SCOTUS      : Nat;
  var failures_EPA         : Nat;
  var failures_ACLU        : Nat;
  var failures_CourtListener : Nat;
  var failures_SEC         : Nat;
  var failures_GlobeNewswire : Nat;

  // ─── Tick History ─────────────────────────────────────────────────────────
  // Stores up to 720 ticks (30s × 720 = 6 hours) committed by the frontend
  // after each Oracle tick cycle.  Any client connecting gets the same history.

  type TickRecord = {
    tickIndex : Nat;
    timestamp : Int;
    scores : [(Text, Float)];
    gsiValue : Float;
    topHeadline : ?Text;
  };

  // ─── Per-User Tick History ────────────────────────────────────────────────
  let userTickHistory : Map.Map<Principal, [TickRecord]>;

  // ─── Tick History Stable State ────────────────────────────────────────────
  // Wrapped in a mutable record so the PositionsMixin — which captures the
  // flattened scores array at include time — can be passed a fresh snapshot
  // without the staleness that a bare `var tickHistory` would cause (the mixin
  // would capture the empty initial array). The record is shared by reference,
  // so flattenTickScores reads tickHistoryState.ticks at call time.
  let tickHistoryState : { var ticks : [TickRecord] };
  var latestScoreSnapshot : [(Text, Float)];
  var tickHeartbeat : Nat;

  // 30-second heartbeat timer — counter only, no Oracle logic
  ignore Timer.recurringTimer<system>(#seconds 30, func() : async () {
    tickHeartbeat += 1;
  });

  // Exponential backoff multipliers:
  //   0 failures → 1× base interval (normal)
  //   1 failure  → 2× base interval
  //   2 failures → 4× base interval
  //   3+ failures → 10× base interval (effectively suspended)
  func backoffMultiplier(consecutiveFailures : Nat) : Int {
    if (consecutiveFailures == 0) { 1 }
    else if (consecutiveFailures == 1) { 2 }
    else if (consecutiveFailures == 2) { 4 }
    else { 10 };
  };

  // Returns true if the source gate is open (enough time has elapsed)
  func gateOpen(lastFetch : Int, baseInterval : Int, consecutiveFailures : Nat) : Bool {
    let effectiveInterval = baseInterval * backoffMultiplier(consecutiveFailures);
    Time.now() - lastFetch >= effectiveInterval;
  };

  // ─── Finnhub HTTP Outcall ────────────────────────────────────────────────
  // Retained for stable-variable compatibility (previously NEWS_API_KEY / NEWS_URL)
  transient let NEWS_API_KEY : Text = "";
  transient let NEWS_URL : Text = "";
  // Finnhub API key stored in mutable state (not hardcoded) — set via setFinnhubKey()
  // Initial value is supplied by the migration chain (migrations/20260725_210516.mo),
  // not by an inline initializer — required under --enhanced-migration.
  var finnhubApiKey : Text;

  // Base URL without the token — the full URL is built dynamically inside fetchNews()
  // by appending "&token=" # finnhubApiKey.
  transient let FINNHUB_BASE_URL : Text = "https://finnhub.io/api/v1/news?category=general";

  public func fetchNews() : async Text {
    // Early-return guard: do not make an outcall with an empty/invalid key.
    if (finnhubApiKey == "") {
      Debug.print("[fetchNews] finnhubApiKey not set — returning empty array");
      return "[]";
    };
    let finnhubUrl : Text = FINNHUB_BASE_URL # "&token=" # finnhubApiKey;
    let request : HttpRequestArgs = {
      url = finnhubUrl;
      max_response_bytes = ?Nat64.fromNat(500_000);
      headers = [
        { name = "Accept"; value = "application/json" },
        { name = "User-Agent"; value = "SentimentAM-Oracle/1.0" },
      ];
      body = null;
      method = #get;
      transform = ?{
        function = transform;
        context = ("" : Blob);
      };
    };

    try {
      let response = await (with cycles = 10_000_000_000) ic.http_request(request);
      switch (response.body.decodeUtf8()) {
        case (?text) {
          // If it starts with '[', it is valid Finnhub data
          if (text.size() > 0 and text.chars().next() == ?'[') {
            text;
          } else {
            // If it starts with '{' it is an error. Return empty array to prevent frontend crash.
            "[]";
          };
        };
        case null { "[]" };
      };
    } catch (_) {
      "[]";
    };
  };


  // ─── Reddit Social Sentiment Feed ──────────────────────────────────────────
  // Legacy URL constants retained for stable-variable upgrade compatibility
  transient let REDDIT_WORLDNEWS_URL : Text = "https://www.reddit.com/r/worldnews/new.json?limit=10";
  transient let REDDIT_WSB_URL       : Text = "https://www.reddit.com/r/wallstreetbets/new.json?limit=10";

  // Active subreddit list — 5 subreddits across macro and values categories.
  transient let REDDIT_SUBREDDITS : [Text] = [
    "worldnews",            // geopolitical/macro signal
    "wallstreetbets",       // macro/fed policy signal
    "politics",             // TRAD/PROG values signal
  ];

  // Helper: get per-subreddit last-fetch timestamp (defaults to 0 = never fetched)
  func redditLastFetch(sub : Text) : Int {
    switch (lastFetch_RedditMap.get(sub)) { case (?t) t; case null 0 };
  };

  // Helper: get per-subreddit failure count (defaults to 0)
  func redditFailures(sub : Text) : Nat {
    switch (failures_RedditMap.get(sub)) { case (?n) n; case null 0 };
  };

  // Helper: determine if a response body looks like a rate-limit response
  func isRateLimitResponse(body : Text) : Bool {
    body.contains(#text "429") or
    body.contains(#text "rate limit") or
    body.contains(#text "Rate Limit") or
    body.contains(#text "Too Many Requests") or
    body.contains(#text "ratelimit");
  };

  public func fetchRedditFeed(subreddit : Text) : async Text {
    // Per-subreddit gate: each subreddit has its own independent timestamp and failure counter.
    let subLastFetch = redditLastFetch(subreddit);
    let subFailures  = redditFailures(subreddit);
    if (not gateOpen(subLastFetch, TIER_C_INTERVAL_NS, subFailures)) {
      return "{}";
    };

    let url : Text = "https://www.reddit.com/r/" # subreddit # "/hot.json?limit=10&t=day";

    let request : HttpRequestArgs = {
      url = url;
      max_response_bytes = ?Nat64.fromNat(200_000);
      headers = [
        { name = "Accept";     value = "application/json" },
        { name = "User-Agent"; value = "SentimentAM-Social/1.0 (by /u/sentimentam)" },
      ];
      body = null;
      method = #get;
      transform = ?{
        function = transform;
        context = ("" : Blob);
      };
    };

    try {
      let response = await (with cycles = 5_000_000_000) ic.http_request(request);

      // Debug: return status and body preview for any non-200 response
      if (response.status != 200) {
        let bodyText = switch (response.body.decodeUtf8()) {
          case (?t) t;
          case null "BODY_DECODE_ERROR";
        };
        let truncated = if (bodyText.size() > 500) {
          var buf = "";
          var i = 0;
          for (c in bodyText.toIter()) {
            if (i < 500) { buf #= Text.fromChar(c); i += 1 };
          };
          buf
        } else { bodyText };
        return "DEBUG_STATUS:" # response.status.toText() # "|BODY:" # truncated;
      };

      switch (response.body.decodeUtf8()) {
        case (?text) {
          // ISSUE 3 FIX — Pre-checks before the '{' character check:

          // Check 1: Empty response
          if (text.size() == 0) {
            // Transient error — do NOT apply backoff, do not update lastFetch
            Debug.print("[Reddit] WARN r/" # subreddit # ": empty response (transient, no backoff)");
            return "{}";
          };

          let firstChar = text.chars().next();

          // Check 2: HTML response (starts with '<') — could be rate-limit or CDN error page
          if (firstChar == ?'<') {
            let bodyLen = text.size();
            let preview = if (bodyLen > 100) {
              // Take first 100 chars manually
              var buf = "";
              var i = 0;
              for (c in text.toIter()) {
                if (i < 100) { buf #= Text.fromChar(c); i += 1 };
              };
              buf
            } else { text };

            if (isRateLimitResponse(text)) {
              // Rate limit — apply backoff
              let newFailures = subFailures + 1;
              failures_RedditMap.add(subreddit, newFailures);
              lastFetch_RedditMap.add(subreddit, Time.now());
              Debug.print("[Reddit] RATE-LIMIT r/" # subreddit # " (HTML, len=" # bodyLen.toText() # "): backoff applied. Failures=" # newFailures.toText());
            } else {
              // Transient CDN/error page — do NOT apply backoff
              Debug.print("[Reddit] WARN r/" # subreddit # ": HTML error response (transient, no backoff), len=" # bodyLen.toText() # ", preview=" # preview);
            };
            return "{}";
          };

          // Check 3: Existing JSON object check ('{' first char)
          if (firstChar == ?'{') {
            // Count posts: count occurrences of '"kind":"t3"' as a proxy for post count
            var postCount : Nat = 0;
            for (_ in text.split(#text "\"kind\":\"t3\"")) {
              postCount += 1;
            };
            // split gives N+1 parts for N matches, so subtract 1
            let count = if (postCount > 0) postCount - 1 else 0;
            Debug.print("[Reddit] OK r/" # subreddit # ": " # count.toText() # " posts");
            lastFetch_RedditMap.add(subreddit, Time.now());
            failures_RedditMap.add(subreddit, 0);
            text;
          } else {
            // Unexpected format — check if it looks like a rate limit response
            if (isRateLimitResponse(text)) {
              let newFailures = subFailures + 1;
              failures_RedditMap.add(subreddit, newFailures);
              lastFetch_RedditMap.add(subreddit, Time.now());
              Debug.print("[Reddit] RATE-LIMIT r/" # subreddit # ": non-JSON rate-limit response, backoff applied. Failures=" # newFailures.toText());
            } else {
              // Transient — no backoff
              Debug.print("[Reddit] WARN r/" # subreddit # ": unexpected response format (transient, no backoff)");
            };
            "{}";
          };
        };
        case null {
          // UTF-8 decode failure — transient, do NOT apply backoff
          Debug.print("[Reddit] WARN r/" # subreddit # ": response body could not be decoded as UTF-8 (transient, no backoff)");
          "{}";
        };
      };
    } catch (err) {
      // ISSUE 2 FIX — Distinguish rate-limit errors from transient network errors:
      // A rate-limit error from Reddit will contain "429" or "rate limit" in the message.
      // Transient errors (network timeout, connection refused, etc.) should NOT apply backoff
      // so the next normal polling cycle retries without penalty.
      let msg = err.message();
      if (isRateLimitResponse(msg)) {
        // Rate limit — apply backoff
        let newFailures = subFailures + 1;
        failures_RedditMap.add(subreddit, newFailures);
        lastFetch_RedditMap.add(subreddit, Time.now());
        Debug.print("[Reddit] RATE-LIMIT r/" # subreddit # ": " # msg # " — backoff applied. Failures=" # newFailures.toText());
      } else {
        // Transient network error — log but do NOT apply backoff or update lastFetch
        Debug.print("[Reddit] TRANSIENT r/" # subreddit # ": " # msg # " — no backoff applied");
      };
      "{}";
    };
  };

  /// Resets Reddit backoff state so the next heartbeat triggers an immediate retry.
  /// Use this after a canister top-up to avoid waiting up to 50 minutes for the
  /// backoff window to expire. Admin-gated — only canister admins may call this.
  public shared ({ caller }) func resetRedditBackoff() : async () {
    if (not (AccessControl.isAdmin(accessControlState, caller))) {
      Runtime.trap("Unauthorized: Only admins can reset the Reddit backoff");
    };
    // Reset per-subreddit maps for all active subreddits
    for (sub in REDDIT_SUBREDDITS.values()) {
      failures_RedditMap.add(sub, 0);
      lastFetch_RedditMap.add(sub, 0);
    };
    // Also reset legacy vars for compat
    failures_Reddit := 0;
    lastFetch_Reddit := 0;
    Debug.print("[Reddit] backoff reset by admin (all subreddits)");
  };

  /// Returns the current cycles balance of this canister.
  /// PUBLIC — no auth required. Use for monitoring without controller access:
  ///   dfx canister call noek7-3yaaa-aaaaj-qn6ea-cai getCyclesBalance --network ic
  public query func getCyclesBalance() : async Nat {
    ExperimentalCycles.balance()
  };

  // ─── HuggingFace FinBERT Sentiment Analysis ───────────────────────────────
  // API key stored in mutable state (not hardcoded) — set via setHuggingFaceKey()
  var huggingfaceApiKey : Text;
  // HF_API_KEY retained as an empty constant for stable-variable upgrade compatibility.
  // The actual key is now stored in huggingfaceApiKey (mutable, admin-settable).
  transient let HF_API_KEY : Text = ""; // retained for upgrade compat — do not remove
  transient let BLS_API_KEY : Text = "9c09beaad5df4087a9d05ca5012d179d";
  transient let CONGRESS_API_KEY : Text = "bx9a4QidpnBVTBPteJoW6hvqUqPSdrthuEbTERGW";
  transient let YOUTUBE_API_KEY : Text = "AIzaSyA6NUeCxursODsuAFQ4Wa0bcua6C19gIEw";
  transient let TMDB_API_KEY : Text = "YOUR_TMDB_KEY_HERE";
  transient let OMDB_API_KEY : Text = "346ceaea";
  transient let HF_FINBERT_URL : Text = "https://anthonyjb1-momentum-finbert-inference.hf.space/run/predict";

  /// Sets the HuggingFace API key. Open during pre-deployment — any signed-in caller may set the key.
  public shared func setHuggingFaceKey(key : Text) : async () {
    huggingfaceApiKey := key;
  };

  /// Returns key status without exposing the value. Open during pre-deployment — any signed-in caller may check the key.
  public shared func getHuggingFaceKeyStatus() : async Text {
    if (huggingfaceApiKey == "") { return "NOT SET" };
    return "SET (" # huggingfaceApiKey.size().toText() # " chars)";
  };

  /// Sets the Finnhub API key. Open during pre-deployment — any signed-in caller may set the key.
  public shared func setFinnhubKey(key : Text) : async () {
    finnhubApiKey := key;
  };

  /// Returns Finnhub key status without exposing the value. Open during pre-deployment — any signed-in caller may check the key.
  public shared func getFinnhubKeyStatus() : async Text {
    if (finnhubApiKey == "") { return "NOT SET" };
    return "SET (" # finnhubApiKey.size().toText() # " chars)";
  };

  // Neutral fallback returned on any error or when key is not set.
  // NOTE: "label" is a reserved keyword in Motoko — field is named sentimentLabel.
  transient let NEUTRAL_FALLBACK = { sentimentLabel = "neutral"; confidence : Float = 0.5; source = "neutral_fallback" };

  /// Internal FinBERT classification via HuggingFace Inference API.
  /// Returns neutral_fallback immediately if key is not set — no HTTP call made.
  func classifyHeadlineSentiment(headline : Text) : async { sentimentLabel : Text; confidence : Float; source : Text } {
    // Case 1: key not set — return neutral fallback without HTTP call
    if (huggingfaceApiKey == "") {
      return NEUTRAL_FALLBACK;
    };

    let bodyText : Text = "{\"inputs\": \"" # headline # "\"}";
    let bodyBlob : Blob = bodyText.encodeUtf8();

    let request : HttpRequestArgs = {
      url = HF_FINBERT_URL;
      max_response_bytes = ?Nat64.fromNat(10_000);
      headers = [
        { name = "Content-Type"; value = "application/json" },
        { name = "Authorization"; value = "Bearer " # huggingfaceApiKey },
      ];
      body = ?bodyBlob;
      method = #post;
      transform = ?{
        function = transform;
        context = ("" : Blob);
      };
    };

    try {
      let response = await (with cycles = 10_000_000_000) ic.http_request(request);

      // Case 3: 503 cold start — model loading, return neutral fallback
      if (response.status == 503) {
        return NEUTRAL_FALLBACK;
      };

      switch (response.body.decodeUtf8()) {
        case (?json) {
          // Gradio Space format: {"data": ["{\"sentimentLabel\": \"negative\", \"confidence\": 0.9994, \"source\": \"finbert_live\"}"]}
          // The inner value is a JSON-escaped string with literal backslashes in the raw body.
          // Detect by presence of sentimentLabel and parse directly via substring scanning.
          if (json.contains(#text "sentimentLabel")) {
            let labelVal = extractTextValue(json, "sentimentLabel\\\": \\\"");
            let confVal  = extractFloatValue(json, "confidence\\\": ");
            let srcVal   = extractTextValue(json, "source\\\": \\\"");
            let resolvedLabel = switch (labelVal) {
              case (?l) {
                if (l == "positive" or l == "POSITIVE") "positive"
                else if (l == "negative" or l == "NEGATIVE") "negative"
                else "neutral";
              };
              case null "neutral";
            };
            let resolvedConf = switch (confVal) {
              case (?c) { if (c > 0.0 and c <= 1.0) c else 0.5 };
              case null 0.5;
            };
            let resolvedSrc = switch (srcVal) {
              case (?s) s;
              case null "finbert_live";
            };
            { sentimentLabel = resolvedLabel; confidence = resolvedConf; source = resolvedSrc };
          } else {
            // HuggingFace Inference API format: [[{"label":"positive","score":0.9}, ...]]
            // Simplified parser: scan for "label":"X" and pick the highest adjacent score.
            let posScore = extractScore(json, "positive");
            let negScore = extractScore(json, "negative");
            let neuScore = extractScore(json, "neutral");

            if (posScore >= negScore and posScore >= neuScore and posScore > 0.0) {
              { sentimentLabel = "positive"; confidence = posScore; source = "finbert_live" };
            } else if (negScore >= posScore and negScore >= neuScore and negScore > 0.0) {
              { sentimentLabel = "negative"; confidence = negScore; source = "finbert_live" };
            } else if (neuScore > 0.0) {
              { sentimentLabel = "neutral"; confidence = neuScore; source = "finbert_live" };
            } else {
              // Case 4: response cannot be parsed — return neutral fallback
              NEUTRAL_FALLBACK;
            };
          };
        };
        // Case 2: HTTP call succeeded but body is not UTF-8 — return neutral fallback
        case null { NEUTRAL_FALLBACK };
      };
    } catch (_) {
      // Case 2: HTTP call failed or timed out — return neutral fallback
      NEUTRAL_FALLBACK;
    };
  };

  /// Extracts the score for a given label from HuggingFace FinBERT JSON response.
  /// Scans for the pattern: "label":"<labelName>" and reads the "score": value that follows.
  /// Returns 0.0 if the pattern is not found or cannot be parsed.
  func extractScore(json : Text, labelName : Text) : Float {
    let searchPattern = "\"label\":\"" # labelName # "\"";
    if (not json.contains(#text searchPattern)) {
      return 0.0;
    };
    // Split on the label pattern and examine the segment that follows
    var afterLabel : Text = "";
    var skippedFirst = false;
    for (part in json.split(#text searchPattern)) {
      if (skippedFirst and afterLabel == "") {
        afterLabel := part;
      };
      if (not skippedFirst) { skippedFirst := true };
    };
    if (afterLabel == "") { return 0.0 };

    // Now find "score": in afterLabel
    let scoreMarker = "\"score\":";
    if (not afterLabel.contains(#text scoreMarker)) { return 0.0 };
    var afterScore : Text = "";
    var skippedScore = false;
    for (part in afterLabel.split(#text scoreMarker)) {
      if (skippedScore and afterScore == "") {
        afterScore := part;
      };
      if (not skippedScore) { skippedScore := true };
    };
    if (afterScore == "") { return 0.0 };

    // Parse the numeric value manually: collect digits and one decimal point
    // e.g. "0.9234..." → integer part 0, fractional part 9234, denominator 10000
    var intPart : Nat = 0;
    var fracNumerator : Nat = 0;
    var fracDenominator : Nat = 1;
    var inFrac = false;
    var startedDigits = false;
    var stop = false;
    for (c in afterScore.toIter()) {
      if (not stop) {
        if (c >= '0' and c <= '9') {
          startedDigits := true;
        let digit = c.toNat32().toNat() - 48;
          if (inFrac) {
            fracNumerator := fracNumerator * 10 + digit;
            fracDenominator := fracDenominator * 10;
          } else {
            intPart := intPart * 10 + digit;
          };
        } else if (c == '.' and not inFrac) {
          inFrac := true;
        } else if (startedDigits) {
          stop := true;
        };
      };
    };
    if (not startedDigits) { return 0.0 };
    intPart.toFloat() + (fracNumerator.toFloat() / fracDenominator.toFloat());
  };

  /// Extracts a text value from a Gradio-escaped JSON body.
  /// Scans for `key` then collects chars until the next `\` terminator (escaped-quote boundary).
  /// Returns null if the key is not found.
  func extractTextValue(json : Text, key : Text) : ?Text {
    if (not json.contains(#text key)) { return null };
    var after : Text = "";
    var skipped = false;
    for (part in json.split(#text key)) {
      if (skipped and after == "") { after := part };
      if (not skipped) { skipped := true };
    };
    if (after == "") { return null };
    var result : Text = "";
    var stop = false;
    for (c in after.toIter()) {
      if (not stop) {
        if (c == '\\') { stop := true } else { result := result # Char.toText(c) };
      };
    };
    if (result == "") null else ?result;
  };

  /// Extracts a Float value from a Gradio-escaped JSON body.
  /// Scans for `key` then collects the numeric value that follows using the same
  /// digit-collection loop as extractScore.
  /// Returns null if the key is not found or no digits are present.
  func extractFloatValue(json : Text, key : Text) : ?Float {
    if (not json.contains(#text key)) { return null };
    var after : Text = "";
    var skipped = false;
    for (part in json.split(#text key)) {
      if (skipped and after == "") { after := part };
      if (not skipped) { skipped := true };
    };
    if (after == "") { return null };
    var intPart : Nat = 0;
    var fracNumerator : Nat = 0;
    var fracDenominator : Nat = 1;
    var inFrac = false;
    var startedDigits = false;
    var stop = false;
    for (c in after.toIter()) {
      if (not stop) {
        if (c >= '0' and c <= '9') {
          startedDigits := true;
          let digit = c.toNat32().toNat() - 48;
          if (inFrac) {
            fracNumerator := fracNumerator * 10 + digit;
            fracDenominator := fracDenominator * 10;
          } else {
            intPart := intPart * 10 + digit;
          };
        } else if (c == '.' and not inFrac) {
          inFrac := true;
        } else if (startedDigits) {
          stop := true;
        };
      };
    };
    if (not startedDigits) { return null };
    ?(intPart.toFloat() + (fracNumerator.toFloat() / fracDenominator.toFloat()));
  };

  /// Public update function — frontend calls this to classify a headline.
  /// HTTP outcalls require update calls (not query).
  /// Returns neutral_fallback if key is not set or on any error.
  /// NOTE: field is "sentimentLabel" not "label" — "label" is a reserved keyword in Motoko.
  public shared func classifyHeadline(headline : Text) : async { sentimentLabel : Text; confidence : Float; source : Text } {
    await classifyHeadlineSentiment(headline);
  };

  /// Legacy function retained for backward compatibility.
  /// New callers should use classifyHeadline() instead.
  public shared func analyzeSentiment(text : Text) : async Text {
    let result = await classifyHeadlineSentiment(text);
    if (result.source == "finbert_live") {
      "[{\"label\":\"" # result.sentimentLabel # "\",\"score\":" # result.confidence.toText() # "}]";
    } else {
      "[{\"label\":\"neutral\",\"score\":0.5}]";
    };
  };

  // ─── Federal Reserve HTTP Outcall ─────────────────────────────────────────
  public func fetchFedData() : async Text {
    // Tier C gate: 15-minute minimum
    if (not gateOpen(lastFetch_Fed, TIER_C_INTERVAL_NS, failures_Fed)) {
      return "";
    };
    // Cycles circuit breaker — pause Tier C if balance is below safety threshold
    let currentCycles = ExperimentalCycles.balance();
    if (currentCycles <= CYCLES_SAFETY_THRESHOLD) {
      Debug.print("[CircuitBreaker] Balance below threshold — Tier C paused. Balance: " # currentCycles.toText());
      return "";
    };
    let url = "https://www.federalreserve.gov/feeds/press_all.xml";
    let request : HttpRequestArgs = {
      url = url;
      max_response_bytes = ?Nat64.fromNat(500_000);
      headers = [
        { name = "User-Agent"; value = "MomentumTerminal/1.0" },
        { name = "Accept"; value = "application/rss+xml, application/xml, text/xml" },
      ];
      body = null;
      method = #get;
      transform = null;
    };
    try {
      let response = await (with cycles = 10_000_000_000) ic.http_request(request);
      switch (response.body.decodeUtf8()) {
        case (?text) {
          lastFetch_Fed := Time.now();
          failures_Fed := 0;
          text;
        };
        case null {
          failures_Fed += 1;
          lastFetch_Fed := Time.now();
          "";
        };
      };
    } catch (_) {
      failures_Fed += 1;
      lastFetch_Fed := Time.now();
      "";
    };
  };

  // ─── Bureau of Labor Statistics HTTP Outcall ──────────────────────────────
  public func fetchBLSData() : async Text {
    // Tier C gate: 15-minute minimum
    if (not gateOpen(lastFetch_BLS, TIER_C_INTERVAL_NS, failures_BLS)) {
      return "{}";
    };
    // Cycles circuit breaker — pause Tier C if balance is below safety threshold
    let currentCycles = ExperimentalCycles.balance();
    if (currentCycles <= CYCLES_SAFETY_THRESHOLD) {
      Debug.print("[CircuitBreaker] Balance below threshold — Tier C paused. Balance: " # currentCycles.toText());
      return "{}";
    };
    let url = "https://api.bls.gov/publicAPI/v2/timeseries/data/";
    let requestBody = "{\"seriesid\":[\"CUUR0000SA0\",\"CES0000000001\"],\"startyear\":\"2024\",\"endyear\":\"2025\",\"registrationkey\":\"" # BLS_API_KEY # "\"}";
    let bodyBytes = requestBody.encodeUtf8();
    let request : HttpRequestArgs = {
      url = url;
      max_response_bytes = ?Nat64.fromNat(500_000);
      headers = [
        { name = "Content-Type"; value = "application/json" },
        { name = "User-Agent"; value = "MomentumTerminal/1.0" },
      ];
      body = ?bodyBytes;
      method = #post;
      transform = null;
    };
    try {
      let response = await (with cycles = 10_000_000_000) ic.http_request(request);
      switch (response.body.decodeUtf8()) {
        case (?text) {
          lastFetch_BLS := Time.now();
          failures_BLS := 0;
          text;
        };
        case null {
          failures_BLS += 1;
          lastFetch_BLS := Time.now();
          "{}";
        };
      };
    } catch (_) {
      failures_BLS += 1;
      lastFetch_BLS := Time.now();
      "{}";
    };
  };

  // ─── ReliefWeb MENA Reports HTTP Outcall ─────────────────────────────────
  public func fetchReliefWebData() : async Text {
    // Tier C gate: 15-minute minimum
    if (not gateOpen(lastFetch_ReliefWeb, TIER_C_INTERVAL_NS, failures_ReliefWeb)) {
      return "{}";
    };
    // Cycles circuit breaker — pause Tier C if balance is below safety threshold
    let currentCycles = ExperimentalCycles.balance();
    if (currentCycles <= CYCLES_SAFETY_THRESHOLD) {
      Debug.print("[CircuitBreaker] Balance below threshold — Tier C paused. Balance: " # currentCycles.toText());
      return "{}";
    };
    let url = "https://api.reliefweb.int/v1/reports?appname=momentum-terminal&filter[operator]=AND&filter[conditions][0][field]=country.name&filter[conditions][0][value][]=Israel&filter[conditions][1][field]=country.name&filter[conditions][1][value][]=Palestine&filter[conditions][2][field]=country.name&filter[conditions][2][value][]=Lebanon&filter[conditions][3][field]=country.name&filter[conditions][3][value][]=Syria&filter[conditions][4][field]=country.name&filter[conditions][4][value][]=Iran&filter[conditions][5][field]=country.name&filter[conditions][5][value][]=Yemen&fields[include][]=title&fields[include][]=date&fields[include][]=source&sort[]=date:desc&limit=10";
    let request : HttpRequestArgs = {
      url = url;
      max_response_bytes = ?Nat64.fromNat(500_000);
      headers = [
        { name = "User-Agent"; value = "MomentumTerminal/1.0" },
        { name = "Accept"; value = "application/json" },
      ];
      body = null;
      method = #get;
      transform = null;
    };
    try {
      let response = await (with cycles = 10_000_000_000) ic.http_request(request);
      switch (response.body.decodeUtf8()) {
        case (?text) {
          lastFetch_ReliefWeb := Time.now();
          failures_ReliefWeb := 0;
          text;
        };
        case null {
          failures_ReliefWeb += 1;
          lastFetch_ReliefWeb := Time.now();
          "{}";
        };
      };
    } catch (_) {
      failures_ReliefWeb += 1;
      lastFetch_ReliefWeb := Time.now();
      "{}";
    };
  };

  // ─── GDELT MENA News HTTP Outcall ────────────────────────────────────────
  public func fetchGDELTData() : async Text {
    // Tier B gate: 5-minute minimum
    if (not gateOpen(lastFetch_GDELT, TIER_B_INTERVAL_NS, failures_GDELT)) {
      return "{}";
    };
    let url = "https://api.gdeltproject.org/api/v2/doc/doc?query=MENA%20OR%20%22Middle%20East%22%20OR%20Iran%20OR%20Israel%20OR%20Hamas%20OR%20Hezbollah%20OR%20OPEC%20OR%20%22Saudi%20Arabia%22&mode=artlist&maxrecords=10&format=json&timespan=1d";
    let request : HttpRequestArgs = {
      url = url;
      max_response_bytes = ?Nat64.fromNat(500_000);
      headers = [
        { name = "User-Agent"; value = "MomentumTerminal/1.0" },
        { name = "Accept"; value = "application/json" },
      ];
      body = null;
      method = #get;
      transform = null;
    };
    try {
      let response = await (with cycles = 10_000_000_000) ic.http_request(request);
      switch (response.body.decodeUtf8()) {
        case (?text) {
          lastFetch_GDELT := Time.now();
          failures_GDELT := 0;
          text;
        };
        case null {
          failures_GDELT += 1;
          lastFetch_GDELT := Time.now();
          "{}";
        };
      };
    } catch (_) {
      failures_GDELT += 1;
      lastFetch_GDELT := Time.now();
      "{}";
    };
  };

  // ─── USPTO / Google Patents RSS HTTP Outcall ──────────────────────────────
  public func fetchUSPTOData() : async Text {
    // Tier C gate: 15-minute minimum
    if (not gateOpen(lastFetch_USPTO, TIER_C_INTERVAL_NS, failures_USPTO)) {
      return "";
    };
    // Cycles circuit breaker — pause Tier C if balance is below safety threshold
    let currentCycles = ExperimentalCycles.balance();
    if (currentCycles <= CYCLES_SAFETY_THRESHOLD) {
      Debug.print("[CircuitBreaker] Balance below threshold — Tier C paused. Balance: " # currentCycles.toText());
      return "";
    };
    let url = "https://patents.google.com/rss/query=artificial+intelligence+machine+learning+semiconductor";
    let request : HttpRequestArgs = {
      url = url;
      max_response_bytes = ?Nat64.fromNat(500_000);
      headers = [
        { name = "User-Agent"; value = "MomentumTerminal/1.0" },
        { name = "Accept"; value = "application/rss+xml, application/xml, text/xml" },
      ];
      body = null;
      method = #get;
      transform = null;
    };
    try {
      let response = await (with cycles = 10_000_000_000) ic.http_request(request);
      switch (response.body.decodeUtf8()) {
        case (?text) {
          lastFetch_USPTO := Time.now();
          failures_USPTO := 0;
          text;
        };
        case null {
          failures_USPTO += 1;
          lastFetch_USPTO := Time.now();
          "";
        };
      };
    } catch (_) {
      failures_USPTO += 1;
      lastFetch_USPTO := Time.now();
      "";
    };
  };

  // ─── Congress.gov Bills HTTP Outcall ─────────────────────────────────────
  public func fetchCongressData() : async Text {
    // Tier C gate: 15-minute minimum
    if (not gateOpen(lastFetch_Congress, TIER_C_INTERVAL_NS, failures_Congress)) {
      return "{}";
    };
    // Cycles circuit breaker — pause Tier C if balance is below safety threshold
    let currentCycles = ExperimentalCycles.balance();
    if (currentCycles <= CYCLES_SAFETY_THRESHOLD) {
      Debug.print("[CircuitBreaker] Balance below threshold — Tier C paused. Balance: " # currentCycles.toText());
      return "{}";
    };
    let url = "https://api.congress.gov/v3/bill?q=%7B%22search%22%3A%22artificial+intelligence%22%7D&sort=updateDate+desc&limit=10&api_key=" # CONGRESS_API_KEY;
    let request : HttpRequestArgs = {
      url = url;
      max_response_bytes = ?Nat64.fromNat(500_000);
      headers = [
        { name = "User-Agent"; value = "MomentumTerminal/1.0" },
        { name = "Accept"; value = "application/json" },
      ];
      body = null;
      method = #get;
      transform = null;
    };
    try {
      let response = await (with cycles = 10_000_000_000) ic.http_request(request);
      switch (response.body.decodeUtf8()) {
        case (?text) {
          lastFetch_Congress := Time.now();
          failures_Congress := 0;
          text;
        };
        case null {
          failures_Congress += 1;
          lastFetch_Congress := Time.now();
          "{}";
        };
      };
    } catch (_) {
      failures_Congress += 1;
      lastFetch_Congress := Time.now();
      "{}";
    };
  };

  // ─── FTC Press Release RSS HTTP Outcall ──────────────────────────────────
  public func fetchFTCData() : async Text {
    // Tier C gate: 15-minute minimum
    if (not gateOpen(lastFetch_FTC, TIER_C_INTERVAL_NS, failures_FTC)) {
      return "";
    };
    // Cycles circuit breaker — pause Tier C if balance is below safety threshold
    let currentCycles = ExperimentalCycles.balance();
    if (currentCycles <= CYCLES_SAFETY_THRESHOLD) {
      Debug.print("[CircuitBreaker] Balance below threshold — Tier C paused. Balance: " # currentCycles.toText());
      return "";
    };
    let url = "https://www.ftc.gov/feeds/press-release-list.xml";
    let request : HttpRequestArgs = {
      url = url;
      max_response_bytes = ?Nat64.fromNat(500_000);
      headers = [
        { name = "User-Agent"; value = "MomentumTerminal/1.0" },
        { name = "Accept"; value = "application/rss+xml, application/xml, text/xml" },
      ];
      body = null;
      method = #get;
      transform = null;
    };
    try {
      let response = await (with cycles = 10_000_000_000) ic.http_request(request);
      switch (response.body.decodeUtf8()) {
        case (?text) {
          lastFetch_FTC := Time.now();
          failures_FTC := 0;
          text;
        };
        case null {
          failures_FTC += 1;
          lastFetch_FTC := Time.now();
          "";
        };
      };
    } catch (_) {
      failures_FTC += 1;
      lastFetch_FTC := Time.now();
      "";
    };
  };

  // ─── SCOTUS Opinions RSS HTTP Outcall ────────────────────────────────────
  public func fetchSCOTUSData() : async Text {
    // Tier C gate: 15-minute minimum
    if (not gateOpen(lastFetch_SCOTUS, TIER_C_INTERVAL_NS, failures_SCOTUS)) {
      return "";
    };
    // Cycles circuit breaker — pause Tier C if balance is below safety threshold
    let currentCycles = ExperimentalCycles.balance();
    if (currentCycles <= CYCLES_SAFETY_THRESHOLD) {
      Debug.print("[CircuitBreaker] Balance below threshold — Tier C paused. Balance: " # currentCycles.toText());
      return "";
    };
    let url = "https://www.supremecourt.gov/rss/opinions.aspx";
    let request : HttpRequestArgs = {
      url = url;
      max_response_bytes = ?Nat64.fromNat(500_000);
      headers = [
        { name = "User-Agent"; value = "MomentumTerminal/1.0" },
        { name = "Accept"; value = "application/rss+xml, application/xml, text/xml" },
      ];
      body = null;
      method = #get;
      transform = null;
    };
    try {
      let response = await (with cycles = 10_000_000_000) ic.http_request(request);
      switch (response.body.decodeUtf8()) {
        case (?text) {
          lastFetch_SCOTUS := Time.now();
          failures_SCOTUS := 0;
          text;
        };
        case null {
          failures_SCOTUS += 1;
          lastFetch_SCOTUS := Time.now();
          "";
        };
      };
    } catch (_) {
      failures_SCOTUS += 1;
      lastFetch_SCOTUS := Time.now();
      "";
    };
  };

  // ─── Congress.gov Traditional Values Bills HTTP Outcall ──────────────────
  public func fetchCongressTraditionalData() : async Text {
    // Tier C gate: 15-minute minimum
    if (not gateOpen(lastFetch_CongressTrad, TIER_C_INTERVAL_NS, failures_CongressTrad)) {
      return "{}";
    };
    // Cycles circuit breaker — pause Tier C if balance is below safety threshold
    let currentCycles = ExperimentalCycles.balance();
    if (currentCycles <= CYCLES_SAFETY_THRESHOLD) {
      Debug.print("[CircuitBreaker] Balance below threshold — Tier C paused. Balance: " # currentCycles.toText());
      return "{}";
    };
    let url = "https://api.congress.gov/v3/bill?q=%7B%22search%22%3A%22religious+freedom+parental+rights+school+choice+second+amendment%22%7D&sort=updateDate+desc&limit=10&api_key=" # CONGRESS_API_KEY;
    let request : HttpRequestArgs = {
      url = url;
      max_response_bytes = ?Nat64.fromNat(500_000);
      headers = [
        { name = "User-Agent"; value = "MomentumTerminal/1.0" },
        { name = "Accept"; value = "application/json" },
      ];
      body = null;
      method = #get;
      transform = null;
    };
    try {
      let response = await (with cycles = 10_000_000_000) ic.http_request(request);
      switch (response.body.decodeUtf8()) {
        case (?text) {
          lastFetch_CongressTrad := Time.now();
          failures_CongressTrad := 0;
          text;
        };
        case null {
          failures_CongressTrad += 1;
          lastFetch_CongressTrad := Time.now();
          "{}";
        };
      };
    } catch (_) {
      failures_CongressTrad += 1;
      lastFetch_CongressTrad := Time.now();
      "{}";
    };
  };

  // ─── CourtListener Federal Court Opinions HTTP Outcall ───────────────────
  public func fetchCourtListenerData() : async Text {
    // Tier C gate: 15-minute minimum
    if (not gateOpen(lastFetch_CourtListener, TIER_C_INTERVAL_NS, failures_CourtListener)) {
      return "{}";
    };
    // Cycles circuit breaker — pause Tier C if balance is below safety threshold
    let currentCycles = ExperimentalCycles.balance();
    if (currentCycles <= CYCLES_SAFETY_THRESHOLD) {
      Debug.print("[CircuitBreaker] Balance below threshold — Tier C paused. Balance: " # currentCycles.toText());
      return "{}";
    };
    let url = "https://www.courtlistener.com/api/rest/v3/opinions/?search=religious+freedom+parental+rights+second+amendment+immigration&order_by=-date_created&page_size=10&format=json";
    let request : HttpRequestArgs = {
      url = url;
      max_response_bytes = ?Nat64.fromNat(500_000);
      headers = [
        { name = "User-Agent"; value = "MomentumTerminal/1.0" },
        { name = "Accept"; value = "application/json" },
      ];
      body = null;
      method = #get;
      transform = null;
    };
    try {
      let response = await (with cycles = 10_000_000_000) ic.http_request(request);
      switch (response.body.decodeUtf8()) {
        case (?text) {
          lastFetch_CourtListener := Time.now();
          failures_CourtListener := 0;
          text;
        };
        case null {
          failures_CourtListener += 1;
          lastFetch_CourtListener := Time.now();
          "{}";
        };
      };
    } catch (_) {
      failures_CourtListener += 1;
      lastFetch_CourtListener := Time.now();
      "{}";
    };
  };

  // ─── EPA Press Release RSS HTTP Outcall ──────────────────────────────────
  public shared func fetchEPAData() : async Text {
    // Tier C gate: 15-minute minimum
    if (not gateOpen(lastFetch_EPA, TIER_C_INTERVAL_NS, failures_EPA)) {
      return "";
    };
    // Cycles circuit breaker — pause Tier C if balance is below safety threshold
    let currentCycles = ExperimentalCycles.balance();
    if (currentCycles <= CYCLES_SAFETY_THRESHOLD) {
      Debug.print("[CircuitBreaker] Balance below threshold — Tier C paused. Balance: " # currentCycles.toText());
      return "";
    };
    let url = "https://www.epa.gov/newsreleases/search/rss";
    let request : HttpRequestArgs = {
      url = url;
      max_response_bytes = ?Nat64.fromNat(500_000);
      headers = [
        { name = "User-Agent"; value = "MomentumTerminal/1.0" },
        { name = "Accept"; value = "application/rss+xml, application/xml, text/xml" },
      ];
      body = null;
      method = #get;
      transform = null;
    };
    try {
      let response = await (with cycles = 10_000_000_000) ic.http_request(request);
      switch (response.body.decodeUtf8()) {
        case (?text) {
          lastFetch_EPA := Time.now();
          failures_EPA := 0;
          text;
        };
        case null {
          failures_EPA += 1;
          lastFetch_EPA := Time.now();
          "";
        };
      };
    } catch (_) {
      failures_EPA += 1;
      lastFetch_EPA := Time.now();
      "";
    };
  };

  // ─── ACLU Press Release RSS HTTP Outcall ─────────────────────────────────
  public shared func fetchACLUData() : async Text {
    // Tier C gate: 15-minute minimum
    if (not gateOpen(lastFetch_ACLU, TIER_C_INTERVAL_NS, failures_ACLU)) {
      return "";
    };
    // Cycles circuit breaker — pause Tier C if balance is below safety threshold
    let currentCycles = ExperimentalCycles.balance();
    if (currentCycles <= CYCLES_SAFETY_THRESHOLD) {
      Debug.print("[CircuitBreaker] Balance below threshold — Tier C paused. Balance: " # currentCycles.toText());
      return "";
    };
    let url = "https://www.aclu.org/press-releases/rss";
    let request : HttpRequestArgs = {
      url = url;
      max_response_bytes = ?Nat64.fromNat(500_000);
      headers = [
        { name = "User-Agent"; value = "MomentumTerminal/1.0" },
        { name = "Accept"; value = "application/rss+xml, application/xml, text/xml" },
      ];
      body = null;
      method = #get;
      transform = null;
    };
    try {
      let response = await (with cycles = 10_000_000_000) ic.http_request(request);
      switch (response.body.decodeUtf8()) {
        case (?text) {
          lastFetch_ACLU := Time.now();
          failures_ACLU := 0;
          text;
        };
        case null {
          failures_ACLU += 1;
          lastFetch_ACLU := Time.now();
          "";
        };
      };
    } catch (_) {
      failures_ACLU += 1;
      lastFetch_ACLU := Time.now();
      "";
    };
  };

  // ─── SEC/EDGAR Filing Search HTTP Outcall ────────────────────────────────
  // Tier C — 60-minute polling interval (same cadence as Congress.gov).
  // Free EDGAR Full-Text Search API, no key required.
  // Routes filings to AI Regulation Risk Sentiment, Fed Policy Sentiment, and Traditional American Values indexes
  // based on keyword presence in the generated headline text.
  public func fetchSECFilings() : async Text {
    // Tier C gate: 60-minute minimum (independent timestamp)
    if (not gateOpen(lastFetch_SEC, TIER_C_60MIN_NS, failures_SEC)) {
      return "{}";
    };
    // Cycles circuit breaker — pause Tier C if balance is below safety threshold
    let currentCycles = ExperimentalCycles.balance();
    if (currentCycles <= CYCLES_SAFETY_THRESHOLD) {
      Debug.print("[CircuitBreaker] Balance below threshold — Tier C paused (SEC). Balance: " # currentCycles.toText());
      return "{}";
    };
    let url = "https://efts.sec.gov/LATEST/search-index?q=%22AI%22+%22regulation%22+%22machine+learning%22&forms=8-K,10-K&dateRange=custom&startdt=2024-01-01";
    let request : HttpRequestArgs = {
      url = url;
      max_response_bytes = ?Nat64.fromNat(300_000);
      headers = [
        { name = "User-Agent"; value = "MomentumTerminal/1.0" },
        { name = "Accept"; value = "application/json" },
      ];
      body = null;
      method = #get;
      transform = null;
    };
    try {
      let response = await (with cycles = 10_000_000_000) ic.http_request(request);
      switch (response.body.decodeUtf8()) {
        case (?text) {
          // Check for rate-limit response before accepting
          if (isRateLimitResponse(text)) {
            failures_SEC += 1;
            lastFetch_SEC := Time.now();
            Debug.print("[SEC] RATE-LIMIT: backoff applied. Failures=" # failures_SEC.toText());
            return "{}";
          };
          lastFetch_SEC := Time.now();
          failures_SEC := 0;
          Debug.print("[SEC] OK: response received (" # text.size().toText() # " chars)");
          text;
        };
        case null {
          // UTF-8 decode failure — transient, do NOT apply backoff
          Debug.print("[SEC] WARN: response body could not be decoded as UTF-8 (transient, no backoff)");
          "{}";
        };
      };
    } catch (err) {
      let msg = err.message();
      if (isRateLimitResponse(msg)) {
        // Rate limit — apply backoff
        failures_SEC += 1;
        lastFetch_SEC := Time.now();
        Debug.print("[SEC] RATE-LIMIT (catch): " # msg # " — backoff applied. Failures=" # failures_SEC.toText());
      } else {
        // Transient network error — log only, do NOT apply backoff or update lastFetch
        Debug.print("[SEC] TRANSIENT (catch): " # msg # " — no backoff applied");
      };
      "{}";
    };
  };

  // ─── GlobeNewswire RSS HTTP Outcall ───────────────────────────────────────
  // Tier C — 30-minute polling interval (same cadence as Federal Reserve RSS).
  // Polls two GlobeNewswire industry RSS feeds. No key required.
  // Routes headlines to Fed Policy Sentiment and AI Regulation Risk Sentiment indexes based on keyword presence in item titles.
  public func fetchGlobeNewswire() : async Text {
    // Tier C gate: 30-minute minimum (independent timestamp)
    if (not gateOpen(lastFetch_GlobeNewswire, TIER_C_30MIN_NS, failures_GlobeNewswire)) {
      return "";
    };
    // Cycles circuit breaker — pause Tier C if balance is below safety threshold
    let currentCycles = ExperimentalCycles.balance();
    if (currentCycles <= CYCLES_SAFETY_THRESHOLD) {
      Debug.print("[CircuitBreaker] Balance below threshold — Tier C paused (GlobeNewswire). Balance: " # currentCycles.toText());
      return "";
    };
    // Poll both RSS feed URLs and concatenate their XML responses separated by a delimiter.
    // The frontend parses each <item> block from the combined XML.
    let url1 = "https://www.globenewswire.com/RssFeed/industry/9144";
    let url2 = "https://www.globenewswire.com/RssFeed/industry/9147";

    let request1 : HttpRequestArgs = {
      url = url1;
      max_response_bytes = ?Nat64.fromNat(400_000);
      headers = [
        { name = "User-Agent"; value = "MomentumTerminal/1.0" },
        { name = "Accept"; value = "application/rss+xml, application/xml, text/xml" },
      ];
      body = null;
      method = #get;
      transform = null;
    };
    let request2 : HttpRequestArgs = {
      url = url2;
      max_response_bytes = ?Nat64.fromNat(400_000);
      headers = [
        { name = "User-Agent"; value = "MomentumTerminal/1.0" },
        { name = "Accept"; value = "application/rss+xml, application/xml, text/xml" },
      ];
      body = null;
      method = #get;
      transform = null;
    };

    try {
      let response1 = await (with cycles = 10_000_000_000) ic.http_request(request1);
      let text1 = switch (response1.body.decodeUtf8()) {
        case (?t) {
          if (isRateLimitResponse(t)) {
            failures_GlobeNewswire += 1;
            lastFetch_GlobeNewswire := Time.now();
            Debug.print("[GlobeNewswire] RATE-LIMIT (feed 9144): backoff applied. Failures=" # failures_GlobeNewswire.toText());
            return "";
          };
          t;
        };
        case null {
          Debug.print("[GlobeNewswire] WARN: feed 9144 response could not be decoded as UTF-8 (transient, no backoff)");
          "";
        };
      };

      try {
        let response2 = await (with cycles = 10_000_000_000) ic.http_request(request2);
        let text2 = switch (response2.body.decodeUtf8()) {
          case (?t) {
            if (isRateLimitResponse(t)) {
              failures_GlobeNewswire += 1;
              lastFetch_GlobeNewswire := Time.now();
              Debug.print("[GlobeNewswire] RATE-LIMIT (feed 9147): backoff applied. Failures=" # failures_GlobeNewswire.toText());
              return "";
            };
            t;
          };
          case null {
            Debug.print("[GlobeNewswire] WARN: feed 9147 response could not be decoded as UTF-8 (transient, no backoff)");
            "";
          };
        };

        lastFetch_GlobeNewswire := Time.now();
        failures_GlobeNewswire := 0;
        Debug.print("[GlobeNewswire] OK: both feeds received (" # text1.size().toText() # " + " # text2.size().toText() # " chars)");
        // Combine both feeds — frontend parses all <item> blocks from the joined text
        text1 # "\n<!-- GLOBENEWSWIRE_FEED_SEPARATOR -->\n" # text2;
      } catch (err2) {
        let msg2 = err2.message();
        if (isRateLimitResponse(msg2)) {
          failures_GlobeNewswire += 1;
          lastFetch_GlobeNewswire := Time.now();
          Debug.print("[GlobeNewswire] RATE-LIMIT (catch, feed 9147): " # msg2 # " — backoff applied. Failures=" # failures_GlobeNewswire.toText());
        } else {
          // Transient — still return feed 1 if it succeeded, do not apply backoff
          Debug.print("[GlobeNewswire] TRANSIENT (catch, feed 9147): " # msg2 # " — returning feed 9144 only, no backoff");
          lastFetch_GlobeNewswire := Time.now();
          failures_GlobeNewswire := 0;
        };
        text1;
      };
    } catch (err1) {
      let msg1 = err1.message();
      if (isRateLimitResponse(msg1)) {
        failures_GlobeNewswire += 1;
        lastFetch_GlobeNewswire := Time.now();
        Debug.print("[GlobeNewswire] RATE-LIMIT (catch, feed 9144): " # msg1 # " — backoff applied. Failures=" # failures_GlobeNewswire.toText());
      } else {
        // Transient network error — log only, do NOT apply backoff or update lastFetch
        Debug.print("[GlobeNewswire] TRANSIENT (catch, feed 9144): " # msg1 # " — no backoff applied");
      };
      "";
    };
  };

  // ─── Persisted Processed Headlines (AI-Graded) ────────────────────────────
  // Stores the last MAX_PERSISTED_HEADLINES headlines fully processed by the
  // Oracle pipeline (FinBERT scored, routed, impact calculated).
  // Frontend fetches these on mount so the terminal never starts blank.
  //
  // NOTE: "label" is a reserved keyword in Motoko — field is named sentimentLabel.

  type ProcessedHeadline = {
    text : Text;
    targetIndex : Text;
    impact : Float;
    sentimentLabel : Text;   // renamed from "label" — reserved keyword in Motoko
    confidence : Float;
    sourceTier : Nat;
    timestamp : Int;
  };

  transient let MAX_PERSISTED_HEADLINES : Nat = 50;
  let processedHeadlines : List.List<ProcessedHeadline>;

  /// Persists a fully-scored headline to canister memory.
  /// Called fire-and-forget from OracleTickContext after FinBERT scoring.
  /// No auth restriction.
  public func storeProcessedHeadline(h : ProcessedHeadline) : async () {
    processedHeadlines.add(h);
    if (processedHeadlines.size() > MAX_PERSISTED_HEADLINES) {
      let arr = processedHeadlines.toArray();
      processedHeadlines.clear();
      let start = arr.size() - MAX_PERSISTED_HEADLINES;
      for (i in Nat.range(start, arr.size())) {
        processedHeadlines.add(arr[i]);
      };
    };
  };

  /// Returns all persisted AI-graded headlines, oldest first.
  /// PUBLIC — no auth restriction. Used on frontend mount to hydrate the Oracle Feed.
  public query func getPersistedHeadlines() : async [ProcessedHeadline] {
    processedHeadlines.toArray();
  };

  type UserProfile = {
    name : Text;
    username : Text;
  };

  let userProfiles : Map.Map<Principal, UserProfile>;

  type SentimentAsset = {
    name : Text;
    baseScore : Float;
  };

  type AssetConfig = {
    maxAllocation : Float;
    volatilityBuffer : Float;
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

  type TrendDirection = {
    #up;
    #down;
  };

  type TrendState = {
    direction : TrendDirection;
    remainingDuration : Nat;
    stepSize : Float;
  };

  type AssetPrice = {
    name : Text;
    category : Text;
    baseScore : Float;
    buyPrice : Float;
    redeemPrice : Float;
    maxAllocation : Float;
    volatilityBuffer : Float;
    currentAllocated : Float;
  };

  type Asset = {
    name : Text;
    category : Text;
    baseScore : Float;
    config : AssetConfig;
  };

  type Holding = {
    assetName : Text;
    units : Float;
    yieldStartTime : Int;
    accruedYield : Float;
    allocationTimestamp : Int;
  };

  type NewsEventCategory = {
    #AI;
    #Mexico;
    #Warriors;
    #Washington;
  };

  type NewsEvent = {
    headline : Text;
    sentimentScore : Float;
    category : NewsEventCategory;
    relatedIndex : ?Text;
  };

  type NewsEventInternal = {
    headline : Text;
    sentimentScore : Float;
    category : NewsEventCategory;
    relatedIndex : Text;
    timestamp : Int;
  };

  type UserAllocationState = {
    lastAllocationCycle : ?Nat;
  };

  type AccountStatus = {
    #Active;
    #Suspended;
  };

  transient let MAX_NEWS_EVENTS = 100;

  func createAsset(name : Text, category : Text, baseScore : Float) : Asset {
    {
      name;
      category;
      baseScore;
      config = {
        maxAllocation = 100_000.0;
        volatilityBuffer = 0.10;
      };
    };
  };

  transient let assets = [
    {
      name = "AI Regulation Risk Sentiment";
      category = "TECHNOLOGY";
      baseScore = 75.0;
      config = {
        maxAllocation = 100_000.0;
        volatilityBuffer = 0.10;
      };
    },
    {
      name = "Mexico Index";
      category = "Geopolitical";
      baseScore = 60.0;
      config = {
        maxAllocation = 100_000.0;
        volatilityBuffer = 0.10;
      };
    },
    {
      name = "Golden State Index";
      category = "Sports";
      baseScore = 80.0;
      config = {
        maxAllocation = 100_000.0;
        volatilityBuffer = 0.10;
      };
    },
    {
      name = "Los Angeles L";
      category = "Sports";
      baseScore = 77.0;
      config = {
        maxAllocation = 100_000.0;
        volatilityBuffer = 0.10;
      };
    },
    createAsset("Boston", "Sports", 85.0),
    createAsset("Milwaukee", "Sports", 78.0),
    createAsset("Chicago", "Sports", 82.0),
    createAsset("Los Angeles C", "Sports", 69.0),
    createAsset("New York K", "Sports", 80.0),
    createAsset("New York N", "Sports", 67.0),
    createAsset("Brooklyn", "Sports", 61.0),
    createAsset("Golden State", "Sports", 84.0),
    createAsset("Miami", "Sports", 79.0),
    createAsset("Houston", "Sports", 66.0),
    createAsset("Dallas", "Sports", 74.0),
    createAsset("Denver", "Sports", 83.0),
    createAsset("Phoenix", "Sports", 78.0),
    createAsset("Memphis", "Sports", 70.0),
    createAsset("Atlanta", "Sports", 76.0),
    createAsset("Cleveland", "Sports", 72.0),
    createAsset("Philadelphia", "Sports", 81.0),
    createAsset("Toronto", "Sports", 68.0),
    createAsset("Oklahoma City", "Sports", 75.0),
    createAsset("Portland", "Sports", 63.0),
    createAsset("Sacramento", "Sports", 71.0),
    createAsset("San Antonio", "Sports", 65.0),
    createAsset("Orlando", "Sports", 62.0),
    createAsset("Indiana", "Sports", 67.0),
    createAsset("Charlotte", "Sports", 60.0),
    createAsset("Detroit", "Sports", 55.0),
    createAsset("Utah", "Sports", 64.0),
    createAsset("Minnesota", "Sports", 69.0),
    createAsset("New Orleans", "Sports", 72.0),
    createAsset("Washington Index", "Sports", 77.0),
    createAsset("Fed Policy Sentiment", "MACRO", 50.0),
    createAsset("MENA Stability Sentiment", "GEOPOLITICAL", 48.5),
    createAsset("Traditional Values Sentiment", "CULTURAL", 50.0),
    createAsset("Progressive Values Sentiment", "CULTURAL", 50.0),
    createAsset("Masculinity Discourse Sentiment", "CULTURAL", 50.0),
    createAsset("Feminism Wave Sentiment", "CULTURAL", 50.0),
    createAsset("F1 Constructor Sentiment", "SPORTS", 50.0),
    createAsset("NASCAR Racing Sentiment", "SPORTS", 50.0),
    createAsset("Obesity Drug Sentiment", "HEALTH", 50.0),
    createAsset("Whole Food & Wellness Sentiment", "HEALTH", 50.0),
  ];

  // Mutable record wrapper so the PositionsMixin (which expects
  // `{ var balance : Float }`) can deduct/credit the wallet and have the
  // mutation propagate back to the actor. Records are shared by reference in
  // Motoko, mirroring the crisisState pattern in lib/lmsr-pricing.mo.
  let walletBalance : { var balance : Float };
  var nextTransactionId : Nat;
  let transactions : List.List<Transaction>;
  let newsEvents : List.List<NewsEvent>;
  var lastTickTimestamp : Int;
  var assetTrends : Map.Map<Text, TrendState>;
  // Stable positions map keyed by (Principal, Text) — survives canister upgrades.
  // Replaces the legacy single-key holdings map (Map<Text, Holding>) so positions
  // are isolated per user. Migrated from the old holdings map by migration.mo.
  var positions : Map.Map<PositionTypes.PositionKey, PositionTypes.Position>;

  // Mutable platform-wide allocations map (assetName → total longUnits across
  // all users). Maintained incrementally alongside `positions` so the
  // PositionsMixin — which captures this Map by reference at include time —
  // always reads current q_i values for LMSR spread pricing. Map.add mutates
  // the B-tree in place, so the mixin's captured reference stays valid.
  var allocationsMap : Map.Map<Text, Float>;

  // Per-index cumulative volume — total dollar value of ALL completed
  // transactions (long buys, long sells, short entries, short redemptions).
  // Volume only ever increases; it never decreases on redemption. Map.add
  // mutates the B-tree in place, so the PositionsMixin's captured reference
  // stays valid for the short-domain increments.
  //
  // PERSISTENCE: This is a top-level `var` in the actor, so under
  // --default-persistent-actors (enhanced orthogonal persistence, see
  // canister.yaml / mops.toml [moc].args) it is stable by default — it
  // survives canister UPGRADES without the `stable` keyword. It does NOT
  // survive a draft REDEPLOY (reinstall), which wipes all canister state by
  // design; after a redeploy, volumeByIndex restarts empty and is re-seeded
  // by the postupgrade backfill from the (also-wiped) transactions list, so
  // it stays at $0 until new transactions increment it.
  var volumeByIndex : Map.Map<Text, Float>;

  // Idempotency guard for the one-time volume backfill. Set to true after
  // backfillVolume() has run once so subsequent calls (or postupgrade hooks)
  // do NOT double-count historical transactions into volumeByIndex.
  //
  // PERSISTENCE: same as volumeByIndex — a top-level actor `var` is stable
  // by default under enhanced orthogonal persistence, so it survives upgrades
  // (no `stable` keyword needed). It resets to false only on a draft redeploy
  // (reinstall), which is the intended clean-slate behavior.
  var volumeBackfilled : Bool;

  // ─── OQL Data Intelligence ───────────────────────────────────────────────
  // Exposes persisted queryable collections to the Caffeine Data Intelligence
  // agent via the `Expose` mixin. Placed AFTER the `positions` and
  // `allocationsMap` declarations so both are in scope.
  //
  // Entities:
  //   - subsidyReserve: per-index cumulative spread revenue. The Map key
  //     (assetName) carries the row identity, so manual mode iterates
  //     `.entries()` and promotes the key to a payload column. Authorization
  //     is `.public_()` to match the existing public getters.
  //   - position: per-user-asset position keyed by (Principal, Text). Manual
  //     mode iterates `positions.entries()` and promotes key.0 (principal →
  //     "user" column) and key.1 (assetName) plus every Position field.
  //     Authorization is `.controllerOrScoped()` with the principal as owner
  //     so each signed-in user reads only their own rows while the controller
  //     (Data Intelligence agent) reads all.
  include Expose({
    entities = [
      OQL.Entity.manual<(Text, Float)>(
        "subsidyReserve",
        func() = subsidyReserves.entries(),
        "SubsidyReserve",
        "assetName",
      )
        .payload("assetName", func((name, _)) = name)
        .payload("reserve", func((_, reserve)) = reserve)
        .public_()
        .build(),
      OQL.Entity.manual<(PositionTypes.PositionKey, PositionTypes.Position)>(
        "position",
        func() = positions.entries(),
        "Position",
        "assetName",
      )
        .payload("user", func((key, _)) = key.0.toText())
        .payload("assetName", func((key, _)) = key.1)
        .payload("longUnits", func((_, pos)) = pos.longUnits)
        .payload("longEntryScore", func((_, pos)) = pos.longEntryScore)
        .payload("shortUnits", func((_, pos)) = pos.shortUnits)
        .payload("shortEntryScore", func((_, pos)) = pos.shortEntryScore)
        .payload("openedAt", func((_, pos)) = pos.openedAt)
        .ownedByWith(
          "user",
          func(caller, owner) = owner == #text(caller.toText()),
        )
        .controllerOrScoped()
        .build(),
    ];
  });

  let userAllocationStates : Map.Map<Principal, UserAllocationState>;
  let sentimentScores : Map.Map<Text, Float>;
  let userStatuses : Map.Map<Text, AccountStatus>;

  func addNewsEvent(event : NewsEvent) {
    newsEvents.add(event);
    if (newsEvents.size() > MAX_NEWS_EVENTS) {
      let eventsArray = newsEvents.toArray();
      newsEvents.clear();
      for (i in Nat.range(1, MAX_NEWS_EVENTS)) {
        if (i < eventsArray.size()) {
          newsEvents.add(eventsArray[i]);
        };
      };
    };
  };

  // Returns the platform-wide index allocations as a Map<Text, Float> keyed
  // by asset name → total long units held. This is the input to the LMSR cost
  // function: q_i for every outcome i. Reads the long leg from the per-user
  // positions map and sums longUnits per assetName across all users.
  func getAllocationsMap() : Map.Map<Text, Float> {
    let m = Map.empty<Text, Float>();
    for ((key, position) in positions.entries()) {
      let assetName = key.1;
      let current = switch (m.get(assetName)) {
        case (?v) { v };
        case null { 0.0 };
      };
      m.add(assetName, current + position.longUnits);
    };
    m;
  };

  // Flattens the tick history ring buffer into the [(Text, Float)] score
  // snapshot the PositionsMixin expects. Takes the latest tick's scores array
  // (the most recent committed per-asset scores), which is the price a new
  // allocation is struck against. Returns [] when no tick has been recorded.
  // Reads tickHistoryState.ticks at call time so the mixin always receives a
  // fresh snapshot rather than the empty array captured at include time.
  func flattenTickScores() : [(Text, Float)] {
    let ticks = tickHistoryState.ticks;
    let total = ticks.size();
    if (total == 0) { return [] };
    ticks[total - 1].scores;
  };

  // Resolves the effective spread for an asset. Honours the crisis override
  // (1.0 for a 10-minute window when |clampedScore| > 3.0) before falling
  // back to the dynamic LMSR spread computed from platform-wide allocations.
  // Auto-resets dynamicSpreadActive once the expiry window has passed.
  func getSpreadForAsset(assetName : Text) : Float {
    // Sync actor state into the mutable wrapper so the lib's auto-reset
    // propagates back.
    crisisState.dynamicSpreadActive := dynamicSpreadActive;
    crisisState.dynamicSpreadExpiry := dynamicSpreadExpiry;
    let spread = LMSR.getSpreadForAsset(
      getAllocationsMap(),
      assetName,
      crisisState,
      Time.now(),
      null,
      null,
      null,
    );
    // Persist any auto-reset the lib performed back to the actor vars.
    dynamicSpreadActive := crisisState.dynamicSpreadActive;
    dynamicSpreadExpiry := crisisState.dynamicSpreadExpiry;
    spread;
  };

  // PositionsMixin — exposes allocateShort / redeemShort / getUserShortPosition
  // / getUserFullPosition / getCircuitBreakerStatus / getShortPositionCap.
  // tickHistory is passed as a flattened [(Text, Float)] snapshot of the latest
  // tick's scores (flattenTickScores reads tickHistoryState.ticks at call time,
  // so the snapshot reflects the most recent committed scores at include time).
  // allocationsMap is captured by reference; Map.add mutates the B-tree in
  // place, so the mixin always reads current q_i values for LMSR spread pricing.
  // currentTime is fixed at include time — the mixin uses it as the position
  // openedAt default and the spread-pricing timestamp.
  include PositionsMixin(
    positions,
    flattenTickScores(),
    allocationsMap,
    subsidyReserves,
    walletBalance,
    MAX_SHORT_POSITION_VALUE,
    crisisState,
    Time.now(),
    volumeByIndex,
  );

  public query ({ caller }) func getCallerUserProfile() : async ?UserProfile {
    if (not (AccessControl.hasPermission(accessControlState, caller, #user))) {
      Runtime.trap("Unauthorized: Only users can get profiles");
    };
    userProfiles.get(caller);
  };

  public query ({ caller }) func getUserProfile(user : Principal) : async ?UserProfile {
    if (caller != user and not AccessControl.isAdmin(accessControlState, caller)) {
      Runtime.trap("Unauthorized: Can only view your own profile");
    };
    userProfiles.get(user);
  };

  public shared ({ caller }) func saveCallerUserProfile(profile : UserProfile) : async () {
    if (not (AccessControl.hasPermission(accessControlState, caller, #user))) {
      Runtime.trap("Unauthorized: Only users can save profiles");
    };
    userProfiles.add(caller, profile);
  };

  public query ({ caller }) func getWalletBalance() : async Float {
    if (not (AccessControl.hasPermission(accessControlState, caller, #user))) {
      Runtime.trap("Unauthorized: Only users can view wallet balance");
    };
    walletBalance.balance;
  };

  // Returns the caller's long leg on `assetName` projected back into the
  // legacy Holding shape so the frontend contract is unchanged. Reads from
  // the per-user-asset positions map (keyed by (caller, assetName)).
  public query ({ caller }) func getHoldings(assetName : Text) : async ?Holding {
    if (not (AccessControl.hasPermission(accessControlState, caller, #user))) {
      Runtime.trap("Unauthorized: Only users can view holdings");
    };
    let key = (caller, assetName);
    switch (positions.get(key)) {
      case (?pos) {
        ?{
          assetName;
          units = pos.longUnits;
          yieldStartTime = pos.openedAt;
          accruedYield = 0.0;
          allocationTimestamp = pos.openedAt;
        };
      };
      case null { null };
    };
  };

  // Returns every (assetName, Holding) pair for the calling principal,
  // projected from the per-user-asset positions map's long leg.
  public query ({ caller }) func getAllHoldings() : async [(Text, Holding)] {
    if (not (AccessControl.hasPermission(accessControlState, caller, #user))) {
      Runtime.trap("Unauthorized: Only users can view holdings");
    };
    let result = List.empty<(Text, Holding)>();
    for ((key, pos) in positions.entries()) {
      let (user, assetName) = key;
      if (user == caller and pos.longUnits > 0.0) {
        result.add(
          (
            assetName,
            {
              assetName;
              units = pos.longUnits;
              yieldStartTime = pos.openedAt;
              accruedYield = 0.0;
              allocationTimestamp = pos.openedAt;
            },
          ),
        );
      };
    };
    result.toArray();
  };

  // Returns the sum of longUnits per index across all users (platform-wide
  // aggregate). Reads the long leg from the per-user-asset positions map.
  public query func getTotalAllocatedByIndex() : async [(Text, Float)] {
    let m = Map.empty<Text, Float>();
    for ((key, position) in positions.entries()) {
      let assetName = key.1;
      let current = switch (m.get(assetName)) {
        case (?v) { v };
        case null { 0.0 };
      };
      m.add(assetName, current + position.longUnits);
    };
    m.toArray();
  };

  // Returns the cumulative dollar volume per index across all completed
  // transactions (long buys + long sells + short entries + short redemptions).
  // Volume only ever increases — it never decreases on redemption. Mirrors the
  // pattern of getTotalAllocatedByIndex but reads the dedicated volumeByIndex
  // map maintained incrementally in allocateFunds / redeemFunds /
  // allocateShort / redeemShort.
  public query func getTotalVolumeByIndex() : async [(Text, Float)] {
    volumeByIndex.toArray();
  };

  // One-time backfill that seeds volumeByIndex from the canister's persisted
  // transaction history. The volumeByIndex counter was added after the canister
  // had already processed transactions, so positions opened before the counter
  // existed are uncounted and display $0. This backfill iterates every
  // transaction in `transactions`, sums the dollar value of the 5 trading
  // types (buy, sell, shortAllocate, redeemAll, shortRedeem) grouped by index
  // name (assetInvolved if present, else assetName), and Map.add's each sum
  // into volumeByIndex so the B-tree mutates in place.
  //
  // IDEMPOTENT: guarded by `volumeBackfilled`. Running more than once (manually
  // or via repeated postupgrade hooks) does NOT double-count — the second and
  // later calls return immediately. The flag is a top-level actor `var`, so
  // under enhanced orthogonal persistence (--default-persistent-actors) it is
  // stable by default and survives upgrades without the `stable` keyword. It
  // only resets to false on a draft redeploy (reinstall).
  //
  // MONOTONIC: the backfill only ever ADDS to volumeByIndex. It never
  // decrements or resets an existing entry. Future transactions continue to
  // increment on top of the backfilled baseline via the existing increment
  // logic in allocateFunds / redeemFunds / redeemAll / allocateShort /
  // redeemShort (which is unchanged).
  public func backfillVolume() : async () {
    if (volumeBackfilled) { return };
    // Per-index accumulator for this backfill pass.
    let sums = Map.empty<Text, Float>();
    for (tx in transactions.values()) {
      // Only the 5 trading types count toward volume. deposit and withdrawal
      // are cash movements, not index trades, and are excluded.
      let isTradingType = switch (tx.transactionType) {
        case (#buy) true;
        case (#sell) true;
        case (#shortAllocate) true;
        case (#redeemAll) true;
        case (#shortRedeem) true;
        case (#deposit) false;
        case (#withdrawal) false;
      };
      if (not isTradingType) { continue };
      // Resolve the index name: prefer assetInvolved, fall back to assetName.
      let indexName = switch (tx.assetInvolved) {
        case (?name) name;
        case null {
          switch (tx.assetName) {
            case (?name) name;
            case null { continue };
          };
        };
      };
      // Resolve the dollar value: prefer dollarAmount, fall back to amount.
      let dollarValue = switch (tx.dollarAmount) {
        case (?v) v;
        case null tx.amount;
      };
      let prev = switch (sums.get(indexName)) {
        case (?v) v;
        case null 0.0;
      };
      sums.add(indexName, prev + dollarValue);
    };
    // Fold the per-index sums into volumeByIndex. Map.add mutates the B-tree
    // in place, so the PositionsMixin's captured reference stays valid.
    for ((indexName, sum) in sums.entries()) {
      let prevVolume = switch (volumeByIndex.get(indexName)) {
        case (?v) v;
        case null 0.0;
      };
      volumeByIndex.add(indexName, prevVolume + sum);
    };
    volumeBackfilled := true;
    Debug.print("[backfillVolume] completed — seeded volumeByIndex from transaction history");
  };

  public query func getAssetPrices() : async [AssetPrice] {
    assets.map(
      func(asset) {
        // Sum longUnits across all users for this asset (platform-wide).
        var longUnits : Float = 0.0;
        for ((key, position) in positions.entries()) {
          if (key.1 == asset.name) {
            longUnits += position.longUnits;
          };
        };
        // Long mark-to-market correction: displayed position value uses
        // longUnits × baseScore (not the spread-adjusted exit price).
        // The spread-adjusted buyPrice/redeemPrice are still returned for
        // redemption execution purposes.
        let currentAllocated = longUnits * asset.baseScore;

        {
          name = asset.name;
          category = asset.category;
          baseScore = asset.baseScore;
          buyPrice = asset.baseScore + getSpreadForAsset(asset.name);
          redeemPrice = asset.baseScore - getSpreadForAsset(asset.name);
          maxAllocation = asset.config.maxAllocation;
          volatilityBuffer = asset.config.volatilityBuffer;
          currentAllocated;
        };
      }
    );
  };

  func calculateAdjustedMaxAllocation(asset : Asset) : Float {
    asset.config.maxAllocation * (1.0 - asset.config.volatilityBuffer);
  };

  func getTotalAllocated(assetName : Text) : Float {
    // Sum longUnits across all users for this asset (platform-wide aggregate).
    var total : Float = 0.0;
    for ((key, position) in positions.entries()) {
      if (key.1 == assetName) {
        total += position.longUnits;
      };
    };
    total;
  };

  public shared ({ caller }) func depositFunds(amount : Float) : async () {
    if (not (AccessControl.hasPermission(accessControlState, caller, #user))) {
      Runtime.trap("Unauthorized: Only users can deposit funds");
    };
    walletBalance.balance += amount;
    let newTransaction : Transaction = {
      id = nextTransactionId;
      timestamp = Time.now();
      amount;
      assetName = null;
      units = null;
      transactionType = #deposit;
      username = "admin";
      dollarAmount = ?amount;
      assetInvolved = null;
    };
    transactions.add(newTransaction);
    nextTransactionId += 1;
  };

  public shared ({ caller }) func withdrawFunds(amount : Float) : async Bool {
    if (not (AccessControl.hasPermission(accessControlState, caller, #user))) {
      Runtime.trap("Unauthorized: Only users can withdraw funds");
    };
    if (walletBalance.balance < amount) {
      return false;
    };
    walletBalance.balance -= amount;
    let newTransaction : Transaction = {
      id = nextTransactionId;
      timestamp = Time.now();
      amount;
      assetName = null;
      units = null;
      transactionType = #withdrawal;
      username = "admin";
      dollarAmount = ?amount;
      assetInvolved = null;
    };
    transactions.add(newTransaction);
    nextTransactionId += 1;
    true;
  };

  public shared ({ caller }) func allocateFunds(assetName : Text, allocationAmount : Float) : async Bool {
    if (not (AccessControl.hasPermission(accessControlState, caller, #user))) {
      Runtime.trap("Unauthorized: Only users can allocate funds");
    };
    if (isTradingPaused) {
      Runtime.trap("Trading is currently paused");
    };

    if (walletBalance.balance < allocationAmount) {
      return false;
    };

    let assetOpt = assets.find(func(a) { a.name == assetName });
    let asset = switch (assetOpt) {
      case (null) { return false };
      case (?a) { a };
    };

    let adjustedMax = calculateAdjustedMaxAllocation(asset);
    let currentTotal = getTotalAllocated(assetName);

    let buyPrice = asset.baseScore + getSpreadForAsset(assetName);
    let unitsToBuy = allocationAmount / buyPrice;
    let newTotal = currentTotal + unitsToBuy;

    if (newTotal > adjustedMax) {
      return false;
    };

    walletBalance.balance -= allocationAmount;

    // Credit the spread revenue into the per-index subsidy reserve.
    LMSR.creditSubsidyReserve(
      subsidyReserves,
      assetName,
      unitsToBuy,
      buyPrice - asset.baseScore,
    );

    let currentTime = Time.now();

    // Read the caller's existing position on this asset (if any) and update
    // the long leg with a weighted-average entry score.
    let key = (caller, assetName);
    let existing = switch (positions.get(key)) {
      case (null) {
        {
          longUnits = 0.0;
          longEntryScore = 0.0;
          shortUnits = 0.0;
          shortEntryScore = 0.0;
          openedAt = currentTime;
        };
      };
      case (?pos) { pos };
    };

    let newLongEntryScore = PositionsLib.weightedEntryScore(
      existing.longUnits,
      existing.longEntryScore,
      unitsToBuy,
      asset.baseScore,
    );

    let updatedPosition = {
      existing with
      longUnits = existing.longUnits + unitsToBuy;
      longEntryScore = newLongEntryScore;
    };
    positions.add(key, updatedPosition);

    // Keep the platform-wide allocations map in sync for LMSR spread pricing.
    let prevAlloc = switch (allocationsMap.get(assetName)) {
      case (?v) { v };
      case null { 0.0 };
    };
    allocationsMap.add(assetName, prevAlloc + unitsToBuy);

    // Volume only ever increases — accumulate the dollar value of this buy.
    let prevVolume = switch (volumeByIndex.get(assetName)) {
      case (?v) { v };
      case null { 0.0 };
    };
    volumeByIndex.add(assetName, prevVolume + allocationAmount);

    let newTransaction : Transaction = {
      id = nextTransactionId;
      timestamp = currentTime;
      amount = allocationAmount;
      assetName = ?assetName;
      units = ?unitsToBuy;
      transactionType = #buy;
      username = "admin";
      dollarAmount = ?allocationAmount;
      assetInvolved = ?assetName;
    };
    transactions.add(newTransaction);
    nextTransactionId += 1;

    let allocationState : UserAllocationState = {
      lastAllocationCycle = ?currentCycleIndex;
    };
    userAllocationStates.add(caller, allocationState);

    true;
  };

  public shared ({ caller }) func redeemFunds(assetName : Text, unitsToSell : Float) : async Bool {
    if (not (AccessControl.hasPermission(accessControlState, caller, #user))) {
      Runtime.trap("Unauthorized: Only users can redeem funds");
    };
    if (isTradingPaused) {
      Runtime.trap("Trading is currently paused");
    };

    let allocationState = userAllocationStates.get(caller);
    switch (allocationState) {
      case (null) {};
      case (?state) {
        switch (state.lastAllocationCycle) {
          case (null) {};
          case (?cycle) {
            if (cycle == currentCycleIndex) {
              return false;
            };
          };
        };
      };
    };

    // Read the caller's long position on this asset from the per-user-asset
    // positions map (keyed by (caller, assetName)).
    let key = (caller, assetName);
    let existing = switch (positions.get(key)) {
      case (null) { return false };
      case (?pos) { pos };
    };

    if (existing.longUnits < unitsToSell) {
      return false;
    };

    let assetOpt = assets.find(func(a) { a.name == assetName });
    let asset = switch (assetOpt) {
      case (null) { return false };
      case (?a) { a };
    };
    // Redemption uses the spread-adjusted exit price (baseScore − spread)
    // since this is an actual redemption execution, not a display value.
    let redeemPrice = Float.max(0.01, asset.baseScore - getSpreadForAsset(assetName));
    let amountToRedeem = unitsToSell * redeemPrice;
    walletBalance.balance += amountToRedeem;

    // Credit the spread revenue into the per-index subsidy reserve.
    LMSR.creditSubsidyReserve(
      subsidyReserves,
      assetName,
      unitsToSell,
      asset.baseScore - redeemPrice,
    );

    let currentTime = Time.now();

    // Update the long leg: decrement longUnits; reset longEntryScore to
    // 0.0 when the long leg is fully closed.
    let remainingLongUnits = existing.longUnits - unitsToSell;
    let updatedPosition = {
      existing with
      longUnits = remainingLongUnits;
      longEntryScore = if (remainingLongUnits == 0.0) { 0.0 } else { existing.longEntryScore };
    };
    positions.add(key, updatedPosition);

    // Keep the platform-wide allocations map in sync for LMSR spread pricing.
    let prevAlloc = switch (allocationsMap.get(assetName)) {
      case (?v) { v };
      case null { 0.0 };
    };
    allocationsMap.add(assetName, Float.max(0.0, prevAlloc - unitsToSell));

    // Volume only ever increases — accumulate the dollar value of this sell,
    // even though the position (capacity) decreases.
    let prevVolume = switch (volumeByIndex.get(assetName)) {
      case (?v) { v };
      case null { 0.0 };
    };
    volumeByIndex.add(assetName, prevVolume + amountToRedeem);

    let newTransaction : Transaction = {
      id = nextTransactionId;
      timestamp = Time.now();
      amount = amountToRedeem;
      assetName = ?assetName;
      units = ?unitsToSell;
      transactionType = #sell;
      username = "admin";
      dollarAmount = ?amountToRedeem;
      assetInvolved = ?assetName;
    };
    transactions.add(newTransaction);
    nextTransactionId += 1;
    true;
  };

  public shared ({ caller }) func redeemAll(assetName : Text) : async Bool {
    if (not (AccessControl.hasPermission(accessControlState, caller, #user))) {
      Runtime.trap("Unauthorized: Only users can redeem funds");
    };
    if (isTradingPaused) {
      Runtime.trap("Trading is currently paused");
    };

    let allocationState = userAllocationStates.get(caller);
    switch (allocationState) {
      case (null) {};
      case (?state) {
        switch (state.lastAllocationCycle) {
          case (null) {};
          case (?cycle) {
            if (cycle == currentCycleIndex) {
              return false;
            };
          };
        };
      };
    };

    // Read the caller's long position on this asset from the per-user-asset
    // positions map (keyed by (caller, assetName)).
    let key = (caller, assetName);
    let existing = switch (positions.get(key)) {
      case (null) { return false };
      case (?pos) { pos };
    };

    if (existing.longUnits == 0.0) {
      return false;
    };

    let assetOpt = assets.find(func(a) { a.name == assetName });
    let asset = switch (assetOpt) {
      case (null) { return false };
      case (?a) { a };
    };
    // Redemption uses the spread-adjusted exit price (baseScore − spread)
    // since this is an actual redemption execution.
    let redeemPrice = asset.baseScore - getSpreadForAsset(assetName);
    let totalValue = existing.longUnits * redeemPrice;
    let fee = totalValue * REDEMPTION_FEE_RATE;
    let netValue = totalValue - fee;

    walletBalance.balance += netValue;

    // Credit the spread revenue into the per-index subsidy reserve.
    LMSR.creditSubsidyReserve(
      subsidyReserves,
      assetName,
      existing.longUnits,
      asset.baseScore - redeemPrice,
    );

    let currentTime = Time.now();

    // Reset the long leg to 0.0 (longEntryScore reset to 0.0 on full close).
    let updatedPosition = {
      existing with
      longUnits = 0.0;
      longEntryScore = 0.0;
    };
    positions.add(key, updatedPosition);

    // Keep the platform-wide allocations map in sync for LMSR spread pricing.
    let prevAlloc = switch (allocationsMap.get(assetName)) {
      case (?v) { v };
      case null { 0.0 };
    };
    allocationsMap.add(assetName, Float.max(0.0, prevAlloc - existing.longUnits));

    // Volume only ever increases — accumulate the dollar value of this
    // redemption, even though the position (capacity) resets to 0.
    let prevVolume = switch (volumeByIndex.get(assetName)) {
      case (?v) { v };
      case null { 0.0 };
    };
    volumeByIndex.add(assetName, prevVolume + netValue);

    let newTransaction : Transaction = {
      id = nextTransactionId;
      timestamp = Time.now();
      amount = netValue;
      assetName = ?assetName;
      units = ?existing.longUnits;
      transactionType = #redeemAll;
      username = "admin";
      dollarAmount = ?netValue;
      assetInvolved = ?assetName;
    };
    transactions.add(newTransaction);
    nextTransactionId += 1;
    true;
  };

  public query ({ caller }) func getTransactionHistory() : async [Transaction] {
    if (not (AccessControl.hasPermission(accessControlState, caller, #user))) {
      Runtime.trap("Unauthorized: Only users can view transaction history");
    };
    transactions.toArray();
  };

  func generateRandomTrendState() : TrendState {
    let direction = if (Time.now() % 2 == 0) { #up } else { #down };
    let stepSize = if (direction == #up) { 0.5 } else { -0.5 };
    {
      direction;
      remainingDuration = 5;
      stepSize;
    };
  };

  func updateTrendState(trend : TrendState) : TrendState {
    let updatedState = {
      trend with remainingDuration = if (trend.remainingDuration > 0) trend.remainingDuration - 1 else 0;
    };

    if (updatedState.remainingDuration <= 0) {
      generateRandomTrendState();
    } else {
      updatedState;
    };
  };

  transient let PARTICIPATION_YIELD_RATE_HOURLY : Float = 0.00068;

  func yieldMultiplier(allocationTimestamp : Int, currentTime : Int) : Float {
    let ageNs : Int = currentTime - allocationTimestamp;
    let ageHours : Float = ageNs.toFloat() / (1_000_000_000.0 * 3600.0);
    if (ageHours < 72.0) {
      1.0;
    } else if (ageHours < 168.0) {
      1.2;
    } else {
      1.5;
    };
  };

  func processParticipationYield() {
    let currentTime = Time.now();
    // Iterate the per-user-asset positions map and accrue participation yield
    // on the long leg. The Position record has no accruedYield field, so the
    // yield is computed from longUnits and openedAt; the positions map is
    // rewritten with the refreshed openedAt so the next cycle accrues from
    // the updated timestamp.
    for ((key, position) in positions.entries()) {
      if (position.longUnits > 0.0) {
        let hoursElapsed = (currentTime - position.openedAt).toFloat() / (1_000_000_000.0 * 3600.0);
        let multiplier = yieldMultiplier(position.openedAt, currentTime);
        let yieldAmount = position.longUnits * PARTICIPATION_YIELD_RATE_HOURLY * hoursElapsed * multiplier;
        ignore yieldAmount;
        // Refresh openedAt so the next accrual window starts from now.
        let updatedPosition = {
          position with
          openedAt = currentTime;
        };
        positions.add(key, updatedPosition);
      };
    };
  };

  transient let AI_BASELINE = 75.0;
  transient let MEXICO_BASELINE = 60.0;
  transient let WARRIORS_BASELINE = 80.0;
  transient let WASHINGTON_BASELINE = 77.0;

  func isHotHeadLine(headline : Text, _score : Float) : Bool {
    headline.contains(#text "Breaking") or headline.contains(#text "Urgent");
  };

  func applyNewsEventInternal(event : NewsEvent) {
    let clampedScore = Float.min(5.0, Float.max(-5.0, event.sentimentScore));

    let isHot = isHotHeadLine(event.headline, clampedScore);

    addNewsEvent({
      event with
      sentimentScore = clampedScore;
      relatedIndex = event.relatedIndex;
    });

    if (Float.abs(clampedScore) > 3.0) {
      dynamicSpreadActive := true;
      dynamicSpreadExpiry := Time.now() + 600_000_000_000;
    };

    spreadActive := isHot;

    switch (event.category) {
      case (#AI) {
        let aiAsset = assets[0];
        let newScore = clampScore(aiAsset.baseScore + clampedScore);
        ignore newScore;
      };
      case (#Mexico) {
        let mexicoAsset = assets[1];
        let newScore = clampScore(mexicoAsset.baseScore + clampedScore);
        ignore newScore;
      };
      case (#Warriors) {
        let warriorsAsset = assets[2];
        let newScore = clampScore(warriorsAsset.baseScore + clampedScore);
        ignore newScore;
      };
      case (#Washington) {
        let washingtonAsset = assets[31];
        let newScore = clampScore(washingtonAsset.baseScore + clampedScore);
        ignore newScore;
      };
    };
  };

  func clampScore(score : Float) : Float {
    let minScore = 0.0;
    let maxScore = 100.0;
    Float.min(maxScore, Float.max(minScore, score));
  };

  func decayScore(currentScore : Float, baseline : Float) : Float {
    currentScore + 0.10 * (baseline - currentScore);
  };

  transient let TICK_INTERVAL_NS : Int = 60_000_000_000;

  public shared ({ caller }) func updateData() : async () {
    if (not (AccessControl.hasPermission(accessControlState, caller, #admin))) {
      Runtime.trap("Unauthorized: Only admins can trigger data updates");
    };

    let currentTime = Time.now();
    if (currentTime - lastTickTimestamp < TICK_INTERVAL_NS) { return };
    lastTickTimestamp := currentTime;

    currentCycleIndex += 1;

    for (asset in assets.values()) {
      let currentTrend = switch (assetTrends.get(asset.name)) {
        case (null) { generateRandomTrendState() };
        case (?trend) { trend };
      };

      let updatedTrend = updateTrendState(currentTrend);
      assetTrends.add(asset.name, updatedTrend);
    };

    processParticipationYield();

    let mutableAssets = assets.toVarArray<Asset>();
    mutableAssets[0] := { mutableAssets[0] with baseScore = decayScore(mutableAssets[0].baseScore, AI_BASELINE) };
    mutableAssets[1] := { mutableAssets[1] with baseScore = decayScore(mutableAssets[1].baseScore, MEXICO_BASELINE) };
    mutableAssets[2] := { mutableAssets[2] with baseScore = decayScore(mutableAssets[2].baseScore, WARRIORS_BASELINE) };
    mutableAssets[31] := { mutableAssets[31] with baseScore = decayScore(mutableAssets[31].baseScore, WASHINGTON_BASELINE) };
    ignore mutableAssets.toArray();
    spreadActive := false;
  };

  public query func getNextRefreshTimeNs() : async Int {
    lastTickTimestamp + TICK_INTERVAL_NS;
  };

  public query func getCurrentTrends() : async [(Text, TrendState)] {
    assetTrends.toArray();
  };

  public shared ({ caller }) func applyNewsEvent(event : NewsEvent) : async () {
    if (not (AccessControl.hasPermission(accessControlState, caller, #admin))) {
      Runtime.trap("Unauthorized: Only admins can apply news events");
    };
    applyNewsEventInternal(event);
  };

  // ADMIN ENDPOINTS
  public query ({ caller }) func getTotalUsers() : async Nat {
    if (not (AccessControl.hasPermission(accessControlState, caller, #admin))) {
      Runtime.trap("Unauthorized: Only admins can get user count");
    };
    userProfiles.size();
  };

  public query ({ caller }) func getTotalPlatformTVL() : async Float {
    if (not (AccessControl.hasPermission(accessControlState, caller, #admin))) {
      Runtime.trap("Unauthorized: Only admins can get total platform TVL");
    };
    walletBalance.balance;
  };

  public query ({ caller }) func getOracleStatus() : async Text {
    if (not (AccessControl.hasPermission(accessControlState, caller, #admin))) {
      Runtime.trap("Unauthorized: Only admins can check oracle status");
    };
    "ONLINE";
  };

  public query ({ caller }) func getRecentTransactions(limit : Nat) : async [Transaction] {
    if (not (AccessControl.hasPermission(accessControlState, caller, #admin))) {
      Runtime.trap("Unauthorized: Only admins can get recent transactions");
    };
    let allTransactions = transactions.toArray();
    let startIdx = if (allTransactions.size() > limit) { allTransactions.size() - limit } else {
      0;
    };
    Array.tabulate(
      Nat.min(limit, allTransactions.size()),
      func(i) {
        let index = startIdx + i;
        if (index < allTransactions.size()) {
          allTransactions[index];
        } else {
          allTransactions[allTransactions.size() - 1];
        };
      },
    );
  };

  public query ({ caller }) func getSentimentScores() : async [(Text, Float)] {
    if (not (AccessControl.hasPermission(accessControlState, caller, #admin))) {
      Runtime.trap("Unauthorized: Only admins can view sentiment scores");
    };
    sentimentScores.toArray();
  };

  public query ({ caller }) func getLatestHeadlines(limit : Nat) : async [NewsEvent] {
    if (not (AccessControl.hasPermission(accessControlState, caller, #admin))) {
      Runtime.trap("Unauthorized: Only admins can view headlines");
    };
    let headlines = newsEvents.toArray();
    let count = Nat.min(limit, headlines.size());
    Array.tabulate(
      count,
      func(i) {
        if (i < headlines.size()) { headlines[i] } else { headlines[headlines.size() - 1] };
      },
    );
  };

  public query ({ caller }) func getAllUsers() : async [(Text, Float, Float, Float, AccountStatus)] {
    if (not (AccessControl.hasPermission(accessControlState, caller, #admin))) {
      Runtime.trap("Unauthorized: Only admins can view user profiles");
    };
    let userArray = userProfiles.toArray();
    let result = userArray.map(
      func((principal, profile)) {
        // Sum this user's longUnits across all their positions (per-user
        // isolation via the (Principal, Text) key).
        var unitsOwned : Float = 0.0;
        for ((key, position) in positions.entries()) {
          if (key.0 == principal) {
            unitsOwned += position.longUnits;
          };
        };
        let status = switch (userStatuses.get(profile.username)) {
          case (null) { #Active };
          case (?s) { s };
        };
        (profile.name, walletBalance.balance, 0.0, unitsOwned, status);
      }
    );
    result;
  };

  public shared ({ caller }) func setUserStatus(username : Text, status : AccountStatus) : async () {
    if (not (AccessControl.hasPermission(accessControlState, caller, #admin))) {
      Runtime.trap("Unauthorized: Only admins can set user status");
    };
    userStatuses.add(username, status);
  };

  public shared ({ caller }) func toggleTradingPaused() : async () {
    if (not (AccessControl.isAdmin(accessControlState, caller))) {
      Runtime.trap("Only an admin can pause or resume trading");
    };
    isTradingPaused := not isTradingPaused;
  };

  public query ({ caller }) func getIsTradingPaused() : async Bool {
    isTradingPaused;
  };

  // 250025002500 Memory Wipe on Upgrade 25002500250025002500250025002500250025002500250025002500250025002500250025002500250025002500250025002500250025002500250025002500250025002500250025002500250025002500250025002500250025002500250025002500250025002500250025002500250025002500
  // Clears the persisted headlines list on every canister upgrade so stable
  // memory starts clean and is never polluted by mock data from previous runs.
  system func postupgrade() {
    processedHeadlines.clear();
    // Reset all per-subreddit rate-gate timestamps to 0 so every subreddit is
    // immediately eligible for a fresh fetch after redeployment.
    for (sub in REDDIT_SUBREDDITS.values()) {
      lastFetch_RedditMap.add(sub, 0);
      failures_RedditMap.add(sub, 0);
    };
    // Also reset legacy scalar vars for compat
    lastFetch_Reddit := 0;
    failures_Reddit := 0;
    Debug.print("[postupgrade] Reddit rate-gate timestamps reset — all subreddits eligible for immediate fetch");
    // One-time volume backfill — seeds volumeByIndex from the persisted
    // transaction history so pre-existing positions are counted. Idempotent:
    // the volumeBackfilled guard inside backfillVolume() prevents
    // double-counting across repeated upgrades.
    //
    // postupgrade() is a synchronous system hook and cannot await an async
    // function directly (send capability required). Schedule the async
    // backfillVolume() on a one-shot 0-delay timer so it runs on the next
    // message round-trip, after postupgrade returns.
    ignore Timer.setTimer<system>(#seconds 0, func() : async () {
      ignore backfillVolume();
    });
  };

  public shared ({ caller }) func adjustUserBalance(_userId : Text, amount : Float) : async () {
    if (not (AccessControl.isAdmin(accessControlState, caller))) {
      Runtime.trap("Only an admin can adjust user balances");
    };
    walletBalance.balance += amount;
  };

  // ─── YouTube Data API HTTP Outcall ────────────────────────────────────────
  public func fetchYouTubeData() : async Text {
    // Tier C gate: 15-minute minimum
    if (not gateOpen(lastFetch_YouTube, TIER_C_INTERVAL_NS, failures_YouTube)) {
      return "{}";
    };
    // Cycles circuit breaker — pause Tier C if balance is below safety threshold
    let currentCycles = ExperimentalCycles.balance();
    if (currentCycles <= CYCLES_SAFETY_THRESHOLD) {
      Debug.print("[CircuitBreaker] Balance below threshold — Tier C paused. Balance: " # currentCycles.toText());
      return "{}";
    };
    let url = "https://www.googleapis.com/youtube/v3/search?part=snippet&q=Marvel+MCU+DC+Comics+Superman+Batman+Avengers&type=video&order=viewCount&maxResults=10&publishedAfter=2026-01-01T00:00:00Z&key=" # YOUTUBE_API_KEY;
    let request : HttpRequestArgs = {
      url = url;
      max_response_bytes = ?Nat64.fromNat(500_000);
      headers = [
        { name = "User-Agent"; value = "MomentumTerminal/1.0" },
        { name = "Accept"; value = "application/json" },
      ];
      body = null;
      method = #get;
      transform = null;
    };
    try {
      let response = await (with cycles = 10_000_000_000) ic.http_request(request);
      switch (response.body.decodeUtf8()) {
        case (?text) {
          lastFetch_YouTube := Time.now();
          failures_YouTube := 0;
          text;
        };
        case null {
          failures_YouTube += 1;
          lastFetch_YouTube := Time.now();
          "{}";
        };
      };
    } catch (_) {
      failures_YouTube += 1;
      lastFetch_YouTube := Time.now();
      "{}";
    };
  };

  // ─── TMDB Upcoming Movies HTTP Outcall ────────────────────────────────────
  public func fetchTMDBData() : async Text {
    // Tier C gate: 15-minute minimum
    if (not gateOpen(lastFetch_TMDB, TIER_C_INTERVAL_NS, failures_TMDB)) {
      return "{}";
    };
    // Cycles circuit breaker — pause Tier C if balance is below safety threshold
    let currentCycles = ExperimentalCycles.balance();
    if (currentCycles <= CYCLES_SAFETY_THRESHOLD) {
      Debug.print("[CircuitBreaker] Balance below threshold — Tier C paused. Balance: " # currentCycles.toText());
      return "{}";
    };
    let url = "https://api.themoviedb.org/3/movie/upcoming?api_key=" # TMDB_API_KEY # "&language=en-US&page=1&region=US";
    let request : HttpRequestArgs = {
      url = url;
      max_response_bytes = ?Nat64.fromNat(500_000);
      headers = [
        { name = "User-Agent"; value = "MomentumTerminal/1.0" },
        { name = "Accept"; value = "application/json" },
      ];
      body = null;
      method = #get;
      transform = null;
    };
    try {
      let response = await (with cycles = 10_000_000_000) ic.http_request(request);
      switch (response.body.decodeUtf8()) {
        case (?text) {
          lastFetch_TMDB := Time.now();
          failures_TMDB := 0;
          text;
        };
        case null {
          failures_TMDB += 1;
          lastFetch_TMDB := Time.now();
          "{}";
        };
      };
    } catch (_) {
      failures_TMDB += 1;
      lastFetch_TMDB := Time.now();
      "{}";
    };
  };

  // ─── TMDB Trending Movies HTTP Outcall ────────────────────────────────────
  public func fetchTMDBPopularData() : async Text {
    // Tier C gate: 15-minute minimum
    if (not gateOpen(lastFetch_TMDBPopular, TIER_C_INTERVAL_NS, failures_TMDBPopular)) {
      return "{}";
    };
    // Cycles circuit breaker — pause Tier C if balance is below safety threshold
    let currentCycles = ExperimentalCycles.balance();
    if (currentCycles <= CYCLES_SAFETY_THRESHOLD) {
      Debug.print("[CircuitBreaker] Balance below threshold — Tier C paused. Balance: " # currentCycles.toText());
      return "{}";
    };
    let url = "https://api.themoviedb.org/3/trending/movie/week?api_key=" # TMDB_API_KEY;
    let request : HttpRequestArgs = {
      url = url;
      max_response_bytes = ?Nat64.fromNat(500_000);
      headers = [
        { name = "User-Agent"; value = "MomentumTerminal/1.0" },
        { name = "Accept"; value = "application/json" },
      ];
      body = null;
      method = #get;
      transform = null;
    };
    try {
      let response = await (with cycles = 10_000_000_000) ic.http_request(request);
      switch (response.body.decodeUtf8()) {
        case (?text) {
          lastFetch_TMDBPopular := Time.now();
          failures_TMDBPopular := 0;
          text;
        };
        case null {
          failures_TMDBPopular += 1;
          lastFetch_TMDBPopular := Time.now();
          "{}";
        };
      };
    } catch (_) {
      failures_TMDBPopular += 1;
      lastFetch_TMDBPopular := Time.now();
      "{}";
    };
  };

  // ─── OMDb Marvel Movies HTTP Outcall ──────────────────────────────────────
  public shared func fetchOMDBMarvelData() : async Text {
    // Tier C gate: 15-minute minimum
    if (not gateOpen(lastFetch_OMDBMarvel, TIER_C_INTERVAL_NS, failures_OMDBMarvel)) {
      return "{}";
    };
    // Cycles circuit breaker — pause Tier C if balance is below safety threshold
    let currentCycles = ExperimentalCycles.balance();
    if (currentCycles <= CYCLES_SAFETY_THRESHOLD) {
      Debug.print("[CircuitBreaker] Balance below threshold — Tier C paused. Balance: " # currentCycles.toText());
      return "{}";
    };
    let url = "http://www.omdbapi.com/?s=Marvel&type=movie&apikey=" # OMDB_API_KEY;
    let request : HttpRequestArgs = {
      url = url;
      max_response_bytes = ?Nat64.fromNat(500_000);
      headers = [
        { name = "Accept"; value = "application/json" },
        { name = "User-Agent"; value = "SentimentAM-Oracle/1.0" },
      ];
      body = null;
      method = #get;
      transform = ?{
        function = transform;
        context = ("" : Blob);
      };
    };
    try {
      let response = await (with cycles = 10_000_000_000) ic.http_request(request);
      switch (response.body.decodeUtf8()) {
        case (?text) {
          lastFetch_OMDBMarvel := Time.now();
          failures_OMDBMarvel := 0;
          text;
        };
        case null {
          failures_OMDBMarvel += 1;
          lastFetch_OMDBMarvel := Time.now();
          "{}";
        };
      };
    } catch (_) {
      failures_OMDBMarvel += 1;
      lastFetch_OMDBMarvel := Time.now();
      "{}";
    };
  };

  // ─── OMDb DC Movies HTTP Outcall ──────────────────────────────────────────
  public shared func fetchOMDBDCData() : async Text {
    // Tier C gate: 15-minute minimum
    if (not gateOpen(lastFetch_OMDBDC, TIER_C_INTERVAL_NS, failures_OMDBDC)) {
      return "{}";
    };
    // Cycles circuit breaker — pause Tier C if balance is below safety threshold
    let currentCycles = ExperimentalCycles.balance();
    if (currentCycles <= CYCLES_SAFETY_THRESHOLD) {
      Debug.print("[CircuitBreaker] Balance below threshold — Tier C paused. Balance: " # currentCycles.toText());
      return "{}";
    };
    let url = "http://www.omdbapi.com/?s=DC+Comics&type=movie&apikey=" # OMDB_API_KEY;
    let request : HttpRequestArgs = {
      url = url;
      max_response_bytes = ?Nat64.fromNat(500_000);
      headers = [
        { name = "Accept"; value = "application/json" },
        { name = "User-Agent"; value = "SentimentAM-Oracle/1.0" },
      ];
      body = null;
      method = #get;
      transform = ?{
        function = transform;
        context = ("" : Blob);
      };
    };
    try {
      let response = await (with cycles = 10_000_000_000) ic.http_request(request);
      switch (response.body.decodeUtf8()) {
        case (?text) {
          lastFetch_OMDBDC := Time.now();
          failures_OMDBDC := 0;
          text;
        };
        case null {
          failures_OMDBDC += 1;
          lastFetch_OMDBDC := Time.now();
          "{}";
        };
      };
    } catch (_) {
      failures_OMDBDC += 1;
      lastFetch_OMDBDC := Time.now();
      "{}";
    };
  };

  // ─── Tick History API ─────────────────────────────────────────────────────

  /// Commits a single tick result to canister memory.
  /// Called fire-and-forget from OracleTickContext after each tick cycle.
  /// Capped at 720 entries (≈6 hours at 30-second ticks).
  public shared ({ caller }) func persistTick(record : TickRecord) : async () {
    let existing = tickHistoryState.ticks;
    let newEntry = [record];
    let combined = existing.concat(newEntry);
    if (combined.size() > 720) {
      let overflow = combined.size() - 720;
      tickHistoryState.ticks := combined.sliceToArray(overflow, combined.size());
    } else {
      tickHistoryState.ticks := combined;
    };
    latestScoreSnapshot := record.scores;

    // Also append to caller's personal history
    let userExisting = switch (userTickHistory.get(caller)) {
      case (?history) { history };
      case (null) { [] };
    };
    let userCombined = userExisting.concat(newEntry);
    if (userCombined.size() > 720) {
      let userOverflow = userCombined.size() - 720;
      userTickHistory.add(caller, userCombined.sliceToArray(userOverflow, userCombined.size()));
    } else {
      userTickHistory.add(caller, userCombined);
    };
  };

  /// Returns the most recent `limit` tick records, oldest first.
  /// PUBLIC query — no auth restriction. Used on frontend mount for hydration.
  public query func getLatestTicks(limit : Nat) : async [TickRecord] {
    let total = tickHistoryState.ticks.size();
    if (total == 0) return [];
    let start = if (total > limit) { total - limit } else { 0 };
    tickHistoryState.ticks.sliceToArray(start, total);
  };

  /// Returns the latest score snapshot committed by persistTick.
  /// PUBLIC query — no auth restriction. Used on frontend mount to bootstrap scores.
  public query func getLatestScores() : async [(Text, Float)] {
    latestScoreSnapshot;
  };

  /// Returns the caller's personal tick history, limited to the last N entries.
  public shared query ({ caller }) func getUserTickHistory(limit : Nat) : async [TickRecord] {
    switch (userTickHistory.get(caller)) {
      case (?history) {
        let total = history.size();
        if (total == 0) return [];
        let start = if (total > limit) { total - limit } else { 0 };
        history.sliceToArray(start, total);
      };
      case (null) { [] };
    };
  };

  /// Returns the most recent scores from the caller's personal history.
  public shared query ({ caller }) func getUserLatestScores() : async [(Text, Float)] {
    switch (userTickHistory.get(caller)) {
      case (?history) {
        let total = history.size();
        if (total == 0) return [];
        let lastRecord = history[total - 1];
        lastRecord.scores;
      };
      case (null) { [] };
    };
  };
};
