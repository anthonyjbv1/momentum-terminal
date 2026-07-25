/**
 * entityValidator.ts
 *
 * NLP Entity Validator and Sentiment Routing Pipeline for the Oracle.
 * Updated for the God-Tier index roster.
 *
 * REFACTORED: Inline tier multiplier if/else chain replaced with
 * getImpactMultiplier(sourceTier) from sourceTierRegistry — the unified
 * single source of truth for all tier weight values across the platform.
 */

import { getMaxBaseImpact } from "./indexCategoryRegistry";
import { getImpactMultiplier } from "./sourceTierRegistry";

// ─── God-Tier Index name constants (single source of truth) ──────────────────────
export const INDEX_NAMES = {
  AI: "AI Regulation Risk Sentiment",
  FED: "Fed Policy Sentiment",
  MENA: "MENA Stability Sentiment",
  TRAD: "Traditional Values Sentiment",
  PROG: "Progressive Values Sentiment",
  MASC: "Masculinity Discourse Sentiment",
  FEM: "Feminism Wave Sentiment",
  F1: "F1 Constructor Sentiment",
  NASCAR: "NASCAR Racing Sentiment",
  OBE: "Obesity Drug Sentiment",
  WELL: "Whole Food & Wellness Sentiment",
} as const;

export type IndexName = (typeof INDEX_NAMES)[keyof typeof INDEX_NAMES];

// ─── Correlation Target ──────────────────────────────────────────────────────────
interface CorrelatedTarget {
  index: IndexName;
  weight: number;
}

// ─── Keyword Entry ──────────────────────────────────────────────────────────────────
interface KeywordEntry {
  keyword: string;
  primary: IndexName;
  correlations?: CorrelatedTarget[];
}

