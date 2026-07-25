import { FALLBACK_ASSET_DEFS } from "../data/fallbackAssets";
import {
  calculateImpact,
  deriveSentimentFromScore,
  routeHeadline,
} from "../lib/oracle/entityValidator";
import { NewsEventCategory } from "../types/backendEnums";
import type { NewsEvent } from "../types/backendEnums";
import type {
  HeadlineEvent,
  IHeadlineService,
} from "./headlineService.interface";
import { getTierLabel, pickWeightedSource } from "./sourceCredibilityEngine";

// ─── ACTIVE INDEX FILTER ──────────────────────────────────────────────────────
// All seven God-Tier index names — only these are surfaced to the Oracle.
const ACTIVE_INDEX_NAMES: Set<string> = new Set([
  "AI Regulation Risk Sentiment",
  "Fed Policy Sentiment",
  "MENA Stability Sentiment",
  "Traditional Values Sentiment",
  "Progressive Values Sentiment",
  "Masculinity Discourse Sentiment",
  "Feminism Wave Sentiment",
  "F1 Constructor Sentiment",
  "NASCAR Racing Sentiment",
  "Obesity Drug Sentiment",
  "Whole Food & Wellness Sentiment",
]);

export function isActiveIndex(relatedIndex?: string): boolean {
  if (!relatedIndex) return false;
  return ACTIVE_INDEX_NAMES.has(relatedIndex);
}
// ─────────────────────────────────────────────────────────────────────────────

export interface AuditableNewsEvent extends NewsEvent {
  rationale?: string;
  source?: string;
  sourceTier?: number;
  baseImpact?: number;
  tierMultiplier?: number;
  correlationWeight?: number;
  /** @deprecated use correlationWeight */
  weight?: number;
  scoringMethod?: string;
  /** The paired inverse index that received a dampened counter-signal this tick. */
  inverseAffectedIndex?: string;
  /** The dampened inverse impact applied to the paired index. */
  inverseImpact?: number;
}

// ─── GSI INDEX WEIGHTS (Oracle dispatch) ─────────────────────────────────────
// Cultural indexes receive lower weight than geopolitical/macro because they
// are narrative-driven rather than macro-driven. Weights sum exactly to 1.0.
const GSI_INDEX_WEIGHTS: Record<string, number> = {
  "AI Regulation Risk Sentiment": 0.14,
  "Fed Policy Sentiment": 0.18,
  "MENA Stability Sentiment": 0.15,
  "Traditional Values Sentiment": 0.1,
  "Progressive Values Sentiment": 0.1,
  "Masculinity Discourse Sentiment": 0.08,
  "Feminism Wave Sentiment": 0.08,
  "F1 Constructor Sentiment": 0.05,
  "NASCAR Racing Sentiment": 0.05,
  "Obesity Drug Sentiment": 0.04,
  "Whole Food & Wellness Sentiment": 0.03,
};

export function pickWeightedIndex(): string {
  const r = Math.random();
  let cumulative = 0;
  for (const [indexName, weight] of Object.entries(GSI_INDEX_WEIGHTS)) {
    cumulative += weight;
    if (r < cumulative) return indexName;
  }
  return "Fed Policy Sentiment";
}

