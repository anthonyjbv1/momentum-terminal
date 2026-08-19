/**
 * headlineQueueService.ts
 *
 * 5-minute bulk-fetch caching layer for the Oracle headline pipeline.
 */

import { createActorWithConfig } from "../config";
import { saveMetricSnapshot, getDeltaHeadlines, getDailyDeltaHeadlines } from "../lib/oracle/metricHistory";

export type SentimentLabel = "positive" | "negative" | "neutral";

/**
 * Phase 2: label and confidence are intentionally absent — scored JIT by FinBERT.
 * forcedIndex: optional bypass — if set, routing engine is skipped entirely.
 */
export interface QueuedHeadline {
  text: string;
  sourceTier: 1 | 2 | 3 | 4 | 5;
  /** Brute-force index override — bypasses routeHeadline() entirely when set. */
  forcedIndex?: string;
  /** Source identifier — flows through pipeline to determine feed label (e.g. "reddit", "youtube"). */
  source?: string;
  /**
   * Pre-computed sentiment score from the mock headline pool.
   * When present, finbertService uses this value directly for classification
   * instead of calling the canister — positive sign → positive, negative → negative.
   */
  sentimentScore?: number;
  /** Reddit upvote count (data.ups). Optional — only present for Reddit-sourced headlines. */
  engagementScore?: number;
  /** Reddit comment count (data.num_comments). Optional — only present for Reddit-sourced headlines. */
  commentCount?: number;
  /** When true, neutral impact suppression is skipped — headline always dispatches. Used for structured data sources (Forbes, YouTube, Twitch, Spotify). */
  sourceLabelOverride?: boolean;
}

// ─── In-memory queue ─────────────────────────────────────────────────────────
const _queue: QueuedHeadline[] = [];
let _initialized = false;
// ─── Source blocklist ────────────────────────────────────────────────────────
export const blockedHeadlines: Array<{
  text: string;
  reason: string;
  blockedAt: number;
}> = [];

function formatCompact(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1).replace(/\.0$/, "")}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return n.toString();
}

function shouldBlockHeadline(text: string): string | null {
  const lower = text.toLowerCase();
  const BLOCKED_NAMES = ["jim cramer", "dan ives"];
  for (const name of BLOCKED_NAMES) {
    if (lower.includes(name)) return `blocked_author:${name}`;
  }
  const REUTERS_PATTERNS = ["morning bid:", "trading day:", "asia stocks"];
  for (const pat of REUTERS_PATTERNS) {
    if (lower.includes(pat)) return `reuters_format:${pat}`;
  }
  if (lower.includes("wall st") && lower.includes("close"))
    return "reuters_format:wall_st_close";
  if (lower.includes("nasdaq end")) return "reuters_format:nasdaq_end";
  if (lower.includes("s&p 500 end") || lower.includes("s&p500 end"))
    return "reuters_format:sp500_end";
  const INSTITUTION_SIGNALS = [
    "fed",
    "federal reserve",
    "ecb",
    "boj",
    "imf",
    "world bank",
    "treasury",
    "sec",
    "cdc",
    "fda",
    "irs",
    "congress",
    "senate",
    "white house",
    "president",
    "minister",
    "governor",
    "department",
    "agency",
    "committee",
    "commission",
    "court",
    "who ",
    "nato",
    "un ",
    "opec",
  ];
  const hasInstitution = INSTITUTION_SIGNALS.some((sig) => lower.includes(sig));
  if (!hasInstitution) {
    const SPECULATIVE_PHRASES = [
      "the case for",
      "what if",
      "could remain",
      "predicts",
      "sees ",
      "says ",
    ];
    for (const phrase of SPECULATIVE_PHRASES) {
      if (lower.includes(phrase)) return `speculative_framing:${phrase.trim()}`;
    }
  }
  return null;
}

let _isFetchingNews = false;
let _isFetchingNewsAPI = false;
let _isFetchingOddsAPI = false;
let _isFetchingGoogleSearch = false;
let _isFetchingReddit = false;
let _isFetchingRSS = false;
let _isFetchingOMDB = false;
let _isFetchingFRED = false;
let _isFetchingBLS = false;
const SNAPSHOT_DISPLAY_INTERVAL_MS = 12 * 60 * 60 * 1000; // show each series snapshot at most twice a day
const SNAPSHOT_LS_KEY = "mt_snapshot_last_shown";
// Persisted to localStorage so the throttle survives page reloads
const _snapshotLastShown = new Map<string, number>(
  (() => {
    try {
      return Object.entries(JSON.parse(localStorage.getItem(SNAPSHOT_LS_KEY) ?? "{}") as Record<string, number>);
    } catch { return []; }
  })()
);
function _persistSnapshotLastShown(key: string, ts: number): void {
  _snapshotLastShown.set(key, ts);
  try {
    const obj = Object.fromEntries(_snapshotLastShown);
    localStorage.setItem(SNAPSHOT_LS_KEY, JSON.stringify(obj));
  } catch { /* ignore */ }
}
let _isFetchingBEA = false;
let _isFetchingForbes = false;
let _isFetchingSocialBlade = false;
let _isFetchingYouTube = false;
let _isFetchingTwitch = false;
let _isFetchingSpotify = false;
let _isFetchingBillboard = false;
let _isFetchingPolymarket = false;
let _isFetchingKalshi = false;
let _isFetchingWorldBank = false;
let _isFetchingNBSChina = false;
let _isFetchingAPISportsSoccer = false;
let _isFetchingAPISportsNFL = false;
let _isFetchingAPISportsF1 = false;
let _isFetchingFotMob = false;
let _isFetchingCollegeScorecard = false;

const LOW_WATER_MARK = 5;

// ─── Fetch interval constants ─────────────────────────────────────────────────
const OMDB_FETCH_INTERVAL_MS = 12 * 60 * 60 * 1000; // 12 hours

// ─── Extended actor type for new backend methods ──────────────────────────────
export interface ActorWithFedBLS {
  fetchFedData: () => Promise<string>;
  fetchBLSData: () => Promise<string>;
  fetchReliefWebData: () => Promise<string>;
  fetchGDELTData: () => Promise<string>;
  fetchUSPTOData: () => Promise<string>;
  fetchCongressData: () => Promise<string>;
  fetchFTCData: () => Promise<string>;
  fetchSCOTUSData: () => Promise<string>;
  fetchCongressTraditionalData: () => Promise<string>;
  fetchCourtListenerData: () => Promise<string>;
  fetchEPAData: () => Promise<string>;
  fetchACLUData: () => Promise<string>;
  fetchYouTubeData: () => Promise<string>;
  fetchTMDBData: () => Promise<string>;
  fetchTMDBPopularData: () => Promise<string>;
  fetchRedditFeed: (subreddit: string) => Promise<string>;
  fetchOMDBMarvelData: () => Promise<string>;
  fetchOMDBDCData: () => Promise<string>;
}

// ─── Canonical source names per tier ─────────────────────────────────────────
export const TIER_SOURCE_NAMES: Record<1 | 2 | 3 | 4 | 5, string[]> = {
  1: ["Bloomberg", "Reuters", "Federal Reserve", "SEC"],
  2: ["Wall Street Journal", "Financial Times", "CNBC"],
  3: ["TechCrunch", "Defense One", "Verified Corporate", "youtube"],
  4: ["Seeking Alpha", "reddit", "Verified Social"],
  5: ["Anonymous X", "Unverified Telegram"],
};

export function getSourceNameForTier(
  tier: 1 | 2 | 3 | 4 | 5,
  sourceOverride?: string,
): string {
  if (sourceOverride) return sourceOverride;
  const names = TIER_SOURCE_NAMES[tier];
  return names[Math.floor(Math.random() * names.length)];
}

// ─── Tier mapping from live source names ─────────────────────────────────────
function mapSourceToTier(sourceName: string): 1 | 2 | 3 | 4 | 5 {
  const name = sourceName.toLowerCase();
  if (
    name.includes("reuters") ||
    name.includes("bloomberg") ||
    name.includes("wsj") ||
    name.includes("wall street journal") ||
    name.includes("ft") ||
    name.includes("financial times")
  )
    return 1;
  if (
    name.includes("cnbc") ||
    name.includes("bbc") ||
    name.includes("associated press")
  )
    return 2;
  return 3;
}

// ─── Finnhub article shape ────────────────────────────────────────────────────
interface FinnhubArticle {
  headline?: string;
  title?: string;
  summary: string;
  source: string;
  id?: number;
  datetime?: number;
  url?: string;
  category?: string;
}

// ─── Jitter helper ────────────────────────────────────────────────────────────
function jitter(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

// ─── Headline cache ───────────────────────────────────────────────────────────
const HEADLINE_CACHE_KEY = "mt_recent_headlines";

function saveHeadlinesToCache(headlines: QueuedHeadline[]): void {
  try {
    const existing: QueuedHeadline[] = JSON.parse(localStorage.getItem(HEADLINE_CACHE_KEY) ?? "[]");
    const merged = [...headlines, ...existing];
    const seen = new Set<string>();
    const deduped = merged.filter((h) => {
      if (seen.has(h.text)) return false;
      seen.add(h.text);
      return true;
    }).slice(0, 200);
    localStorage.setItem(HEADLINE_CACHE_KEY, JSON.stringify(deduped));
  } catch {}
}

function loadHeadlinesFromCache(): QueuedHeadline[] {
  try {
    return JSON.parse(localStorage.getItem(HEADLINE_CACHE_KEY) ?? "[]");
  } catch { return []; }
}

export async function fetchNewsBatch(): Promise<void> {
  if (_isFetchingNews) {
    console.info(
      "[HeadlineQueue] News refill already in progress — skipping duplicate request.",
    );
    return;
  }

  _isFetchingNews = true;

  try {
    const finnhubKey = import.meta.env.VITE_FINNHUB_API_KEY as string | undefined;
    if (!finnhubKey) {
      console.warn("[HeadlineQueue] VITE_FINNHUB_API_KEY not set — skipping Finnhub fetch.");
      return;
    }
    const resp = await fetch(
      `https://finnhub.io/api/v1/news?category=general&token=${finnhubKey}`,
    );
    if (!resp.ok) {
      throw new Error(`Finnhub responded with status ${resp.status}`);
    }
    const data: unknown = await resp.json();
    if (!Array.isArray(data) || data.length === 0) {
      console.warn("[HeadlineQueue] Finnhub returned empty or non-array response.");
      return;
    }
    const mapped: QueuedHeadline[] = (data as FinnhubArticle[])
      .filter((a) => (a.headline ?? a.title ?? "").trim().length > 0)
      .map((a) => ({
        text: (a.headline ?? a.title ?? "").trim(),
        sourceTier: mapSourceToTier(a.source ?? ""),
        source: "finnhub",
      }))
      .sort(() => Math.random() - 0.5)
      .slice(0, 4);
    for (const _item of mapped) {
      const _br = shouldBlockHeadline(_item.text);
      if (_br) {
        blockedHeadlines.push({ text: _item.text, reason: _br, blockedAt: Date.now() });
      } else {
        _queue.push(_item);
      }
    }
    saveHeadlinesToCache(mapped);
    console.info(
      `[HeadlineQueue] Enqueued ${mapped.length} live headlines from Finnhub. Queue depth: ${_queue.length}`,
    );
  } catch (err) {
    console.warn("[HeadlineQueue] Finnhub direct fetch failed — queue remains empty.", err);
  } finally {
    _isFetchingNews = false;
  }
}

async function fetchNewsAPIBatch(): Promise<void> {
  if (_isFetchingNewsAPI) return;
  _isFetchingNewsAPI = true;
  try {
    const newsApiKey = import.meta.env.VITE_NEWSDATAIO_KEY ?? "";
    if (!newsApiKey) return;
    const resp = await fetch(
      `https://newsdata.io/api/1/news?apikey=${newsApiKey}&language=en&size=10`,
    );
    if (!resp.ok) throw new Error(`Newsdataio responded with status ${resp.status}`);
    const data: unknown = await resp.json();
    if (!Array.isArray((data as { results?: unknown }).results)) return;
    const articles = (data as { results: Array<{ title?: string; source_id?: string }> }).results;
    const mapped: QueuedHeadline[] = articles
      .filter((a) => (a.title ?? "").trim().length > 0)
      .map((a) => ({
        text: (a.title ?? "").trim(),
        sourceTier: mapSourceToTier(a.source_id ?? ""),
        source: "newsapi",
      }))
      .sort(() => Math.random() - 0.5)
      .slice(0, 6);
    for (const item of mapped) {
      const blockReason = shouldBlockHeadline(item.text);
      if (blockReason) {
        blockedHeadlines.push({ text: item.text, reason: blockReason, blockedAt: Date.now() });
      } else {
        _queue.push(item);
      }
    }
    saveHeadlinesToCache(mapped);
    console.info(`[HeadlineQueue] Enqueued ${mapped.length} headlines from Newsdataio. Queue depth: ${_queue.length}`);
  } catch (err) {
    console.warn("[HeadlineQueue] Newsdataio fetch failed.", err);
  } finally {
    _isFetchingNewsAPI = false;
  }
}

const ODDS_SPORTS = [
  // { key: "americanfootball_nfl", label: "NFL" },        // removed: requires paid plan tier
  { key: "soccer_uefa_champs_league", label: "Champions League" },
  // { key: "soccer_spain_la_liga", label: "La Liga" },    // removed: requires paid plan tier
  { key: "soccer_fifa_world_cup", label: "World Cup" },
];

async function fetchOddsAPIBatch(): Promise<void> {
  if (_isFetchingOddsAPI) return;
  const ODDS_SUPPRESSED_UNTIL = new Date('2026-09-01').getTime();
  if (Date.now() < ODDS_SUPPRESSED_UNTIL) {
    console.log('[OddsAPI] Credits exhausted — suppressed until Sept 1');
    return;
  }
  _isFetchingOddsAPI = true;
  try {
    const key = import.meta.env.VITE_ODDS_API_KEY ?? "";
    if (!key) return;
    const results = await Promise.all(
      ODDS_SPORTS.map(async ({ key: sport, label }) => {
        try {
          const resp = await fetch(
            `https://api.the-odds-api.com/v4/sports/${sport}/odds/?apiKey=${key}&regions=us&markets=h2h&oddsFormat=decimal`,
          );
          if (resp.status === 401) {
            console.warn("[OddsAPI] 401 Unauthorized — check VITE_ODDS_API_KEY");
            return [];
          }
          if (!resp.ok) return [];
          const games = await resp.json() as Array<{
            home_team: string;
            away_team: string;
            bookmakers: Array<{ markets: Array<{ outcomes: Array<{ name: string; price: number }> }> }>;
          }>;
          return games.flatMap((game) => {
            const outcomes = game.bookmakers[0]?.markets[0]?.outcomes ?? [];
            const homeOutcome = outcomes.find((o) => o.name === game.home_team);
            if (!homeOutcome) return [];
            const prob = Math.round((1 / homeOutcome.price) * 100);
            const homeTeam = game.home_team;
            const awayTeam = game.away_team;
            const formats = [
              `${homeTeam} vs ${awayTeam} — ${homeTeam} implied win probability ${prob}%`,
              `${homeTeam} favored at ${prob}% to beat ${awayTeam}`,
              `Odds update: ${homeTeam} ${prob}% win probability ahead of ${awayTeam} clash`,
              `${awayTeam} faces ${homeTeam} — oddsmakers give ${homeTeam} ${prob}% edge`,
              `${homeTeam} opens as ${prob}% favorite vs ${awayTeam}`,
            ];
            const text = formats[Math.floor(Math.random() * formats.length)];
            return [{ text, sourceTier: 2 as const, source: "odds_api" }];
          });
        } catch {
          return [];
        }
      }),
    );
    const mapped: QueuedHeadline[] = (results.flat() as QueuedHeadline[])
      .sort(() => Math.random() - 0.5)
      .slice(0, 8);
    for (const item of mapped) {
      const blockReason = shouldBlockHeadline(item.text);
      if (blockReason) {
        blockedHeadlines.push({ text: item.text, reason: blockReason, blockedAt: Date.now() });
      } else {
        _queue.push(item);
      }
    }
    saveHeadlinesToCache(mapped);
    console.info(`[HeadlineQueue] Enqueued ${mapped.length} headlines from Odds API. Queue depth: ${_queue.length}`);
  } catch (err) {
    console.warn("[HeadlineQueue] Odds API fetch failed.", err);
  } finally {
    _isFetchingOddsAPI = false;
  }
}

let _googleSearchPointer = 0;

const SEARCH_QUERIES = [
  // Original
  { query: "Elon Musk news", index: "Elon Musk Sentiment" },
  { query: "Federal Reserve interest rates", index: "Fed Policy Sentiment" },
  { query: "MENA Middle East conflict", index: "MENA Stability Sentiment" },
  { query: "AI regulation policy", index: "AI Regulation Risk Sentiment" },
  { query: "Kansas City Chiefs", index: "Kansas City Chiefs Sentiment" },
  { query: "MrBeast YouTube", index: "MrBeast Sentiment" },
  { query: "Ozempic weight loss drug", index: "Ozempic Sentiment" },
  { query: "Drake music news", index: "Drake Sentiment" },
  { query: "Jensen Huang Nvidia", index: "Jensen Huang Sentiment" },
  { query: "FC Barcelona soccer", index: "FC Barcelona Sentiment" },
  // Individuals
  { query: "Mark Zuckerberg Meta news", index: "Mark Zuckerberg Sentiment" },
  { query: "Warren Buffett Berkshire Hathaway", index: "Warren Buffett Sentiment" },
  { query: "Patrick Mahomes NFL", index: "Patrick Mahomes Sentiment" },
  { query: "Kendrick Lamar music", index: "Kendrick Lamar Sentiment" },
  { query: "Kai Cenat Twitch", index: "Kai Cenat Sentiment" },
  { query: "Adin Ross livestream", index: "Adin Ross Sentiment" },
  { query: "Jeff Bezos Amazon", index: "Jeff Bezos Sentiment" },
  { query: "Larry Ellison Oracle", index: "Larry Ellison Sentiment" },
  { query: "Larry Page Google", index: "Larry Page Sentiment" },
  { query: "Sergey Brin Google", index: "Sergey Brin Sentiment" },
  { query: "Michael Dell Dell Technologies", index: "Michael Dell Sentiment" },
  // Sports
  { query: "Real Madrid news", index: "Real Madrid CF Sentiment" },
  { query: "Ferrari Formula 1", index: "F1 Ferrari Sentiment" },
  { query: "McLaren F1 racing", index: "F1 McLaren Sentiment" },
  { query: "Mercedes F1 team", index: "F1 Mercedes Sentiment" },
  { query: "Denver Broncos NFL", index: "Denver Broncos Sentiment" },
  { query: "France national soccer team", index: "France National Team Sentiment" },
  { query: "Spain national soccer team", index: "Spain National Team Sentiment" },
  // Health
  { query: "Alzheimer's disease treatment", index: "Alzheimer's Sentiment" },
  { query: "mental health crisis news", index: "Mental Health Sentiment" },
  { query: "cancer research breakthrough", index: "Cancer Research Sentiment" },
  { query: "type 2 diabetes treatment", index: "Type 2 Diabetes Sentiment" },
  { query: "flu season influenza news", index: "Seasonal Influenza Sentiment" },
  { query: "Wegovy semaglutide news", index: "Wegovy Sentiment" },
  // Cultural
  { query: "traditional values conservative news", index: "Traditionalism Sentiment" },
  { query: "progressive liberal politics news", index: "Progressivism Sentiment" },
  { query: "masculinity men culture news", index: "Masculism Sentiment" },
  { query: "feminism women rights news", index: "Feminism Sentiment" },
  // Regional
  { query: "California politics news", index: "California Sentiment" },
  { query: "Texas politics news", index: "Texas Sentiment" },
  { query: "Florida politics news", index: "Florida Sentiment" },
  { query: "New York city news", index: "New York Sentiment" },
  { query: "China economy news", index: "China Sentiment" },
  { query: "Germany economy news", index: "Germany Sentiment" },
  { query: "United States economy news", index: "United States Sentiment" },
  // Universities
  { query: "Harvard University news", index: "Harvard University Sentiment" },
  { query: "Yale University news", index: "Yale University Sentiment" },
  { query: "Ohio State University news", index: "Ohio State University Sentiment" },
  { query: "University of Michigan news", index: "University of Michigan Sentiment" },
];

async function fetchGoogleSearchBatch(): Promise<void> {
  if (_isFetchingGoogleSearch) return;
  if (localStorage.getItem("mt_apify_disabled") === "true") {
    console.info("[GoogleSearch] Apify disabled — free tier exhausted");
    return;
  }
  _isFetchingGoogleSearch = true;
  try {
    const apifyToken = import.meta.env.VITE_APIFY_TOKEN ?? "";
    if (!apifyToken) return;
    const batch = [0, 1, 2].map((offset) => {
      const idx = (_googleSearchPointer + offset) % SEARCH_QUERIES.length;
      return SEARCH_QUERIES[idx];
    });
    _googleSearchPointer = (_googleSearchPointer + 3) % SEARCH_QUERIES.length;
    const results = await Promise.all(
      batch.map(async (entry) => {
        try {
          const resp = await fetch(
            `https://api.apify.com/v2/acts/nFJndFXA5zjCTuudP/run-sync-get-dataset-items?token=${apifyToken}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                queries: entry.query,
                maxPagesPerQuery: 1,
                resultsPerPage: 5,
                countryCode: "us",
              }),
            },
          );
          const rawText = await resp.text();
          if (!resp.ok) return [];
          const data = JSON.parse(rawText);
          const pages = Array.isArray(data) ? data : [];
          const totalResults: number = pages[0]?.resultsTotal ?? pages[0]?.totalResults ?? 0;
          if (totalResults === 0) return [];
          const stored: Record<string, number> = JSON.parse(localStorage.getItem("mt_search_volume") ?? "{}");
          const prev = stored[entry.query];
          stored[entry.query] = totalResults;
          localStorage.setItem("mt_search_volume", JSON.stringify(stored));
          if (prev === undefined) return [];
          const pct = Math.round(((totalResults - prev) / prev) * 100);
          if (Math.abs(pct) < 10) return [];
          const surged = pct > 0;
          const entityName = entry.index.replace(" Sentiment", "");
          const text = `${entityName} Google search volume ${surged ? "surged" : "declined"} ${Math.abs(pct).toFixed(0)}% — ${surged ? "elevated" : "declining"} narrative search activity`;
          return [{ text, sourceTier: mapSourceToTier("google_search") as 1 | 2 | 3 | 4 | 5, source: "google_search", forcedIndex: entry.index }];
        } catch {
          return [];
        }
      }),
    );
    const mapped: QueuedHeadline[] = results.flat() as QueuedHeadline[];
    for (const item of mapped) {
      const blockReason = shouldBlockHeadline(item.text);
      if (blockReason) {
        blockedHeadlines.push({ text: item.text, reason: blockReason, blockedAt: Date.now() });
      } else {
        _queue.push(item);
      }
    }
    saveHeadlinesToCache(mapped);
    console.info(`[HeadlineQueue] Enqueued ${mapped.length} volume-change headlines from Google Search. Queue depth: ${_queue.length}`);
  } catch (err) {
    console.warn("[HeadlineQueue] Google Search fetch failed.", err);
  } finally {
    _isFetchingGoogleSearch = false;
  }
}

// ─── Reddit Apify volume-delta batch ─────────────────────────────────────────

const REDDIT_SUBREDDITS: Record<string, string> = {
  "r/diabetes": "Type 2 Diabetes Sentiment",
  "r/COVID19": "COVID Variant Sentiment",
  "r/LongCovid": "Long COVID Sentiment",
  "r/mentalhealth": "Mental Health Sentiment",
  "r/cancer": "Cancer Research Sentiment",
  "r/Alzheimers": "Alzheimer's Sentiment",
  "r/flu": "Seasonal Influenza Sentiment",
  "r/Ozempic": "Ozempic Sentiment",
  "r/WegovyWeightLoss": "Wegovy Sentiment",
  "r/ADHD": "Adderall Sentiment",
  "r/KansasCityChiefs": "Kansas City Chiefs Sentiment",
  "r/DenverBroncos": "Denver Broncos Sentiment",
  "r/barca": "FC Barcelona Sentiment",
  "r/realmadrid": "Real Madrid CF Sentiment",
  "r/NASCAR": "NASCAR Sentiment",
  "r/formula1": "F1 Constructor Sentiment",
  "r/Masculinity": "Masculism Sentiment",
  "r/Feminism": "Feminism Sentiment",
  "r/MENA": "MENA Stability Sentiment",
};

const REDDIT_KEYS = Object.keys(REDDIT_SUBREDDITS);

// Pointer persisted across page loads so each call advances through the list
let _redditApifyPointer: number = (() => {
  try {
    const stored = Number.parseInt(localStorage.getItem("mt_reddit_pointer") ?? "0", 10);
    return Number.isNaN(stored) ? 0 : stored % REDDIT_KEYS.length;
  } catch {
    return 0;
  }
})();

async function fetchRedditApifyBatch(): Promise<void> {
  if (_isFetchingReddit) return;
  _isFetchingReddit = true;
  try {
    const apifyToken = import.meta.env.VITE_APIFY_TOKEN ?? "";
    if (!apifyToken) return;

    // Pick 3 subreddits from the current pointer position
    const batch = [0, 1, 2].map((offset) => {
      const key = REDDIT_KEYS[(_redditApifyPointer + offset) % REDDIT_KEYS.length];
      return { sub: key, index: REDDIT_SUBREDDITS[key] };
    });
    _redditApifyPointer = (_redditApifyPointer + 3) % REDDIT_KEYS.length;
    try { localStorage.setItem("mt_reddit_pointer", String(_redditApifyPointer)); } catch { /* ignore */ }

    const results = await Promise.all(
      batch.map(async ({ sub, index }) => {
        try {
          const subredditPath = sub.replace("r/", "");
          const resp = await fetch(
            `https://api.apify.com/v2/acts/oAuCIx3ItNrs2okjQ/run-sync-get-dataset-items?token=${apifyToken}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                startUrls: [{ url: `https://www.reddit.com/r/${subredditPath}/hot/` }],
                maxItems: 50,
                proxy: { useApifyProxy: true },
              }),
            },
          );
          if (!resp.ok) return [];
          const data = await resp.json();
          const posts: unknown[] = Array.isArray(data) ? data : [];

          const postCount = posts.length;
          const upvotes = posts.reduce((sum: number, p) => {
            const post = p as Record<string, unknown>;
            const u =
              (post.numberOfUpvotes as number | undefined) ??
              (post.upvotes as number | undefined) ??
              (post.score as number | undefined) ??
              (post.ups as number | undefined) ??
              0;
            return sum + u;
          }, 0);

          const stored: Record<string, number> = (() => {
            try { return JSON.parse(localStorage.getItem("mt_reddit_volume") ?? "{}") as Record<string, number>; }
            catch { return {}; }
          })();

          const prev = stored[sub];
          stored[sub] = postCount;
          try { localStorage.setItem("mt_reddit_volume", JSON.stringify(stored)); } catch { /* ignore */ }

          // No baseline yet — store and skip
          if (prev === undefined) return [];

          const pct = prev > 0 ? ((postCount - prev) / prev) * 100 : 0;
          if (Math.abs(pct) < 15) return [];

          const surging = pct > 0;
          const entityName = index.replace(" Sentiment", "");
          const text = surging
            ? `${sub} discussion volume surging — elevated narrative activity signal for ${entityName}`
            : `${sub} discussion volume declining — fading narrative engagement for ${entityName}`;

          void upvotes; // available for future use
          return [{ text, sourceTier: 2 as const, source: "reddit" as const, forcedIndex: index }];
        } catch {
          return [];
        }
      }),
    );

    const mapped: QueuedHeadline[] = results.flat() as QueuedHeadline[];
    for (const item of mapped) {
      const blockReason = shouldBlockHeadline(item.text);
      if (blockReason) {
        blockedHeadlines.push({ text: item.text, reason: blockReason, blockedAt: Date.now() });
      } else {
        _queue.push(item);
      }
    }
    saveHeadlinesToCache(mapped);
    console.info(`[HeadlineQueue] Enqueued ${mapped.length} volume-change headlines from Reddit. Queue depth: ${_queue.length}`);
  } catch (err) {
    console.warn("[HeadlineQueue] Reddit Apify fetch failed.", err);
  } finally {
    _isFetchingReddit = false;
  }
}