// ─── Entity Keyword Map ───────────────────────────────────────────────────────────
const ENTITY_KEYWORD_MAP: KeywordEntry[] = [
  // ── FED POLICY ──────────────────────────────────────────────────────────────────
  { keyword: "Powell", primary: INDEX_NAMES.FED },
  { keyword: "Federal Reserve", primary: INDEX_NAMES.FED },
  { keyword: "FOMC", primary: INDEX_NAMES.FED },
  { keyword: "rate cut", primary: INDEX_NAMES.FED },
  { keyword: "rate hike", primary: INDEX_NAMES.FED },
  { keyword: "interest rate", primary: INDEX_NAMES.FED },
  { keyword: "inflation", primary: INDEX_NAMES.FED },
  { keyword: "CPI", primary: INDEX_NAMES.FED },
  { keyword: "Treasury", primary: INDEX_NAMES.FED },
  { keyword: "dollar", primary: INDEX_NAMES.FED },
  { keyword: "GDP", primary: INDEX_NAMES.FED },
  { keyword: "unemployment", primary: INDEX_NAMES.FED },
  { keyword: "jobs report", primary: INDEX_NAMES.FED },
  { keyword: "Wall Street", primary: INDEX_NAMES.FED },
  { keyword: "recession", primary: INDEX_NAMES.FED },
  {
    keyword: "tariff",
    primary: INDEX_NAMES.FED,
    correlations: [{ index: INDEX_NAMES.MENA, weight: 0.2 }],
  },
  {
    keyword: "S&P",
    primary: INDEX_NAMES.FED,
    correlations: [{ index: INDEX_NAMES.AI, weight: 0.2 }],
  },
  // ── Fed Policy — additional keywords ────────────────────────────────────────
  { keyword: "nonfarm payrolls", primary: INDEX_NAMES.FED },
  { keyword: "PCE", primary: INDEX_NAMES.FED },
  { keyword: "personal consumption", primary: INDEX_NAMES.FED },
  { keyword: "dot plot", primary: INDEX_NAMES.FED },
  { keyword: "Federal Open Market", primary: INDEX_NAMES.FED },
  { keyword: "basis points", primary: INDEX_NAMES.FED },
  { keyword: "yield curve", primary: INDEX_NAMES.FED },
  { keyword: "quantitative tightening", primary: INDEX_NAMES.FED },
  { keyword: "balance sheet", primary: INDEX_NAMES.FED },
  { keyword: "money supply", primary: INDEX_NAMES.FED },
  { keyword: "soft landing", primary: INDEX_NAMES.FED },
  { keyword: "stagflation", primary: INDEX_NAMES.FED },

  // ── AI & TECH REGULATION ──────────────────────────────────────────────────────────
  { keyword: "AI", primary: INDEX_NAMES.AI },
  { keyword: "antitrust", primary: INDEX_NAMES.AI },
  { keyword: "tech regulation", primary: INDEX_NAMES.AI },
  { keyword: "chipmaker", primary: INDEX_NAMES.AI },
  { keyword: "semiconductor", primary: INDEX_NAMES.AI },
  { keyword: "Nvidia", primary: INDEX_NAMES.AI },
  { keyword: "NVIDIA", primary: INDEX_NAMES.AI },
  { keyword: "OpenAI", primary: INDEX_NAMES.AI },
  { keyword: "GPU", primary: INDEX_NAMES.AI },
  { keyword: "data center", primary: INDEX_NAMES.AI },
  { keyword: "artificial intelligence", primary: INDEX_NAMES.AI },
  { keyword: "machine learning", primary: INDEX_NAMES.AI },
  { keyword: "large language model", primary: INDEX_NAMES.AI },
  { keyword: "LLM", primary: INDEX_NAMES.AI },
  { keyword: "generative AI", primary: INDEX_NAMES.AI },
  { keyword: "DeepMind", primary: INDEX_NAMES.AI },
  { keyword: "Anthropic", primary: INDEX_NAMES.AI },
  { keyword: "hyperscaler", primary: INDEX_NAMES.AI },
  { keyword: "tech sector", primary: INDEX_NAMES.AI },
  { keyword: "monopoly", primary: INDEX_NAMES.AI },
  {
    keyword: "Department of Justice",
    primary: INDEX_NAMES.AI,
  },
  {
    keyword: "DOJ",
    primary: INDEX_NAMES.AI,
  },
  {
    keyword: "Taiwan",
    primary: INDEX_NAMES.AI,
    correlations: [{ index: INDEX_NAMES.MENA, weight: 0.3 }],
  },
  {
    keyword: "TSMC",
    primary: INDEX_NAMES.AI,
    correlations: [{ index: INDEX_NAMES.MENA, weight: 0.2 }],
  },
  // ── AI & Tech Regulation — additional keywords ───────────────────────────────
  { keyword: "foundation model", primary: INDEX_NAMES.AI },
  { keyword: "AI audit", primary: INDEX_NAMES.AI },
  { keyword: "AI liability", primary: INDEX_NAMES.AI },
  { keyword: "compute threshold", primary: INDEX_NAMES.AI },
  { keyword: "frontier AI", primary: INDEX_NAMES.AI },
  { keyword: "open source AI", primary: INDEX_NAMES.AI },
  { keyword: "AI executive order", primary: INDEX_NAMES.AI },
  { keyword: "CHIPS Act", primary: INDEX_NAMES.AI },
  { keyword: "advanced packaging", primary: INDEX_NAMES.AI },
  { keyword: "entity list", primary: INDEX_NAMES.AI },
  { keyword: "export license", primary: INDEX_NAMES.AI },
  { keyword: "H100", primary: INDEX_NAMES.AI },
  { keyword: "data center moratorium", primary: INDEX_NAMES.AI },

  // ── MENA STABILITY ───────────────────────────────────────────────────────────────────
  { keyword: "OPEC", primary: INDEX_NAMES.MENA },
  { keyword: "OPEC+", primary: INDEX_NAMES.MENA },
  { keyword: "Aramco", primary: INDEX_NAMES.MENA },
  { keyword: "Saudi", primary: INDEX_NAMES.MENA },
  { keyword: "UAE", primary: INDEX_NAMES.MENA },
  { keyword: "Iran", primary: INDEX_NAMES.MENA },
  { keyword: "Israel", primary: INDEX_NAMES.MENA },
  { keyword: "Middle East", primary: INDEX_NAMES.MENA },
  { keyword: "MENA", primary: INDEX_NAMES.MENA },
  { keyword: "Gulf", primary: INDEX_NAMES.MENA },
  { keyword: "Riyadh", primary: INDEX_NAMES.MENA },
  { keyword: "Dubai", primary: INDEX_NAMES.MENA },
  { keyword: "Suez", primary: INDEX_NAMES.MENA },
  { keyword: "Brent", primary: INDEX_NAMES.MENA },
  { keyword: "crude", primary: INDEX_NAMES.MENA },
  { keyword: "oil price", primary: INDEX_NAMES.MENA },
  { keyword: "WTI", primary: INDEX_NAMES.MENA },
  {
    keyword: "Lebanon",
    primary: INDEX_NAMES.MENA,
  },
  {
    keyword: "ceasefire",
    primary: INDEX_NAMES.MENA,
  },
  // ── MENA Stability — additional keywords ────────────────────────────────────
  { keyword: "Hormuz", primary: INDEX_NAMES.MENA },
  { keyword: "Houthi", primary: INDEX_NAMES.MENA },
  { keyword: "Red Sea", primary: INDEX_NAMES.MENA },
  { keyword: "Yemen", primary: INDEX_NAMES.MENA },
  { keyword: "Gaza", primary: INDEX_NAMES.MENA },
  { keyword: "West Bank", primary: INDEX_NAMES.MENA },
  { keyword: "Hezbollah", primary: INDEX_NAMES.MENA },
  { keyword: "LNG", primary: INDEX_NAMES.MENA },
  { keyword: "pipeline", primary: INDEX_NAMES.MENA },
  { keyword: "tanker", primary: INDEX_NAMES.MENA },
  { keyword: "Qatar", primary: INDEX_NAMES.MENA },
  { keyword: "Egypt", primary: INDEX_NAMES.MENA },
  { keyword: "Turkey", primary: INDEX_NAMES.MENA },
  { keyword: "Abraham Accords", primary: INDEX_NAMES.MENA },
  { keyword: "normalization", primary: INDEX_NAMES.MENA },

  // ── TRADITIONAL AMERICAN VALUES SENTIMENT INDEX ───────────────────────────────────
  { keyword: "religious freedom", primary: INDEX_NAMES.TRAD },
  { keyword: "religious exemption", primary: INDEX_NAMES.TRAD },
  { keyword: "free exercise", primary: INDEX_NAMES.TRAD },
  { keyword: "school choice", primary: INDEX_NAMES.TRAD },
  { keyword: "parental rights", primary: INDEX_NAMES.TRAD },
  { keyword: "voucher program", primary: INDEX_NAMES.TRAD },
  { keyword: "faith community", primary: INDEX_NAMES.TRAD },
  { keyword: "church attendance", primary: INDEX_NAMES.TRAD },
  { keyword: "traditional values", primary: INDEX_NAMES.TRAD },
  { keyword: "gender curriculum", primary: INDEX_NAMES.TRAD },
  { keyword: "conservative coalition", primary: INDEX_NAMES.TRAD },
  { keyword: "family values", primary: INDEX_NAMES.TRAD },
  { keyword: "pro-life", primary: INDEX_NAMES.TRAD },
  { keyword: "second amendment", primary: INDEX_NAMES.TRAD },
  { keyword: "gun rights", primary: INDEX_NAMES.TRAD },
  { keyword: "border security", primary: INDEX_NAMES.TRAD },
  { keyword: "DEI", primary: INDEX_NAMES.TRAD },
  { keyword: "woke", primary: INDEX_NAMES.TRAD },
  { keyword: "transgender athlete", primary: INDEX_NAMES.TRAD },
  { keyword: "critical race theory", primary: INDEX_NAMES.TRAD },

  // ── PROGRESSIVE AMERICAN VALUES SENTIMENT INDEX ───────────────────────────────────
  { keyword: "climate bill", primary: INDEX_NAMES.PROG },
  { keyword: "green new deal", primary: INDEX_NAMES.PROG },
  { keyword: "clean energy", primary: INDEX_NAMES.PROG },
  { keyword: "carbon emissions", primary: INDEX_NAMES.PROG },
  { keyword: "student loan", primary: INDEX_NAMES.PROG },
  { keyword: "debt forgiveness", primary: INDEX_NAMES.PROG },
  { keyword: "labor movement", primary: INDEX_NAMES.PROG },
  { keyword: "union organizing", primary: INDEX_NAMES.PROG },
  { keyword: "UAW", primary: INDEX_NAMES.PROG },
  { keyword: "minimum wage", primary: INDEX_NAMES.PROG },
  { keyword: "wealth tax", primary: INDEX_NAMES.PROG },
  { keyword: "universal basic income", primary: INDEX_NAMES.PROG },
  { keyword: "LGBTQ", primary: INDEX_NAMES.PROG },
  { keyword: "reproductive rights", primary: INDEX_NAMES.PROG },
  { keyword: "abortion access", primary: INDEX_NAMES.PROG },
  { keyword: "medicare for all", primary: INDEX_NAMES.PROG },
  { keyword: "voting rights", primary: INDEX_NAMES.PROG },
  { keyword: "carbon tax", primary: INDEX_NAMES.PROG },
  { keyword: "progressive coalition", primary: INDEX_NAMES.PROG },
  { keyword: "affirmative action", primary: INDEX_NAMES.PROG },
  { keyword: "drug pricing", primary: INDEX_NAMES.PROG },
  { keyword: "healthcare public option", primary: INDEX_NAMES.PROG },

  // ── Cross-index correlations ──────────────────────────────────────────────────
  {
    keyword: "culture war",
    primary: INDEX_NAMES.TRAD,
    correlations: [{ index: INDEX_NAMES.PROG, weight: -0.4 }],
  },
  {
    keyword: "polarization",
    primary: INDEX_NAMES.TRAD,
    correlations: [{ index: INDEX_NAMES.PROG, weight: -0.3 }],
  },
  {
    keyword: "Supreme Court",
    primary: INDEX_NAMES.TRAD,
    correlations: [{ index: INDEX_NAMES.PROG, weight: -0.3 }],
  },

  // ── MASCULINITY DISCOURSE SENTIMENT ──────────────────────────────────────────
  { keyword: "masculinity", primary: INDEX_NAMES.MASC },
  { keyword: "male loneliness", primary: INDEX_NAMES.MASC },
  { keyword: "andrew tate", primary: INDEX_NAMES.MASC },
  { keyword: "mens rights", primary: INDEX_NAMES.MASC },
  { keyword: "traditional masculinity", primary: INDEX_NAMES.MASC },

  // ── FEMINISM WAVE SENTIMENT ───────────────────────────────────────────────────
  { keyword: "feminism", primary: INDEX_NAMES.FEM },
  { keyword: "feminist", primary: INDEX_NAMES.FEM },
  { keyword: "title ix", primary: INDEX_NAMES.FEM },
  { keyword: "metoo", primary: INDEX_NAMES.FEM },
  { keyword: "womens rights", primary: INDEX_NAMES.FEM },
  { keyword: "equal pay", primary: INDEX_NAMES.FEM },

  // ── F1 CONSTRUCTOR SENTIMENT ──────────────────────────────────────────────────
  { keyword: "formula 1", primary: INDEX_NAMES.F1 },
  { keyword: "f1", primary: INDEX_NAMES.F1 },
  { keyword: "grand prix", primary: INDEX_NAMES.F1 },
  { keyword: "constructor championship", primary: INDEX_NAMES.F1 },
  { keyword: "drive to survive", primary: INDEX_NAMES.F1 },

  // ── NASCAR RACING SENTIMENT ───────────────────────────────────────────────────
  { keyword: "nascar", primary: INDEX_NAMES.NASCAR },
  { keyword: "daytona", primary: INDEX_NAMES.NASCAR },
  { keyword: "stock car", primary: INDEX_NAMES.NASCAR },

  // ── OBESITY DRUG SENTIMENT ────────────────────────────────────────────────────
  { keyword: "ozempic", primary: INDEX_NAMES.OBE },
  { keyword: "wegovy", primary: INDEX_NAMES.OBE },
  { keyword: "glp-1", primary: INDEX_NAMES.OBE },
  { keyword: "semaglutide", primary: INDEX_NAMES.OBE },
  { keyword: "weight loss drug", primary: INDEX_NAMES.OBE },
  { keyword: "novo nordisk", primary: INDEX_NAMES.OBE },
  { keyword: "eli lilly", primary: INDEX_NAMES.OBE },

  // ── WHOLE FOOD & WELLNESS SENTIMENT ──────────────────────────────────────────
  { keyword: "clean eating", primary: INDEX_NAMES.WELL },
  { keyword: "whole food", primary: INDEX_NAMES.WELL },
  { keyword: "ultra processed", primary: INDEX_NAMES.WELL },
  { keyword: "seed oil", primary: INDEX_NAMES.WELL },
  { keyword: "carnivore diet", primary: INDEX_NAMES.WELL },
  { keyword: "fitness culture", primary: INDEX_NAMES.WELL },
];