// ─── MOCK HEADLINE POOL ───────────────────────────────────────────────────────
export const MOCK_HEADLINES: AuditableNewsEvent[] = [
  // ── AI Regulation Risk Sentiment ────────────────────────────────────────────
  {
    headline:
      "OpenAI announces breakthrough in reasoning models, surpassing human benchmarks",
    sentimentScore: 4.5,
    category: NewsEventCategory.AI,
    relatedIndex: "AI Regulation Risk Sentiment",
    source: "TechCrunch",
    rationale:
      "Major AI capability breakthrough signals accelerating sector growth.",
  },
  {
    headline:
      "Major AI lab reports critical safety flaw in frontier model deployment",
    sentimentScore: -3.8,
    category: NewsEventCategory.AI,
    relatedIndex: "AI Regulation Risk Sentiment",
    source: "Reuters",
    rationale:
      "Safety incident triggers regulatory scrutiny and erodes enterprise adoption confidence.",
  },
  {
    headline:
      "EU regulators propose sweeping restrictions on generative AI applications",
    sentimentScore: -2.5,
    category: NewsEventCategory.AI,
    relatedIndex: "AI Regulation Risk Sentiment",
    source: "FT",
    rationale: "Regulatory headwinds create compliance cost uncertainty.",
  },
  {
    headline: "Department of Justice opens antitrust probe into AI chipmakers",
    sentimentScore: -3.1,
    category: NewsEventCategory.AI,
    relatedIndex: "AI Regulation Risk Sentiment",
    source: "Bloomberg",
    rationale: "Antitrust action signals escalating tech regulation risk.",
  },
  {
    headline:
      "AI chip demand surges as hyperscalers accelerate data center buildouts",
    sentimentScore: 2.8,
    category: NewsEventCategory.AI,
    relatedIndex: "AI Regulation Risk Sentiment",
    source: "WSJ",
    rationale:
      "Hyperscaler capex acceleration confirms sustained AI investment cycle.",
  },
  // ── AI Regulation Risk Sentiment — new additions ────────────────────────────
  {
    headline:
      "Senate AI Safety Act passes committee 14-3 — mandates third-party audits of large language models before public deployment",
    sentimentScore: -3.2,
    category: NewsEventCategory.AI,
    relatedIndex: "AI Regulation Risk Sentiment",
    source: "Reuters",
  },
  {
    headline:
      "White House expands chip export restrictions to 12 additional countries citing national security — semiconductor stocks slide",
    sentimentScore: -3.5,
    category: NewsEventCategory.AI,
    relatedIndex: "AI Regulation Risk Sentiment",
    source: "Bloomberg",
  },
  {
    headline:
      "EU AI Act enforcement begins — companies face fines up to 35M euros for non-compliance with high-risk AI provisions",
    sentimentScore: -2.9,
    category: NewsEventCategory.AI,
    relatedIndex: "AI Regulation Risk Sentiment",
    source: "FT",
  },
  {
    headline:
      "Nvidia announces $500B US manufacturing investment — will build next-generation GPU fabrication in Arizona",
    sentimentScore: 3.8,
    category: NewsEventCategory.AI,
    relatedIndex: "AI Regulation Risk Sentiment",
    source: "Bloomberg",
  },
  {
    headline:
      "FTC drops landmark AI antitrust investigation — Commission signals new framework favoring innovation over restriction",
    sentimentScore: 3.4,
    category: NewsEventCategory.AI,
    relatedIndex: "AI Regulation Risk Sentiment",
    source: "WSJ",
  },
  {
    headline:
      "Leaked internal polling shows Congress deeply divided on AI regulation — no comprehensive bill expected before midterms",
    sentimentScore: 1.8,
    category: NewsEventCategory.AI,
    relatedIndex: "AI Regulation Risk Sentiment",
    source: "Politico",
  },
  {
    headline:
      "TSMC confirms advanced packaging facility in Ohio — reduces US dependence on Taiwan supply chain",
    sentimentScore: 3.1,
    category: NewsEventCategory.AI,
    relatedIndex: "AI Regulation Risk Sentiment",
    source: "Reuters",
  },
  {
    headline:
      "DOJ opens second antitrust investigation into AI cloud dominance — targets Microsoft Azure and Google Cloud AI exclusivity contracts",
    sentimentScore: -3.3,
    category: NewsEventCategory.AI,
    relatedIndex: "AI Regulation Risk Sentiment",
    source: "Bloomberg",
  },

  // ── Fed Policy Sentiment ─────────────────────────────────────────────────────
  {
    headline:
      "Federal Reserve signals rate cut as inflation cools to 2.1% target",
    sentimentScore: 3.6,
    category: NewsEventCategory.Washington,
    relatedIndex: "Fed Policy Sentiment",
    source: "Bloomberg",
    rationale: "Rate cut signaling reduces discount rate on future earnings.",
  },
  {
    headline: "Powell signals aggressive rate cuts amid slowing jobs data",
    sentimentScore: 3.2,
    category: NewsEventCategory.Washington,
    relatedIndex: "Fed Policy Sentiment",
    source: "Reuters",
    rationale:
      "Dovish pivot supports equity valuations across rate-sensitive sectors.",
  },
  {
    headline:
      "Breaking: US Treasury yields surge on stronger-than-expected CPI data",
    sentimentScore: -2.7,
    category: NewsEventCategory.Washington,
    relatedIndex: "Fed Policy Sentiment",
    source: "Bloomberg",
    rationale: "Inflation surprise reduces probability of near-term rate cuts.",
  },
  {
    headline:
      "Wall Street rallies as FOMC holds rates steady, signals patience",
    sentimentScore: 2.9,
    category: NewsEventCategory.Washington,
    relatedIndex: "Fed Policy Sentiment",
    source: "CNBC",
    rationale:
      "Policy hold reduces near-term volatility in rate-sensitive equities.",
  },
  {
    headline:
      "S&P 500 hits all-time high as earnings surpass analyst forecasts",
    sentimentScore: 4.1,
    category: NewsEventCategory.Washington,
    relatedIndex: "Fed Policy Sentiment",
    source: "CNBC",
    rationale: "Broad earnings beat confirms corporate resilience.",
  },
  // ── Fed Policy Sentiment — new additions ─────────────────────────────────────
  {
    headline:
      "Federal Reserve holds rates steady, signals two cuts possible by year end",
    sentimentScore: 3.2,
    category: NewsEventCategory.Washington,
    relatedIndex: "Fed Policy Sentiment",
    source: "Bloomberg",
  },
  {
    headline:
      "CPI prints hotter than expected at 4.2% — markets pricing in three additional Fed rate hikes through year end",
    sentimentScore: -3.4,
    category: NewsEventCategory.Washington,
    relatedIndex: "Fed Policy Sentiment",
    source: "Reuters",
  },
  {
    headline:
      "Nonfarm payrolls surge 280K — labor market resilience complicates Fed pivot timeline",
    sentimentScore: -2.8,
    category: NewsEventCategory.Washington,
    relatedIndex: "Fed Policy Sentiment",
    source: "Bloomberg",
  },
  {
    headline:
      "Fed Governor Waller signals openness to rate cuts if inflation data cooperates",
    sentimentScore: 2.6,
    category: NewsEventCategory.Washington,
    relatedIndex: "Fed Policy Sentiment",
    source: "CNBC",
  },
  {
    headline:
      "Treasury yield curve inverts to deepest level since 2007 as recession fears mount",
    sentimentScore: -3.1,
    category: NewsEventCategory.Washington,
    relatedIndex: "Fed Policy Sentiment",
    source: "FT",
  },
  {
    headline:
      "PCE inflation cools to 2.3% — Fed's preferred measure approaching target",
    sentimentScore: 3.5,
    category: NewsEventCategory.Washington,
    relatedIndex: "Fed Policy Sentiment",
    source: "Reuters",
  },
  {
    headline:
      "FOMC minutes reveal deep divisions — two members pushed for emergency 75bp hike as inflation expectations become unanchored",
    sentimentScore: -3.8,
    category: NewsEventCategory.Washington,
    relatedIndex: "Fed Policy Sentiment",
    source: "Bloomberg",
  },
  {
    headline:
      "Wall Street loads up on puts just in case — Powell expected to signal aggressive rate cuts later today",
    sentimentScore: 2.4,
    category: NewsEventCategory.Washington,
    relatedIndex: "Fed Policy Sentiment",
    source: "CNBC",
  },

  // ── MENA Stability Sentiment ─────────────────────────────────────────────────
  {
    headline:
      "UAE Central Bank Halts Liquidity Operations Amid Regional Uncertainty",
    sentimentScore: -3.8,
    category: NewsEventCategory.Mexico,
    relatedIndex: "MENA Stability Sentiment",
    source: "Al Jazeera",
    rationale:
      "UAE liquidity halt restricts capital flow across MENA financial markets.",
  },
  {
    headline: "OPEC+ agrees to extend production cuts through Q3",
    sentimentScore: 2.5,
    category: NewsEventCategory.Mexico,
    relatedIndex: "MENA Stability Sentiment",
    source: "Reuters",
    rationale: "Production discipline supports Brent crude price floor.",
  },
  {
    headline:
      "Saudi Arabia announces $500B infrastructure investment plan, Vision 2030 accelerates",
    sentimentScore: 3.1,
    category: NewsEventCategory.Mexico,
    relatedIndex: "MENA Stability Sentiment",
    source: "Bloomberg",
    rationale:
      "Flagship diversification investment confirms Saudi commitment to post-oil transition.",
  },
  {
    headline:
      "Iran and P5+1 reach preliminary nuclear framework agreement — regional tensions ease as Gulf states welcome diplomatic breakthrough",
    sentimentScore: 3.6,
    category: NewsEventCategory.Mexico,
    relatedIndex: "MENA Stability Sentiment",
    source: "FT",
    rationale: "Failed nuclear negotiations maintain oil supply uncertainty.",
  },
  // ── MENA Stability Sentiment — new additions ─────────────────────────────────
  {
    headline:
      "Strait of Hormuz tanker incident disrupts 20% of global LNG flow — Brent crude surges $9 in Asian trading session",
    sentimentScore: -3.9,
    category: NewsEventCategory.Mexico,
    relatedIndex: "MENA Stability Sentiment",
    source: "Reuters",
  },
  {
    headline:
      "Israel and Hamas reach 60-day ceasefire agreement brokered by Qatar and Egypt",
    sentimentScore: 3.7,
    category: NewsEventCategory.Mexico,
    relatedIndex: "MENA Stability Sentiment",
    source: "AP",
  },
  {
    headline:
      "Saudi Arabia and OPEC+ agree coordinated production stabilization plan — Brent crude steady as energy ministers signal commitment to price floor",
    sentimentScore: 2.9,
    category: NewsEventCategory.Mexico,
    relatedIndex: "MENA Stability Sentiment",
    source: "Bloomberg",
  },
  {
    headline:
      "UAE signs landmark digital economy partnership with 12 Asian nations — $200B investment commitment",
    sentimentScore: 3.2,
    category: NewsEventCategory.Mexico,
    relatedIndex: "MENA Stability Sentiment",
    source: "FT",
  },
  {
    headline:
      "Yemen Houthi missile strike hits commercial vessel in Red Sea — major shipping lines rerouting around Cape of Good Hope",
    sentimentScore: -3.6,
    category: NewsEventCategory.Mexico,
    relatedIndex: "MENA Stability Sentiment",
    source: "Reuters",
  },
  {
    headline:
      "OPEC+ reaches unanimous agreement on phased output normalization — energy ministers cite stable demand outlook and regional cooperation as key drivers",
    sentimentScore: 2.7,
    category: NewsEventCategory.Mexico,
    relatedIndex: "MENA Stability Sentiment",
    source: "Bloomberg",
  },
  {
    headline:
      "Egypt secures $15B IMF standby arrangement — pound stabilizes after months of currency pressure",
    sentimentScore: 2.8,
    category: NewsEventCategory.Mexico,
    relatedIndex: "MENA Stability Sentiment",
    source: "FT",
  },
  {
    headline:
      "Iran nuclear talks resume in Geneva — US and EU officials describe atmosphere as constructive",
    sentimentScore: 2.5,
    category: NewsEventCategory.Mexico,
    relatedIndex: "MENA Stability Sentiment",
    source: "AP",
  },

  // ── Traditional American Values Sentiment Index ───────────────────────────────
  {
    headline:
      "Supreme Court rules in favor of religious exemptions in landmark free exercise case",
    sentimentScore: 3.4,
    category: NewsEventCategory.Washington,
    relatedIndex: "Traditional Values Sentiment Index",
    source: "Reuters",
    rationale:
      "Landmark ruling expands religious liberty protections nationally.",
  },
  {
    headline:
      "Congressional hearing targets gender curriculum in public schools amid parental rights push",
    sentimentScore: 2.8,
    category: NewsEventCategory.Washington,
    relatedIndex: "Traditional Values Sentiment Index",
    source: "WSJ",
    rationale:
      "Legislative pressure on curriculum signals rising parental rights momentum.",
  },
  {
    headline:
      "Church attendance hits decade high as faith communities report surge in young adult membership",
    sentimentScore: 3.1,
    category: NewsEventCategory.Washington,
    relatedIndex: "Traditional Values Sentiment Index",
    source: "AP",
    rationale:
      "Rising faith community engagement strengthens traditional values coalition.",
  },
  {
    headline:
      "Poll shows record support for school choice voucher programs in swing states",
    sentimentScore: 2.6,
    category: NewsEventCategory.Washington,
    relatedIndex: "Traditional Values Sentiment Index",
    source: "CNBC",
    rationale:
      "Broad public support for school choice signals policy tailwinds.",
  },
  {
    headline:
      "Federal court blocks state mandate requiring gender identity curriculum in elementary schools",
    sentimentScore: 3.2,
    category: NewsEventCategory.Washington,
    relatedIndex: "Traditional Values Sentiment Index",
    source: "Bloomberg",
    rationale:
      "Court ruling reinforces parental control over early education content.",
  },
  // ── Traditional American Values Sentiment Index — new additions ──────────────
  {
    headline:
      "Supreme Court rules 6-3 in favor of religious exemptions for employers citing sincerely held beliefs — landmark free exercise decision",
    sentimentScore: 3.8,
    category: NewsEventCategory.Washington,
    relatedIndex: "Traditional Values Sentiment Index",
    source: "Reuters",
  },
  {
    headline:
      "Federal court blocks state mandate requiring gender identity curriculum in elementary schools — parental rights groups claim major victory",
    sentimentScore: 3.4,
    category: NewsEventCategory.Washington,
    relatedIndex: "Traditional Values Sentiment Index",
    source: "AP",
  },
  {
    headline:
      "Gallup survey finds church attendance hits decade high — faith communities report surge in young adult membership",
    sentimentScore: 3.1,
    category: NewsEventCategory.Washington,
    relatedIndex: "Traditional Values Sentiment Index",
    source: "AP",
  },
  {
    headline:
      "School choice voucher program passes in four additional states — over 2 million students now eligible for private school funding",
    sentimentScore: 3.5,
    category: NewsEventCategory.Washington,
    relatedIndex: "Traditional Values Sentiment Index",
    source: "WSJ",
  },
  {
    headline:
      "Second Amendment Foundation wins federal appeals court ruling striking down assault weapons ban in three states",
    sentimentScore: 3.2,
    category: NewsEventCategory.Washington,
    relatedIndex: "Traditional Values Sentiment Index",
    source: "Reuters",
  },
  {
    headline:
      "Congressional hearing targets DEI mandates in public universities — Republican-led committee advances legislation restricting federal funding",
    sentimentScore: 2.8,
    category: NewsEventCategory.Washington,
    relatedIndex: "Traditional Values Sentiment Index",
    source: "WSJ",
  },
  {
    headline:
      "Supreme Court agrees to hear landmark case on public school prayer — decision could reshape First Amendment jurisprudence",
    sentimentScore: 2.6,
    category: NewsEventCategory.Washington,
    relatedIndex: "Traditional Values Sentiment Index",
    source: "AP",
  },
  {
    headline:
      "Bud Light boycott anniversary — traditional values coalition reports sustained 23% market share loss has not recovered",
    sentimentScore: 2.4,
    category: NewsEventCategory.Washington,
    relatedIndex: "Traditional Values Sentiment Index",
    source: "WSJ",
  },
  {
    headline:
      "Federal judge strikes down school district transgender athlete policy — ruling applies across six-state circuit",
    sentimentScore: 3.0,
    category: NewsEventCategory.Washington,
    relatedIndex: "Traditional Values Sentiment Index",
    source: "Reuters",
  },
  {
    headline:
      "NFL viewership rebounds 18% after league distances itself from social justice campaign messaging",
    sentimentScore: 2.7,
    category: NewsEventCategory.Washington,
    relatedIndex: "Traditional Values Sentiment Index",
    source: "WSJ",
  },

  // ── Progressive American Values Sentiment Index ───────────────────────────────
  {
    headline:
      "Historic climate bill passes Senate with bipartisan support, largest green investment in US history",
    sentimentScore: 3.8,
    category: NewsEventCategory.Washington,
    relatedIndex: "Progressive Values Sentiment Index",
    source: "Reuters",
    rationale:
      "Landmark climate legislation signals sustained green policy commitment.",
  },
  {
    headline:
      "Student loan forgiveness program reinstated following appeals court reversal",
    sentimentScore: 3.3,
    category: NewsEventCategory.Washington,
    relatedIndex: "Progressive Values Sentiment Index",
    source: "Bloomberg",
    rationale:
      "Debt relief reinstatement mobilizes progressive base and boosts consumer sentiment.",
  },
  {
    headline:
      "UAW announces largest membership drive in thirty years as labor movement accelerates",
    sentimentScore: 2.9,
    category: NewsEventCategory.Washington,
    relatedIndex: "Progressive Values Sentiment Index",
    source: "AP",
    rationale:
      "Labor organizing surge confirms structural shift in worker bargaining power.",
  },
  {
    headline:
      "Federal minimum wage increase bill advances through committee with strong progressive coalition",
    sentimentScore: 2.7,
    category: NewsEventCategory.Washington,
    relatedIndex: "Progressive Values Sentiment Index",
    source: "WSJ",
    rationale:
      "Wage floor legislation advances on coalition strength signaling policy traction.",
  },
  {
    headline:
      "LGBTQ protections expanded under new executive order covering federal contractors",
    sentimentScore: 3.1,
    category: NewsEventCategory.Washington,
    relatedIndex: "Progressive Values Sentiment Index",
    source: "CNBC",
    rationale:
      "Executive expansion of LGBTQ protections energizes progressive policy coalition.",
  },
  // ── Progressive American Values Sentiment Index — new additions ──────────────
  {
    headline:
      "Historic climate bill passes Senate with bipartisan support — largest green energy investment in US history at $800B over decade",
    sentimentScore: 3.9,
    category: NewsEventCategory.Washington,
    relatedIndex: "Progressive Values Sentiment Index",
    source: "Reuters",
  },
  {
    headline:
      "Student loan forgiveness program reinstated following appeals court reversal — 4 million borrowers to receive immediate relief",
    sentimentScore: 3.5,
    category: NewsEventCategory.Washington,
    relatedIndex: "Progressive Values Sentiment Index",
    source: "Bloomberg",
  },
  {
    headline:
      "UAW wins landmark contract at three non-union auto plants — largest labor organizing victory in 40 years",
    sentimentScore: 3.6,
    category: NewsEventCategory.Washington,
    relatedIndex: "Progressive Values Sentiment Index",
    source: "AP",
  },
  {
    headline:
      "Federal minimum wage increase to $17 advances through Senate committee — first federal increase in 15 years",
    sentimentScore: 3.2,
    category: NewsEventCategory.Washington,
    relatedIndex: "Progressive Values Sentiment Index",
    source: "Reuters",
  },
  {
    headline:
      "Supreme Court strikes down affirmative action ban — ruling restores race-conscious admissions at public universities",
    sentimentScore: 3.4,
    category: NewsEventCategory.Washington,
    relatedIndex: "Progressive Values Sentiment Index",
    source: "AP",
  },
  {
    headline:
      "EPA issues strictest air quality standards in agency history — targets fossil fuel emissions in low-income communities",
    sentimentScore: 3.1,
    category: NewsEventCategory.Washington,
    relatedIndex: "Progressive Values Sentiment Index",
    source: "Reuters",
  },
  {
    headline:
      "Democratic presidential candidate breaks single-day fundraising record at $42M — signaling strong grassroots energy heading into final stretch",
    sentimentScore: 3.3,
    category: NewsEventCategory.Washington,
    relatedIndex: "Progressive Values Sentiment Index",
    source: "Bloomberg",
  },
  {
    headline:
      "Federal court upholds LGBTQ workplace protections — ruling expands Title VII coverage to all 50 states regardless of state law",
    sentimentScore: 3.0,
    category: NewsEventCategory.Washington,
    relatedIndex: "Progressive Values Sentiment Index",
    source: "AP",
  },
  {
    headline:
      "Healthcare public option bill advances — CBO scores it covering 12 million uninsured Americans at net zero cost over decade",
    sentimentScore: 2.9,
    category: NewsEventCategory.Washington,
    relatedIndex: "Progressive Values Sentiment Index",
    source: "Reuters",
  },
  {
    headline:
      "Major pharmaceutical company agrees to $4B settlement in insulin price gouging case — landmark win for drug pricing reform advocates",
    sentimentScore: 3.2,
    category: NewsEventCategory.Washington,
    relatedIndex: "Progressive Values Sentiment Index",
    source: "Bloomberg",
  },
];

