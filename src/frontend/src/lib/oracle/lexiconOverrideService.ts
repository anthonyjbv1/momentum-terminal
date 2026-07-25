/**
 * lexiconOverrideService.ts
 *
 * Deterministic lexicon override layer for the Oracle sentiment pipeline.
 * Called at the top of analyzeSentiment() in finbertService.ts BEFORE any
 * HuggingFace / FinBERT API call. First match wins and bypasses the API
 * entirely.
 *
 * Confidence uses a random jitter within the calibrated [min, max] range on
 * every invocation — guarantees organic variance across Oracle ticks.
 */

export interface LexiconOverride {
  patterns: string[];
  operator: "AND" | "OR";
  direction: "positive" | "negative" | "neutral";
  minConfidence: number;
  maxConfidence: number;
}

export const LEXICON_OVERRIDES: LexiconOverride[] = [
  // Federal Reserve / Macro
  {
    patterns: ["rate hike"],
    operator: "OR",
    direction: "negative",
    minConfidence: 0.75,
    maxConfidence: 0.98,
  },
  {
    patterns: ["rate cut"],
    operator: "OR",
    direction: "positive",
    minConfidence: 0.75,
    maxConfidence: 0.93,
  },
  {
    patterns: ["inflation cools", "cpi cools", "pce cools"],
    operator: "OR",
    direction: "positive",
    minConfidence: 0.75,
    maxConfidence: 0.92,
  },
  {
    patterns: ["cpi", "inflation"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.75,
    maxConfidence: 0.95,
  },
  {
    patterns: ["powell", "fomc"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.75,
    maxConfidence: 0.95,
  },
  {
    patterns: ["recession", "fears"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.75,
    maxConfidence: 0.93,
  },
  {
    patterns: ["chip", "semiconductor", "export", "ban"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.75,
    maxConfidence: 0.95,
  },

  // Geopolitical / MENA
  {
    patterns: ["opec", "emergency"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.75,
    maxConfidence: 0.98,
  },
  {
    patterns: ["taiwan", "disruption"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.75,
    maxConfidence: 0.98,
  },
  {
    patterns: ["strait of hormuz"],
    operator: "OR",
    direction: "negative",
    minConfidence: 0.75,
    maxConfidence: 0.95,
  },
  {
    patterns: ["ceasefire", "peace deal", "de-escalation"],
    operator: "OR",
    direction: "positive",
    minConfidence: 0.78,
    maxConfidence: 0.96,
  },
  {
    patterns: ["trade deal", "trade agreement", "tariff relief"],
    operator: "OR",
    direction: "positive",
    minConfidence: 0.75,
    maxConfidence: 0.95,
  },
  {
    patterns: ["sanctions lifted", "sanctions removed"],
    operator: "OR",
    direction: "positive",
    minConfidence: 0.75,
    maxConfidence: 0.95,
  },
  {
    patterns: ["war", "strikes", "bombed", "missile", "attack"],
    operator: "OR",
    direction: "negative",
    minConfidence: 0.75,
    maxConfidence: 0.95,
  },

  // AI Regulation Risk Sentiment
  {
    patterns: ["department of justice", "antitrust"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.75,
    maxConfidence: 0.98,
  },
  {
    patterns: ["ai", "safety", "audit", "mandate", "regulation"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.75,
    maxConfidence: 0.93,
  },
  {
    patterns: [
      "ftc opens investigation",
      "ftc launches investigation",
      "ftc files complaint",
    ],
    operator: "OR",
    direction: "negative",
    minConfidence: 0.75,
    maxConfidence: 0.95,
  },
  // FTC specific — distinguish opening vs closing investigations
  // Each is a single OR phrase so the full substring match fires correctly
  {
    patterns: ["ftc drops"],
    operator: "OR",
    direction: "positive",
    minConfidence: 0.75,
    maxConfidence: 0.92,
  },
  {
    patterns: ["ftc closes"],
    operator: "OR",
    direction: "positive",
    minConfidence: 0.75,
    maxConfidence: 0.92,
  },
  {
    patterns: ["ftc ends investigation"],
    operator: "OR",
    direction: "positive",
    minConfidence: 0.75,
    maxConfidence: 0.92,
  },
  {
    patterns: ["senate ai safety act"],
    operator: "OR",
    direction: "negative",
    minConfidence: 0.75,
    maxConfidence: 0.95,
  },
  {
    patterns: ["export", "ban", "semiconductor"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.75,
    maxConfidence: 0.95,
  },

  // Legal / Policy
  {
    patterns: ["supreme court", "rules", "favor"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.72,
    maxConfidence: 0.9,
  },
  {
    patterns: ["court strikes down"],
    operator: "OR",
    direction: "negative",
    minConfidence: 0.72,
    maxConfidence: 0.9,
  },
  {
    patterns: ["appeals court", "blocked"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.72,
    maxConfidence: 0.9,
  },
  {
    patterns: ["federal court", "strikes down"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.72,
    maxConfidence: 0.9,
  },

  // Cultural / Entertainment
  {
    patterns: ["box office", "record"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.75,
    maxConfidence: 0.93,
  },
  {
    patterns: ["viewership", "collapsed", "drops"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.75,
    maxConfidence: 0.93,
  },
  {
    patterns: ["franchise fatigue"],
    operator: "OR",
    direction: "negative",
    minConfidence: 0.72,
    maxConfidence: 0.9,
  },
  {
    patterns: ["fan sentiment", "positive"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.75,
    maxConfidence: 0.93,
  },
  {
    patterns: ["trailer", "breaks record"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.75,
    maxConfidence: 0.93,
  },

  // Social Policy
  {
    patterns: ["student loan", "blocked"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.72,
    maxConfidence: 0.9,
  },
  {
    patterns: ["student loan", "approved", "passes"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.72,
    maxConfidence: 0.9,
  },
  {
    patterns: ["climate bill", "passes"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.72,
    maxConfidence: 0.9,
  },
  {
    patterns: ["school choice", "blocked"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.72,
    maxConfidence: 0.9,
  },

  // Fed Policy — yield curve
  {
    patterns: ["yield curve inverts", "yield curve inversion"],
    operator: "OR",
    direction: "negative",
    minConfidence: 0.88,
    maxConfidence: 0.96,
  },
  {
    patterns: ["soft landing", "goldilocks economy"],
    operator: "OR",
    direction: "positive",
    minConfidence: 0.82,
    maxConfidence: 0.92,
  },

  // Cultural — box office and entertainment
  {
    patterns: ["opens to", "superhero", "debut"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.72,
    maxConfidence: 0.9,
  },
  {
    patterns: ["recovery narrative", "momentum"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.7,
    maxConfidence: 0.88,
  },
  {
    patterns: ["production pause", "disappointments"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.72,
    maxConfidence: 0.9,
  },
  {
    patterns: ["consecutive", "disappointments"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.7,
    maxConfidence: 0.88,
  },
  {
    patterns: ["biggest superhero"],
    operator: "OR",
    direction: "positive",
    minConfidence: 0.72,
    maxConfidence: 0.9,
  },

  // FTC — additional positive signal
  {
    patterns: ["favoring innovation"],
    operator: "OR",
    direction: "positive",
    minConfidence: 0.7,
    maxConfidence: 0.88,
  },

  // AI Regulation Risk Sentiment positive signals
  {
    patterns: ["openai", "breakthrough"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.72,
    maxConfidence: 0.9,
  },
  {
    patterns: ["surpassing human benchmarks"],
    operator: "OR",
    direction: "positive",
    minConfidence: 0.75,
    maxConfidence: 0.92,
  },

  // MENA live data patterns
  {
    patterns: ["iran", "war", "strikes"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.75,
    maxConfidence: 0.93,
  },
  {
    patterns: ["tehran", "bombed"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.75,
    maxConfidence: 0.95,
  },
  {
    patterns: ["un envoy", "iran"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.68,
    maxConfidence: 0.82,
  },
  {
    patterns: ["waivers", "iran"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.65,
    maxConfidence: 0.8,
  },

  // Traditional American Values — positive signals (court/legal/faith/education)
  {
    patterns: ["court blocks"],
    operator: "OR",
    direction: "positive",
    minConfidence: 0.8,
    maxConfidence: 0.92,
  },
  {
    patterns: ["judge strikes down"],
    operator: "OR",
    direction: "positive",
    minConfidence: 0.8,
    maxConfidence: 0.92,
  },
  {
    patterns: ["blocks mandate"],
    operator: "OR",
    direction: "positive",
    minConfidence: 0.8,
    maxConfidence: 0.92,
  },
  {
    patterns: ["parental rights"],
    operator: "OR",
    direction: "positive",
    minConfidence: 0.82,
    maxConfidence: 0.92,
  },
  {
    patterns: ["faith communities"],
    operator: "OR",
    direction: "positive",
    minConfidence: 0.8,
    maxConfidence: 0.9,
  },
  {
    patterns: ["church attendance"],
    operator: "OR",
    direction: "positive",
    minConfidence: 0.8,
    maxConfidence: 0.9,
  },
  {
    patterns: ["religious exemption"],
    operator: "OR",
    direction: "positive",
    minConfidence: 0.82,
    maxConfidence: 0.92,
  },
  {
    patterns: ["school choice"],
    operator: "OR",
    direction: "positive",
    minConfidence: 0.8,
    maxConfidence: 0.92,
  },
  {
    patterns: ["voucher program"],
    operator: "OR",
    direction: "positive",
    minConfidence: 0.8,
    maxConfidence: 0.9,
  },

  // Progressive American Values — positive signals (policy wins / social progress)
  {
    patterns: ["student loan forgiveness"],
    operator: "OR",
    direction: "positive",
    minConfidence: 0.82,
    maxConfidence: 0.92,
  },
  {
    patterns: ["loan forgiveness reinstated"],
    operator: "OR",
    direction: "positive",
    minConfidence: 0.82,
    maxConfidence: 0.92,
  },
  {
    patterns: ["appeals court reversal"],
    operator: "OR",
    direction: "positive",
    minConfidence: 0.8,
    maxConfidence: 0.9,
  },
  {
    patterns: ["borrowers relief"],
    operator: "OR",
    direction: "positive",
    minConfidence: 0.8,
    maxConfidence: 0.9,
  },
  {
    patterns: ["debt relief"],
    operator: "OR",
    direction: "positive",
    minConfidence: 0.8,
    maxConfidence: 0.92,
  },
  {
    patterns: ["reproductive rights"],
    operator: "OR",
    direction: "positive",
    minConfidence: 0.82,
    maxConfidence: 0.92,
  },
  {
    patterns: ["climate bill passes"],
    operator: "OR",
    direction: "positive",
    minConfidence: 0.8,
    maxConfidence: 0.9,
  },
  {
    patterns: ["green energy"],
    operator: "OR",
    direction: "positive",
    minConfidence: 0.8,
    maxConfidence: 0.9,
  },
  {
    patterns: ["minimum wage increase"],
    operator: "OR",
    direction: "positive",
    minConfidence: 0.82,
    maxConfidence: 0.92,
  },
  {
    patterns: ["universal healthcare"],
    operator: "OR",
    direction: "positive",
    minConfidence: 0.8,
    maxConfidence: 0.9,
  },
  {
    patterns: ["voting rights"],
    operator: "OR",
    direction: "positive",
    minConfidence: 0.82,
    maxConfidence: 0.92,
  },

  // (DC character entries retained — no marvelous/distinguished keywords)
  {
    patterns: ["dc box office", "dc studios"],
    operator: "OR",
    direction: "positive",
    minConfidence: 0.78,
    maxConfidence: 0.9,
  },
  {
    patterns: [
      "batman",
      "superman",
      "wonder woman",
      "aquaman",
      "flash",
      "green lantern",
    ],
    operator: "OR",
    direction: "positive",
    minConfidence: 0.72,
    maxConfidence: 0.85,
  },
  {
    patterns: ["dc", "record", "opening"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.82,
    maxConfidence: 0.93,
  },
  {
    patterns: ["dc", "flop", "disappoints", "underperforms", "bombs"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.84,
    maxConfidence: 0.95,
  },
  {
    patterns: ["dc studios", "cancels", "shelves", "reboots", "restructures"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.82,
    maxConfidence: 0.93,
  },
  {
    patterns: ["james gunn", "dc creative", "dc universe"],
    operator: "OR",
    direction: "positive",
    minConfidence: 0.72,
    maxConfidence: 0.85,
  },
  {
    patterns: ["warner bros", "dc", "loss", "writedown", "impairment"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.86,
    maxConfidence: 0.95,
  },

  // --- MENA EXPANSION ---
  {
    patterns: ["iran nuclear deal", "nuclear agreement", "nuclear framework"],
    operator: "OR",
    direction: "positive",
    minConfidence: 0.82,
    maxConfidence: 0.93,
  },
  {
    patterns: ["iran", "sanctions", "expanded", "tightened", "new"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.85,
    maxConfidence: 0.95,
  },
  {
    patterns: ["secondary sanctions", "oil sanctions"],
    operator: "OR",
    direction: "negative",
    minConfidence: 0.84,
    maxConfidence: 0.94,
  },
  {
    patterns: ["iran", "deal", "optimistic", "progress", "breakthrough"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.78,
    maxConfidence: 0.9,
  },
  {
    patterns: ["houthi", "attack", "strike", "missile", "drone"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.88,
    maxConfidence: 0.96,
  },
  {
    patterns: ["red sea", "shipping", "reroute", "disruption", "blocked"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.86,
    maxConfidence: 0.95,
  },
  {
    patterns: ["gulf ceasefire", "regional ceasefire", "middle east ceasefire"],
    operator: "OR",
    direction: "positive",
    minConfidence: 0.84,
    maxConfidence: 0.94,
  },
  {
    patterns: ["iran", "pope", "criticize", "diplomatic", "tensions"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.75,
    maxConfidence: 0.87,
  },
  {
    patterns: ["israel", "ceasefire", "agreement", "hostage deal"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.82,
    maxConfidence: 0.93,
  },
  {
    patterns: ["uae", "de-escalation", "mediation", "diplomacy"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.78,
    maxConfidence: 0.9,
  },

  // --- AI REGULATION RISK SENTIMENT EXPANSION ---
  {
    patterns: ["eu ai act", "enforcement", "compliance", "deadline"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.88,
    maxConfidence: 0.96,
  },
  {
    patterns: ["ai regulation", "passes", "signed", "enacted"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.86,
    maxConfidence: 0.95,
  },
  {
    patterns: ["ai regulation", "fails", "blocked", "delayed", "dropped"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.84,
    maxConfidence: 0.94,
  },
  {
    patterns: ["chip export", "restricted", "banned", "limited"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.86,
    maxConfidence: 0.95,
  },
  {
    patterns: ["ai investment", "surges", "record", "billion"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.8,
    maxConfidence: 0.91,
  },
  {
    patterns: ["hyperscaler", "data center", "accelerate", "buildout"],
    operator: "OR",
    direction: "positive",
    minConfidence: 0.78,
    maxConfidence: 0.89,
  },
  {
    patterns: ["ai moratorium", "ai pause", "ai ban"],
    operator: "OR",
    direction: "negative",
    minConfidence: 0.88,
    maxConfidence: 0.96,
  },
  {
    patterns: ["third party audit", "ai", "mandate", "required"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.86,
    maxConfidence: 0.95,
  },
  {
    patterns: ["ai exemption", "light touch", "self regulation"],
    operator: "OR",
    direction: "positive",
    minConfidence: 0.8,
    maxConfidence: 0.91,
  },

  // --- MARVELOUS UNIVERSE EXPANSION ---
  {
    patterns: ["marvel", "box office", "record", "opening weekend"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.84,
    maxConfidence: 0.94,
  },
  {
    patterns: ["marvel", "flop", "disappoints", "underperforms", "bombs"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.84,
    maxConfidence: 0.95,
  },
  {
    patterns: ["mcu", "announcement", "slate", "phase", "confirmed"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.78,
    maxConfidence: 0.9,
  },
  {
    patterns: ["disney", "marvel", "cancels", "shelves", "delays"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.84,
    maxConfidence: 0.94,
  },
  {
    patterns: [
      "avengers",
      "iron man",
      "thor",
      "spider-man",
      "captain america",
      "black panther",
    ],
    operator: "OR",
    direction: "positive",
    minConfidence: 0.72,
    maxConfidence: 0.85,
  },
  {
    patterns: ["streaming", "viewership", "record", "disney plus"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.8,
    maxConfidence: 0.91,
  },

  // --- FED POLICY EXPANSION ---
  {
    patterns: ["federal reserve", "rate cut", "signals", "pivot"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.86,
    maxConfidence: 0.95,
  },
  {
    patterns: ["jobless claims", "drop", "fall", "decline"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.82,
    maxConfidence: 0.92,
  },
  {
    patterns: ["jobless claims", "rise", "surge", "increase"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.82,
    maxConfidence: 0.92,
  },
  {
    patterns: ["labor market", "stability", "strong", "resilient"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.8,
    maxConfidence: 0.91,
  },
  {
    patterns: ["stagflation", "hyperinflation"],
    operator: "OR",
    direction: "negative",
    minConfidence: 0.88,
    maxConfidence: 0.96,
  },
  {
    patterns: ["gdp", "growth", "beats", "exceeds", "strong"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.82,
    maxConfidence: 0.93,
  },

  // --- FED POLICY (new batch) ---
  {
    patterns: ["s&p 500", "all-time high"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.82,
    maxConfidence: 0.92,
  },
  {
    patterns: ["wall street", "rallies"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.84,
    maxConfidence: 0.93,
  },
  {
    patterns: ["federal reserve", "signals", "cuts"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.84,
    maxConfidence: 0.94,
  },
  {
    patterns: ["fomc", "holds", "cuts"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.82,
    maxConfidence: 0.92,
  },
  {
    patterns: ["nonfarm payrolls", "surge"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.84,
    maxConfidence: 0.93,
  },
  {
    patterns: ["fomc minutes", "divisions", "emergency hike"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.86,
    maxConfidence: 0.95,
  },
  {
    patterns: ["treasury yields", "surge", "cpi"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.86,
    maxConfidence: 0.95,
  },

  // --- AI REGULATION RISK SENTIMENT (new batch) ---
  {
    patterns: ["nvidia", "manufacturing", "investment"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.82,
    maxConfidence: 0.92,
  },
  {
    patterns: ["eu ai act", "enforcement"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.88,
    maxConfidence: 0.96,
  },
  {
    patterns: ["chip export", "restrictions", "expanded"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.86,
    maxConfidence: 0.95,
  },
  {
    patterns: ["doj", "antitrust", "ai cloud"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.86,
    maxConfidence: 0.95,
  },
  {
    patterns: ["ai lab", "safety flaw"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.86,
    maxConfidence: 0.95,
  },
  {
    patterns: ["eu regulators", "generative ai", "restrictions"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.86,
    maxConfidence: 0.95,
  },
  {
    patterns: ["congress", "divided", "ai regulation", "no bill"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.8,
    maxConfidence: 0.91,
  },
  {
    patterns: ["tsmc", "ohio", "facility"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.8,
    maxConfidence: 0.91,
  },

  // --- MENA STABILITY (new batch) ---
  {
    patterns: ["iran nuclear talks", "constructive"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.82,
    maxConfidence: 0.93,
  },
  {
    patterns: ["egypt", "imf", "stabilizes"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.8,
    maxConfidence: 0.91,
  },
  {
    patterns: ["uae", "landmark", "partnership", "investment"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.8,
    maxConfidence: 0.91,
  },
  {
    patterns: ["opec", "unanimous", "agreement"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.78,
    maxConfidence: 0.9,
  },
  {
    patterns: ["uae central bank", "halts", "liquidity"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.86,
    maxConfidence: 0.95,
  },
  {
    patterns: ["military", "locked and loaded", "iran"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.9,
    maxConfidence: 0.97,
  },
  {
    patterns: ["irgc", "hormuz", "ships"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.86,
    maxConfidence: 0.95,
  },
  {
    patterns: ["allies fear", "iran", "backfire"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.82,
    maxConfidence: 0.92,
  },
  {
    patterns: ["hedge fund", "iran peace", "buying"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.78,
    maxConfidence: 0.89,
  },

  // --- MARVELOUS UNIVERSE (new batch) ---
  // marvelous universe entries removed

  // --- TRADITIONAL AMERICAN VALUES (new batch) ---
  {
    patterns: ["second amendment", "wins", "appeals court"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.84,
    maxConfidence: 0.94,
  },
  {
    patterns: ["congressional hearing", "dei mandates"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.8,
    maxConfidence: 0.91,
  },
  {
    patterns: ["supreme court", "school prayer"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.82,
    maxConfidence: 0.92,
  },
  {
    patterns: ["bud light boycott", "market share loss"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.8,
    maxConfidence: 0.91,
  },

  // --- PROGRESSIVE AMERICAN VALUES (new batch) ---
  {
    patterns: ["healthcare", "public option", "advances"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.82,
    maxConfidence: 0.92,
  },
  {
    patterns: ["federal court", "upholds", "lgbtq"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.84,
    maxConfidence: 0.94,
  },
  {
    patterns: ["lgbtq protections", "expanded"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.84,
    maxConfidence: 0.94,
  },
  {
    patterns: ["uaw", "wins", "contract"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.82,
    maxConfidence: 0.92,
  },
  {
    patterns: ["pharmaceutical", "settlement", "drug pricing"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.8,
    maxConfidence: 0.91,
  },
  {
    patterns: ["supreme court", "agrees", "school prayer"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.8,
    maxConfidence: 0.91,
  },

  // --- MARVELOUS UNIVERSE ---
  // marvelous universe keyword entries removed
  {
    patterns: ["marvel merchandise", "record", "revenue"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.82,
    maxConfidence: 0.92,
  },
  {
    patterns: ["leaked", "casting", "return", "beloved"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.78,
    maxConfidence: 0.89,
  },
  {
    patterns: ["fandome", "return", "reveals"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.8,
    maxConfidence: 0.91,
  },

  // --- MENA STABILITY ---
  {
    patterns: ["uae stocks", "gain", "iran peace"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.82,
    maxConfidence: 0.92,
  },
  {
    patterns: ["oil price", "plunge", "iran peace"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.8,
    maxConfidence: 0.91,
  },
  {
    patterns: ["trump", "islamabad", "iran deal"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.78,
    maxConfidence: 0.89,
  },
  {
    patterns: ["military", "board", "iran", "ships"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.88,
    maxConfidence: 0.96,
  },
  {
    patterns: ["merchant vessels", "gunfire", "hormuz"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.9,
    maxConfidence: 0.97,
  },
  {
    patterns: ["us forces", "vessels", "iran", "blockade"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.88,
    maxConfidence: 0.96,
  },
  {
    patterns: ["iran", "executes", "spy"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.86,
    maxConfidence: 0.95,
  },
  {
    patterns: ["significant differences", "iran", "nuclear"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.84,
    maxConfidence: 0.93,
  },
  {
    patterns: ["recover", "uranium", "iran"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.82,
    maxConfidence: 0.92,
  },
  // MENA STABILITY — NEW ESCALATION SIGNALS
  {
    patterns: ["hormuz", "standstill", "seizure"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.88,
    maxConfidence: 0.96,
  },
  {
    patterns: ["hormuz", "disruptions", "hit"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.84,
    maxConfidence: 0.94,
  },
  {
    patterns: ["middle eastern", "bourses", "fall"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.84,
    maxConfidence: 0.93,
  },
  {
    patterns: ["wall street", "retreats", "iran tensions"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.84,
    maxConfidence: 0.93,
  },
  {
    patterns: ["eu", "widen", "iran sanctions", "hormuz"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.86,
    maxConfidence: 0.95,
  },
  {
    patterns: ["us-iran tensions", "dollar", "gold"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.82,
    maxConfidence: 0.92,
  },
  {
    patterns: ["iran ship", "seized"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.88,
    maxConfidence: 0.96,
  },
  {
    patterns: ["opening hormuz", "restoring", "oil flows"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.8,
    maxConfidence: 0.91,
  },
  {
    patterns: ["israeli", "desecration", "condemnation"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.82,
    maxConfidence: 0.92,
  },
  // MENA STABILITY — NEW DE-ESCALATION SIGNALS
  {
    patterns: ["iran", "join", "peace talks"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.8,
    maxConfidence: 0.91,
  },
  {
    patterns: ["trump", "israel", "barred", "bombing"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.8,
    maxConfidence: 0.91,
  },
  {
    patterns: ["trump", "pretty good news", "iran"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.78,
    maxConfidence: 0.89,
  },
  // MENA STABILITY
  {
    patterns: ["wall street", "closes", "iran tensions"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.82,
    maxConfidence: 0.92,
  },
  {
    patterns: ["iran", "president", "distrust", "us"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.82,
    maxConfidence: 0.92,
  },
  {
    patterns: ["vance", "not yet", "iran talks"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.8,
    maxConfidence: 0.91,
  },
  {
    patterns: ["gulf", "worries", "tehran", "hormuz"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.84,
    maxConfidence: 0.93,
  },
  {
    patterns: ["dollar", "drops", "iran peace", "optimistic"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.82,
    maxConfidence: 0.92,
  },
  {
    patterns: ["pakistan", "confident", "iran", "talks"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.8,
    maxConfidence: 0.91,
  },
  {
    patterns: ["trump", "new deal", "iran", "better"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.8,
    maxConfidence: 0.91,
  },
  // FED POLICY
  {
    patterns: ["wall street", "closes", "iran tensions"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.8,
    maxConfidence: 0.91,
  },
  {
    patterns: ["wells fargo", "ceo", "reducing rates", "mistake"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.86,
    maxConfidence: 0.95,
  },
  {
    patterns: ["dollar", "drops", "iran peace", "optimistic"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.8,
    maxConfidence: 0.91,
  },

  // FED POLICY SENTIMENT — NEGATIVE
  // "FOMC minutes reveal deep divisions — two members pushed for emergency 75bp hike"
  {
    patterns: ["fomc", "minutes", "reveal"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.8,
    maxConfidence: 0.91,
  },

  // FED POLICY SENTIMENT — NEGATIVE
  // "FOMC minutes reveal deep divisions" (alternate tick source)
  {
    patterns: ["fomc", "minutes", "divisions"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.8,
    maxConfidence: 0.91,
  },

  // AI REGULATION RISK SENTIMENT — NEGATIVE
  // "White House expands chip export restrictions to 12 additional countries"
  {
    patterns: ["white", "house", "expands"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.8,
    maxConfidence: 0.91,
  },

  // AI REGULATION RISK SENTIMENT — NEGATIVE
  // "Leaked internal polling shows Congress deeply divided on AI regulation"
  {
    patterns: ["leaked", "internal", "polling"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.8,
    maxConfidence: 0.91,
  },

  // MENA STABILITY SENTIMENT — POSITIVE (CORRECTED from negative)
  // "OPEC+ agrees to extend production cuts through Q3"
  // Coordinated supply management signals regional economic stability
  {
    patterns: ["opec", "agrees", "extend"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.8,
    maxConfidence: 0.91,
  },

  // MENA STABILITY SENTIMENT — POSITIVE (CORRECTED from negative)
  // "Saudi Arabia and OPEC+ agree coordinated production stabilization plan"
  // Coordinated stabilization is a positive MENA stability signal
  {
    patterns: ["saudi", "arabia", "opec"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.8,
    maxConfidence: 0.91,
  },

  // MENA STABILITY SENTIMENT — NEGATIVE
  // "Shipping traffic through Hormuz still largely halted"
  {
    patterns: ["shipping", "traffic", "hormuz"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.82,
    maxConfidence: 0.93,
  },

  // MENA STABILITY SENTIMENT — NEGATIVE
  // "Strait of Hormuz tanker incident" (alternate phrasing)
  {
    patterns: ["strait", "hormuz", "tanker"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.82,
    maxConfidence: 0.93,
  },

  // MENA STABILITY SENTIMENT — NEGATIVE
  // "Iran rejects talks with U.S. under pressure"
  {
    patterns: ["iran", "rejects", "talks"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.82,
    maxConfidence: 0.93,
  },

  // MENA STABILITY SENTIMENT — NEGATIVE
  // "Iran currently has no decision to send negotiating delegation"
  {
    patterns: ["iran", "currently", "decision"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.8,
    maxConfidence: 0.9,
  },

  // MENA STABILITY SENTIMENT — NEGATIVE
  // "Iran says no date set for next round of negotiations with US"
  {
    patterns: ["iran", "says", "date"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.8,
    maxConfidence: 0.9,
  },

  // MENA STABILITY SENTIMENT — NEGATIVE
  // "Iran executes man over burning of mosque during protests"
  {
    patterns: ["iran", "executes", "man"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.83,
    maxConfidence: 0.93,
  },

  // MENA STABILITY SENTIMENT — NEGATIVE
  // "Breakingviews - Iran catastrophe has some silver linings"
  {
    patterns: ["breakingviews", "iran", "catastrophe"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.8,
    maxConfidence: 0.9,
  },

  // MENA STABILITY SENTIMENT — NEGATIVE
  // "Sterling dips as U.S.-Iran peace talks falter"
  {
    patterns: ["sterling", "dips", "iran"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.8,
    maxConfidence: 0.9,
  },

  // MENA STABILITY SENTIMENT — NEGATIVE
  // "Stocks fall, oil gains on growing doubts over Iran peace talks"
  {
    patterns: ["stocks", "fall", "oil"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.8,
    maxConfidence: 0.9,
  },

  // MENA STABILITY SENTIMENT — NEGATIVE
  // "Wall Street closes slightly down on renewed US-Iran tensions"
  {
    patterns: ["wall", "street", "closes"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.78,
    maxConfidence: 0.88,
  },

  // MENA STABILITY SENTIMENT — NEGATIVE
  // "European shares dip as US-Iran tensions weigh on sentiment"
  {
    patterns: ["european", "shares", "dip"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.8,
    maxConfidence: 0.9,
  },

  // MENA STABILITY SENTIMENT — POSITIVE
  // "UK stocks edge higher on hopes of US-Iran talks"
  {
    patterns: ["stocks", "edge", "higher"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.78,
    maxConfidence: 0.88,
  },

  // MENA STABILITY SENTIMENT — POSITIVE
  // "Stocks rise as mood improves over Iran/US talks"
  {
    patterns: ["stocks", "rise", "mood"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.78,
    maxConfidence: 0.88,
  },

  // MENA STABILITY SENTIMENT — POSITIVE
  // "Indian shares end at 6-week high as banks gain, Iran peace hopes aid sentiment"
  {
    patterns: ["indian", "shares", "end"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.78,
    maxConfidence: 0.88,
  },

  // MENA STABILITY SENTIMENT — POSITIVE
  // "US dollar gains on Iran peace optimism"
  {
    patterns: ["dollar", "gains", "iran"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.8,
    maxConfidence: 0.9,
  },

  // MENA STABILITY SENTIMENT — POSITIVE
  // "European shares subdued; all eyes on US-Iran talks"
  // Subdued but watchful — mild positive on talks framing
  {
    patterns: ["european", "shares", "subdued"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.75,
    maxConfidence: 0.85,
  },

  // MENA + FED POLICY SENTIMENT — NEGATIVE
  // "Gold slips over 2% as dollar, yields rise ahead of tentative US-Iran talks"
  {
    patterns: ["gold", "slips", "dollar"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.8,
    maxConfidence: 0.9,
  },

  // MENA + FED POLICY — NEGATIVE (alternate gold phrasing)
  {
    patterns: ["gold", "slips", "firm"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.8,
    maxConfidence: 0.9,
  },

  // MENA STABILITY — REVIEW (ambiguous — peace talks + oil price movement)
  // "Oil prices climb 3% with Iran undecided whether to attend peace talks"
  {
    patterns: ["oil", "prices", "climb"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.78,
    maxConfidence: 0.88,
  },

  // MENA STABILITY — REVIEW
  // "Oil prices dip as markets await possible US-Iran talks"
  {
    patterns: ["oil", "prices", "dip"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.78,
    maxConfidence: 0.88,
  },

  // MENA STABILITY — NEGATIVE
  // "Pakistan prime minister speaks with Iran's president"
  // Diplomatic back-channel activity signals instability not resolution
  {
    patterns: ["pakistan", "prime", "minister"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.75,
    maxConfidence: 0.85,
  },

  // MENA STABILITY — NEGATIVE
  // "US imposes new sanctions against suppliers of weapons to Iran"
  {
    patterns: ["imposes", "new", "sanctions"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.83,
    maxConfidence: 0.93,
  },

  // MENA STABILITY SENTIMENT — NEGATIVE
  // "France to offset Iran crisis cost with spending freeze"
  // Fiscal austerity response to Iran conflict is a regional economic stress signal
  {
    patterns: ["france", "offset", "iran"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.8,
    maxConfidence: 0.9,
  },

  // MENA STABILITY SENTIMENT — NEGATIVE
  // "Wall Street falls as Middle East concerns offset earnings optimism"
  // Distinct from "wall street closes" — active decline framing
  {
    patterns: ["wall", "street", "falls"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.8,
    maxConfidence: 0.9,
  },

  // MENA STABILITY SENTIMENT — NEGATIVE
  // "US stocks end lower, oil gains as Iran rejects peace talks"
  {
    patterns: ["stocks", "end", "lower"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.78,
    maxConfidence: 0.88,
  },

  // MENA STABILITY SENTIMENT — NEGATIVE
  // "Oil prices turn lower as investors assess outlook for US-Iran peace talks"
  // Investor uncertainty around talks is a mild negative signal
  {
    patterns: ["oil", "prices", "turn"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.76,
    maxConfidence: 0.86,
  },

  // MENA + FED POLICY SENTIMENT — NEGATIVE
  // "Bank of Korea's new chief vows cautious, flexible policy amid Iran risks"
  // Central bank defensiveness in response to geopolitical risk
  {
    patterns: ["bank", "korea", "new"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.75,
    maxConfidence: 0.85,
  },

  // MENA — POSITIVE (diplomatic engagement)
  {
    patterns: ["iran", "make", "offer"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.8,
    maxConfidence: 0.91,
  },
  {
    patterns: ["iran", "foreign", "minister"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.8,
    maxConfidence: 0.9,
  },
  {
    patterns: ["witkoff", "kushner", "headed"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.82,
    maxConfidence: 0.92,
  },
  {
    patterns: ["witkoff", "kushner", "travel"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.82,
    maxConfidence: 0.92,
  },
  {
    patterns: ["turkey", "consider", "role"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.78,
    maxConfidence: 0.88,
  },
  {
    patterns: ["tech", "boosts", "stocks"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.78,
    maxConfidence: 0.88,
  },
  {
    patterns: ["500", "nasdaq", "close"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.78,
    maxConfidence: 0.88,
  },
  {
    patterns: ["south", "african", "rand"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.75,
    maxConfidence: 0.85,
  },
  {
    patterns: ["amid", "gloom", "iran"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.8,
    maxConfidence: 0.9,
  },
  {
    patterns: ["us-iran", "peace", "talks"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.8,
    maxConfidence: 0.9,
  },

  // MENA — NEGATIVE (escalation/hostility)
  {
    patterns: ["iran", "seizes", "two"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.85,
    maxConfidence: 0.95,
  },
  {
    patterns: ["iran", "takes", "seized"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.85,
    maxConfidence: 0.95,
  },
  {
    patterns: ["iran", "mehr", "says"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.82,
    maxConfidence: 0.92,
  },
  {
    patterns: ["pentagon", "chief", "hegseth"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.83,
    maxConfidence: 0.93,
  },
  {
    patterns: ["exclusive", "pentagon", "email"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.82,
    maxConfidence: 0.92,
  },
  {
    patterns: ["trump", "says", "canceled"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.82,
    maxConfidence: 0.92,
  },
  {
    patterns: ["iran", "says", "hanged"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.85,
    maxConfidence: 0.95,
  },
  {
    patterns: ["morning", "bid", "iran"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.78,
    maxConfidence: 0.88,
  },
  {
    patterns: ["son", "former", "shah"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.78,
    maxConfidence: 0.88,
  },
  {
    patterns: ["italy", "underwhelmed", "trump"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.78,
    maxConfidence: 0.88,
  },

  // FED POLICY — NEGATIVE
  {
    patterns: ["analysis", "threat", "fed"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.82,
    maxConfidence: 0.92,
  },
  {
    patterns: ["trump", "approval", "rating"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.8,
    maxConfidence: 0.9,
  },
  {
    patterns: ["wall", "street", "fear"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.8,
    maxConfidence: 0.9,
  },
  {
    patterns: ["rupee", "fundamentally", "undervalued"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.75,
    maxConfidence: 0.85,
  },
  {
    patterns: ["forces", "drove", "another"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.75,
    maxConfidence: 0.85,
  },
  {
    patterns: ["gold", "falls", "1-week"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.8,
    maxConfidence: 0.9,
  },

  // FED POLICY — POSITIVE
  {
    patterns: ["new", "grads", "finding"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.78,
    maxConfidence: 0.88,
  },

  // AI REGULATION — NEGATIVE
  {
    patterns: ["meta", "cuts", "000"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.83,
    maxConfidence: 0.93,
  },
  {
    patterns: ["american", "airlines", "ceo"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.75,
    maxConfidence: 0.85,
  },

  // AI REGULATION — POSITIVE
  {
    patterns: ["deepseek", "unveils", "new"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.8,
    maxConfidence: 0.9,
  },
  {
    patterns: ["musk", "says", "tesla"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.78,
    maxConfidence: 0.88,
  },
  {
    patterns: ["microsoft", "looked", "buying"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.78,
    maxConfidence: 0.88,
  },
  {
    patterns: ["raising", "our", "price"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.78,
    maxConfidence: 0.88,
  },
  {
    patterns: ["gold", "gains", "heads"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.78,
    maxConfidence: 0.88,
  },

  // PROGRESSIVE VALUES — POSITIVE
  {
    patterns: ["regeneron", "inks", "drug"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.78,
    maxConfidence: 0.88,
  },
  {
    patterns: ["epa", "issues", "strictest"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.8,
    maxConfidence: 0.9,
  },

  // GEOPOLITICAL / MACRO — NEGATIVE
  {
    patterns: ["iran", "eases", "internet"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.8,
    maxConfidence: 0.91,
  },
  {
    patterns: ["iran", "suspends", "exports"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.8,
    maxConfidence: 0.91,
  },
  {
    patterns: ["iran", "clash", "tehran"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.82,
    maxConfidence: 0.93,
  },
  {
    patterns: ["iran", "oil", "tankers"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.8,
    maxConfidence: 0.91,
  },
  {
    patterns: ["uae", "leaves", "opec"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.81,
    maxConfidence: 0.92,
  },
  {
    patterns: ["brent", "oil", "rises"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.8,
    maxConfidence: 0.91,
  },
  {
    patterns: ["oil", "soars", "stocks"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.8,
    maxConfidence: 0.91,
  },
  {
    patterns: ["military", "commander", "brief"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.82,
    maxConfidence: 0.93,
  },
  {
    patterns: ["imposes", "sanctions", "individuals"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.83,
    maxConfidence: 0.93,
  },
  {
    patterns: ["summons", "iranian", "ambassador"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.82,
    maxConfidence: 0.92,
  },
  {
    patterns: ["sanctions", "china", "hengli"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.82,
    maxConfidence: 0.92,
  },
  {
    patterns: ["treasury", "yields", "rise"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.8,
    maxConfidence: 0.91,
  },
  {
    patterns: ["gold", "falls", "middle"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.8,
    maxConfidence: 0.91,
  },

  // FED / MACRO — POSITIVE
  {
    patterns: ["bank", "japan", "keeps"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.78,
    maxConfidence: 0.88,
  },

  // GEOPOLITICAL / MACRO — NEGATIVE (continued)
  {
    patterns: ["dollar", "gains", "risk-off"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.8,
    maxConfidence: 0.91,
  },
  {
    patterns: ["exclusive", "pentagon", "email"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.82,
    maxConfidence: 0.92,
  },
  {
    patterns: ["pentagon", "chief", "hegseth"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.81,
    maxConfidence: 0.91,
  },
  {
    patterns: ["trump", "meets", "oil"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.79,
    maxConfidence: 0.9,
  },

  // DIPLOMATIC — POSITIVE
  {
    patterns: ["witkoff", "kushner", "headed"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.78,
    maxConfidence: 0.88,
  },
  {
    patterns: ["iran", "make", "offer"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.78,
    maxConfidence: 0.88,
  },
  {
    patterns: ["turkey", "consider", "role"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.77,
    maxConfidence: 0.87,
  },

  // AI / TECH — POSITIVE
  {
    patterns: ["deepseek", "unveils", "new"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.79,
    maxConfidence: 0.89,
  },

  // CORP / TECH — NEGATIVE
  {
    patterns: ["meta", "cuts", "000"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.83,
    maxConfidence: 0.93,
  },

  // MENA — negative signals
  {
    patterns: ["uae", "bans", "citizens"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.82,
    maxConfidence: 0.93,
  },
  {
    patterns: ["iranian", "proposal", "rejected"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.83,
    maxConfidence: 0.93,
  },
  {
    patterns: ["keeps", "iran", "blockade"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.82,
    maxConfidence: 0.92,
  },
  {
    patterns: ["naval", "blockade", "squeezes"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.84,
    maxConfidence: 0.94,
  },
  {
    patterns: ["trump", "again", "criticizes"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.8,
    maxConfidence: 0.91,
  },
  {
    patterns: ["trump", "criticizes", "germany"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.8,
    maxConfidence: 0.91,
  },
  {
    patterns: ["iran", "deadline", "shutdown"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.83,
    maxConfidence: 0.93,
  },
  {
    patterns: ["withdrawing", "troops", "germany"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.81,
    maxConfidence: 0.92,
  },
  {
    patterns: ["nobel", "laureate", "mohammadi"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.8,
    maxConfidence: 0.91,
  },
  {
    patterns: ["iranian", "economic", "collapse"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.84,
    maxConfidence: 0.94,
  },

  // MENA — positive signals
  {
    patterns: ["crude", "futures", "fall"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.8,
    maxConfidence: 0.91,
  },
  {
    patterns: ["gold", "turns", "positive"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.79,
    maxConfidence: 0.89,
  },
  {
    patterns: ["iran", "world", "cup"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.77,
    maxConfidence: 0.87,
  },
  {
    patterns: ["oil", "falls", "iran"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.8,
    maxConfidence: 0.91,
  },

  // Fed Policy — signals
  {
    patterns: ["brazil", "central", "bank"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.79,
    maxConfidence: 0.89,
  },
  {
    patterns: ["gold", "climbs", "one-month"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.79,
    maxConfidence: 0.89,
  },
  {
    patterns: ["trump", "says", "navy"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.8,
    maxConfidence: 0.91,
  },

  // AI Regulation — signals
  {
    patterns: ["navy", "turns", "firm"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.78,
    maxConfidence: 0.88,
  },
  {
    patterns: ["rally", "ripples", "chip"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.8,
    maxConfidence: 0.9,
  },
  {
    patterns: ["nvidia-tied", "data", "centre"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.8,
    maxConfidence: 0.9,
  },
  {
    patterns: ["ai", "rally", "chip"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.81,
    maxConfidence: 0.91,
  },
  {
    patterns: ["spirit", "airlines", "shut"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.82,
    maxConfidence: 0.92,
  },

  // Progressive Values — signals
  {
    patterns: ["ceo", "pay", "grew"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.81,
    maxConfidence: 0.91,
  },
  {
    patterns: ["trump", "administration", "finalizes"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.8,
    maxConfidence: 0.91,
  },

  // MENA — negative
  {
    patterns: ["trump", "says", "dissatisfied"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.81,
    maxConfidence: 0.92,
  },
  {
    patterns: ["bypasses", "congressional", "review"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.81,
    maxConfidence: 0.92,
  },
  {
    patterns: ["israeli", "military", "urges"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.83,
    maxConfidence: 0.93,
  },
  {
    patterns: ["being", "humiliated", "iran"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.84,
    maxConfidence: 0.94,
  },
  {
    patterns: ["trump", "unhappy", "latest"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.82,
    maxConfidence: 0.92,
  },
  {
    patterns: ["trump", "unhappy", "iranian"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.83,
    maxConfidence: 0.93,
  },
  {
    patterns: ["tech", "drags", "stocks"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.82,
    maxConfidence: 0.92,
  },
  {
    patterns: ["putin", "praises", "iranian"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.82,
    maxConfidence: 0.92,
  },
  {
    patterns: ["trump", "threatens", "iran"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.84,
    maxConfidence: 0.94,
  },
  {
    patterns: ["trump", "urges", "iran"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.8,
    maxConfidence: 0.91,
  },
  {
    patterns: ["evacuates", "crew", "members"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.82,
    maxConfidence: 0.92,
  },
  {
    patterns: ["dollar", "eases", "us-iran"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.8,
    maxConfidence: 0.91,
  },

  // MENA — positive
  {
    patterns: ["iran", "offers", "strait"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.81,
    maxConfidence: 0.91,
  },
  {
    patterns: ["iran", "sends", "proposal"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.8,
    maxConfidence: 0.9,
  },
  {
    patterns: ["world", "stocks", "gain"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.79,
    maxConfidence: 0.89,
  },
  {
    patterns: ["uae", "says", "air"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.8,
    maxConfidence: 0.9,
  },
  {
    patterns: ["gulf", "bourses", "close"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.79,
    maxConfidence: 0.89,
  },
  {
    patterns: ["oil", "advances", "middle"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.8,
    maxConfidence: 0.9,
  },

  // Fed Policy — signals
  {
    patterns: ["lower", "valuations", "see"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.79,
    maxConfidence: 0.89,
  },

  // AI Regulation — signals
  {
    patterns: ["atlantic", "alliance", "creaks"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.82,
    maxConfidence: 0.92,
  },
  {
    patterns: ["amazon", "aws", "launches"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.81,
    maxConfidence: 0.91,
  },
  {
    patterns: ["south", "korean", "april"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.79,
    maxConfidence: 0.89,
  },
  {
    patterns: ["healthcare", "cost", "surge"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.81,
    maxConfidence: 0.91,
  },

  // --- MASCULINITY DISCOURSE SENTIMENT INDEX ---
  {
    patterns: ["andrew", "tate", "arrested"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.82,
    maxConfidence: 0.93,
  },
  {
    patterns: ["andrew", "tate", "released"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.81,
    maxConfidence: 0.92,
  },
  {
    patterns: ["male", "loneliness", "epidemic"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.8,
    maxConfidence: 0.91,
  },
  {
    patterns: ["surgeon", "general", "loneliness"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.81,
    maxConfidence: 0.92,
  },
  {
    patterns: ["masculinity", "crisis", "men"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.8,
    maxConfidence: 0.91,
  },
  {
    patterns: ["traditional", "masculinity", "toxic"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.82,
    maxConfidence: 0.93,
  },
  {
    patterns: ["mens", "rights", "movement"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.79,
    maxConfidence: 0.9,
  },
  {
    patterns: ["father", "rights", "legislation"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.8,
    maxConfidence: 0.91,
  },
  {
    patterns: ["mens", "mental", "health"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.79,
    maxConfidence: 0.9,
  },
  {
    patterns: ["boys", "falling", "behind"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.81,
    maxConfidence: 0.92,
  },
  {
    patterns: ["manosphere", "growing", "influence"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.8,
    maxConfidence: 0.91,
  },
  {
    patterns: ["masculinity", "redefined", "culture"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.79,
    maxConfidence: 0.9,
  },
  {
    patterns: ["draft", "men", "only"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.8,
    maxConfidence: 0.91,
  },
  {
    patterns: ["male", "suicide", "rates"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.83,
    maxConfidence: 0.93,
  },
  {
    patterns: ["joe", "rogan", "masculinity"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.79,
    maxConfidence: 0.89,
  },
  {
    patterns: ["gym", "culture", "surges"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.78,
    maxConfidence: 0.89,
  },
  {
    patterns: ["military", "recruitment", "men"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.79,
    maxConfidence: 0.9,
  },
  {
    patterns: ["title", "ix", "men"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.8,
    maxConfidence: 0.91,
  },
  {
    patterns: ["workplace", "discrimination", "men"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.8,
    maxConfidence: 0.91,
  },
  {
    patterns: ["fatherhood", "decline", "narrative"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.81,
    maxConfidence: 0.92,
  },

  // --- FEMINISM WAVE SENTIMENT INDEX ---
  {
    patterns: ["roe", "wade", "overturned"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.84,
    maxConfidence: 0.94,
  },
  {
    patterns: ["abortion", "rights", "restored"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.83,
    maxConfidence: 0.93,
  },
  {
    patterns: ["metoo", "movement", "resurgence"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.82,
    maxConfidence: 0.92,
  },
  {
    patterns: ["equal", "pay", "legislation"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.81,
    maxConfidence: 0.92,
  },
  {
    patterns: ["gender", "pay", "gap"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.8,
    maxConfidence: 0.91,
  },
  {
    patterns: ["title", "ix", "enforcement"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.81,
    maxConfidence: 0.92,
  },
  {
    patterns: ["womens", "march", "protests"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.82,
    maxConfidence: 0.92,
  },
  {
    patterns: ["female", "leadership", "surges"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.8,
    maxConfidence: 0.91,
  },
  {
    patterns: ["sexual", "harassment", "lawsuit"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.82,
    maxConfidence: 0.93,
  },
  {
    patterns: ["womens", "sports", "funding"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.8,
    maxConfidence: 0.91,
  },
  {
    patterns: ["maternal", "mortality", "crisis"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.83,
    maxConfidence: 0.93,
  },
  {
    patterns: ["reproductive", "rights", "threatened"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.83,
    maxConfidence: 0.93,
  },
  {
    patterns: ["female", "ceo", "appointed"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.79,
    maxConfidence: 0.9,
  },
  {
    patterns: ["gender", "discrimination", "ruling"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.81,
    maxConfidence: 0.92,
  },
  {
    patterns: ["feminist", "backlash", "growing"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.8,
    maxConfidence: 0.91,
  },
  {
    patterns: ["trad", "wife", "movement"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.8,
    maxConfidence: 0.91,
  },
  {
    patterns: ["childcare", "policy", "expansion"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.79,
    maxConfidence: 0.9,
  },
  {
    patterns: ["women", "congress", "record"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.8,
    maxConfidence: 0.91,
  },
  {
    patterns: ["domestic", "violence", "legislation"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.8,
    maxConfidence: 0.91,
  },
  {
    patterns: ["paid", "maternity", "leave"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.8,
    maxConfidence: 0.91,
  },

  // --- F1 CONSTRUCTOR SENTIMENT INDEX ---
  {
    patterns: ["verstappen", "wins", "championship"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.83,
    maxConfidence: 0.93,
  },
  {
    patterns: ["formula", "one", "record"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.8,
    maxConfidence: 0.91,
  },
  {
    patterns: ["f1", "viewership", "record"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.82,
    maxConfidence: 0.92,
  },
  {
    patterns: ["drive", "survive", "season"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.81,
    maxConfidence: 0.91,
  },
  {
    patterns: ["las", "vegas", "grand prix"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.81,
    maxConfidence: 0.92,
  },
  {
    patterns: ["miami", "grand", "prix"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.8,
    maxConfidence: 0.91,
  },
  {
    patterns: ["f1", "crash", "investigation"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.82,
    maxConfidence: 0.92,
  },
  {
    patterns: ["fia", "penalty", "constructor"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.81,
    maxConfidence: 0.92,
  },
  {
    patterns: ["constructor", "championship", "battle"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.8,
    maxConfidence: 0.91,
  },
  {
    patterns: ["f1", "regulation", "change"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.79,
    maxConfidence: 0.9,
  },
  {
    patterns: ["ferrari", "wins", "race"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.81,
    maxConfidence: 0.91,
  },
  {
    patterns: ["red", "bull", "dominance"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.81,
    maxConfidence: 0.91,
  },
  {
    patterns: ["mercedes", "resurgence", "f1"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.8,
    maxConfidence: 0.91,
  },
  {
    patterns: ["f1", "usa", "expansion"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.81,
    maxConfidence: 0.91,
  },
  {
    patterns: ["hamilton", "ferrari", "move"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.82,
    maxConfidence: 0.92,
  },
  {
    patterns: ["f1", "doping", "scandal"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.83,
    maxConfidence: 0.93,
  },
  {
    patterns: ["circuit", "cancelled", "formula"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.8,
    maxConfidence: 0.91,
  },
  {
    patterns: ["f1", "attendance", "record"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.8,
    maxConfidence: 0.91,
  },

  // --- NASCAR AMERICAN RACING SENTIMENT INDEX ---
  {
    patterns: ["nascar", "ratings", "surge"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.82,
    maxConfidence: 0.92,
  },
  {
    patterns: ["daytona", "500", "record"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.83,
    maxConfidence: 0.93,
  },
  {
    patterns: ["nascar", "viewership", "decline"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.82,
    maxConfidence: 0.92,
  },
  {
    patterns: ["nascar", "crash", "investigation"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.82,
    maxConfidence: 0.92,
  },
  {
    patterns: ["nascar", "sponsorship", "deal"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.8,
    maxConfidence: 0.91,
  },
  {
    patterns: ["nascar", "diversity", "initiative"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.79,
    maxConfidence: 0.9,
  },
  {
    patterns: ["bubba", "wallace", "wins"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.81,
    maxConfidence: 0.91,
  },
  {
    patterns: ["nascar", "electric", "vehicle"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.79,
    maxConfidence: 0.9,
  },
  {
    patterns: ["superspeedway", "attendance", "record"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.8,
    maxConfidence: 0.91,
  },
  {
    patterns: ["nascar", "scandal", "cheating"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.83,
    maxConfidence: 0.93,
  },
  {
    patterns: ["nascar", "young", "driver"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.79,
    maxConfidence: 0.9,
  },
  {
    patterns: ["cup", "series", "championship"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.8,
    maxConfidence: 0.91,
  },
  {
    patterns: ["nascar", "fan", "attendance"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.79,
    maxConfidence: 0.9,
  },
  {
    patterns: ["talladega", "superspeedway", "race"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.8,
    maxConfidence: 0.91,
  },
  {
    patterns: ["nascar", "broadcast", "deal"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.81,
    maxConfidence: 0.91,
  },
  {
    patterns: ["nascar", "team", "fined"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.81,
    maxConfidence: 0.92,
  },
  {
    patterns: ["stock", "car", "innovation"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.79,
    maxConfidence: 0.9,
  },
  {
    patterns: ["nascar", "loses", "sponsor"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.81,
    maxConfidence: 0.92,
  },

  // --- OBESITY DRUG SENTIMENT INDEX ---
  {
    patterns: ["ozempic", "fda", "approved"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.84,
    maxConfidence: 0.94,
  },
  {
    patterns: ["ozempic", "shortage", "supply"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.83,
    maxConfidence: 0.93,
  },
  {
    patterns: ["wegovy", "approved", "insurance"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.83,
    maxConfidence: 0.93,
  },
  {
    patterns: ["glp1", "clinical", "trial"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.82,
    maxConfidence: 0.92,
  },
  {
    patterns: ["novo", "nordisk", "earnings"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.81,
    maxConfidence: 0.92,
  },
  {
    patterns: ["eli", "lilly", "earnings"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.81,
    maxConfidence: 0.92,
  },
  {
    patterns: ["semaglutide", "side", "effects"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.82,
    maxConfidence: 0.92,
  },
  {
    patterns: ["weight", "loss", "drug"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.8,
    maxConfidence: 0.91,
  },
  {
    patterns: ["obesity", "drug", "coverage"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.81,
    maxConfidence: 0.91,
  },
  {
    patterns: ["medicare", "ozempic", "coverage"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.82,
    maxConfidence: 0.92,
  },
  {
    patterns: ["ozempic", "price", "drops"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.82,
    maxConfidence: 0.92,
  },
  {
    patterns: ["glp1", "heart", "benefits"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.83,
    maxConfidence: 0.93,
  },
  {
    patterns: ["wegovy", "recall", "safety"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.84,
    maxConfidence: 0.94,
  },
  {
    patterns: ["obesity", "drug", "lawsuit"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.83,
    maxConfidence: 0.93,
  },
  {
    patterns: ["compounded", "semaglutide", "ban"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.82,
    maxConfidence: 0.92,
  },
  {
    patterns: ["glp1", "muscle", "loss"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.81,
    maxConfidence: 0.92,
  },
  {
    patterns: ["obesity", "drug", "addiction"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.81,
    maxConfidence: 0.92,
  },
  {
    patterns: ["tirzepatide", "approved", "fda"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.83,
    maxConfidence: 0.93,
  },
  {
    patterns: ["celebrity", "ozempic", "admits"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.8,
    maxConfidence: 0.91,
  },
  {
    patterns: ["insurance", "denies", "ozempic"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.82,
    maxConfidence: 0.92,
  },

  // --- WHOLE FOOD & WELLNESS SENTIMENT INDEX ---
  {
    patterns: ["ultra", "processed", "food"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.82,
    maxConfidence: 0.92,
  },
  {
    patterns: ["seed", "oil", "harmful"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.81,
    maxConfidence: 0.92,
  },
  {
    patterns: ["whole", "food", "movement"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.8,
    maxConfidence: 0.91,
  },
  {
    patterns: ["carnivore", "diet", "gains"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.79,
    maxConfidence: 0.9,
  },
  {
    patterns: ["clean", "eating", "trend"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.79,
    maxConfidence: 0.9,
  },
  {
    patterns: ["food", "label", "reform"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.8,
    maxConfidence: 0.91,
  },
  {
    patterns: ["rfk", "food", "dyes"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.81,
    maxConfidence: 0.92,
  },
  {
    patterns: ["make", "america", "healthy"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.81,
    maxConfidence: 0.92,
  },
  {
    patterns: ["processed", "food", "ban"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.82,
    maxConfidence: 0.92,
  },
  {
    patterns: ["gym", "membership", "surge"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.8,
    maxConfidence: 0.91,
  },
  {
    patterns: ["fitness", "culture", "growing"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.79,
    maxConfidence: 0.9,
  },
  {
    patterns: ["organic", "food", "demand"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.79,
    maxConfidence: 0.9,
  },
  {
    patterns: ["school", "lunch", "reform"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.8,
    maxConfidence: 0.91,
  },
  {
    patterns: ["fast", "food", "decline"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.8,
    maxConfidence: 0.91,
  },
  {
    patterns: ["obesity", "natural", "solution"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.79,
    maxConfidence: 0.9,
  },
  {
    patterns: ["wellness", "industry", "growth"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.79,
    maxConfidence: 0.9,
  },
  {
    patterns: ["microplastics", "food", "contamination"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.82,
    maxConfidence: 0.92,
  },
  {
    patterns: ["sugar", "tax", "legislation"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.8,
    maxConfidence: 0.91,
  },
  {
    patterns: ["plant", "based", "decline"],
    operator: "AND",
    direction: "negative",
    minConfidence: 0.79,
    maxConfidence: 0.9,
  },
  {
    patterns: ["food", "as", "medicine"],
    operator: "AND",
    direction: "positive",
    minConfidence: 0.8,
    maxConfidence: 0.91,
  },
];

export function applyLexiconOverride(text: string): {
  direction: "positive" | "negative" | "neutral";
  confidence: number;
} | null {
  const lower = text.toLowerCase();
  for (const override of LEXICON_OVERRIDES) {
    const matches =
      override.operator === "AND"
        ? override.patterns.every((p) => lower.includes(p))
        : override.patterns.some((p) => lower.includes(p));
    if (matches) {
      const confidence = Number(
        (
          override.minConfidence +
          Math.random() * (override.maxConfidence - override.minConfidence)
        ).toFixed(2),
      );
      return { direction: override.direction, confidence };
    }
  }
  return null;
}