// ─── Keyword Context Requirements ───────────────────────────────────────────────
// Some broad single-word keywords produce false positives when they appear alone.
// KEYWORD_CONTEXT_REQUIREMENTS maps each such keyword to a list of co-occurrence
// context words — at least one must appear in the headline for the match to count.
// This map is purely additive: no keyword arrays, entity maps, or routing logic
// are altered. The check fires at match-time inside routeHeadline().
const KEYWORD_CONTEXT_REQUIREMENTS: Record<string, string[]> = {
  // "oil" alone routes to MENA — require a MENA-region co-occurrence
  oil: [
    "Iran",
    "Hormuz",
    "OPEC",
    "Gulf",
    "Saudi",
    "Iraq",
    "Middle East",
    "MENA",
    "Yemen",
    "Lebanon",
    "Syria",
  ],
  // "AI" alone routes to AI Regulation — require a policy/risk co-occurrence
  AI: [
    "regulation",
    "ban",
    "law",
    "policy",
    "Congress",
    "EU",
    "rule",
    "safety",
    "risk",
    "harm",
    "scam",
    "fraud",
    "job",
    "labor",
    "oversight",
    "compliance",
  ],
  // "stocks", "S&P", "Nasdaq" alone route to Fed Policy — require a macro co-occurrence
  stocks: [
    "Fed",
    "rate",
    "inflation",
    "CPI",
    "PPI",
    "Powell",
    "FOMC",
    "yield",
    "Treasury",
    "monetary",
  ],
  "S&P": [
    "Fed",
    "rate",
    "inflation",
    "CPI",
    "PPI",
    "Powell",
    "FOMC",
    "yield",
    "Treasury",
    "monetary",
  ],
  Nasdaq: [
    "Fed",
    "rate",
    "inflation",
    "CPI",
    "PPI",
    "Powell",
    "FOMC",
    "yield",
    "Treasury",
    "monetary",
  ],
};