// ─── SCHEDULED MOCK EVENTS ────────────────────────────────────────────────────
// Simulates the cadence of real data sources (monthly macro releases,
// weekly box office, weekly conflict reports). Intervals are compressed for
// mock mode — real API integration will replace these with actual polling.
export const SCHEDULED_MOCK_EVENTS: Record<
  string,
  { headlines: AuditableNewsEvent[]; intervalMs: number }
> = {
  // Monthly macro data releases (simulated every 8 minutes in mock mode)
  FED_MONTHLY: {
    intervalMs: 480_000,
    headlines: [
      {
        headline:
          "Monthly CPI data released — inflation reading in line with Fed forecasts at 2.8%",
        sentimentScore: 1.2,
        category: NewsEventCategory.Washington,
        relatedIndex: "Fed Policy Sentiment",
        source: "BLS",
      },
      {
        headline:
          "Nonfarm payrolls miss expectations — 95K jobs added vs 180K forecast, unemployment ticks up to 4.2%",
        sentimentScore: -2.4,
        category: NewsEventCategory.Washington,
        relatedIndex: "Fed Policy Sentiment",
        source: "BLS",
      },
      {
        headline:
          "PCE deflator falls to 2.1% — Fed's preferred inflation gauge reaches closest point to 2% target in three years",
        sentimentScore: 3.3,
        category: NewsEventCategory.Washington,
        relatedIndex: "Fed Policy Sentiment",
        source: "BEA",
      },
    ],
  },
  // Weekly conflict data (simulated every 7 minutes in mock mode)
  // Weekly conflict data (simulated every 7 minutes in mock mode)
  ACLED_WEEKLY: {
    intervalMs: 420_000,
    headlines: [
      {
        headline:
          "ACLED weekly conflict report — incident count in MENA region rises 23% week over week, concentrated in three flashpoint zones",
        sentimentScore: -2.6,
        category: NewsEventCategory.Mexico,
        relatedIndex: "MENA Stability Sentiment",
        source: "ACLED",
      },
      {
        headline:
          "ACLED weekly report — conflict incidents decline for third consecutive week as ceasefire holds across most monitored zones",
        sentimentScore: 2.9,
        category: NewsEventCategory.Mexico,
        relatedIndex: "MENA Stability Sentiment",
        source: "ACLED",
      },
    ],
  },
};