// ─── FRED (Federal Reserve Economic Data) direct fetch ────────────────────────
async function fetchFREDBatch(): Promise<void> {
  if (_isFetchingFRED) return;
  _isFetchingFRED = true;
  try {
    const apiKey = import.meta.env.VITE_FRED_API_KEY ?? "";
    if (!apiKey) return;

    const FRED_SERIES = [
      { id: "CPIAUCSL", label: "US Consumer Price Index",            entity: "United States", index: "Fed Policy Sentiment" },
      { id: "PCEPILFE", label: "US PCE Inflation Index",             entity: "United States", index: "Fed Policy Sentiment" },
      { id: "UNRATE",   label: "US Unemployment Rate",               entity: "United States", index: "United States Sentiment" },
      { id: "FEDFUNDS", label: "Federal Funds Rate",                 entity: "United States", index: "Fed Policy Sentiment" },
      { id: "GS10",     label: "10-Year Treasury Yield",             entity: "United States", index: "Fed Policy Sentiment" },
      { id: "CAUR",     label: "California unemployment rate",       entity: "California",    index: "California Sentiment" },
      { id: "CASTHPI",  label: "California house price index",       entity: "California",    index: "California Sentiment" },
      { id: "NYUR",     label: "New York unemployment rate",         entity: "New York",      index: "New York Sentiment" },
      { id: "NYSTHPI",  label: "New York house price index",         entity: "New York",      index: "New York Sentiment" },
      { id: "FLUR",     label: "Florida unemployment rate",          entity: "Florida",       index: "Florida Sentiment" },
      { id: "FLSTHPI",  label: "Florida house price index",          entity: "Florida",       index: "Florida Sentiment" },
      { id: "TXUR",     label: "Texas unemployment rate",            entity: "Texas",         index: "Texas Sentiment" },
      { id: "TXSTHPI",  label: "Texas house price index",            entity: "Texas",         index: "Texas Sentiment" },
    ];

    const mapped: QueuedHeadline[] = [];

    for (const series of FRED_SERIES) {
      try {
        const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${series.id}&api_key=${apiKey}&file_type=json&limit=1&sort_order=desc`;
        const resp = await fetch(`/api/data-proxy?url=${encodeURIComponent(url)}`);
        if (!resp.ok) { await new Promise((r) => setTimeout(r, 200)); continue; }
        const data = await resp.json() as { observations?: Array<{ value: string; date: string }> };
        const obs = data.observations?.[0];
        if (!obs || !obs.value || obs.value === ".") { await new Promise((r) => setTimeout(r, 200)); continue; }
        const value = Number.parseFloat(obs.value);
        if (Number.isNaN(value)) { await new Promise((r) => setTimeout(r, 200)); continue; }

        const metricKey = `fred:${series.id}`;
        const snapshotItem: QueuedHeadline = {
          text: (() => {
            const d = obs.date; // "YYYY-MM-DD"
            const monthYear = new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { month: "long", year: "numeric" });
            if (series.id === "CPIAUCSL") return `US inflation index holds at ${value.toFixed(1)} as of ${monthYear}`;
            if (series.id === "PCEPILFE") return `Core consumer prices index at ${value.toFixed(1)} as of ${monthYear}`;
            if (series.id === "UNRATE")   return `National unemployment sits at ${value.toFixed(1)}% as of ${monthYear}`;
            if (series.id === "FEDFUNDS") return `The Fed funds rate holds at ${value.toFixed(2)}% as of ${monthYear}`;
            if (series.id === "GS10")     return `10-year Treasury yield sits at ${value.toFixed(2)}% as of ${monthYear}`;
            if (series.id === "CAUR")     return `California unemployment sits at ${value.toFixed(1)}% as of ${monthYear}`;
            if (series.id === "CASTHPI")  return `California home prices index at ${value.toFixed(1)} as of ${monthYear}`;
            if (series.id === "NYUR")     return `New York unemployment sits at ${value.toFixed(1)}% as of ${monthYear}`;
            if (series.id === "NYSTHPI")  return `New York home prices index at ${value.toFixed(1)} as of ${monthYear}`;
            if (series.id === "FLUR")     return `Florida unemployment sits at ${value.toFixed(1)}% as of ${monthYear}`;
            if (series.id === "FLSTHPI")  return `Florida home prices index at ${value.toFixed(1)} as of ${monthYear}`;
            if (series.id === "TXUR")     return `Texas unemployment sits at ${value.toFixed(1)}% as of ${monthYear}`;
            if (series.id === "TXSTHPI")  return `Texas home prices index at ${value.toFixed(1)} as of ${monthYear}`;
            return `${series.entity} ${series.label.toLowerCase()} at ${value.toFixed(2)} as of ${monthYear}`;
          })(),
          sourceTier: 2,
          source: "fred",
          forcedIndex: series.index,
          sourceLabelOverride: true,
          sentimentScore: 0,
        };
        const blockReason = shouldBlockHeadline(snapshotItem.text);
        const lastShown = _snapshotLastShown.get(metricKey) ?? 0;
        if (blockReason) {
          blockedHeadlines.push({ text: snapshotItem.text, reason: blockReason, blockedAt: Date.now() });
        } else if (Date.now() - lastShown >= SNAPSHOT_DISPLAY_INTERVAL_MS) {
          mapped.push(snapshotItem);
          _queue.push(snapshotItem);
          _persistSnapshotLastShown(metricKey, Date.now());
        }

        saveMetricSnapshot(metricKey, value, series.label, "FRED");
        const weeklyDeltas = getDeltaHeadlines(metricKey, value, series.entity, `FRED ${series.label}`, series.index);
        const dailyDeltas = getDailyDeltaHeadlines(metricKey, value, series.entity, `FRED ${series.label}`, series.index);
        const deltas = [...weeklyDeltas, ...dailyDeltas];
        for (const d of deltas) {
          const dr = shouldBlockHeadline(d.text);
          if (dr) {
            blockedHeadlines.push({ text: d.text, reason: dr, blockedAt: Date.now() });
          } else {
            const dh = d as unknown as QueuedHeadline;
            mapped.push(dh);
            _queue.push(dh);
          }
        }
      } catch { /* skip this series */ }
      await new Promise((r) => setTimeout(r, 200));
    }

    if (mapped.length > 0) {
      saveHeadlinesToCache(mapped);
      console.info(`[FREDService] Enqueued ${mapped.length} FRED economic headlines. Queue depth: ${_queue.length}`);
    }
  } catch (err) {
    console.warn("[FREDService] FRED fetch failed.", err);
  } finally {
    _isFetchingFRED = false;
  }
}

// ─── BLS (Bureau of Labor Statistics) direct fetch ────────────────────────────
async function fetchBLSBatch(): Promise<void> {
  if (_isFetchingBLS) return;
  _isFetchingBLS = true;
  try {
    const apiKey = import.meta.env.VITE_BLS_API_KEY ?? "";
    if (!apiKey) return;

    const BLS_SERIES: Array<{ id: string; name: string; index: string }> = [
      { id: "CUUR0000SA0", name: "US Consumer Price Index (CPI)", index: "Fed Policy Sentiment" },
      { id: "WPUFD4",      name: "US Producer Price Index (PPI)", index: "Fed Policy Sentiment" },
      { id: "LNS14000000", name: "US Unemployment Rate",          index: "United States Sentiment" },
    ];

    const resp = await fetch(
      `/api/data-proxy?url=${encodeURIComponent("https://api.bls.gov/publicAPI/v2/timeseries/data/")}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          seriesid: BLS_SERIES.map((s) => s.id),
          registrationkey: apiKey,
          startyear: "2026",
          endyear: "2026",
        }),
      },
    );
    if (!resp.ok) return;
    const data = await resp.json() as {
      Results?: {
        series?: Array<{
          seriesID: string;
          data?: Array<{ value: string; periodName: string; year: string }>;
        }>;
      };
    };
    const seriesList = data.Results?.series ?? [];

    const mapped: QueuedHeadline[] = [];
    for (const s of seriesList) {
      const meta = BLS_SERIES.find((b) => b.id === s.seriesID);
      if (!meta) continue;
      const latest = s.data?.[0];
      if (!latest?.value) continue;
      const value = Number.parseFloat(latest.value);
      if (Number.isNaN(value)) continue;

      const item: QueuedHeadline = {
        text: (() => {
            const period = `${latest.periodName} ${latest.year}`;
            if (s.seriesID === "CUUR0000SA0") return `Consumer prices read ${value.toFixed(1)} in ${period}`;
            if (s.seriesID === "WPUFD4")      return `Producer prices index at ${value.toFixed(1)} in ${period}`;
            if (s.seriesID === "LNS14000000") return `National unemployment sits at ${value.toFixed(1)}% in ${period}`;
            return `${meta.name.replace(/\(.*?\)/g, "").trim()} reads ${value.toFixed(2)} in ${period}`;
          })(),
        sourceTier: 2,
        source: "bls",
        forcedIndex: meta.index,
        sourceLabelOverride: true,
        sentimentScore: 0,
      };
      const metricKey = `bls:${s.seriesID}`;
      const blockReason = shouldBlockHeadline(item.text);
      const lastShownBls = _snapshotLastShown.get(metricKey) ?? 0;
      if (blockReason) {
        blockedHeadlines.push({ text: item.text, reason: blockReason, blockedAt: Date.now() });
      } else if (Date.now() - lastShownBls >= SNAPSHOT_DISPLAY_INTERVAL_MS) {
        mapped.push(item);
        _queue.push(item);
        _persistSnapshotLastShown(metricKey, Date.now());
      }
      saveMetricSnapshot(metricKey, value, meta.name, "BLS");
      const weeklyDeltas = getDeltaHeadlines(metricKey, value, "United States", `BLS ${meta.name}`, meta.index);
      const dailyDeltas = getDailyDeltaHeadlines(metricKey, value, "United States", `BLS ${meta.name}`, meta.index);
      const deltas = [...weeklyDeltas, ...dailyDeltas];
      for (const d of deltas) {
        const dr = shouldBlockHeadline(d.text);
        if (dr) {
          blockedHeadlines.push({ text: d.text, reason: dr, blockedAt: Date.now() });
        } else {
          const dh = d as unknown as QueuedHeadline;
          mapped.push(dh);
          _queue.push(dh);
        }
      }
    }

    if (mapped.length > 0) {
      saveHeadlinesToCache(mapped);
      console.info(`[BLSService] Enqueued ${mapped.length} BLS headlines. Queue depth: ${_queue.length}`);
    }
  } catch (err) {
    console.warn("[BLSService] BLS fetch failed.", err);
  } finally {
    _isFetchingBLS = false;
  }
}

function formatQuarterDate(str: string): string {
  return str.replace(/(\d{4})Q([1-4])/g, (_, year, q) => {
    return `Q${q} ${year}`;
  });
}