/**
 * Returns true when a keyword has no context requirement, or when at least one
 * of its required context words appears in the headline text (case-sensitive for
 * acronyms/proper nouns, plain includes for everything else).
 */
function keywordPassesContextCheck(
  headlineText: string,
  keyword: string,
): boolean {
  const required = KEYWORD_CONTEXT_REQUIREMENTS[keyword];
  if (!required) return true;
  return required.some((ctx) => headlineText.includes(ctx));
}

/**
 * Word-boundary-aware keyword matcher.
 * For short keywords (≤ 4 chars) uses \b regex to prevent substring false positives
 * (e.g. "Fed" must not match "Federal", "MCU" must not match "MCUNIVERSITY").
 * For longer keywords plain includes() is safe enough.
 */
function matchesKeyword(text: string, keyword: string): boolean {
  if (keyword.length <= 4) {
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`\\b${escaped}\\b`, "i");
    return regex.test(text);
  }
  return text.toLowerCase().includes(keyword.toLowerCase());
}

/**
 * Scans headline text for entity keywords and returns a Map<IndexName, correlationWeight>.
 * Returns an empty Map if no keyword matched.
 */
export function routeHeadline(headlineText: string): Map<IndexName, number> {
  const result = new Map<IndexName, number>();

  for (const entry of ENTITY_KEYWORD_MAP) {
    if (!matchesKeyword(headlineText, entry.keyword)) continue;
    if (!keywordPassesContextCheck(headlineText, entry.keyword)) continue;

    result.set(entry.primary, (result.get(entry.primary) ?? 0) + 1.0);

    for (const { index, weight } of entry.correlations ?? []) {
      result.set(index, (result.get(index) ?? 0) + weight);
    }
  }

  for (const [idx, w] of result) {
    result.set(idx, Math.max(-1, Math.min(1, w)));
  }

  return result;
}

export type SentimentLabel = "positive" | "negative" | "neutral";

export function calculateImpact(
  label: SentimentLabel,
  confidence: number,
  sourceTier: 1 | 2 | 3 | 4 | 5,
  indexCategory?: string,
): number {
  const maxBase = getMaxBaseImpact(indexCategory);
  const baseImpact = confidence * maxBase;
  const direction = label === "negative" ? -1 : label === "neutral" ? 0 : 1;
  // Tier multiplier is now resolved from SOURCE_TIER_REGISTRY — the unified
  // single source of truth. Previously resolved via inline if/else chain.
  const tierMultiplier = getImpactMultiplier(sourceTier);
  const raw = baseImpact * direction * tierMultiplier;
  return Number(raw.toFixed(2));
}

export function deriveSentimentFromScore(score: number): SentimentLabel {
  if (score > 52) return "positive";
  if (score < 48) return "negative";
  return "neutral";
}
