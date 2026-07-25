/**
 * socialHeadlineGenerator
 *
 * Receives processed social sentiment data and makes a lightweight Anthropic
 * API call to generate a terminal-grade Oracle headline. Falls back to
 * template-based headlines if the API call fails.
 *
 * STRICT SAFETY: no UI, no side effects. Pure async TypeScript service.
 */

import { applySampleConfidenceMultiplier } from "../utils/sampleConfidenceMultiplier";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SocialHeadlineInput {
  platform: "reddit" | "twitter" | "youtube" | "cross-platform";
  indexName: string;
  sentimentDirection: "positive" | "negative" | "neutral" | "divergent";
  sentimentScore: number; // -1.0 to 1.0
  engagementMetric: number;
  engagementLabel: string; // e.g. "upvotes", "views", "reactions"
  sampleWindowDays: number; // 1, 7, 30, or 90
  triggerHeadline: string | null;
  platformContext: string; // e.g. "r/worldnews", "YouTube creator: MrBeast"
}

export interface SocialOracleHeadline {
  headlineText: string;
  platform: string;
  indexName: string;
  sentimentDirection: string;
  scoreImpact: number;
  source: "ORACLE-SOCIAL";
  timestamp: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function capitalize(str: string): string {
  if (!str) return str;
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function buildFallbackHeadline(input: SocialHeadlineInput): string {
  if (input.sentimentDirection === "negative") {
    return `${capitalize(input.platform)} sentiment declining on ${input.indexName} narrative`;
  }
  if (input.sentimentDirection === "positive") {
    return `${capitalize(input.platform)} engagement rising — ${input.indexName} narrative strengthening`;
  }
  if (input.sentimentDirection === "divergent") {
    return `Cross-platform sentiment diverging on ${input.indexName}`;
  }
  // neutral (default)
  return `${capitalize(input.platform)} signal neutral — ${input.indexName} narrative stable`;
}

// ─── Platform → SourceType mapping ───────────────────────────────────────────

const PLATFORM_SOURCE_TYPE: Record<
  SocialHeadlineInput["platform"],
  | "social-reddit"
  | "social-twitter"
  | "social-youtube"
  | "social-cross-platform"
> = {
  reddit: "social-reddit",
  twitter: "social-twitter",
  youtube: "social-youtube",
  "cross-platform": "social-cross-platform",
};

// ─── Primary Export ───────────────────────────────────────────────────────────

const ORACLE_SYSTEM_PROMPT =
  "You are the Oracle, an AI sentiment engine for a financial terminal. Generate a single clinical, terminal-grade headline (maximum 12 words) that summarizes a social sentiment signal. The headline should read like institutional market intelligence, not journalism or social media. Use phrases like 'Narrative confidence declining', 'Crowd sentiment diverging', 'Social signal negative', 'Engagement momentum weakening', 'Cross-platform consensus forming'. Never mention specific usernames, subreddit names, or raw numbers in the headline. Always reference the index or narrative category. Output only the headline text, nothing else.";

export async function generateSocialOracleHeadline(
  input: SocialHeadlineInput,
): Promise<SocialOracleHeadline> {
  const scoreImpact = applySampleConfidenceMultiplier(
    input.sentimentScore,
    input.sampleWindowDays,
    PLATFORM_SOURCE_TYPE[input.platform],
  );

  const triggerPart = input.triggerHeadline
    ? `Trigger headline: ${input.triggerHeadline}.`
    : "No trigger headline.";

  const userMessage = `Platform: ${capitalize(input.platform)}. Index: ${input.indexName}. Sentiment direction: ${input.sentimentDirection}. Sentiment score: ${input.sentimentScore.toFixed(2)}. Engagement: ${input.engagementMetric} ${input.engagementLabel}. Sample window: ${input.sampleWindowDays} day${input.sampleWindowDays === 1 ? "" : "s"}. ${triggerPart} Generate the Oracle headline.`;

  let headlineText: string;

  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey ?? "",
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 80,
        system: ORACLE_SYSTEM_PROMPT,
        messages: [{ role: "user", content: userMessage }],
      }),
    });

    if (!response.ok) {
      headlineText = buildFallbackHeadline(input);
    } else {
      const data = (await response.json()) as {
        content?: Array<{ type: string; text: string }>;
      };

      const rawText = data?.content?.[0]?.text?.trim();
      headlineText =
        rawText && rawText.length > 0 ? rawText : buildFallbackHeadline(input);
    }
  } catch (err) {
    // API call failed — log the failure reason and use template fallback. Never throw.
    console.warn(
      "[SocialHeadlineGenerator] Anthropic API call failed — using fallback headline.",
      err,
    );
    headlineText = buildFallbackHeadline(input);
  }

  return {
    headlineText,
    platform: input.platform,
    indexName: input.indexName,
    sentimentDirection: input.sentimentDirection,
    scoreImpact,
    source: "ORACLE-SOCIAL",
    timestamp: Date.now(),
  };
}