// ─── BEA (Bureau of Economic Analysis) direct fetch ──────────────────────────
async function fetchBEABatch(): Promise<void> {
  if (_isFetchingBEA) return;
  _isFetchingBEA = true;
  try {
    const apiKey = import.meta.env.VITE_BEA_API_KEY ?? "";
    if (!apiKey) return;

    const BEA_STATES: Array<{ index: string; fips: string; stateName: string }> = [
      { index: "California Sentiment", fips: "06000", stateName: "California" },
      { index: "New York Sentiment",   fips: "36000", stateName: "New York" },
      { index: "Florida Sentiment",    fips: "12000", stateName: "Florida" },
      { index: "Texas Sentiment",      fips: "48000", stateName: "Texas" },
    ];

    const mapped: QueuedHeadline[] = [];

    for (const state of BEA_STATES) {
      try {
        const url = `https://apps.bea.gov/api/data/?UserID=${apiKey}&method=GetData&datasetname=Regional&TableName=SQGDP2&LineCode=1&GeoFIPS=${state.fips}&Year=LAST5&ResultFormat=JSON`;
        const resp = await fetch(`/api/data-proxy?url=${encodeURIComponent(url)}`);
        if (!resp.ok) continue;
        const data = await resp.json() as {
          BEAAPI?: {
            Results?: {
              Data?: Array<{ DataValue: string; TimePeriod: string }>;
            };
          };
        };

        const rows = (data.BEAAPI?.Results?.Data ?? [])
          .filter((r) => r.DataValue && r.DataValue.trim() !== "")
          .sort((a, b) => b.TimePeriod.localeCompare(a.TimePeriod));

        const latest = rows[0];
        if (!latest) continue;
        const gdpFloat = Number.parseFloat(latest.DataValue.replace(/,/g, "")) / 1000;
        if (Number.isNaN(gdpFloat)) continue;

        const item: QueuedHeadline = {
          text: formatQuarterDate(`${state.stateName}'s economy produced $${gdpFloat.toFixed(1)}B in ${latest.TimePeriod}`),
          sourceTier: 2,
          source: "bea",
          forcedIndex: state.index,
          sourceLabelOverride: true,
          sentimentScore: 0,
        };
        const blockReason = shouldBlockHeadline(item.text);
        if (blockReason) {
          blockedHeadlines.push({ text: item.text, reason: blockReason, blockedAt: Date.now() });
        } else {
          mapped.push(item);
          _queue.push(item);
        }

        const metricKey = `bea:${state.index}:gdp`;
        saveMetricSnapshot(metricKey, gdpFloat, `${state.stateName} state GDP`, "BEA");
        const weeklyDeltas = getDeltaHeadlines(metricKey, gdpFloat, state.stateName, "BEA state GDP", state.index);
        const dailyDeltas = getDailyDeltaHeadlines(metricKey, gdpFloat, state.stateName, "BEA state GDP", state.index);
        const deltas = [...weeklyDeltas, ...dailyDeltas];
        for (const d of deltas) {
          const dr = shouldBlockHeadline(d.text);
          if (dr) {
            blockedHeadlines.push({ text: d.text, reason: dr, blockedAt: Date.now() });
          } else {
            const dh = d as unknown as QueuedHeadline;
            mapped.push(dh);
            _queue.push(dh);
          }
        }
      } catch { /* skip this state */ }
    }

    if (mapped.length > 0) {
      saveHeadlinesToCache(mapped);
      console.info(`[BEAService] Enqueued ${mapped.length} BEA regional GDP headlines. Queue depth: ${_queue.length}`);
    }
  } catch (err) {
    console.warn("[BEAService] BEA fetch failed.", err);
  } finally {
    _isFetchingBEA = false;
  }
}

// ─── World Bank batch fetch ───────────────────────────────────────────────────
async function fetchWorldBankBatch(): Promise<void> {
  if (_isFetchingWorldBank) return;
  _isFetchingWorldBank = true;
  try {
    const INDICATORS: Array<{ code: string; label: string }> = [
      { code: "NY.GDP.MKTP.KD.ZG", label: "GDP growth (annual %)" },
      { code: "FP.CPI.TOTL.ZG",    label: "Inflation, consumer prices (annual %)" },
      { code: "SL.UEM.TOTL.ZS",    label: "Unemployment rate (% of labor force)" },
    ];
    const COUNTRIES: Array<{ code: string; name: string; index: string }> = [
      { code: "DEU", name: "Germany", index: "Germany Sentiment" },
      { code: "CHN", name: "China",   index: "China Sentiment" },
    ];

    const mapped: QueuedHeadline[] = [];

    for (const country of COUNTRIES) {
      for (const indicator of INDICATORS) {
        try {
          const url = `https://api.worldbank.org/v2/country/${country.code}/indicator/${indicator.code}?format=json&per_page=5`;
          const resp = await fetch(`/api/data-proxy?url=${encodeURIComponent(url)}`);
          if (!resp.ok) { await new Promise((r) => setTimeout(r, 300)); continue; }
          const raw = await resp.json() as [unknown, Array<{ value: number | null; date: string }> | undefined];
          const records = raw[1] ?? [];
          const latest = records.find((r) => r.value !== null && r.value !== undefined);
          if (!latest || latest.value === null) { await new Promise((r) => setTimeout(r, 300)); continue; }

          const item: QueuedHeadline = {
            text: (() => {
              const val = latest.value;
              const year = latest.date;
              if (indicator.code === "NY.GDP.MKTP.KD.ZG") return formatQuarterDate(`${country.name}'s economy ${val >= 0 ? "grew" : "contracted"} ${Math.abs(val).toFixed(1)}% in ${year}`);
              if (indicator.code === "FP.CPI.TOTL.ZG")    return formatQuarterDate(`${country.name}'s inflation ran at ${val.toFixed(1)}% in ${year}`);
              if (indicator.code === "SL.UEM.TOTL.ZS")    return formatQuarterDate(`${country.name}'s unemployment stood at ${val.toFixed(1)}% in ${year}`);
              return formatQuarterDate(`${country.name} ${indicator.label.toLowerCase().replace(/\(.*?\)/g, "").trim()} at ${val.toFixed(2)} for ${year}`);
            })(),
            sourceTier: 2,
            source: "worldbank",
            forcedIndex: country.index,
            sourceLabelOverride: true,
            sentimentScore: 0,
          };
          const blockReason = shouldBlockHeadline(item.text);
          if (blockReason) {
            blockedHeadlines.push({ text: item.text, reason: blockReason, blockedAt: Date.now() });
          } else {
            mapped.push(item);
            _queue.push(item);
          }

          const metricKey = `worldbank:${country.code}:${indicator.code}`;
          saveMetricSnapshot(metricKey, latest.value, `${country.name} ${indicator.label}`, "World Bank");
          const weeklyDeltas = getDeltaHeadlines(metricKey, latest.value, country.name, `World Bank ${indicator.label}`, country.index);
          const dailyDeltas = getDailyDeltaHeadlines(metricKey, latest.value, country.name, `World Bank ${indicator.label}`, country.index);
          const deltas = [...weeklyDeltas, ...dailyDeltas];
          for (const d of deltas) {
            const dr = shouldBlockHeadline(d.text);
            if (dr) {
              blockedHeadlines.push({ text: d.text, reason: dr, blockedAt: Date.now() });
            } else {
              const dh = d as unknown as QueuedHeadline;
              mapped.push(dh);
              _queue.push(dh);
            }
          }
        } catch { /* skip this combo */ }
        await new Promise((r) => setTimeout(r, 300));
      }
    }

    if (mapped.length > 0) {
      saveHeadlinesToCache(mapped);
      console.info(`[WorldBankService] Enqueued ${mapped.length} World Bank headlines. Queue depth: ${_queue.length}`);
    }
  } catch (err) {
    console.warn("[WorldBankService] World Bank fetch failed.", err);
  } finally {
    _isFetchingWorldBank = false;
  }
}

// ─── NBS China batch fetch ────────────────────────────────────────────────────
async function fetchNBSChinaBatch(): Promise<void> {
  if (_isFetchingNBSChina) return;
  _isFetchingNBSChina = true;
  try {
    const DATASETS: Array<{ slug: string; label: string }> = [
      { slug: "china-gdp", label: "China GDP" },
      { slug: "china-cpi", label: "China CPI (Consumer Price Index)" },
    ];

    const mapped: QueuedHeadline[] = [];

    for (const dataset of DATASETS) {
      try {
        const url = `https://chinadata.live/api/v2/data/${dataset.slug}`;
        const resp = await fetch(`/api/data-proxy?url=${encodeURIComponent(url)}`);
        if (!resp.ok) { await new Promise((r) => setTimeout(r, 500)); continue; }
        const raw = await resp.json() as {
          data?: { data?: Array<{ date: string; value: number | string }>; unit?: string };
        };
        const points = raw.data?.data ?? [];
        const unit = raw.data?.unit ?? "";
        if (!points.length) { await new Promise((r) => setTimeout(r, 500)); continue; }

        const latest = points[points.length - 1];
        if (!latest) { await new Promise((r) => setTimeout(r, 500)); continue; }
        const numericValue = typeof latest.value === "string"
          ? Number.parseFloat(latest.value)
          : latest.value;
        if (Number.isNaN(numericValue)) { await new Promise((r) => setTimeout(r, 500)); continue; }

        const item: QueuedHeadline = {
          text: (() => {
            const d = latest.date;
            if (dataset.slug === "china-gdp") {
              if (numericValue > 50 || numericValue < -30) {
                console.warn(`[NBSChina] Sanity check failed: ${numericValue} — skipping`);
                return null as unknown as string;
              }
              const trillions = (numericValue / 10000).toFixed(2);
              return `China's economy reached ${trillions} trillion CNY in ${d}`;
            }
            if (dataset.slug === "china-cpi") return `China consumer prices held at ${numericValue.toFixed(1)} in ${d} per NBS data`;
            return `China ${dataset.label.replace(/\(.*?\)/g, "").trim().toLowerCase()} at ${numericValue.toFixed(2)} as of ${d}`;
          })(),
          sourceTier: 2,
          source: "nbschina",
          forcedIndex: "China Sentiment",
          sourceLabelOverride: true,
          sentimentScore: 0,
        };
        if (!item.text) { await new Promise((r) => setTimeout(r, 500)); continue; }
        const blockReason = shouldBlockHeadline(item.text);
        if (blockReason) {
          blockedHeadlines.push({ text: item.text, reason: blockReason, blockedAt: Date.now() });
        } else {
          mapped.push(item);
          _queue.push(item);
        }

        const metricKey = `nbschina:${dataset.slug}`;
        saveMetricSnapshot(metricKey, numericValue, dataset.label, "NBS China");
        const weeklyDeltas = getDeltaHeadlines(metricKey, numericValue, "China", `NBS China ${dataset.label}`, "China Sentiment");
        const dailyDeltas = getDailyDeltaHeadlines(metricKey, numericValue, "China", `NBS China ${dataset.label}`, "China Sentiment");
        const deltas = [...weeklyDeltas, ...dailyDeltas];
        for (const d of deltas) {
          const dr = shouldBlockHeadline(d.text);
          if (dr) {
            blockedHeadlines.push({ text: d.text, reason: dr, blockedAt: Date.now() });
          } else {
            const dh = d as unknown as QueuedHeadline;
            mapped.push(dh);
            _queue.push(dh);
          }
        }
      } catch { /* skip this dataset */ }
      await new Promise((r) => setTimeout(r, 500));
    }

    if (mapped.length > 0) {
      saveHeadlinesToCache(mapped);
      console.info(`[NBSChinaService] Enqueued ${mapped.length} NBS China headlines. Queue depth: ${_queue.length}`);
    }
  } catch (err) {
    console.warn("[NBSChinaService] NBS China fetch failed.", err);
  } finally {
    _isFetchingNBSChina = false;
  }
}

// ─── API-Sports Soccer batch fetch ───────────────────────────────────────────
async function fetchAPISportsSoccerBatch(): Promise<void> {
  if (_isFetchingAPISportsSoccer) return;
  _isFetchingAPISportsSoccer = true;
  try {
    const apiKey = import.meta.env.VITE_APISPORTS_KEY ?? "";
    if (!apiKey) return;

    const SOCCER_TEAMS: Array<{ teamId: number; name: string; index: string }> = [
      { teamId: 529, name: "FC Barcelona",        index: "FC Barcelona Sentiment" },
      { teamId: 541, name: "Real Madrid CF",       index: "Real Madrid CF Sentiment" },
      { teamId: 2,   name: "France National Team", index: "France National Team Sentiment" },
      { teamId: 9,   name: "Spain National Team",  index: "Spain National Team Sentiment" },
    ];

    const headers = { "x-apisports-key": apiKey };
    const mapped: QueuedHeadline[] = [];

    for (const team of SOCCER_TEAMS) {
      try {
        // Call 1 — last 5 fixtures
        const fixtResp = await fetch(
          `/api/data-proxy?url=${encodeURIComponent(`https://v3.football.api-sports.io/fixtures?team=${team.teamId}&last=5`)}`,
          { headers },
        );
        if (fixtResp.ok) {
          const fixtData = await fixtResp.json() as {
            response?: Array<{
              fixture: { date: string; status: { short: string } };
              league: { name: string };
              teams: { home: { id: number; name: string }; away: { id: number; name: string } };
              goals: { home: number | null; away: number | null };
            }>;
          };
          for (const fix of fixtData.response ?? []) {
            if (fix.fixture.status.short !== "FT") continue;
            const isHome = fix.teams.home.id === team.teamId;
            const opponent = isHome ? fix.teams.away.name : fix.teams.home.name;
            const scored = isHome ? (fix.goals.home ?? 0) : (fix.goals.away ?? 0);
            const conceded = isHome ? (fix.goals.away ?? 0) : (fix.goals.home ?? 0);
            const date = fix.fixture.date.slice(0, 10);
            let text: string;
            let sentimentScore: number;
            const shortName = team.name.replace(/^FC\s+/i, "").replace(/\s+CF$/i, "").replace(/\s+National Team$/i, "");
            if (scored > conceded) {
              text = `${shortName} beat ${opponent} ${scored}-${conceded}`;
              sentimentScore = 0.85;
            } else if (scored < conceded) {
              text = `${shortName} fell to ${opponent} ${conceded}-${scored}`;
              sentimentScore = -0.85;
            } else {
              text = `${shortName} and ${opponent} shared the points in a ${scored}-${conceded} draw`;
              sentimentScore = 0;
            }
            const item: QueuedHeadline = {
              text,
              sourceTier: 2,
              source: "apisports-soccer",
              forcedIndex: team.index,
              sourceLabelOverride: true,
              sentimentScore,
            };
            const br = shouldBlockHeadline(item.text);
            if (br) { blockedHeadlines.push({ text: item.text, reason: br, blockedAt: Date.now() }); }
            else { mapped.push(item); _queue.push(item); }
          }
        }

        // Call 2 — next fixture
        const nextResp = await fetch(
          `/api/data-proxy?url=${encodeURIComponent(`https://v3.football.api-sports.io/fixtures?team=${team.teamId}&next=1`)}`,
          { headers },
        );
        if (nextResp.ok) {
          const nextData = await nextResp.json() as {
            response?: Array<{
              fixture: { date: string };
              league: { name: string };
              teams: { home: { name: string }; away: { name: string } };
            }>;
          };
          const next = nextData.response?.[0];
          if (next) {
            const date = next.fixture.date.slice(0, 10);
            const item: QueuedHeadline = {
              text: `${next.teams.home.name} host ${next.teams.away.name} next in ${next.league.name}`,
              sourceTier: 2,
              source: "apisports-soccer",
              forcedIndex: team.index,
              sourceLabelOverride: true,
              sentimentScore: 0,
            };
            const br = shouldBlockHeadline(item.text);
            if (br) { blockedHeadlines.push({ text: item.text, reason: br, blockedAt: Date.now() }); }
            else { mapped.push(item); _queue.push(item); }
          }
        }
      } catch { /* skip this team */ }
      await new Promise((r) => setTimeout(r, 500));
    }

    if (mapped.length > 0) {
      saveHeadlinesToCache(mapped);
      console.info(`[APISportsSoccerService] Enqueued ${mapped.length} soccer headlines. Queue depth: ${_queue.length}`);
    }
  } catch (err) {
    console.warn("[APISportsSoccerService] fetch failed.", err);
  } finally {
    _isFetchingAPISportsSoccer = false;
  }
}

// ─── API-Sports NFL batch fetch ───────────────────────────────────────────────
async function fetchAPISportsNFLBatch(): Promise<void> {
  if (_isFetchingAPISportsNFL) return;
  _isFetchingAPISportsNFL = true;
  try {
    const apiKey = import.meta.env.VITE_APISPORTS_KEY ?? "";
    if (!apiKey) return;

    const NFL_TEAMS: Array<{ teamId: number; name: string; index: string }> = [
      { teamId: 17, name: "Kansas City Chiefs", index: "Kansas City Chiefs Sentiment" },
      { teamId: 28, name: "Denver Broncos",     index: "Denver Broncos Sentiment" },
    ];

    const headers = { "x-apisports-key": apiKey };
    const mapped: QueuedHeadline[] = [];

    for (const team of NFL_TEAMS) {
      try {
        // Call 1 — recent games
        const gamesResp = await fetch(
          `/api/data-proxy?url=${encodeURIComponent(`https://v1.american-football.api-sports.io/games?team=${team.teamId}&season=2025&league=1`)}`,
          { headers },
        );
        if (gamesResp.ok) {
          const gamesData = await gamesResp.json() as {
            response?: Array<{
              game: { date: { date: string }; status: { short: string } };
              teams: { home: { id: number; name: string }; away: { id: number; name: string } };
              scores: { home: { total: number | null }; away: { total: number | null } };
            }>;
          };
          const finished = (gamesData.response ?? [])
            .filter((g) => g.game.status.short === "FT" || g.game.status.short === "F")
            .sort((a, b) => b.game.date.date.localeCompare(a.game.date.date))
            .slice(0, 5);

          for (const game of finished) {
            const isHome = game.teams.home.id === team.teamId;
            const opponent = isHome ? game.teams.away.name : game.teams.home.name;
            const scored = isHome ? (game.scores.home.total ?? 0) : (game.scores.away.total ?? 0);
            const conceded = isHome ? (game.scores.away.total ?? 0) : (game.scores.home.total ?? 0);
            const date = game.game.date.date;
            let text: string;
            let sentimentScore: number;
            if (scored > conceded) {
              text = `${team.name} beat ${opponent} ${scored}-${conceded}`;
              sentimentScore = 0.85;
            } else if (scored < conceded) {
              text = `${team.name} fell to ${opponent} ${conceded}-${scored}`;
              sentimentScore = -0.85;
            } else {
              text = `${team.name} and ${opponent} tied ${scored}-${conceded}`;
              sentimentScore = 0;
            }
            const item: QueuedHeadline = {
              text, sourceTier: 2, source: "apisports-nfl",
              forcedIndex: team.index, sourceLabelOverride: true, sentimentScore,
            };
            const br = shouldBlockHeadline(item.text);
            if (br) { blockedHeadlines.push({ text: item.text, reason: br, blockedAt: Date.now() }); }
            else { mapped.push(item); _queue.push(item); }
          }
        }

        await new Promise((r) => setTimeout(r, 500));

        // Call 2 — standings
        const standResp = await fetch(
          `/api/data-proxy?url=${encodeURIComponent(`https://v1.american-football.api-sports.io/standings?team=${team.teamId}&season=2025&league=1`)}`,
          { headers },
        );
        if (standResp.ok) {
          const standData = await standResp.json() as {
            response?: Array<Array<{
              won: number; lost: number; pct: string; position: number;
              group: { name: string };
            }>>;
          };
          const entry = standData.response?.[0]?.[0];
          if (entry) {
            const { won, lost, pct, position } = entry;
            const divisionName = entry.group?.name ?? "division";
            const winRate = won / Math.max(won + lost, 1);
            const trend = winRate >= 0.6 ? "strong" : winRate < 0.4 ? "struggling" : "average";
            const sentimentScore = winRate >= 0.6 ? 0.82 : winRate < 0.4 ? -0.82 : 0;
            const item: QueuedHeadline = {
              text: position === 1
                ? `${team.name} lead the ${divisionName} at ${won}-${lost} in the 2025 season`
                : winRate >= 0.6
                  ? `${team.name} sit at ${won}-${lost} in the ${divisionName}, in strong form`
                  : winRate < 0.4
                    ? `${team.name} are ${won}-${lost} in the ${divisionName}, looking for a turnaround`
                    : `${team.name} are ${won}-${lost} in the ${divisionName} at the midpoint of the season`,
              sourceTier: 2, source: "apisports-nfl",
              forcedIndex: team.index, sourceLabelOverride: true, sentimentScore,
            };
            const br = shouldBlockHeadline(item.text);
            if (br) { blockedHeadlines.push({ text: item.text, reason: br, blockedAt: Date.now() }); }
            else { mapped.push(item); _queue.push(item); }
          }
        }
      } catch { /* skip this team */ }
      await new Promise((r) => setTimeout(r, 500));
    }

    // Patrick Mahomes stats
    try {
      const statsResp = await fetch(
        `/api/data-proxy?url=${encodeURIComponent("https://v1.american-football.api-sports.io/players/statistics?id=1197&season=2025")}`,
        { headers },
      );
      if (statsResp.ok) {
        const statsData = await statsResp.json() as {
          response?: Array<{
            statistics?: Array<{
              passing?: { touchdowns?: { total?: number }; interceptions?: { total?: number }; yards?: { total?: number }; rating?: { total?: number } };
            }>;
          }>;
        };
        const stats = statsData.response?.[0]?.statistics?.[0]?.passing;
        if (stats) {
          const tds = stats.touchdowns?.total ?? 0;
          const ints = stats.interceptions?.total ?? 0;
          const yards = stats.yards?.total ?? 0;
          const rating = stats.rating?.total ?? 0;
          if (yards > 0) {
            const sentimentScore = rating >= 95 ? 0.82 : 0;
            const item: QueuedHeadline = {
              text: `Mahomes has thrown for ${yards.toLocaleString()} yards with ${tds} touchdowns and ${ints} interceptions in 2025`,
              sourceTier: 2, source: "apisports-nfl",
              forcedIndex: "Patrick Mahomes Sentiment", sourceLabelOverride: true, sentimentScore,
            };
            const br = shouldBlockHeadline(item.text);
            if (br) { blockedHeadlines.push({ text: item.text, reason: br, blockedAt: Date.now() }); }
            else { mapped.push(item); _queue.push(item); }
          }
        }
      }
    } catch { /* skip mahomes */ }

    if (mapped.length > 0) {
      saveHeadlinesToCache(mapped);
      console.info(`[APISportsNFLService] Enqueued ${mapped.length} NFL headlines. Queue depth: ${_queue.length}`);
    }
  } catch (err) {
    console.warn("[APISportsNFLService] fetch failed.", err);
  } finally {
    _isFetchingAPISportsNFL = false;
  }
}