const _indexCursors: Record<string, number> = {};

export function getNextHeadlineForIndex(
  indexName: string,
): AuditableNewsEvent | null {
  const pool = MOCK_HEADLINES.filter((h) => h.relatedIndex === indexName);
  if (pool.length === 0) return null;

  if (_indexCursors[indexName] === undefined) {
    _indexCursors[indexName] = 0;
  }

  const base = pool[_indexCursors[indexName] % pool.length];
  _indexCursors[indexName] = (_indexCursors[indexName] + 1) % pool.length;

  const credEntry = pickWeightedSource();
  const tierLabel = getTierLabel(credEntry.tier);

  const label = deriveSentimentFromScore(base.sentimentScore);
  const confidence = Math.min(
    0.95,
    0.5 + Math.abs(base.sentimentScore - 50) / 100,
  );

  // Look up the category for this index from FALLBACK_ASSET_DEFS so that
  // calculateImpact() applies the correct per-category maxBaseImpact ceiling
  // (geopolitical → 1.5, cultural → 2.5, macro → 1.5) instead of the universal 2.5 fallback.
  const indexCategory = FALLBACK_ASSET_DEFS.find(
    (def) => def.name === indexName,
  )?.category;

  const finalImpact = calculateImpact(
    label,
    confidence,
    credEntry.tier,
    indexCategory,
  );

  const routedIndices = routeHeadline(base.headline);
  const routedKeys = [...routedIndices.keys()];
  const routingNote =
    routedKeys.length > 0 && !routedKeys.includes(base.relatedIndex as never)
      ? ` [routed:${routedKeys.join(",")}]`
      : "";

  return {
    ...base,
    source: credEntry.source,
    sentimentScore: finalImpact,
    rationale: base.rationale
      ? `[${credEntry.source} \u00b7 ${tierLabel}]${routingNote} ${base.rationale}`
      : `Source: ${credEntry.source} (${tierLabel})${routingNote}`,
  };
}

