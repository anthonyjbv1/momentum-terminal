/**
 * headlineQueueService.ts
 *
 * 5-minute bulk-fetch caching layer for the Oracle headline pipeline.
 */

import { createActorWithConfig } from "../config";

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
let _isFetchingBEA = false;
let _isFetchingForbes = false;
let _isFetchingSocialBlade = false;

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
    }).slice(0, 15);
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
  { key: "americanfootball_nfl", label: "NFL" },
  { key: "soccer_uefa_champs_league", label: "Champions League" },
  { key: "soccer_spain_la_liga", label: "La Liga" },
  { key: "soccer_fifa_world_cup", label: "World Cup" },
];

async function fetchOddsAPIBatch(): Promise<void> {
  if (_isFetchingOddsAPI) return;
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
      { id: "CPIAUCSL", label: "US Consumer Price Index", unit: "", index: "Fed Policy Sentiment" },
      { id: "UNRATE",   label: "US Unemployment Rate",   unit: "%", index: "Fed Policy Sentiment" },
      { id: "FEDFUNDS", label: "Federal Funds Rate",     unit: "%", index: "Fed Policy Sentiment" },
      { id: "PCE",      label: "US PCE Inflation",       unit: "",  index: "Fed Policy Sentiment" },
    ];

    const stored: Record<string, number> = (() => {
      try { return JSON.parse(localStorage.getItem("mt_fred_values") ?? "{}") as Record<string, number>; }
      catch { return {}; }
    })();

    const results = await Promise.all(
      FRED_SERIES.map(async (series) => {
        try {
          const resp = await fetch(
            `/api/data-proxy?url=${encodeURIComponent(`https://api.stlouisfed.org/fred/series/observations?series_id=${series.id}&api_key=${apiKey}&file_type=json&limit=1&sort_order=desc`)}`,
          );
          if (!resp.ok) return [];
          const data = await resp.json() as { observations?: Array<{ value: string }> };
          const valueStr = data.observations?.[0]?.value;
          if (!valueStr || valueStr === ".") return [];
          const value = Number.parseFloat(valueStr);
          if (Number.isNaN(value)) return [];

          const prev = stored[series.id];
          stored[series.id] = value;

          if (prev === undefined || prev === value) return [];

          const text = series.unit
            ? `${series.label} at ${value}${series.unit} — ${series.id === "UNRATE" ? "labor market signal" : "monetary policy signal"}`
            : series.id === "PCE"
              ? `${series.label} at ${value} — Fed preferred inflation measure`
              : `${series.label} at ${value} — Fed Policy signal`;

          return [{ text, sourceTier: 1 as const, source: "fred" as const, forcedIndex: series.index }];
        } catch {
          return [];
        }
      }),
    );

    try { localStorage.setItem("mt_fred_values", JSON.stringify(stored)); } catch { /* ignore */ }

    const mapped: QueuedHeadline[] = results.flat() as QueuedHeadline[];
    for (const item of mapped) {
      const blockReason = shouldBlockHeadline(item.text);
      if (blockReason) {
        blockedHeadlines.push({ text: item.text, reason: blockReason, blockedAt: Date.now() });
      } else {
        _queue.push(item);
      }
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

    const BLS_SERIES = [
      { id: "CUUR0000SA0",  label: "US CPI",         unit: "",  index: "Fed Policy Sentiment",     headline: (v: number) => `US CPI at ${v} — inflation signal` },
      { id: "LNS14000000",  label: "US Unemployment", unit: "%", index: "United States Sentiment",  headline: (v: number) => `US Unemployment at ${v}% — labor market signal` },
    ];

    const stored: Record<string, number> = (() => {
      try { return JSON.parse(localStorage.getItem("mt_bls_values") ?? "{}") as Record<string, number>; }
      catch { return {}; }
    })();

    const resp = await fetch(`/api/data-proxy?url=${encodeURIComponent("https://api.bls.gov/publicAPI/v2/timeseries/data/")}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        seriesid: BLS_SERIES.map((s) => s.id),
        registrationkey: apiKey,
        startyear: "2026",
        endyear: "2026",
      }),
    });
    if (!resp.ok) return;
    const data = await resp.json() as { Results?: { series?: Array<{ seriesID: string; data?: Array<{ value: string }> }> } };
    const series = data.Results?.series ?? [];

    const mapped: QueuedHeadline[] = [];
    for (const s of series) {
      const meta = BLS_SERIES.find((b) => b.id === s.seriesID);
      if (!meta) continue;
      const valueStr = s.data?.[0]?.value;
      if (!valueStr) continue;
      const value = Number.parseFloat(valueStr);
      if (Number.isNaN(value)) continue;

      const prev = stored[s.seriesID];
      stored[s.seriesID] = value;
      if (prev === undefined || prev === value) continue;

      const item: QueuedHeadline = { text: meta.headline(value), sourceTier: 1, source: "bls", forcedIndex: meta.index };
      const blockReason = shouldBlockHeadline(item.text);
      if (blockReason) {
        blockedHeadlines.push({ text: item.text, reason: blockReason, blockedAt: Date.now() });
      } else {
        mapped.push(item);
        _queue.push(item);
      }
    }

    try { localStorage.setItem("mt_bls_values", JSON.stringify(stored)); } catch { /* ignore */ }

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

// ─── BEA (Bureau of Economic Analysis) direct fetch ──────────────────────────
async function fetchBEABatch(): Promise<void> {
  if (_isFetchingBEA) return;
  _isFetchingBEA = true;
  try {
    const apiKey = import.meta.env.VITE_BEA_API_KEY ?? "";
    if (!apiKey) return;

    const BEA_STATE_MAP: Record<string, string> = {
      CA: "California Sentiment",
      NY: "New York Sentiment",
      TX: "Texas Sentiment",
      FL: "Florida Sentiment",
    };

    const stored: Record<string, number> = (() => {
      try { return JSON.parse(localStorage.getItem("mt_bea_values") ?? "{}") as Record<string, number>; }
      catch { return {}; }
    })();

    const resp = await fetch(
      `https://apps.bea.gov/api/data/?UserID=${apiKey}&method=GetData&datasetname=Regional&TableName=SQGDP2&LineCode=1&GeoFips=STATE&Year=2026&ResultFormat=JSON`,
    );
    if (!resp.ok) return;
    const data = await resp.json() as {
      BEAAPI?: { Results?: { Data?: Array<{ GeoFips: string; GeoName: string; DataValue: string; TimePeriod: string }> } }
    };
    const rows = data.BEAAPI?.Results?.Data ?? [];

    const stateMap: Record<string, { name: string; value: number }> = {};
    for (const row of rows) {
      const fips = row.GeoFips;
      const val = Number.parseFloat(row.DataValue.replace(/,/g, ""));
      if (Number.isNaN(val)) continue;
      if (!stateMap[fips] || row.TimePeriod > (stateMap[fips] as { name: string; value: number; period?: string }).period!) {
        stateMap[fips] = { name: row.GeoName, value: val };
      }
    }

    const FIPS_TO_ABBR: Record<string, string> = { "06000": "CA", "36000": "NY", "48000": "TX", "12000": "FL" };
    const mapped: QueuedHeadline[] = [];

    for (const [fips, abbr] of Object.entries(FIPS_TO_ABBR)) {
      const entry = stateMap[fips];
      if (!entry) continue;
      const index = BEA_STATE_MAP[abbr];
      if (!index) continue;

      const prev = stored[abbr];
      stored[abbr] = entry.value;
      if (prev === undefined || prev === entry.value) continue;

      const pct = prev > 0 ? (((entry.value - prev) / prev) * 100).toFixed(1) : "0.0";
      const text = `${entry.name} GDP growth ${pct}% — regional economic signal`;
      const item: QueuedHeadline = { text, sourceTier: 1, source: "bea", forcedIndex: index };
      const blockReason = shouldBlockHeadline(item.text);
      if (blockReason) {
        blockedHeadlines.push({ text: item.text, reason: blockReason, blockedAt: Date.now() });
      } else {
        mapped.push(item);
        _queue.push(item);
      }
    }

    try { localStorage.setItem("mt_bea_values", JSON.stringify(stored)); } catch { /* ignore */ }

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

      const rankHeadline: QueuedHeadline = {
        text: `${name} net worth $${net_worth_b.toFixed(1)}B — Forbes Real-Time #${rank}`,
        sourceTier: 1,
        source: "forbes",
        forcedIndex,
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
          const changeHeadline: QueuedHeadline = {
            text: `${name} net worth ${direction} $${Math.abs(change_abs).toFixed(1)}B (${change_pct >= 0 ? "+" : ""}${change_pct.toFixed(2)}%) since prior trading day per Forbes Real-Time Billionaires`,
            sourceTier: 1,
            source: "forbes",
            forcedIndex,
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
  const fredIntervalId = setInterval(fetchFREDBatch, 3_600_000);

  void fetchBLSBatch();
  const blsIntervalId = setInterval(fetchBLSBatch, 3_600_000);

  void fetchBEABatch();
  const beaIntervalId = setInterval(fetchBEABatch, 3_600_000);

  void fetchForbesBatch();
  const forbesIntervalId = setInterval(fetchForbesBatch, 3_600_000);

  void fetchSocialBladeBatch();
  const socialBladeIntervalId = setInterval(fetchSocialBladeBatch, 3_600_000);

  // OMDb film database — fire immediately, then every 12 hours
  void fetchOMDBBatch();
  const omdbIntervalId = setInterval(fetchOMDBBatch, OMDB_FETCH_INTERVAL_MS);

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
    clearInterval(forbesIntervalId);
    clearInterval(socialBladeIntervalId);
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
    await Promise.all([fetchNewsBatch(), fetchNewsAPIBatch(), fetchRSSBatch(), fetchOddsAPIBatch(), fetchGoogleSearchBatch(), fetchRedditApifyBatch(), fetchFREDBatch(), fetchBLSBatch(), fetchBEABatch(), fetchForbesBatch(), fetchSocialBladeBatch()]);
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