// ─── API-Sports F1 batch fetch ────────────────────────────────────────────────
async function fetchAPISportsF1Batch(): Promise<void> {
  if (_isFetchingAPISportsF1) return;
  _isFetchingAPISportsF1 = true;
  try {
    const apiKey = import.meta.env.VITE_APISPORTS_KEY ?? "";
    if (!apiKey) return;

    const F1_CONSTRUCTORS: Array<{ constructorId: number; name: string; index: string }> = [
      { constructorId: 3, name: "Ferrari",   index: "Ferrari Sentiment" },
      { constructorId: 2, name: "McLaren",   index: "McLaren Sentiment" },
      { constructorId: 5, name: "Mercedes",  index: "Mercedes Sentiment" },
    ];

    const headers = { "x-apisports-key": apiKey };
    const mapped: QueuedHeadline[] = [];
    const constructorSet = new Set(F1_CONSTRUCTORS.map((c) => c.constructorId));

    // Call 1 — constructor standings
    try {
      const standResp = await fetch(
        `/api/data-proxy?url=${encodeURIComponent("https://v1.formula-1.api-sports.io/rankings/teams?season=2026")}`,
        { headers },
      );
      if (standResp.ok) {
        const standData = await standResp.json() as {
          response?: Array<{
            team: { id: number; name: string };
            position: number;
            points: number;
            wins: number;
          }>;
        };
        for (const entry of standData.response ?? []) {
          if (!constructorSet.has(entry.team.id)) continue;
          const meta = F1_CONSTRUCTORS.find((c) => c.constructorId === entry.team.id);
          if (!meta) continue;
          const { position: pos, points, wins } = entry;
          const positionLabel = pos === 1 ? "leading" : pos <= 3 ? "contending" : pos <= 6 ? "midfield" : "trailing";
          const sentimentScore = pos <= 3 ? 0.85 : pos <= 6 ? 0 : -0.85;
          const item: QueuedHeadline = {
            text: pos === 1
              ? `${meta.name} lead the 2026 F1 constructors' championship with ${points} points`
              : pos <= 3
                ? `${meta.name} are P${pos} in the 2026 constructors' championship with ${points} points`
                : `${meta.name} sit P${pos} in the 2026 F1 standings with ${points} points from ${wins} wins`,
            sourceTier: 2, source: "apisports-f1",
            forcedIndex: meta.index, sourceLabelOverride: true, sentimentScore,
          };
          const br = shouldBlockHeadline(item.text);
          if (br) { blockedHeadlines.push({ text: item.text, reason: br, blockedAt: Date.now() }); }
          else { mapped.push(item); _queue.push(item); }

          const metricKey = `apisports:f1:${meta.index}:constructor_pos`;
          saveMetricSnapshot(metricKey, pos, `${meta.name} F1 constructor position`, "API-Sports F1");
          const weeklyDeltas = getDeltaHeadlines(metricKey, pos, meta.name, "API-Sports F1 constructor position", meta.index);
          const dailyDeltas = getDailyDeltaHeadlines(metricKey, pos, meta.name, "API-Sports F1 constructor position", meta.index);
          const deltas = [...weeklyDeltas, ...dailyDeltas];
          for (const d of deltas) {
            const dr = shouldBlockHeadline(d.text);
            if (dr) { blockedHeadlines.push({ text: d.text, reason: dr, blockedAt: Date.now() }); }
            else { const dh = d as unknown as QueuedHeadline; mapped.push(dh); _queue.push(dh); }
          }
        }
      }
    } catch { /* skip standings */ }

    await new Promise((r) => setTimeout(r, 500));

    // Call 2 — recent race results
    try {
      const racesResp = await fetch(
        `/api/data-proxy?url=${encodeURIComponent("https://v1.formula-1.api-sports.io/rankings/races?season=2026")}`,
        { headers },
      );
      if (racesResp.ok) {
        const racesData = await racesResp.json() as {
          response?: Array<{
            race: { name: string };
            driver: { name: string };
            team: { id: number };
            position: number;
            points: number;
          }>;
        };
        const allResults = racesData.response ?? [];
        // group by race name, take last 3 unique races
        const raceNames: string[] = [];
        for (const r of allResults) {
          if (!raceNames.includes(r.race.name)) raceNames.push(r.race.name);
        }
        const last3Races = raceNames.slice(-3);

        for (const raceName of last3Races) {
          const raceResults = allResults.filter((r) => r.race.name === raceName);
          for (const result of raceResults) {
            if (!constructorSet.has(result.team.id)) continue;
            const meta = F1_CONSTRUCTORS.find((c) => c.constructorId === result.team.id);
            if (!meta) continue;
            const pos = result.position;
            let resultLabel: string;
            let sentimentScore: number;
            if (pos <= 3) { resultLabel = `podium finish (P${pos})`; sentimentScore = 0.85; }
            else if (pos <= 10) { resultLabel = `points finish (P${pos})`; sentimentScore = 0.82; }
            else { resultLabel = `out of points (P${pos})`; sentimentScore = -0.85; }
            const item: QueuedHeadline = {
              text: pos <= 3
                ? `${result.driver.name} took a podium for ${meta.name} at the ${raceName}, finishing P${pos}`
                : pos <= 10
                  ? `${result.driver.name} scored points for ${meta.name} at the ${raceName} with a P${pos} finish`
                  : `${result.driver.name} finished outside the points for ${meta.name} at the ${raceName}`,
              sourceTier: 2, source: "apisports-f1",
              forcedIndex: meta.index, sourceLabelOverride: true, sentimentScore,
            };
            const br = shouldBlockHeadline(item.text);
            if (br) { blockedHeadlines.push({ text: item.text, reason: br, blockedAt: Date.now() }); }
            else { mapped.push(item); _queue.push(item); }
          }
        }
      }
    } catch { /* skip races */ }

    if (mapped.length > 0) {
      saveHeadlinesToCache(mapped);
      console.info(`[APISportsF1Service] Enqueued ${mapped.length} F1 headlines. Queue depth: ${_queue.length}`);
    }
  } catch (err) {
    console.warn("[APISportsF1Service] fetch failed.", err);
  } finally {
    _isFetchingAPISportsF1 = false;
  }
}

// ─── FotMob live match batch fetch ────────────────────────────────────────────
async function fetchFotMobBatch(): Promise<void> {
  if (_isFetchingFotMob) return;
  _isFetchingFotMob = true;
  try {
    const FOTMOB_TEAMS: Record<number, { name: string; index: string }> = {
      242: { name: "FC Barcelona",        index: "FC Barcelona Sentiment" },
      86:  { name: "Real Madrid CF",      index: "Real Madrid CF Sentiment" },
      37:  { name: "France National Team",index: "France National Team Sentiment" },
      45:  { name: "Spain National Team", index: "Spain National Team Sentiment" },
    };

    const fotmobHeaders = {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      "Accept": "application/json, text/plain, */*",
      "Accept-Language": "en-US,en;q=0.9",
      "Referer": "https://www.fotmob.com/",
      "Origin": "https://www.fotmob.com",
    };

    const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const endpoints = [
      `https://www.fotmob.com/api/matches?date=${today}`,
      `https://www.fotmob.com/api/v2/matches?date=${today}`,
      `https://www.fotmob.com/api/data/matches?date=${today}`,
    ];

    type FotMobMatchesResponse = {
      leagues?: Array<{
        matches?: Array<{
          id: number | string;
          home: { id: number; name: string };
          away: { id: number; name: string };
          status: { finished?: boolean; ongoing?: boolean };
          home_score?: { current?: number };
          away_score?: { current?: number };
          leagueName?: string;
        }>;
        name?: string;
      }>;
    };

    let matchesData: FotMobMatchesResponse | null = null;

    for (const endpoint of endpoints) {
      try {
        const resp = await fetch(endpoint, { headers: fotmobHeaders });
        if (resp.ok) {
          matchesData = await resp.json() as FotMobMatchesResponse;
          console.info(`[FotMobService] Success via ${endpoint}`);
          break;
        }
      } catch { /* try next endpoint */ }
    }

    if (!matchesData) {
      console.warn(`[FotMobService] All endpoints failed for date ${today} — FotMob may have changed their API structure`);
      return;
    }

    const mapped: QueuedHeadline[] = [];
    const trackedIds = new Set(Object.keys(FOTMOB_TEAMS).map(Number));

    for (const league of matchesData.leagues ?? []) {
      const leagueName = league.name ?? "Unknown League";
      for (const match of league.matches ?? []) {
        const homeId = match.home?.id;
        const awayId = match.away?.id;
        const matchedId = trackedIds.has(homeId) ? homeId : trackedIds.has(awayId) ? awayId : null;
        if (matchedId === null) continue;
        const meta = FOTMOB_TEAMS[matchedId];
        if (!meta) continue;

        const isHome = homeId === matchedId;
        const homeName = match.home?.name ?? "";
        const awayName = match.away?.name ?? "";
        const homeScore = match.home_score?.current ?? 0;
        const awayScore = match.away_score?.current ?? 0;
        const scored = isHome ? homeScore : awayScore;
        const conceded = isHome ? awayScore : homeScore;
        const opponent = isHome ? awayName : homeName;

        if (match.status?.finished) {
          let text: string;
          let sentimentScore: number;
          const shortName = meta.name.replace(/^FC\s+/i, "").replace(/\s+CF$/i, "").replace(/\s+National Team$/i, "");
          if (scored > conceded) {
            text = `${shortName} beat ${opponent} ${scored}-${conceded} in ${leagueName}`;
            sentimentScore = 0.85;
          } else if (scored < conceded) {
            text = `${shortName} fell to ${opponent} ${conceded}-${scored} in ${leagueName}`;
            sentimentScore = -0.85;
          } else {
            text = `${shortName} and ${opponent} drew ${scored}-${conceded} in ${leagueName}`;
            sentimentScore = 0;
          }
          const item: QueuedHeadline = {
            text, sourceTier: 2, source: "fotmob",
            forcedIndex: meta.index, sourceLabelOverride: true, sentimentScore,
          };
          const br = shouldBlockHeadline(item.text);
          if (br) { blockedHeadlines.push({ text: item.text, reason: br, blockedAt: Date.now() }); }
          else { mapped.push(item); _queue.push(item); }

          // Fetch match details for stats
          try {
            const detailResp = await fetch(
              `https://www.fotmob.com/api/matchDetails?matchId=${match.id}`,
              { headers: fotmobHeaders },
            );
            if (detailResp.ok) {
              const detail = await detailResp.json() as {
                stats?: Array<{
                  stats?: Array<{
                    title?: string;
                    stats?: Array<{ home?: string | number; away?: string | number }>;
                  }>;
                }>;
              };
              for (const statGroup of detail.stats ?? []) {
                for (const statItem of statGroup.stats ?? []) {
                  const title = (statItem.title ?? "").toLowerCase();
                  const statValues = statItem.stats?.[0];
                  if (!statValues) continue;
                  const homeVal = statValues.home;
                  const awayVal = statValues.away;
                  if (homeVal === undefined || awayVal === undefined) continue;

                  let statText: string | null = null;
                  if (title === "possession") {
                    statText = `${homeName} controlled ${homeVal}% of the ball against ${awayName} in ${leagueName}`;
                  } else if (title.includes("expected goals") || title === "xg") {
                    const hxg = Number.parseFloat(String(homeVal));
                    const axg = Number.parseFloat(String(awayVal));
                    if (!Number.isNaN(hxg) && !Number.isNaN(axg)) {
                      const dominant = hxg >= axg ? homeName : awayName;
                      const higher = Math.max(hxg, axg).toFixed(1);
                      const lower = Math.min(hxg, axg).toFixed(1);
                      statText = `${dominant} created ${higher} expected goals to ${lower} in ${leagueName}`;
                    }
                  } else if (title === "shots on target") {
                    statText = `${homeName} had ${homeVal} shots on target to ${awayName}'s ${awayVal} in ${leagueName}`;
                  } else if (title === "big chances") {
                    statText = `${homeName} created ${homeVal} big chances against ${awayName}'s ${awayVal} in ${leagueName}`;
                  }
                  if (!statText) continue;
                  const statItem2: QueuedHeadline = {
                    text: statText, sourceTier: 2, source: "fotmob",
                    forcedIndex: meta.index, sourceLabelOverride: true, sentimentScore: 0,
                  };
                  const br2 = shouldBlockHeadline(statItem2.text);
                  if (br2) { blockedHeadlines.push({ text: statItem2.text, reason: br2, blockedAt: Date.now() }); }
                  else { mapped.push(statItem2); _queue.push(statItem2); }
                }
              }
            }
          } catch { /* skip detail stats */ }
          await new Promise((r) => setTimeout(r, 200));

        } else if (match.status?.ongoing) {
          const item: QueuedHeadline = {
            text: `${homeName} and ${awayName} are live in ${leagueName}, ${homeScore}-${awayScore}`,
            sourceTier: 2, source: "fotmob",
            forcedIndex: meta.index, sourceLabelOverride: true, sentimentScore: 0,
          };
          const br = shouldBlockHeadline(item.text);
          if (br) { blockedHeadlines.push({ text: item.text, reason: br, blockedAt: Date.now() }); }
          else { mapped.push(item); _queue.push(item); }
        }
      }
    }

    if (mapped.length > 0) {
      saveHeadlinesToCache(mapped);
      console.info(`[FotMobService] Enqueued ${mapped.length} FotMob headlines. Queue depth: ${_queue.length}`);
    }
  } catch (err) {
    console.warn("[FotMobService] fetch failed.", err);
  } finally {
    _isFetchingFotMob = false;
  }
}

// ─── College Scorecard batch fetch ───────────────────────────────────────────
async function fetchCollegeScorecardBatch(): Promise<void> {
  if (_isFetchingCollegeScorecard) return;
  _isFetchingCollegeScorecard = true;
  try {
    const apiKey = import.meta.env.VITE_COLLEGE_SCORECARD_KEY ?? "";
    if (!apiKey) return;

    const UNIVERSITIES: Array<{ unitId: number; name: string; index: string }> = [
      { unitId: 170976, name: "University of Michigan", index: "University of Michigan Sentiment" },
      { unitId: 204796, name: "Ohio State University",  index: "Ohio State University Sentiment" },
      { unitId: 130794, name: "Yale University",        index: "Yale University Sentiment" },
      { unitId: 166027, name: "Harvard University",     index: "Harvard University Sentiment" },
    ];

    const US_NEWS_RANKS: Record<string, { rank: number }> = {
      "University of Michigan Sentiment": { rank: 21 },
      "Ohio State University Sentiment":  { rank: 35 },
      "Yale University Sentiment":        { rank: 5 },
      "Harvard University Sentiment":     { rank: 3 },
    };

    const ENDOWMENTS: Record<string, { val: number }> = {
      "University of Michigan Sentiment": { val: 18.6 },
      "Ohio State University Sentiment":  { val: 9.7 },
      "Yale University Sentiment":        { val: 41.4 },
      "Harvard University Sentiment":     { val: 53.2 },
    };

    const fields = [
      "school.name",
      "latest.admissions.admission_rate.overall",
      "latest.student.size",
      "latest.completion.completion_rate_4yr_150_pooled",
      "latest.earnings.10_yrs_after_entry.median",
      "latest.cost.avg_net_price.public",
      "latest.cost.avg_net_price.private",
    ].join(",");

    const mapped: QueuedHeadline[] = [];

    const enqueueItem = (item: QueuedHeadline) => {
      const br = shouldBlockHeadline(item.text);
      if (br) { blockedHeadlines.push({ text: item.text, reason: br, blockedAt: Date.now() }); }
      else { mapped.push(item); _queue.push(item); }
    };

    for (const uni of UNIVERSITIES) {
      try {
        const url = `https://api.data.gov/ed/collegescorecard/v1/schools?api_key=${apiKey}&id=${uni.unitId}&fields=${fields}&_per_page=1`;
        const resp = await fetch(`/api/data-proxy?url=${encodeURIComponent(url)}`);
        if (resp.ok) {
          const data = await resp.json() as {
            results?: Array<{
              "school.name"?: string;
              "latest.admissions.admission_rate.overall"?: number | null;
              "latest.student.size"?: number | null;
              "latest.completion.completion_rate_4yr_150_pooled"?: number | null;
              "latest.earnings.10_yrs_after_entry.median"?: number | null;
            }>;
          };
          const r = data.results?.[0];
          if (r) {
            const schoolName = r["school.name"] ?? uni.name;

            const admRate = r["latest.admissions.admission_rate.overall"];
            if (admRate !== null && admRate !== undefined && !Number.isNaN(admRate)) {
              const admPct = admRate * 100;
              const selectivity = admPct < 10 ? "highly selective" : admPct < 25 ? "selective" : admPct < 50 ? "moderately selective" : "accessible";
              enqueueItem({
                text: `${schoolName} admits ${admPct.toFixed(1)}% of applicants, making it ${selectivity}`,
                sourceTier: 2, source: "scorecard",
                forcedIndex: uni.index, sourceLabelOverride: true,
                sentimentScore: admPct < 10 ? 0.75 : 0,
              });
              const metricKey = `scorecard:${uni.index}:admission_rate`;
              saveMetricSnapshot(metricKey, admPct, `${schoolName} admission rate`, "College Scorecard");
              const weeklyDeltas = getDeltaHeadlines(metricKey, admPct, schoolName, "College Scorecard admission rate", uni.index);
              const dailyDeltas = getDailyDeltaHeadlines(metricKey, admPct, schoolName, "College Scorecard admission rate", uni.index);
              const deltas = [...weeklyDeltas, ...dailyDeltas];
              for (const d of deltas) {
                const dr = shouldBlockHeadline(d.text);
                if (dr) { blockedHeadlines.push({ text: d.text, reason: dr, blockedAt: Date.now() }); }
                else { const dh = d as unknown as QueuedHeadline; mapped.push(dh); _queue.push(dh); }
              }
            }

            const enrollment = r["latest.student.size"];
            if (enrollment !== null && enrollment !== undefined) {
              enqueueItem({
                text: `${schoolName} enrolls ${enrollment >= 10000 ? `nearly ${Math.round(enrollment / 1000)}k` : enrollment.toLocaleString()} students`,
                sourceTier: 2, source: "scorecard",
                forcedIndex: uni.index, sourceLabelOverride: true, sentimentScore: 0,
              });
            }

            const gradRate = r["latest.completion.completion_rate_4yr_150_pooled"];
            if (gradRate !== null && gradRate !== undefined && !Number.isNaN(gradRate)) {
              const gradPct = gradRate * 100;
              const perf = gradPct >= 90 ? "strong" : gradPct >= 80 ? "good" : gradPct >= 70 ? "moderate" : "concerning";
              const sentimentScore = gradPct >= 90 ? 0.75 : gradPct >= 70 ? 0 : -0.75;
              enqueueItem({
                text: `${gradPct.toFixed(0)}% of ${schoolName} students graduate within four years`,
                sourceTier: 2, source: "scorecard",
                forcedIndex: uni.index, sourceLabelOverride: true, sentimentScore,
              });
            }

            const earnings = r["latest.earnings.10_yrs_after_entry.median"];
            if (earnings !== null && earnings !== undefined) {
              enqueueItem({
                text: `${schoolName} graduates earn a median $${Math.round(earnings / 1000)}k annually a decade after enrollment`,
                sourceTier: 2, source: "scorecard",
                forcedIndex: uni.index, sourceLabelOverride: true,
                sentimentScore: earnings >= 80000 ? 0.75 : 0,
              });
            }
          }
        }
      } catch { /* skip this university */ }

      // Static US News rankings
      const rankData = US_NEWS_RANKS[uni.index];
      if (rankData) {
        const { rank } = rankData;
        const rankLabel = rank <= 5 ? "elite" : rank <= 10 ? "top-10" : rank <= 25 ? "top-25" : "top-50";
        enqueueItem({
          text: `${uni.name} ranks #${rank} nationally in the 2026 US News Best Colleges list`,
          sourceTier: 2, source: "scorecard",
          forcedIndex: uni.index, sourceLabelOverride: true,
          sentimentScore: rank <= 10 ? 0.72 : 0,
        });
      }

      // Static endowment values
      const endowData = ENDOWMENTS[uni.index];
      if (endowData) {
        const { val } = endowData;
        const tier = val >= 30 ? "mega-endowment" : val >= 10 ? "large-endowment" : "significant-endowment";
        enqueueItem({
          text: `${uni.name} holds a $${val}B endowment, among the ${val >= 30 ? "largest" : "largest"} in higher education`,
          sourceTier: 2, source: "scorecard",
          forcedIndex: uni.index, sourceLabelOverride: true,
          sentimentScore: val >= 30 ? 0.72 : 0,
        });
        const metricKey = `endowment:${uni.index}:value`;
        saveMetricSnapshot(metricKey, val, `${uni.name} endowment`, "College Scorecard");
        const weeklyDeltas = getDeltaHeadlines(metricKey, val, uni.name, "College Scorecard endowment", uni.index);
        const dailyDeltas = getDailyDeltaHeadlines(metricKey, val, uni.name, "College Scorecard endowment", uni.index);
        const deltas = [...weeklyDeltas, ...dailyDeltas];
        for (const d of deltas) {
          const dr = shouldBlockHeadline(d.text);
          if (dr) { blockedHeadlines.push({ text: d.text, reason: dr, blockedAt: Date.now() }); }
          else { const dh = d as unknown as QueuedHeadline; mapped.push(dh); _queue.push(dh); }
        }
      }

      await new Promise((r) => setTimeout(r, 500));
    }

    if (mapped.length > 0) {
      saveHeadlinesToCache(mapped);
      console.info(`[CollegeScorecardService] Enqueued ${mapped.length} college headlines. Queue depth: ${_queue.length}`);
    }
  } catch (err) {
    console.warn("[CollegeScorecardService] fetch failed.", err);
  } finally {
    _isFetchingCollegeScorecard = false;
  }
}