export interface BatchedTickHeadlines {
  headlines: AuditableNewsEvent[];
  netImpact: number;
}

export function generateBatchedTickHeadlines(): Map<
  string,
  BatchedTickHeadlines
> {
  const result = new Map<string, BatchedTickHeadlines>();

  const roll = Math.random();

  // Guarantee at least 1 headline per tick — zero-headline ticks starve the
  // pipeline of positive signal and cause runaway floor collapse.
  // Distribution: volume=1 (75%), volume=2 (20%), volume=3 (5%).
  // Sentiment ratio of the headline pool is unchanged.
  let volume: number;
  if (roll < 0.75) {
    volume = 1;
  } else if (roll < 0.95) {
    volume = 2;
  } else {
    volume = 3;
  }

  if (volume >= 3) {
    const meltdownIndex = pickWeightedIndex();
    const headlines: AuditableNewsEvent[] = [];
    for (let i = 0; i < 3; i++) {
      const h = getNextHeadlineForIndex(meltdownIndex);
      if (h) headlines.push(h);
    }
    if (headlines.length > 0) {
      const netImpact = headlines.reduce((sum, h) => sum + h.sentimentScore, 0);
      result.set(meltdownIndex, { headlines, netImpact });
    }
    return result;
  }

  const perIndex = new Map<string, AuditableNewsEvent[]>();

  for (let i = 0; i < volume; i++) {
    const indexName = pickWeightedIndex();
    const h = getNextHeadlineForIndex(indexName);
    if (!h) continue;

    if (!perIndex.has(indexName)) {
      perIndex.set(indexName, []);
    }
    perIndex.get(indexName)!.push(h);
  }

  for (const [indexName, headlines] of perIndex) {
    const netImpact = headlines.reduce((sum, h) => sum + h.sentimentScore, 0);
    result.set(indexName, { headlines, netImpact });
  }

  return result;
}