// ─── Forbes Real-Time Billionaires batch fetch ────────────────────────────────
async function fetchForbesBatch(): Promise<void> {
  if (_isFetchingForbes) return;
  _isFetchingForbes = true;
  try {
    const FORBES_INDEX_MAP: Record<string, string> = {
      "Elon Musk": "Elon Musk Sentiment",
      "Larry Page": "Larry Page Sentiment",
      "Sergey Brin": "Sergey Brin Sentiment",
      "Jeff Bezos": "Jeff Bezos Sentiment",
      "Michael Dell": "Michael Dell Sentiment",
      "Mark Zuckerberg": "Mark Zuckerberg Sentiment",
      "Jensen Huang": "Jensen Huang Sentiment",
      "Larry Ellison": "Larry Ellison Sentiment",
      "Bernard Arnault & Family": "Bernard Arnault Sentiment",
      "Warren Buffett": "Warren Buffett Sentiment",
    };

    const resp = await fetch(
      `/api/data-proxy?url=${encodeURIComponent("https://www.forbes.com/forbesapi/person/rtb/0/position/true.json")}`,
    );
    if (!resp.ok) return;
    const data = await resp.json() as { personList?: { personsLists?: Array<{
      personName?: string;
      finalWorth?: number;
      estWorthPrev?: number;
      position?: number;
    }> } };

    const persons = data.personList?.personsLists ?? [];

    const stored: Record<string, number> = (() => {
      try { return JSON.parse(localStorage.getItem("mt_forbes_values") ?? "{}") as Record<string, number>; }
      catch { return {}; }
    })();

    const mapped: QueuedHeadline[] = [];

    for (const person of persons) {
      const name = person.personName;
      if (!name || !(name in FORBES_INDEX_MAP)) continue;
      const forcedIndex = FORBES_INDEX_MAP[name];
      const rank = person.position ?? 0;
      const finalWorth = person.finalWorth ?? 0;
      const estWorthPrev = person.estWorthPrev ?? finalWorth;

      const net_worth_b = finalWorth / 1000;

      const rankSentiment = rank <= 3 ? 0.60 : rank <= 7 ? 0.35 : rank <= 15 ? 0.15 : rank <= 25 ? 0.00 : -0.10;
      const rankHeadline: QueuedHeadline = {
        text: `${name} net worth $${net_worth_b.toFixed(1)}B — Forbes Real-Time #${rank}`,
        sourceTier: 1,
        source: "forbes",
        forcedIndex,
        sourceLabelOverride: true,
        sentimentScore: rankSentiment,
      };
      const blockReason1 = shouldBlockHeadline(rankHeadline.text);
      if (blockReason1) {
        blockedHeadlines.push({ text: rankHeadline.text, reason: blockReason1, blockedAt: Date.now() });
      } else {
        mapped.push(rankHeadline);
        _queue.push(rankHeadline);
      }

      const prev = stored[name];
      stored[name] = finalWorth;

      if (prev !== undefined && prev !== finalWorth && estWorthPrev > 0) {
        const change_abs = (finalWorth - estWorthPrev) / 1000;
        const change_pct = ((finalWorth - estWorthPrev) / estWorthPrev) * 100;
        if (Math.abs(change_pct) >= 0.5) {
          const direction = change_abs >= 0 ? "rose" : "fell";
          // Scale: a 10% daily net-worth swing earns full sentiment weight
          const forbesSentiment = Math.max(-1, Math.min(1, change_pct / 10));
          const changeHeadline: QueuedHeadline = {
            text: `${name} net worth ${direction} $${Math.abs(change_abs).toFixed(1)}B (${change_pct >= 0 ? "+" : ""}${change_pct.toFixed(2)}%) since prior trading day per Forbes Real-Time Billionaires`,
            sourceTier: 1,
            source: "forbes",
            forcedIndex,
            sourceLabelOverride: true,
            sentimentScore: forbesSentiment,
          };
          const blockReason2 = shouldBlockHeadline(changeHeadline.text);
          if (blockReason2) {
            blockedHeadlines.push({ text: changeHeadline.text, reason: blockReason2, blockedAt: Date.now() });
          } else {
            mapped.push(changeHeadline);
            _queue.push(changeHeadline);
          }
        }
      }
    }

    try { localStorage.setItem("mt_forbes_values", JSON.stringify(stored)); } catch { /* ignore */ }

    if (mapped.length > 0) {
      saveHeadlinesToCache(mapped);
      console.info(`[ForbesService] Enqueued ${mapped.length} Forbes billionaire headlines. Queue depth: ${_queue.length}`);
    }
  } catch (err) {
    console.warn("[ForbesService] Forbes fetch failed.", err);
  } finally {
    _isFetchingForbes = false;
  }
}

// ─── Social Blade batch fetch ─────────────────────────────────────────────────
async function fetchSocialBladeBatch(): Promise<void> {
  if (_isFetchingSocialBlade) return;
  _isFetchingSocialBlade = true;
  try {
    const SOCIALBLADE_ACCOUNTS: Record<string, { index: string; platform: string; label: string; url: string }> = {
      kaicenat:      { index: "Kai Cenat Sentiment",       platform: "Twitch",    label: "Twitch followers",     url: "https://socialblade.com/twitch/user/kaicenat" },
      adinross:      { index: "Adin Ross Sentiment",       platform: "Twitch",    label: "Twitch followers",     url: "https://socialblade.com/twitch/user/adinross" },
      mrbeast:       { index: "MrBeast Sentiment",         platform: "YouTube",   label: "YouTube subscribers",  url: "https://socialblade.com/youtube/user/mrbeast" },
      champagnepapi: { index: "Drake Sentiment",           platform: "Instagram", label: "Instagram followers",  url: "https://socialblade.com/instagram/user/champagnepapi" },
      kendricklamar: { index: "Kendrick Lamar Sentiment",  platform: "Instagram", label: "Instagram followers",  url: "https://socialblade.com/instagram/user/kendricklamar" },
      patrickmahomes:{ index: "Patrick Mahomes Sentiment", platform: "Instagram", label: "Instagram followers",  url: "https://socialblade.com/instagram/user/patrickmahomes" },
    };

    const stored: Record<string, number> = (() => {
      try { return JSON.parse(localStorage.getItem("mt_socialblade_values") ?? "{}") as Record<string, number>; }
      catch { return {}; }
    })();

    const countRegex = /(\d{1,3}(?:,\d{3})+)\s*(?:Followers|Subscribers)/i;
    const mapped: QueuedHeadline[] = [];

    await Promise.all(
      Object.entries(SOCIALBLADE_ACCOUNTS).map(async ([username, meta]) => {
        try {
          const resp = await fetch(
            `/api/data-proxy?url=${encodeURIComponent(meta.url)}`,
          );
          if (!resp.ok) return;
          const html = await resp.text();
          const match = countRegex.exec(html);
          if (!match) return;
          const count = parseInt(match[1].replace(/,/g, ""), 10);
          if (count < 10_000) return;

          const prev = stored[username];
          stored[username] = count;

          if (prev === undefined || prev === count) return;
          const changePct = Math.abs((count - prev) / prev) * 100;
          if (changePct < 5) return;

          const direction = count > prev ? "surged" : "declined";
          const momentum = count > prev ? "growing" : "declining";
          const displayName = username === "champagnepapi" ? "Drake"
            : username === "patrickmahomes" ? "Patrick Mahomes"
            : username === "kendricklamar" ? "Kendrick Lamar"
            : username === "mrbeast" ? "MrBeast"
            : username === "kaicenat" ? "Kai Cenat"
            : username === "adinross" ? "Adin Ross"
            : username;

          const item: QueuedHeadline = {
            text: `${displayName} ${meta.platform} ${meta.label} ${direction} to ${count.toLocaleString()} — ${momentum} creator momentum signal`,
            sourceTier: 2,
            source: "socialblade",
            forcedIndex: meta.index,
          };
          const blockReason = shouldBlockHeadline(item.text);
          if (blockReason) {
            blockedHeadlines.push({ text: item.text, reason: blockReason, blockedAt: Date.now() });
          } else {
            mapped.push(item);
            _queue.push(item);
          }
        } catch { /* skip this creator */ }
      }),
    );

    try { localStorage.setItem("mt_socialblade_values", JSON.stringify(stored)); } catch { /* ignore */ }

    if (mapped.length > 0) {
      saveHeadlinesToCache(mapped);
      console.info(`[SocialBladeService] Enqueued ${mapped.length} creator headlines. Queue depth: ${_queue.length}`);
    }
  } catch (err) {
    console.warn("[SocialBladeService] SocialBlade fetch failed.", err);
  } finally {
    _isFetchingSocialBlade = false;
  }
}

// ─── YouTube Data API batch fetch ─────────────────────────────────────────────
async function fetchYouTubeBatch(): Promise<void> {
  if (_isFetchingYouTube) return;
  _isFetchingYouTube = true;
  try {
    const apiKey = import.meta.env.VITE_YOUTUBE_API_KEY as string | undefined;
    if (!apiKey) {
      console.warn("[YouTubeService] VITE_YOUTUBE_API_KEY not set — skipping.");
      return;
    }

    const YOUTUBE_CHANNEL_MAP: Record<string, { index: string; displayName: string }> = {
      "UCX6OQ3DkcsbYNE6H8uQQuVA": { index: "MrBeast Sentiment",        displayName: "MrBeast" },
      "UCJrUFbQTO1hHcMvCgFOFZgw": { index: "Kai Cenat Sentiment",       displayName: "Kai Cenat" },
      "UCVGA3Ol3DTGKd3TJ9o5D4tg": { index: "Adin Ross Sentiment",       displayName: "Adin Ross" },
      "UCVtL9JJqxmFTKXMBUplmXBQ": { index: "Kendrick Lamar Sentiment",  displayName: "Kendrick Lamar" },
      "UCByOQJjav0CUDwxCk-wiGSA": { index: "Drake Sentiment",           displayName: "Drake" },
      "UCSHZKyawb77ixDdsGog4iWA": { index: "Elon Musk Sentiment",       displayName: "Elon Musk" },
    };

    const stored: Record<string, number> = (() => {
      try { return JSON.parse(localStorage.getItem("mt_yt_subs") ?? "{}") as Record<string, number>; }
      catch { return {}; }
    })();

    const mapped: QueuedHeadline[] = [];
    const channelIds = Object.keys(YOUTUBE_CHANNEL_MAP).join(",");

    const resp = await fetch(
      `https://www.googleapis.com/youtube/v3/channels?part=statistics&id=${channelIds}&key=${apiKey}`,
    );
    if (!resp.ok) {
      console.warn(`[YouTubeService] API returned ${resp.status}`);
      return;
    }

    const data = await resp.json() as {
      items?: Array<{
        id: string;
        statistics: { subscriberCount: string; viewCount: string; videoCount: string };
      }>;
    };

    for (const item of data.items ?? []) {
      const meta = YOUTUBE_CHANNEL_MAP[item.id];
      if (!meta) continue;
      const subs = parseInt(item.statistics.subscriberCount ?? "0", 10);
      const views = parseInt(item.statistics.viewCount ?? "0", 10);
      const videos = parseInt(item.statistics.videoCount ?? "0", 10);
      if (!subs) continue;

      const ytMetricKey = `yt_subs_${item.id}`;
      saveMetricSnapshot(ytMetricKey, subs, meta.displayName, "YouTube");
      const ytWeeklyDeltas = getDeltaHeadlines(ytMetricKey, subs, meta.displayName, "YouTube", meta.index);
      const ytDailyDeltas = getDailyDeltaHeadlines(ytMetricKey, subs, meta.displayName, "YouTube", meta.index);
      mapped.push(...ytWeeklyDeltas, ...ytDailyDeltas);
      _queue.push(...ytWeeklyDeltas, ...ytDailyDeltas);

      // Headline 1 — always: snapshot stats
      const statsHeadline: QueuedHeadline = {
        text: `${meta.displayName} crosses ${formatCompact(subs)} YouTube subscribers with over ${formatCompact(views)} total views`,
        sourceTier: 2,
        source: "youtube",
        forcedIndex: meta.index,
        sourceLabelOverride: true,
      };
      const block1 = shouldBlockHeadline(statsHeadline.text);
      if (block1) {
        blockedHeadlines.push({ text: statsHeadline.text, reason: block1, blockedAt: Date.now() });
      } else {
        mapped.push(statsHeadline);
        _queue.push(statsHeadline);
      }

      // Headline 2 — conditional: subscriber growth
      const prev = stored[item.id];
      stored[item.id] = subs;
      if (prev !== undefined && subs > prev) {
        // Scale: 1% sub growth per cycle earns full positive sentiment
        const ytGrowthPct = ((subs - prev) / prev) * 100;
        const ytSentiment = Math.min(1, ytGrowthPct / 1);
        const growthHeadline: QueuedHeadline = {
          text: `${meta.displayName} gains subscribers, now at ${formatCompact(subs)} on YouTube`,
          sourceTier: 2,
          source: "youtube",
          forcedIndex: meta.index,
          sourceLabelOverride: true,
          sentimentScore: ytSentiment,
        };
        const block2 = shouldBlockHeadline(growthHeadline.text);
        if (block2) {
          blockedHeadlines.push({ text: growthHeadline.text, reason: block2, blockedAt: Date.now() });
        } else {
          mapped.push(growthHeadline);
          _queue.push(growthHeadline);
        }
      }
    }

    try { localStorage.setItem("mt_yt_subs", JSON.stringify(stored)); } catch { /* ignore */ }

    if (mapped.length > 0) {
      saveHeadlinesToCache(mapped);
      console.info(`[YouTubeService] Enqueued ${mapped.length} YouTube headlines. Queue depth: ${_queue.length}`);
    }
  } catch (err) {
    console.warn("[YouTubeService] YouTube fetch failed.", err);
  } finally {
    _isFetchingYouTube = false;
  }
}

// ─── Twitch API batch fetch ───────────────────────────────────────────────────
// Note: /helix/channels/followers requires moderator:read:followers (OAuth user scope).
// Client-credentials only supports stream status and user lookups — follower counts
// fall back to Social Blade (already proxied). Live viewer counts work on app auth.
let _twitchToken: string | null = null;
let _twitchTokenExpiresAt = 0;

async function getTwitchToken(): Promise<string | null> {
  if (_twitchToken && Date.now() < _twitchTokenExpiresAt) return _twitchToken;
  const clientId = import.meta.env.VITE_TWITCH_CLIENT_ID as string | undefined;
  const clientSecret = import.meta.env.VITE_TWITCH_CLIENT_SECRET as string | undefined;
  if (!clientId || !clientSecret) return null;
  try {
    const resp = await fetch("/api/twitch-proxy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId, clientSecret }),
    });
    if (!resp.ok) return null;
    const data = await resp.json() as { access_token: string };
    _twitchToken = data.access_token;
    // Cache for 55 minutes (Twitch app tokens are valid for 60 days, but refresh regularly)
    _twitchTokenExpiresAt = Date.now() + 55 * 60 * 1000;
    return _twitchToken;
  } catch { return null; }
}

async function fetchTwitchBatch(): Promise<void> {
  if (_isFetchingTwitch) return;
  _isFetchingTwitch = true;
  try {
    const clientId = import.meta.env.VITE_TWITCH_CLIENT_ID as string | undefined;
    if (!clientId) {
      console.warn("[TwitchService] VITE_TWITCH_CLIENT_ID not set — skipping.");
      return;
    }
    const token = await getTwitchToken();
    if (!token) {
      console.warn("[TwitchService] Could not obtain Twitch token — skipping.");
      return;
    }

    const TWITCH_CHANNEL_MAP: Record<string, string> = {
      kaicenat: "Kai Cenat Sentiment",
      adinross: "Adin Ross Sentiment",
    };

    const DISPLAY_NAMES: Record<string, string> = {
      kaicenat: "Kai Cenat",
      adinross: "Adin Ross",
    };

    const mapped: QueuedHeadline[] = [];

    await Promise.all(
      Object.entries(TWITCH_CHANNEL_MAP).map(async ([username, forcedIndex]) => {
        try {
          const streamResp = await fetch(
            `/api/twitch-proxy?endpoint=${encodeURIComponent(`streams?user_login=${username}`)}&clientId=${clientId}&token=${encodeURIComponent(token)}`,
          );
          if (!streamResp.ok) return;
          const streamData = await streamResp.json() as {
            data: Array<{ viewer_count: number; game_name: string; title: string }>;
          };

          const displayName = DISPLAY_NAMES[username] ?? username;
          const stream = streamData.data?.[0];

          // Only generate a headline when the streamer is live — offline status is not a signal
          if (!stream) return;

          const twitchMetricKey = `twitch_viewers_${username}`;
          saveMetricSnapshot(twitchMetricKey, stream.viewer_count, displayName, "Twitch");
          const twitchWeeklyDeltas = getDeltaHeadlines(twitchMetricKey, stream.viewer_count, displayName, "Twitch", forcedIndex);
          const twitchDailyDeltas = getDailyDeltaHeadlines(twitchMetricKey, stream.viewer_count, displayName, "Twitch", forcedIndex);
          mapped.push(...twitchWeeklyDeltas, ...twitchDailyDeltas);
          _queue.push(...twitchWeeklyDeltas, ...twitchDailyDeltas);

          // Scale: 50k concurrent viewers earns full positive sentiment
          const twitchSentiment = Math.min(1, stream.viewer_count / 50_000);
          const headline: QueuedHeadline = {
            text: `${displayName} is live on Twitch streaming ${stream.game_name} with ${stream.viewer_count.toLocaleString()} concurrent viewers`,
            sourceTier: 2,
            source: "twitch",
            forcedIndex,
            sourceLabelOverride: true,
            sentimentScore: twitchSentiment,
          };

          const blockReason = shouldBlockHeadline(headline.text);
          if (blockReason) {
            blockedHeadlines.push({ text: headline.text, reason: blockReason, blockedAt: Date.now() });
          } else {
            mapped.push(headline);
            _queue.push(headline);
          }
        } catch { /* skip this creator */ }
      }),
    );

    if (mapped.length > 0) {
      saveHeadlinesToCache(mapped);
      console.info(`[TwitchService] Enqueued ${mapped.length} Twitch headlines. Queue depth: ${_queue.length}`);
    }
  } catch (err) {
    console.warn("[TwitchService] Twitch fetch failed.", err);
  } finally {
    _isFetchingTwitch = false;
  }
}

// ─── Spotify API batch fetch ──────────────────────────────────────────────────
let _spotifyToken: string | null = null;
let _spotifyTokenExpiresAt = 0;

async function getSpotifyToken(): Promise<string | null> {
  if (_spotifyToken && Date.now() < _spotifyTokenExpiresAt) return _spotifyToken;
  const clientId = import.meta.env.VITE_SPOTIFY_CLIENT_ID as string | undefined;
  const clientSecret = import.meta.env.VITE_SPOTIFY_CLIENT_SECRET as string | undefined;
  if (!clientId || !clientSecret) return null;
  try {
    const resp = await fetch("/api/spotify-proxy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId, clientSecret }),
    });
    if (!resp.ok) return null;
    const data = await resp.json() as { access_token: string };
    _spotifyToken = data.access_token;
    _spotifyTokenExpiresAt = Date.now() + 55 * 60 * 1000;
    return _spotifyToken;
  } catch { return null; }
}

async function fetchSpotifyBatch(): Promise<void> {
  if (_isFetchingSpotify) return;
  _isFetchingSpotify = true;
  try {
    const token = await getSpotifyToken();
    if (!token) {
      console.warn("[SpotifyService] Could not obtain Spotify token — skipping.");
      return;
    }

    const SPOTIFY_ARTIST_MAP: Record<string, { index: string; displayName: string }> = {
      "3TVXtAsR1Inumwj472S9r4": { index: "Drake Sentiment",          displayName: "Drake" },
      "2YZyLoL8N0Wb9xBt1NhZWg": { index: "Kendrick Lamar Sentiment", displayName: "Kendrick Lamar" },
    };

    const stored: Record<string, number> = (() => {
      try { return JSON.parse(localStorage.getItem("mt_spotify_followers") ?? "{}") as Record<string, number>; }
      catch { return {}; }
    })();

    const mapped: QueuedHeadline[] = [];

    await Promise.all(
      Object.entries(SPOTIFY_ARTIST_MAP).map(async ([artistId, meta]) => {
        try {
          const resp = await fetch(
            `/api/spotify-proxy?endpoint=${encodeURIComponent(`artists/${artistId}`)}&token=${encodeURIComponent(token)}`,
          );
          if (!resp.ok) return;
          const data = await resp.json() as {
            followers?: { total: number };
            popularity?: number;
          };
          const followers = data.followers?.total ?? 0;
          const popularity = data.popularity ?? 0;
          if (!followers) return;

          const spotifyMetricKey = `spotify_followers_${artistId}`;
          saveMetricSnapshot(spotifyMetricKey, followers, meta.displayName, "Spotify");
          const spotifyWeeklyDeltas = getDeltaHeadlines(spotifyMetricKey, followers, meta.displayName, "Spotify", meta.index);
          const spotifyDailyDeltas = getDailyDeltaHeadlines(spotifyMetricKey, followers, meta.displayName, "Spotify", meta.index);
          mapped.push(...spotifyWeeklyDeltas, ...spotifyDailyDeltas);
          _queue.push(...spotifyWeeklyDeltas, ...spotifyDailyDeltas);

          const snapshotHeadline: QueuedHeadline = {
            text: `${meta.displayName} sits at ${popularity}/100 popularity on Spotify with ${formatCompact(followers)} followers`,
            sourceTier: 2,
            source: "spotify",
            forcedIndex: meta.index,
            sourceLabelOverride: true,
          };
          const block1 = shouldBlockHeadline(snapshotHeadline.text);
          if (block1) {
            blockedHeadlines.push({ text: snapshotHeadline.text, reason: block1, blockedAt: Date.now() });
          } else {
            mapped.push(snapshotHeadline);
            _queue.push(snapshotHeadline);
          }

          const prev = stored[artistId];
          stored[artistId] = followers;
          if (prev !== undefined && prev !== followers) {
            // Scale: 1% follower change per cycle earns full sentiment weight
            const spotifyChangePct = ((followers - prev) / prev) * 100;
            const spotifySentiment = Math.max(-1, Math.min(1, spotifyChangePct / 1));
            const changeHeadline: QueuedHeadline = {
              text: followers > prev
                ? `${meta.displayName}'s Spotify following continues to climb, now at ${formatCompact(followers)}`
                : `${meta.displayName}'s Spotify follower count slips, now at ${formatCompact(followers)}`,
              sourceTier: 2,
              source: "spotify",
              forcedIndex: meta.index,
              sourceLabelOverride: true,
              sentimentScore: spotifySentiment,
            };
            const block2 = shouldBlockHeadline(changeHeadline.text);
            if (block2) {
              blockedHeadlines.push({ text: changeHeadline.text, reason: block2, blockedAt: Date.now() });
            } else {
              mapped.push(changeHeadline);
              _queue.push(changeHeadline);
            }
          }
        } catch { /* skip this artist */ }
      }),
    );

    try { localStorage.setItem("mt_spotify_followers", JSON.stringify(stored)); } catch { /* ignore */ }

    if (mapped.length > 0) {
      saveHeadlinesToCache(mapped);
      console.info(`[SpotifyService] Enqueued ${mapped.length} Spotify headlines. Queue depth: ${_queue.length}`);
    }
  } catch (err) {
    console.warn("[SpotifyService] Spotify fetch failed.", err);
  } finally {
    _isFetchingSpotify = false;
  }
}

// ─── Billboard Hot 100 batch fetch ───────────────────────────────────────────
const BILLBOARD_FETCH_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const BILLBOARD_LS_KEY = "mt_billboard_last_fetch";

const SIX_DAYS_MS = 6 * 24 * 60 * 60 * 1000;

async function fetchBillboardBatch(): Promise<void> {
  if (_isFetchingBillboard) return;
  const lastFetch = localStorage.getItem(BILLBOARD_LS_KEY);
  console.log('[BillboardService] Gate check —',
    'lastFetch:', lastFetch,
    'hoursAgo:', lastFetch
      ? ((Date.now() - parseInt(lastFetch)) / 3600000).toFixed(1)
      : 'never'
  );
  if (lastFetch && Date.now() - parseInt(lastFetch) < BILLBOARD_FETCH_INTERVAL_MS) return;
  _isFetchingBillboard = true;
  try {
    const key = import.meta.env.VITE_RAPIDAPI_KEY as string | undefined;
    if (!key) { console.warn("[BillboardService] VITE_RAPIDAPI_KEY not set."); return; }
    const resp = await fetch(
      "https://billboard-api2.p.rapidapi.com/hot-100?date=2024-06-01&range=1-10",
      { headers: { "X-RapidAPI-Key": key, "X-RapidAPI-Host": "billboard-api2.p.rapidapi.com" } },
    );
    if (resp.status === 429) {
      console.warn("[BillboardService] 429 Too Many Requests — suppressing for 24 hours");
      localStorage.setItem(BILLBOARD_LS_KEY, (Date.now() - SIX_DAYS_MS).toString());
      return;
    }
    if (!resp.ok) { console.warn("[BillboardService] API error", resp.status); return; }
    const data = await resp.json() as { content?: Array<Record<string, unknown>> };
    const entries = data.content ?? [];
    const mapped: QueuedHeadline[] = [];

    for (const entry of entries) {
      const rank = Number(entry.rank ?? entry.Rank ?? 0);
      const title = String(entry.title ?? entry.Title ?? "");
      const artist = String(entry.artist ?? entry.Artist ?? "");
      const lastWeekRaw = entry.last_week ?? entry["Last Week"] ?? entry.last_week_position;
      const peakPos = Number(entry.peak_pos ?? entry["Peak Pos"] ?? 0);
      const wksOnChart = Number(entry.wks_on_chart ?? entry["Wks on Chart"] ?? 0);
      void peakPos;

      const ARTIST_MAP: Array<{ match: string; index: string; displayName: string }> = [
        { match: "drake",   index: "Drake Sentiment",          displayName: "Drake" },
        { match: "kendrick", index: "Kendrick Lamar Sentiment", displayName: "Kendrick Lamar" },
      ];

      for (const am of ARTIST_MAP) {
        if (!artist.toLowerCase().includes(am.match)) continue;

        // 1. Chart position
        const posLabel: "positive" | "neutral" | "negative" =
          rank <= 5 ? "positive" : rank <= 20 ? "neutral" : "negative";
        const posHeadline: QueuedHeadline = {
          text: `${am.displayName} '${title}' is #${rank} on the Billboard Hot 100 this week`,
          sourceTier: 2,
          source: "billboard",
          forcedIndex: am.index,
          sourceLabelOverride: true,
          sentimentScore: posLabel === "positive" ? 0.85 : posLabel === "negative" ? -0.85 : 0,
        };
        if (!shouldBlockHeadline(posHeadline.text)) { mapped.push(posHeadline); _queue.push(posHeadline); }

        // 2. Week-over-week movement
        const lastWeekNum = Number(lastWeekRaw);
        if (lastWeekRaw !== null && lastWeekRaw !== undefined && lastWeekRaw !== "NEW" && !isNaN(lastWeekNum) && lastWeekNum !== 0) {
          if (rank < lastWeekNum) {
            const h: QueuedHeadline = { text: `${am.displayName} '${title}' climbs from #${lastWeekNum} to #${rank} on Billboard Hot 100`, sourceTier: 2, source: "billboard", forcedIndex: am.index, sourceLabelOverride: true, sentimentScore: 0.87 };
            if (!shouldBlockHeadline(h.text)) { mapped.push(h); _queue.push(h); }
          } else if (rank > lastWeekNum) {
            const h: QueuedHeadline = { text: `${am.displayName} '${title}' falls from #${lastWeekNum} to #${rank} on Billboard Hot 100`, sourceTier: 2, source: "billboard", forcedIndex: am.index, sourceLabelOverride: true, sentimentScore: -0.87 };
            if (!shouldBlockHeadline(h.text)) { mapped.push(h); _queue.push(h); }
          }
        }

        // 3. Longevity
        if (wksOnChart >= 10) {
          const h: QueuedHeadline = { text: `${am.displayName} '${title}' spends ${wksOnChart} weeks on Billboard Hot 100`, sourceTier: 2, source: "billboard", forcedIndex: am.index, sourceLabelOverride: true, sentimentScore: 0.82 };
          if (!shouldBlockHeadline(h.text)) { mapped.push(h); _queue.push(h); }
        }

        // 4. Debut
        const isDebut = lastWeekRaw === "NEW" || lastWeekRaw === 0 || lastWeekRaw === null || lastWeekRaw === undefined;
        if (isDebut) {
          const debutLabel: "positive" | "neutral" = rank <= 10 ? "positive" : "neutral";
          const h: QueuedHeadline = { text: `${am.displayName} '${title}' debuts at #${rank} on Billboard Hot 100`, sourceTier: 2, source: "billboard", forcedIndex: am.index, sourceLabelOverride: true, sentimentScore: debutLabel === "positive" ? 0.88 : 0 };
          if (!shouldBlockHeadline(h.text)) { mapped.push(h); _queue.push(h); }
        }
      }
    }

    localStorage.setItem(BILLBOARD_LS_KEY, String(Date.now()));
    if (mapped.length > 0) {
      saveHeadlinesToCache(mapped);
      console.info(`[BillboardService] Enqueued ${mapped.length} headlines. Queue depth: ${_queue.length}`);
    }
  } catch (err) {
    console.warn("[BillboardService] Fetch failed.", err);
  } finally {
    _isFetchingBillboard = false;
  }
}

// ─── Polymarket batch fetch ───────────────────────────────────────────────────
const PREDICTION_MARKET_KEYWORD_MAP: Record<string, string[]> = {
  "Fed Policy Sentiment": ["federal reserve", "fed rate", "fomc", "interest rate", "rate cut", "rate hike", "inflation", "cpi", "basis points", "monetary policy"],
  "MENA Stability Sentiment": ["iran", "israel", "hormuz", "middle east", "saudi", "gaza", "ceasefire", "opec", "nuclear deal", "hezbollah"],
  "AI Regulation Risk Sentiment": ["ai regulation", "artificial intelligence", "openai", "anthropic", "chatgpt", "ai safety", "ai bill", "ai act"],
  "Traditionalism Sentiment": ["abortion", "second amendment", "religious freedom", "pro-life", "supreme court gun"],
  "Progressivism Sentiment": ["lgbtq", "voting rights", "dei ", "reproductive rights", "transgender"],
  "Obesity Drug Sentiment": ["ozempic", "glp-1", "wegovy", "semaglutide"],
  "Elon Musk Sentiment": ["spacex", "tesla ceo", "elon musk", "grok", "starlink"],
  "Kansas City Chiefs Sentiment": ["kansas city chiefs", "chiefs nfl", "super bowl chiefs"],
  "Denver Broncos Sentiment": ["denver broncos", "broncos nfl"],
  "F1 Constructor Sentiment": ["formula 1 champion", "f1 champion", "grand prix winner"],
  "NASCAR Sentiment": ["nascar", "daytona 500", "cup series"],
  "Drake Sentiment": ["drake rapper", "drizzy", "aubrey graham"],
  "Kendrick Lamar Sentiment": ["kendrick lamar"],
  "United States Sentiment": ["us president", "us recession", "us gdp", "us election 2026", "us midterm"],
  "California Sentiment": ["california governor", "california election", "newsom"],
  "Texas Sentiment": ["texas governor", "texas election", "abbott governor"],
  "Germany Sentiment": ["germany election", "bundestag", "german chancellor", "merz"],
  "China Sentiment": ["china taiwan", "china trade", "pboc", "xi jinping"],
};

function matchPredictionMarketIndex(question: string): string | null {
  const lq = question.toLowerCase();
  for (const [index, keywords] of Object.entries(PREDICTION_MARKET_KEYWORD_MAP)) {
    if (keywords.some((kw) => lq.includes(kw))) return index;
  }
  return null;
}

const POLY_CACHE_KEY = 'mt_polymarket_last_fetch';
const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;

async function fetchPolymarketBatch(): Promise<void> {
  if (_isFetchingPolymarket) return;
  const lastFetch = localStorage.getItem(POLY_CACHE_KEY);
  if (lastFetch && Date.now() - parseInt(lastFetch) < TWELVE_HOURS_MS) return;
  _isFetchingPolymarket = true;
  try {
    const key = import.meta.env.VITE_RAPIDAPI_KEY as string | undefined;
    if (!key) { console.warn("[PolymarketService] VITE_RAPIDAPI_KEY not set."); return; }
    const polymarketHeaders = { "X-RapidAPI-Key": key, "X-RapidAPI-Host": "polymarket-api2.p.rapidapi.com" };
    const polymarketEndpoints = [
      "https://polymarket-api2.p.rapidapi.com/api/markets?limit=50&active=true&closed=false",
      "https://polymarket-api2.p.rapidapi.com/v1/markets?limit=50&active=true&closed=false",
    ];
    let polymarketResp: Response | null = null;
    let polymarketSuccessUrl = "";
    for (const url of polymarketEndpoints) {
      try {
        const r = await fetch(url, { headers: polymarketHeaders });
        if (r.ok) { polymarketResp = r; polymarketSuccessUrl = url; break; }
        console.warn(`[PolymarketService] ${url} returned ${r.status}`);
      } catch { /* try next */ }
    }
    if (!polymarketResp) { console.warn("[PolymarketService] All endpoints failed."); return; }
    console.info(`[PolymarketService] Success via ${polymarketSuccessUrl}`);
    const markets = await polymarketResp.json() as Array<{
      question: string;
      conditionId: string;
      outcomePrices?: string[];
      outcomes?: string[];
      volume?: number;
      active?: boolean;
    }>;

    const seenRaw = (() => { try { return JSON.parse(localStorage.getItem("mt_polymarket_seen") ?? "[]") as string[]; } catch { return [] as string[]; } })();
    const seen = new Set(seenRaw);
    const mapped: QueuedHeadline[] = [];

    let processed = 0;
    for (const market of markets) {
      if (processed >= 20) break;
      if ((market.volume ?? 0) <= 1000) continue;
      if (seen.has(market.conditionId)) continue;
      const forcedIndex = matchPredictionMarketIndex(market.question);
      if (!forcedIndex) continue;
      const yesPct = Math.round(parseFloat(market.outcomePrices?.[0] ?? "0.5") * 100);
      const label: "positive" | "neutral" | "negative" = yesPct >= 60 ? "positive" : yesPct <= 40 ? "negative" : "neutral";
      const h: QueuedHeadline = {
        text: `${market.question} — ${yesPct}% probability according to Polymarket`,
        sourceTier: 1,
        source: "polymarket",
        forcedIndex,
        sourceLabelOverride: true,
        sentimentScore: label === "positive" ? 0.85 : label === "negative" ? -0.85 : 0,
      };
      if (!shouldBlockHeadline(h.text)) { mapped.push(h); _queue.push(h); }
      seen.add(market.conditionId);
      processed++;
    }

    const updatedSeen = [...seen].slice(-100);
    try { localStorage.setItem("mt_polymarket_seen", JSON.stringify(updatedSeen)); } catch { /* ignore */ }
    try { localStorage.setItem(POLY_CACHE_KEY, String(Date.now())); } catch { /* ignore */ }

    if (mapped.length > 0) {
      saveHeadlinesToCache(mapped);
      console.info(`[PolymarketService] Enqueued ${mapped.length} headlines. Queue depth: ${_queue.length}`);
    }
  } catch (err) {
    console.warn("[PolymarketService] Fetch failed.", err);
  } finally {
    _isFetchingPolymarket = false;
  }
}