let roundRobinIndex = 0;

export function getNextHeadline(): AuditableNewsEvent {
  const activeHeadlines = MOCK_HEADLINES.filter((h) =>
    isActiveIndex(h.relatedIndex),
  );
  if (activeHeadlines.length === 0) {
    return MOCK_HEADLINES[0];
  }
  const headline = activeHeadlines[roundRobinIndex % activeHeadlines.length];
  roundRobinIndex = (roundRobinIndex + 1) % activeHeadlines.length;
  return headline;
}

export function getAllHeadlines(): AuditableNewsEvent[] {
  return MOCK_HEADLINES.filter((h) => isActiveIndex(h.relatedIndex));
}

export function getHeadlinesForIndex(
  indexName: string,
  count = 5,
): AuditableNewsEvent[] {
  const filtered = MOCK_HEADLINES.filter((h) => h.relatedIndex === indexName);
  return filtered.slice(0, count);
}

export function getRandomHeadline(): AuditableNewsEvent {
  return getNextHeadline();
}

// ─── IHeadlineService implementation ─────────────────────────────────────────
// AuditableNewsEvent is a structural superset of HeadlineEvent. The cast here
// is safe: every field required by HeadlineEvent is always present in the
// objects we return (relatedIndex is always set on every MOCK_HEADLINES entry).
// Any future real API service must implement IHeadlineService — swap the
// import in consumers, no Oracle pipeline changes required.
const mockHeadlineService: IHeadlineService = {
  getNextHeadlineForIndex: (indexName: string): HeadlineEvent | null =>
    getNextHeadlineForIndex(indexName) as HeadlineEvent | null,
  getAllHeadlines: (): HeadlineEvent[] => getAllHeadlines() as HeadlineEvent[],
  isActiveIndex,
  pickWeightedIndex,
};

export default mockHeadlineService;