// ─── Kalshi batch fetch ───────────────────────────────────────────────────────
const KALSHI_EXTRA_KEYWORDS: Record<string, string[]> = {
  "Fed Policy Sentiment": ["fed funds", "fomc meeting", "rate decision", "pce", "unemployment rate"],
  "MENA Stability Sentiment": ["oil price", "strait of hormuz", "opec production"],
  "United States Sentiment": ["us debt ceiling", "government shutdown", "us gdp growth"],
};

function matchKalshiIndex(title: string): string | null {
  const lq = title.toLowerCase();
  for (const [index, keywords] of Object.entries(PREDICTION_MARKET_KEYWORD_MAP)) {
    if (keywords.some((kw) => lq.includes(kw))) return index;
    const extra = KALSHI_EXTRA_KEYWORDS[index];
    if (extra?.some((kw) => lq.includes(kw))) return index;
  }
  return null;
}

async function fetchKalshiBatch(): Promise<void> {
  if (_isFetchingKalshi) return;
  _isFetchingKalshi = true;
  try {
    type KalshiMarket = { title?: string; ticker?: string; yes_bid?: number; yes_ask?: number; yes_price?: number; volume?: number; category?: string; close_time?: string };

    const events: Array<{ title: string; ticker: string; yesMid: number; volume: number }> = [];

    const resp = await fetch(
      "https://api.elections.kalshi.com/trade-api/v2/markets?limit=100&status=open",
      { headers: { "Content-Type": "application/json" } },
    );

    if (!resp.ok) {
      console.warn("[KalshiService] Elections API unavailable — will retry next interval");
      return;
    }

    const data = await resp.json() as { markets?: KalshiMarket[] };
    for (const m of (data.markets ?? [])) {
      if ((m.volume ?? 0) <= 500) continue;
      const yesMid = m.yes_price !== undefined
        ? Math.round(m.yes_price * 100)
        : Math.round(((m.yes_bid ?? 0) + (m.yes_ask ?? 0)) / 2);
      events.push({ title: m.title ?? "", ticker: m.ticker ?? "", yesMid, volume: m.volume ?? 0 });
    }

    const seenRaw = (() => { try { return JSON.parse(localStorage.getItem("mt_kalshi_seen") ?? "[]") as string[]; } catch { return [] as string[]; } })();
    const seen = new Set(seenRaw);
    const mapped: QueuedHeadline[] = [];

    let processed = 0;
    for (const ev of events) {
      if (processed >= 20) break;
      if (seen.has(ev.ticker)) continue;
      const forcedIndex = matchKalshiIndex(ev.title);
      if (!forcedIndex) continue;
      const label: "positive" | "neutral" | "negative" = ev.yesMid >= 60 ? "positive" : ev.yesMid <= 40 ? "negative" : "neutral";
      const h: QueuedHeadline = {
        text: `${ev.title} — ${ev.yesMid}% implied probability per Kalshi`,
        sourceTier: 1,
        source: "kalshi",
        forcedIndex,
        sourceLabelOverride: true,
        sentimentScore: label === "positive" ? 0.85 : label === "negative" ? -0.85 : 0,
      };
      if (!shouldBlockHeadline(h.text)) { mapped.push(h); _queue.push(h); }
      seen.add(ev.ticker);
      processed++;
    }

    const updatedSeen = [...seen].slice(-100);
    try { localStorage.setItem("mt_kalshi_seen", JSON.stringify(updatedSeen)); } catch { /* ignore */ }

    if (mapped.length > 0) {
      saveHeadlinesToCache(mapped);
      console.info(`[KalshiService] Enqueued ${mapped.length} headlines. Queue depth: ${_queue.length}`);
    }
  } catch (err) {
    console.warn("[KalshiService] Fetch failed.", err);
  } finally {
    _isFetchingKalshi = false;
  }
}

const RSS_FEEDS = [
  // Fed Policy
  "https://www.federalreserve.gov/feeds/press_all.xml",
  "https://rss.politico.com/economy.xml",
  // AI/Tech
  "https://www.technologyreview.com/feed/",
  "https://iapp.org/feed/",
  "https://rss.app/feeds/vmz63wsmiH2iYkPS.xml",
  "https://rss.app/feeds/siT53CznJQycjrG3.xml",
  "https://rss.app/feeds/tv6fxE6Ve7e0GGIU.xml",
  // Cultural
  "https://rss.app/feeds/u9NnW8qBxnwn6cUZ.xml",
  "https://rss.app/feeds/PAmogJKfLZTivhKX.xml",
  "https://rss.app/feeds/tZI3VR1XCeonV4LB.xml",
  "https://rss.app/feeds/tKvhZ0YbuCHtbga5.xml",
  // Health/Pharma
  "https://rss.app/feeds/K7Ayl5e2UG32ySPa.xml",
  "https://rss.app/feeds/eArVi6r8VNMRCtZu.xml",
  "https://rss.app/feeds/jZj2jw01OosftOCH.xml",
  // Wellness
  "https://rss.app/feeds/vndSayjtxN4CfBUL.xml",
  "https://rss.app/feeds/tWAO0xDv2bjS8fSm.xml",
  // F1
  "https://rss.app/feeds/LbA9D9830ZEBj3G4.xml",
  "https://rss.app/feeds/hL9FX3P2YpH1KGV6.xml",
  "https://rss.app/feeds/gF24z2IEweCAh3mU.xml",
  // NASCAR
  "https://rss.app/feeds/z7fS4raclQJFPNtd.xml",
  "https://rss.app/feeds/KcHsZsdAIzWSzlBz.xml",
  // Elon Musk
  "https://rss.app/feeds/tL3c9WMgAq7BaDbr.xml",
  "https://rss.app/feeds/tJ1uPi9qHjZ9dE3J.xml",
  // Chiefs/Broncos
  "https://rss.app/feeds/tCHv6kajrGkjg17k.xml",
  "https://rss.app/feeds/tr7TwyVbI1dMSWrQ.xml",
  // Germany
  "https://rss.app/feeds/two1nZ9mZx1IwHoz.xml",
  "https://rss.app/feeds/tbq2CGqLVxLpNdlh.xml",
  "https://rss.app/feeds/sZPHQ3AmF3YSSsw6.xml",
  // China
  "https://rss.app/feeds/thFpOHw7SBKO4g7V.xml",
  "https://rss.app/feeds/tGKYVB2c6kezIJTL.xml",
  "https://rss.app/feeds/tiDyujWUIYmHds7F.xml",
  // Universities
  "https://rss.app/feeds/t4Fgkiqia3itNvRd.xml",
  "https://rss.app/feeds/tavU2yumNMnexZzS.xml",
  "https://news.harvard.edu/gazette/feed/",
  // Creators/TMZ
  "https://rss.app/feeds/ttQpgh9K2l1xlrHm.xml",
];

async function fetchRSSBatch(): Promise<void> {
  if (_isFetchingRSS) return;
  _isFetchingRSS = true;
  try {
    const results = await Promise.all(
      RSS_FEEDS.map(async (url) => {
        try {
          const resp = await fetch(
            `https://corsproxy.io/?${encodeURIComponent(url)}`,
          );
          if (!resp.ok) return [];
          const xml = await resp.text();
          const doc = new DOMParser().parseFromString(xml, "text/xml");
          return Array.from(doc.querySelectorAll("item > title"))
            .map((el) => el.textContent?.trim() ?? "")
            .filter((t) => t.length > 0)
            .slice(0, 5)
            .map((text) => ({
              text,
              sourceTier: mapSourceToTier("rss") as 1 | 2 | 3 | 4 | 5,
              source: "rss",
            }));
        } catch {
          return [];
        }
      }),
    );
    const combined: QueuedHeadline[] = (results.flat() as QueuedHeadline[])
      .sort(() => Math.random() - 0.5)
      .slice(0, 10);
    for (const item of combined) {
      const blockReason = shouldBlockHeadline(item.text);
      if (blockReason) {
        blockedHeadlines.push({ text: item.text, reason: blockReason, blockedAt: Date.now() });
      } else {
        _queue.push(item);
      }
    }
    console.info(`[HeadlineQueue] Enqueued ${combined.length} headlines from RSS feeds. Queue depth: ${_queue.length}`);
  } catch (err) {
    console.warn("[HeadlineQueue] RSS batch fetch failed.", err);
  } finally {
    _isFetchingRSS = false;
  }
}


// ─── BLS JSON parser ──────────────────────────────────────────────────────────
function parseBLSResponse(
  jsonText: string,
): Array<{ text: string; relatedIndex: string; source: string }> {
  if (!jsonText || jsonText === "{}") return [];

  try {
    const data = JSON.parse(jsonText) as {
      Results?: {
        series?: Array<{ seriesID: string; data?: Array<{ value: string }> }>;
      };
    };
    if (!data?.Results?.series) return [];

    const headlines: Array<{
      text: string;
      relatedIndex: string;
      source: string;
    }> = [];

    for (const series of data.Results.series) {
      const seriesId = series.seriesID;
      const latestData = series.data?.[0];
      const priorData = series.data?.[1];

      if (!latestData || !priorData) continue;

      const latest = Number.parseFloat(latestData.value);
      const prior = Number.parseFloat(priorData.value);
      const delta = latest - prior;

      let headline = "";

      if (seriesId === "CUUR0000SA0") {
        if (delta > 0.2) {
          headline = `CPI rises to ${latest.toFixed(1)} — inflation running hotter than prior period, Fed rate cut expectations diminish`;
        } else if (delta < -0.1) {
          headline = `CPI cools to ${latest.toFixed(1)} — inflation easing opens door for Fed rate cuts`;
        } else {
          headline = `CPI holds steady at ${latest.toFixed(1)} — in line with prior period, Fed remains on hold`;
        }
      } else if (seriesId === "CES0000000001") {
        const deltaK = Math.round(delta);
        if (deltaK > 50) {
          headline = `Nonfarm payrolls surge ${deltaK}K above prior month — strong labor market complicates Fed pivot timeline`;
        } else if (deltaK < -30) {
          headline = `Nonfarm payrolls fall ${Math.abs(deltaK)}K below prior month — weakening labor market supports rate cut case`;
        } else {
          headline = `Nonfarm payrolls change ${deltaK > 0 ? "+" : ""}${deltaK}K from prior month — labor market stable, Fed remains data dependent`;
        }
      }

      if (headline) {
        headlines.push({
          text: headline,
          relatedIndex: "Fed Policy Sentiment",
          source: "Bureau of Labor Statistics",
        });
      }
    }

    return headlines;
  } catch {
    return [];
  }
}

// ─── ReliefWeb JSON parser ────────────────────────────────────────────────────
function parseReliefWebResponse(jsonText: string): Array<{
  text: string;
  relatedIndex: string;
  source: string;
}> {
  if (!jsonText || jsonText === "{}") return [];

  try {
    const data = JSON.parse(jsonText) as {
      data?: Array<{
        fields?: {
          title?: string;
          source?: Array<{ name?: string }>;
        };
      }>;
    };
    if (!data?.data || !Array.isArray(data.data)) return [];

    const headlines: Array<{
      text: string;
      relatedIndex: string;
      source: string;
    }> = [];

    for (const item of data.data) {
      const title = item.fields?.title;
      if (!title || title.length < 10) continue;

      const sourceName = item.fields?.source?.[0]?.name ?? "ReliefWeb";

      headlines.push({
        text: title,
        relatedIndex: "MENA Stability Sentiment",
        source: sourceName,
      });
    }

    return headlines;
  } catch {
    return [];
  }
}

// ─── USPTO RSS parser ─────────────────────────────────────────────────────────
function parseUSPTOResponse(xmlText: string): Array<{
  text: string;
  relatedIndex: string;
  source: string;
}> {
  if (!xmlText || xmlText.trim() === "") return [];

  try {
    const headlines: Array<{
      text: string;
      relatedIndex: string;
      source: string;
    }> = [];
    const itemTitleRegex = /<item>[\s\S]*?<title>(.*?)<\/title>/g;
    let match = itemTitleRegex.exec(xmlText);

    while (match !== null) {
      const title = match[1]
        .replace(/<!\[CDATA\[/, "")
        .replace(/\]\]>/, "")
        .trim();

      if (title && title.length >= 10) {
        headlines.push({
          text: `AI Patent Filed: ${title}`,
          relatedIndex: "AI Regulation Risk Sentiment",
          source: "USPTO",
        });
      }
      match = itemTitleRegex.exec(xmlText);
    }

    return headlines;
  } catch {
    return [];
  }
}

// ─── Congress.gov JSON parser ─────────────────────────────────────────────────
function parseCongressResponse(jsonText: string): Array<{
  text: string;
  relatedIndex: string;
  source: string;
}> {
  if (!jsonText || jsonText === "{}" || jsonText.trim() === "") return [];

  try {
    const data = JSON.parse(jsonText) as {
      bills?: Array<{
        title?: string;
        latestAction?: { text?: string };
      }>;
    };

    if (!data?.bills || !Array.isArray(data.bills)) return [];

    const headlines: Array<{
      text: string;
      relatedIndex: string;
      source: string;
    }> = [];

    for (const bill of data.bills) {
      const title = bill.title;
      if (!title || title.length < 5) continue;

      const actionText = (bill.latestAction?.text ?? "").toLowerCase();

      // Compute sentiment direction for future use (QueuedHeadline currently carries only text/tier/index)
      const direction: "POSITIVE" | "NEGATIVE" | "NEUTRAL" =
        actionText.includes("passed") || actionText.includes("signed")
          ? "POSITIVE"
          : actionText.includes("referred") || actionText.includes("introduced")
            ? "NEGATIVE"
            : actionText.includes("failed") || actionText.includes("tabled")
              ? "POSITIVE"
              : "NEUTRAL";
      // confidence is computed per spec; unused in queue push per QueuedHeadline interface
      const confidence =
        direction === "POSITIVE" &&
        (actionText.includes("passed") || actionText.includes("signed"))
          ? jitter(0.78, 0.92)
          : direction === "NEGATIVE"
            ? jitter(0.6, 0.75)
            : direction === "POSITIVE"
              ? jitter(0.72, 0.88)
              : 0.5;
      void direction;
      void confidence;

      headlines.push({
        text: `Congress: ${title}`,
        relatedIndex: "AI Regulation Risk Sentiment",
        source: "Congress.gov",
      });
    }

    return headlines;
  } catch {
    return [];
  }
}

// ─── DC / Marvel keyword routing arrays (shared by YouTube + TMDB parsers) ────
const MARVEL_ROUTING_KEYWORDS = [
  "Marvel",
  "MCU",
  "Avengers",
  "Spider-Man",
  "Iron Man",
  "Thor",
  "Black Panther",
  "Captain America",
  "Doctor Strange",
  "Guardians",
] as const;

const DC_ROUTING_KEYWORDS = [
  "DC",
  "Superman",
  "Batman",
  "Wonder Woman",
  "Aquaman",
  "Flash",
  "Justice League",
  "DC Studios",
  "Warner Bros",
] as const;

// ─── TMDB JSON parser ─────────────────────────────────────────────────────────
function parseTMDBResponse(
  responseText: string,
  prefix: "Upcoming: " | "Trending: ",
): QueuedHeadline[] {
  if (!responseText || responseText.trim() === "" || responseText === "{}")
    return [];

  try {
    const data = JSON.parse(responseText) as {
      results?: Array<{
        title?: string;
        vote_average?: number;
        popularity?: number;
      }>;
    };

    if (!data?.results || !Array.isArray(data.results)) return [];

    const headlines: QueuedHeadline[] = [];

    for (const result of data.results) {
      const rawTitle = result.title;
      if (!rawTitle || rawTitle.length < 2) continue;

      const title = `${prefix}${rawTitle}`;
      const _isMarvel = MARVEL_ROUTING_KEYWORDS.some((kw) =>
        rawTitle.includes(kw),
      );
      const _isDC = DC_ROUTING_KEYWORDS.some((kw) => rawTitle.includes(kw));

      const voteAvg =
        typeof result.vote_average === "number" ? result.vote_average : 6;
      const popularity =
        typeof result.popularity === "number" ? result.popularity : 200;

      let direction: "POSITIVE" | "NEGATIVE" | "NEUTRAL" = "NEUTRAL";
      let confidence: number;

      if (voteAvg >= 7.0 || popularity >= 500) {
        direction = "POSITIVE";
        confidence = jitter(0.72, 0.9);
      } else if (voteAvg < 5.0 || popularity < 100) {
        direction = "NEGATIVE";
        confidence = jitter(0.68, 0.85);
      } else {
        direction = "POSITIVE";
        confidence = jitter(0.6, 0.75);
      }

      void direction;
      void confidence;

      const _baseHeadline = {
        text: title,
        sourceTier: 2 as const,
        source: "tmdb",
      };

      // DC and MU indexes removed — skip these headlines
    }

    return headlines;
  } catch {
    return [];
  }
}


// ─── SCOTUS RSS parser ────────────────────────────────────────────────────────
const SCOTUS_POSITIVE_KEYWORDS = [
  "religious freedom",
  "free exercise",
  "second amendment",
  "parental rights",
  "school choice",
  "religious exemption",
] as const;

const SCOTUS_NEGATIVE_KEYWORDS = [
  "abortion",
  "affirmative action",
  "voting rights",
] as const;

function parseSCOTUSResponse(rawXml: string): QueuedHeadline[] {
  if (!rawXml || rawXml.trim() === "") return [];

  try {
    const headlines: QueuedHeadline[] = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let itemMatch = itemRegex.exec(rawXml);

    while (itemMatch !== null) {
      const itemContent = itemMatch[1];

      const titleMatch = itemContent.match(
        /<title><!\[CDATA\[(.*?)\]\]><\/title>|<title>(.*?)<\/title>/,
      );
      const descMatch = itemContent.match(
        /<description><!\[CDATA\[(.*?)\]\]><\/description>|<description>(.*?)<\/description>/,
      );

      const title = (titleMatch?.[1] ?? titleMatch?.[2] ?? "").trim();
      const description = (descMatch?.[1] ?? descMatch?.[2] ?? "").trim();

      if (!title || title.length < 3) {
        itemMatch = itemRegex.exec(rawXml);
        continue;
      }

      const combined = `${title} ${description}`.toLowerCase();

      let direction: "POSITIVE" | "NEGATIVE" | "NEUTRAL" = "NEUTRAL";
      let confidence = 0.5;

      if (SCOTUS_POSITIVE_KEYWORDS.some((kw) => combined.includes(kw))) {
        direction = "POSITIVE";
        confidence = jitter(0.78, 0.95);
      } else if (SCOTUS_NEGATIVE_KEYWORDS.some((kw) => combined.includes(kw))) {
        direction = "NEGATIVE";
        confidence = jitter(0.75, 0.92);
      }

      void direction;
      void confidence;

      headlines.push({
        text: `SCOTUS Opinion: ${title}`,
        sourceTier: 1,
        forcedIndex: "Traditionalism Sentiment Index",
        source: "scotus",
      });

      itemMatch = itemRegex.exec(rawXml);
    }

    return headlines;
  } catch {
    return [];
  }
}

// ─── Congress Traditional JSON parser ────────────────────────────────────────
const CONSERVATIVE_TITLE_KEYWORDS = [
  "religious",
  "freedom",
  "parental",
  "school",
  "second amendment",
  "gun",
  "faith",
  "traditional",
] as const;

function parseCongressTraditionalResponse(rawJson: string): QueuedHeadline[] {
  if (!rawJson || rawJson === "{}" || rawJson.trim() === "") return [];

  try {
    const data = JSON.parse(rawJson) as {
      bills?: Array<{
        title?: string;
        latestAction?: { text?: string };
      }>;
    };

    if (!data?.bills || !Array.isArray(data.bills)) return [];

    const headlines: QueuedHeadline[] = [];

    for (const bill of data.bills) {
      const title = bill.title;
      if (!title || title.length < 5) continue;

      const actionText = (bill.latestAction?.text ?? "").toLowerCase();
      const titleLower = title.toLowerCase();

      let direction: "POSITIVE" | "NEGATIVE" | "NEUTRAL" = "NEUTRAL";
      let confidence = 0.5;

      if (
        (actionText.includes("passed") || actionText.includes("signed")) &&
        CONSERVATIVE_TITLE_KEYWORDS.some((kw) => titleLower.includes(kw))
      ) {
        direction = "POSITIVE";
        confidence = jitter(0.78, 0.92);
      } else if (
        actionText.includes("referred") ||
        actionText.includes("introduced")
      ) {
        direction = "NEUTRAL";
        confidence = 0.55;
      } else if (
        actionText.includes("failed") ||
        actionText.includes("tabled")
      ) {
        direction = "NEGATIVE";
        confidence = jitter(0.65, 0.8);
      }

      void direction;
      void confidence;

      headlines.push({
        text: `Congress: ${title}`,
        sourceTier: 2,
        forcedIndex: "Traditionalism Sentiment Index",
        source: "congress",
      });
    }

    return headlines;
  } catch {
    return [];
  }
}

// ─── CourtListener JSON parser ────────────────────────────────────────────────
function parseCourtListenerResponse(rawJson: string): QueuedHeadline[] {
  if (!rawJson || rawJson === "{}" || rawJson.trim() === "") return [];

  try {
    const data = JSON.parse(rawJson) as {
      results?: Array<{
        case_name?: string;
        plain_text?: string;
      }>;
    };

    if (!data?.results || !Array.isArray(data.results)) return [];

    const headlines: QueuedHeadline[] = [];

    for (const result of data.results) {
      const caseName = result.case_name;
      if (!caseName || caseName.length < 3) continue;

      const plainTextSnippet = (result.plain_text ?? "").slice(0, 200);
      const combined = `${caseName} ${plainTextSnippet}`.toLowerCase();

      let direction: "POSITIVE" | "NEGATIVE" | "NEUTRAL" = "NEUTRAL";
      let confidence = 0.5;

      if (SCOTUS_POSITIVE_KEYWORDS.some((kw) => combined.includes(kw))) {
        direction = "POSITIVE";
        confidence = jitter(0.78, 0.95);
      } else if (SCOTUS_NEGATIVE_KEYWORDS.some((kw) => combined.includes(kw))) {
        direction = "NEGATIVE";
        confidence = jitter(0.75, 0.92);
      }

      void direction;
      void confidence;

      headlines.push({
        text: `Federal Court: ${caseName}`,
        sourceTier: 2,
        forcedIndex: "Traditionalism Sentiment Index",
        source: "courtlistener",
      });
    }

    return headlines;
  } catch {
    return [];
  }
}

// ─── Progressive SCOTUS positive keywords (inverted polarity) ─────────────────
const PROGRESSIVE_SCOTUS_POSITIVE_KEYWORDS = [
  "voting rights",
  "reproductive rights",
  "lgbtq",
  "affirmative action",
  "environmental",
  "climate",
] as const;

// ─── parseSCOTUSProgressiveResponse ──────────────────────────────────────────
function parseSCOTUSProgressiveResponse(rawXml: string): QueuedHeadline[] {
  if (!rawXml || rawXml.trim() === "") return [];

  try {
    const headlines: QueuedHeadline[] = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let itemMatch = itemRegex.exec(rawXml);

    while (itemMatch !== null) {
      const itemContent = itemMatch[1];

      const titleMatch = itemContent.match(
        /<title><!\[CDATA\[(.*?)\]\]><\/title>|<title>(.*?)<\/title>/,
      );
      const descMatch = itemContent.match(
        /<description><!\[CDATA\[(.*?)\]\]><\/description>|<description>(.*?)<\/description>/,
      );

      const title = (titleMatch?.[1] ?? titleMatch?.[2] ?? "").trim();
      const description = (descMatch?.[1] ?? descMatch?.[2] ?? "").trim();

      if (!title || title.length < 3) {
        itemMatch = itemRegex.exec(rawXml);
        continue;
      }

      const combined = `${title} ${description}`.toLowerCase();

      let direction: "POSITIVE" | "NEGATIVE" | "NEUTRAL" = "NEUTRAL";
      let confidence = 0.5;

      // Inverted polarity: SCOTUS_POSITIVE_KEYWORDS → NEGATIVE for Progressive
      if (SCOTUS_POSITIVE_KEYWORDS.some((kw) => combined.includes(kw))) {
        direction = "NEGATIVE";
        confidence = jitter(0.75, 0.92);
      } else if (
        PROGRESSIVE_SCOTUS_POSITIVE_KEYWORDS.some((kw) => combined.includes(kw))
      ) {
        direction = "POSITIVE";
        confidence = jitter(0.78, 0.93);
      }

      void direction;
      void confidence;

      headlines.push({
        text: `SCOTUS Opinion: ${title}`,
        sourceTier: 1,
        forcedIndex: "Progressivism Sentiment Index",
        source: "scotus",
      });

      itemMatch = itemRegex.exec(rawXml);
    }

    return headlines;
  } catch {
    return [];
  }
}

// ─── Progressive Congress JSON parser ─────────────────────────────────────────
const PROGRESSIVE_TITLE_KEYWORDS = [
  "climate",
  "clean energy",
  "voting rights",
  "healthcare",
  "student loan",
  "immigration reform",
  "lgbtq",
  "reproductive",
] as const;

function parseCongressProgressiveResponse(rawJson: string): QueuedHeadline[] {
  if (!rawJson || rawJson === "{}" || rawJson.trim() === "") return [];

  try {
    const data = JSON.parse(rawJson) as {
      bills?: Array<{
        title?: string;
        latestAction?: { text?: string };
      }>;
    };

    if (!data?.bills || !Array.isArray(data.bills)) return [];

    const headlines: QueuedHeadline[] = [];

    for (const bill of data.bills) {
      const title = bill.title;
      if (!title || title.length < 5) continue;

      const actionText = (bill.latestAction?.text ?? "").toLowerCase();
      const titleLower = title.toLowerCase();
      const hasProgressiveKeyword = PROGRESSIVE_TITLE_KEYWORDS.some((kw) =>
        titleLower.includes(kw),
      );

      let direction: "POSITIVE" | "NEGATIVE" | "NEUTRAL" = "NEUTRAL";
      let confidence = 0.5;

      if (
        hasProgressiveKeyword &&
        (actionText.includes("passed") || actionText.includes("signed"))
      ) {
        direction = "POSITIVE";
        confidence = jitter(0.78, 0.92);
      } else if (
        hasProgressiveKeyword &&
        (actionText.includes("referred") || actionText.includes("introduced"))
      ) {
        direction = "NEUTRAL";
        confidence = 0.55;
      } else if (
        hasProgressiveKeyword &&
        (actionText.includes("failed") || actionText.includes("tabled"))
      ) {
        direction = "NEGATIVE";
        confidence = jitter(0.65, 0.8);
      }

      void direction;
      void confidence;

      headlines.push({
        text: `Congress: ${title}`,
        sourceTier: 2,
        forcedIndex: "Progressivism Sentiment Index",
        source: "congress",
      });
    }

    return headlines;
  } catch {
    return [];
  }
}

// ─── ACLU RSS parser ──────────────────────────────────────────────────────────
const ACLU_POSITIVE_KEYWORDS = [
  "wins",
  "victory",
  "blocks",
  "court rules",
  "overturns",
  "upholds",
] as const;

const ACLU_NEGATIVE_KEYWORDS = [
  "files suit",
  "challenges",
  "appeals",
  "sues",
  "opposes",
  "fights",
] as const;

function parseACLUResponse(xmlText: string): QueuedHeadline[] {
  if (!xmlText || xmlText.trim() === "") return [];

  try {
    const headlines: QueuedHeadline[] = [];
    const itemTitleRegex = /<item>[\s\S]*?<title>(.*?)<\/title>/g;
    let match = itemTitleRegex.exec(xmlText);

    while (match !== null) {
      const title = match[1]
        .replace(/<!\[CDATA\[/, "")
        .replace(/\]\]>/, "")
        .trim();

      if (title && title.length >= 10) {
        const lower = title.toLowerCase();

        let direction: "POSITIVE" | "NEGATIVE" | "NEUTRAL" = "NEUTRAL";
        let confidence = 0.55;

        if (ACLU_POSITIVE_KEYWORDS.some((kw) => lower.includes(kw))) {
          direction = "POSITIVE";
          confidence = jitter(0.75, 0.93);
        } else if (ACLU_NEGATIVE_KEYWORDS.some((kw) => lower.includes(kw))) {
          direction = "NEGATIVE";
          confidence = jitter(0.68, 0.85);
        }

        void direction;
        void confidence;

        headlines.push({
          text: `ACLU: ${title}`,
          sourceTier: 2,
          forcedIndex: "Progressivism Sentiment Index",
          source: "aclu",
        });
      }
      match = itemTitleRegex.exec(xmlText);
    }

    return headlines;
  } catch {
    return [];
  }
}


// ─── OMDb JSON parser ─────────────────────────────────────────────────────────
function _parseOMDBResponse(
  responseText: string,
  targetIndex: string,
): QueuedHeadline[] {
  if (!responseText || responseText.trim() === "" || responseText === "{}")
    return [];

  try {
    const data = JSON.parse(responseText) as {
      Response?: string;
      Search?: Array<{
        Title?: string;
        Year?: string;
        Type?: string;
        imdbID?: string;
      }>;
    };

    if (
      data.Response === "False" ||
      !data.Search ||
      !Array.isArray(data.Search)
    )
      return [];

    const currentYear = new Date().getFullYear();
    const headlines: QueuedHeadline[] = [];

    for (const item of data.Search) {
      const title = item.Title;
      if (!title || title.length < 2) continue;

      const year = Number.parseInt(item.Year ?? "0", 10);
      const isRecent = year === currentYear || year === currentYear + 1;

      // Sentiment computed per spec; not carried in QueuedHeadline interface
      const direction: "POSITIVE" | "NEUTRAL" = isRecent
        ? "POSITIVE"
        : "NEUTRAL";
      const confidence = isRecent ? jitter(0.65, 0.82) : 0.5;
      void direction;
      void confidence;

      headlines.push({
        text: `Film Release: ${title}`,
        sourceTier: 3,
        forcedIndex: targetIndex,
        source: "omdb",
      });
    }

    return headlines;
  } catch {
    return [];
  }
}

// ─── OMDb batch fetch ─────────────────────────────────────────────────────────
async function fetchOMDBBatch(): Promise<void> {
  if (_isFetchingOMDB) return;
  _isFetchingOMDB = true;
  try {
    const _actor = (await createActorWithConfig()) as ActorWithFedBLS;
    let totalEnqueued = 0;

    if (totalEnqueued > 0) {
      console.info(
        `[OMDBService] Enqueued ${totalEnqueued} headlines. Queue depth: ${_queue.length}`,
      );
    }
  } catch (err) {
    console.warn("[OMDBService] Failed to fetch OMDB data:", err);
  } finally {
    _isFetchingOMDB = false;
  }
}

export function initHeadlineQueue(actor: ActorWithFedBLS): () => void {
  if (_initialized) return () => {};
  _initialized = true;

  const cached = loadHeadlinesFromCache();
  if (cached.length > 0) {
    _queue.push(...cached);
    console.info(`[HeadlineQueue] Seeded ${cached.length} headlines from localStorage cache.`);
  }

  // No demo/mock seeding — the queue starts empty and is populated only by the
  // live source fetches kicked off below. Early ticks will have no headlines to
  // score until the first successful fetch lands.

  // LIVE MODE:
  fetchNewsBatch();
  const newsIntervalId = setInterval(fetchNewsBatch, 300_000);

  void fetchNewsAPIBatch();
  const newsApiIntervalId = setInterval(fetchNewsAPIBatch, 3_600_000);

  void fetchRSSBatch();
  const rssIntervalId = setInterval(fetchRSSBatch, 600_000);

  void fetchOddsAPIBatch();
  const oddsApiIntervalId = setInterval(fetchOddsAPIBatch, 900_000);

  void fetchGoogleSearchBatch();
  const googleSearchIntervalId = setInterval(fetchGoogleSearchBatch, 3_600_000);

  void fetchRedditApifyBatch();
  const redditApifyIntervalId = setInterval(fetchRedditApifyBatch, 3_600_000);

  void fetchFREDBatch();
  const fredIntervalId = setInterval(fetchFREDBatch, 360 * 60 * 1000);

  void fetchBLSBatch();
  const blsIntervalId = setInterval(fetchBLSBatch, 360 * 60 * 1000);

  void fetchBEABatch();
  const beaIntervalId = setInterval(fetchBEABatch, 720 * 60 * 1000);

  void fetchWorldBankBatch();
  const worldBankIntervalId = setInterval(fetchWorldBankBatch, 1440 * 60 * 1000);

  void fetchNBSChinaBatch();
  const nbsChinaIntervalId = setInterval(fetchNBSChinaBatch, 1440 * 60 * 1000);

  void fetchForbesBatch();
  const forbesIntervalId = setInterval(fetchForbesBatch, 3_600_000);

  void fetchSocialBladeBatch();
  const socialBladeIntervalId = setInterval(fetchSocialBladeBatch, 3_600_000);

  // YouTube — subscriber counts + growth signals (60 min)
  void fetchYouTubeBatch();
  const youTubeIntervalId = setInterval(fetchYouTubeBatch, 3_600_000);

  // Twitch — live stream status + viewer counts (15 min)
  void fetchTwitchBatch();
  const twitchIntervalId = setInterval(fetchTwitchBatch, 900_000);

  // Spotify — artist follower counts + popularity scores (60 min)
  void fetchSpotifyBatch();
  const spotifyIntervalId = setInterval(fetchSpotifyBatch, 3_600_000);

  // OMDb film database — fire immediately, then every 12 hours
  void fetchOMDBBatch();
  const omdbIntervalId = setInterval(fetchOMDBBatch, OMDB_FETCH_INTERVAL_MS);

  // Billboard Hot 100 — fire immediately (guarded by 7-day localStorage check), then weekly
  void fetchBillboardBatch();
  const billboardIntervalId = setInterval(fetchBillboardBatch, 168 * 60 * 60 * 1000);

  // Polymarket — fire immediately (guarded by 12-hour localStorage gate), then every 12 hours
  void fetchPolymarketBatch();
  const polymarketIntervalId = setInterval(fetchPolymarketBatch, 720 * 60 * 1000);

  // Kalshi — fire immediately, then every 6 hours
  void fetchKalshiBatch();
  const kalshiIntervalId = setInterval(fetchKalshiBatch, 360 * 60 * 1000);

  // API-Sports Soccer — fire immediately, then every 6 hours
  void fetchAPISportsSoccerBatch();
  const apiSportsSoccerIntervalId = setInterval(fetchAPISportsSoccerBatch, 360 * 60 * 1000);

  // API-Sports NFL — fire immediately, then every 6 hours
  void fetchAPISportsNFLBatch();
  const apiSportsNFLIntervalId = setInterval(fetchAPISportsNFLBatch, 360 * 60 * 1000);

  // API-Sports F1 — fire immediately, then every 6 hours
  void fetchAPISportsF1Batch();
  const apiSportsF1IntervalId = setInterval(fetchAPISportsF1Batch, 360 * 60 * 1000);

  // FotMob — fire immediately, then every 3 hours
  void fetchFotMobBatch();
  const fotmobIntervalId = setInterval(fetchFotMobBatch, 180 * 60 * 1000);

  // College Scorecard — fire immediately, then every 72 hours
  void fetchCollegeScorecardBatch();
  const collegeScorecardIntervalId = setInterval(fetchCollegeScorecardBatch, 4320 * 60 * 1000);

  return () => {
    clearInterval(newsIntervalId);
    clearInterval(blsIntervalId);
    clearInterval(newsApiIntervalId);
    clearInterval(rssIntervalId);
    clearInterval(oddsApiIntervalId);
    clearInterval(googleSearchIntervalId);
    clearInterval(redditApifyIntervalId);
    clearInterval(omdbIntervalId);
    clearInterval(fredIntervalId);
    clearInterval(beaIntervalId);
    clearInterval(worldBankIntervalId);
    clearInterval(nbsChinaIntervalId);
    clearInterval(forbesIntervalId);
    clearInterval(socialBladeIntervalId);
    clearInterval(youTubeIntervalId);
    clearInterval(twitchIntervalId);
    clearInterval(spotifyIntervalId);
    clearInterval(billboardIntervalId);
    clearInterval(polymarketIntervalId);
    clearInterval(kalshiIntervalId);
    clearInterval(apiSportsSoccerIntervalId);
    clearInterval(apiSportsNFLIntervalId);
    clearInterval(apiSportsF1IntervalId);
    clearInterval(fotmobIntervalId);
    clearInterval(collegeScorecardIntervalId);
    _initialized = false;
  };
}

/**
 * Fix 2 — Tier 3 / social starvation guard.
 * Scans the queue for the first entry that has a forcedIndex field set
 * (i.e. a social or explicitly routed headline from Reddit, YouTube, etc.)
 * and removes + returns it. Returns null if no such entry exists.
 * This is called from OracleTickContext when the normal FIFO drain produced
 * no social headlines that tick, guaranteeing at least one social slot per tick
 * when social headlines are waiting. Does NOT affect normal drain count.
 */
export function dequeueForcedIndexHeadline(): QueuedHeadline | null {
  const idx = _queue.findIndex((h) => h.forcedIndex);
  if (idx === -1) return null;
  const [extracted] = _queue.splice(idx, 1);
  return extracted ?? null;
}

export async function dequeueHeadlines(n: number): Promise<QueuedHeadline[]> {
  const count = Math.min(n, _queue.length);
  const extracted = _queue.splice(0, count);

  if (getQueueLength() < LOW_WATER_MARK) {
    console.info(
      `[HeadlineQueue] Low water mark reached (${getQueueLength()} remaining) — triggering refill.`,
    );

    // A refill from init()'s 5-minute interval (or an overlapping tick) is
    // already in flight. fetchNewsBatch() would early-return on its own
    // _isFetchingNews guard, making the live feed look empty and triggering a
    // spurious mock top-up — so defer to the in-flight fetch instead.
    if (_isFetchingNews) {
      console.info(
        "[HeadlineQueue] Refill already in flight — deferring to it, no mock top-up.",
      );
      return extracted;
    }

    // LIVE MODE: refill from the live Finnhub newswire and wait for the result.
    // fetchNewsBatch() pushes validated headlines onto _queue internally
    // (source='finnhub', or canister-persisted headlines via its own internal
    // fallback), so measure queue depth across the call to tell whether the
    // live fetch actually produced anything.
    const depthBeforeFetch = getQueueLength();
    await Promise.all([fetchNewsBatch(), fetchNewsAPIBatch(), fetchRSSBatch(), fetchOddsAPIBatch(), fetchGoogleSearchBatch(), fetchRedditApifyBatch(), fetchFREDBatch(), fetchBLSBatch(), fetchBEABatch(), fetchWorldBankBatch(), fetchNBSChinaBatch(), fetchForbesBatch(), fetchSocialBladeBatch(), fetchYouTubeBatch(), fetchTwitchBatch(), fetchSpotifyBatch(), fetchBillboardBatch(), fetchPolymarketBatch(), fetchKalshiBatch(), fetchAPISportsSoccerBatch(), fetchAPISportsNFLBatch(), fetchAPISportsF1Batch(), fetchFotMobBatch(), fetchCollegeScorecardBatch()]);
    const liveEnqueued = getQueueLength() - depthBeforeFetch;

    if (liveEnqueued > 0) {
      console.info(
        `[HeadlineQueue] Live refill added ${liveEnqueued} headlines. Queue depth: ${getQueueLength()}`,
      );
    } else {
      // Mock fallback removed — the queue is intentionally left empty when the
      // live newswire yields nothing, rather than being padded with synthetic
      // headlines. Ticks will have no headlines to score until the next
      // successful Finnhub fetch.
      console.warn(
        "[HeadlineQueue] Live refill produced no headlines — queue left empty (mock fallback disabled).",
      );
    }
  }

  return extracted;
}

export function getQueueLength(): number {
  return _queue.length;
}
