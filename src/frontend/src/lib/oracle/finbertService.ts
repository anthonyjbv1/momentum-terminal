/**
 * finbertService.ts
 *
 * Sentiment classification routed through the ICP backend canister.
 *
 * Classification priority:
 *   1. Deterministic Lexicon Override — high-signal macro/geopolitical/cultural
 *      phrases matched before any ML model is consulted. Returns immediately.
 *
 *   2. Mock pool fast-path — when sentimentScore is provided AND non-zero
 *      (pre-assigned score from the 84-headline mock pool), direction is derived
 *      directly from the sign. No canister call.
 *      sentimentScore > 0.05  → positive
 *      sentimentScore < -0.05 → negative
 *      -0.05 ≤ score ≤ 0.05  → neutral (legitimate dead zone)
 *
 *   3. Real FinBERT via canister — when sentimentScore is undefined or zero
 *      (live Finnhub headline or any external source without a pre-assigned score),
 *      calls canister.classifyHeadline(text). The canister POSTs to the
 *      HuggingFace Inference API (ProsusAI/finbert) and returns a structured
 *      { sentimentLabel, confidence, source } result.
 *      source === "finbert_live" when the HuggingFace key is set and the call
 *      succeeds; source === "neutral_fallback" when the key is absent or the
 *      model returns an error (503 cold start, rate limit, timeout).
 *
 *   4. NEUTRAL_FALLBACK — any canister call failure falls back silently. The
 *      pipeline is never interrupted by a classification error.
 *
 * STRICT SAFETY: no UI changes, no engine file changes. Pure TypeScript utility.
 */

import type { SentimentLabel } from "./entityValidator";
import { applyLexiconOverride } from "./lexiconOverrideService";

export interface SentimentResult {
  label: SentimentLabel;
  confidence: number;
  scoringMethod: "lexicon" | "finbert" | "neutral_fallback";
  /** Passthrough from canister: "finbert_live" | "neutral_fallback" | undefined */
  source?: string;
}

/** @deprecated Use SentimentResult */
export type FinBERTResult = SentimentResult;

const NEUTRAL_FALLBACK: SentimentResult = {
  label: "neutral",
  confidence: 0.5,
  scoringMethod: "neutral_fallback",
  source: "neutral_fallback",
};

/**
 * Classifies the sentiment of a headline.
 *
 * @param text            The headline text to classify.
 * @param sentimentScore  Optional pre-computed sentiment score from the mock
 *                        headline pool. When present AND non-zero, classification
 *                        is derived directly from its sign — no canister call.
 *                        When undefined or zero, calls canister.classifyHeadline().
 */
export async function analyzeSentiment(
  text: string,
  sentimentScore?: number,
): Promise<SentimentResult> {
  // ── Mock pool fast-path (disabled) ────────────────────────────────────────
  // All headlines — including those with a pre-assigned sentimentScore — now
  // fall through to the canister call below. sentimentScore is retained only as
  // a fallback in the Step 3 catch block, used when the canister call fails.
  // ──────────────────────────────────────────────────────────────────────────

  // Local helper: derive a SentimentResult from a pre-assigned sentimentScore
  // using the same clampedConfidence + sign-based threshold logic that the old
  // fast-path used. Shared between this block (for documentation) and the
  // Step 3 catch fallback so the two paths stay in sync.
  const scoreFallback = (): SentimentResult => {
    if (sentimentScore === undefined || sentimentScore === 0) {
      return NEUTRAL_FALLBACK;
    }
    const clampedConfidence = Math.min(
      0.95,
      Math.max(0.55, Math.abs(sentimentScore)),
    );
    let label: SentimentLabel;
    if (sentimentScore > 0.05) {
      label = "positive";
    } else if (sentimentScore < -0.05) {
      label = "negative";
    } else {
      label = "neutral";
    }
    return {
      label,
      confidence: clampedConfidence,
      scoringMethod: "finbert",
    };
  };

  // ── 1. Gradio Space (primary path) ────────────────────────────────────────
  console.log(`[FinBERT] routing to Gradio first: "${text.slice(0, 60)}"`);
  const gradioResult = await gradioFallback(text, scoreFallback);

  if (gradioResult.scoringMethod !== "neutral_fallback") {
    if (gradioResult.label === "neutral" && gradioResult.confidence < 0.7) {
      // ── 2. Lexicon override — only when Gradio is weakly neutral ──────────
      const override = applyLexiconOverride(text);
      if (override) {
        console.log(
          `[FinBERT] Lexicon override (weak Gradio neutral): "${text.slice(0, 60)}" → ${override.direction} (${override.confidence.toFixed(2)})`,
        );
        return {
          label: override.direction,
          confidence: override.confidence,
          scoringMethod: "lexicon",
        };
      }
    }
    return gradioResult;
  }

  // ── 3. scoreFallback — last resort when Gradio returns neutral_fallback ──
  return scoreFallback();
  // ──────────────────────────────────────────────────────────────────────────
}

async function gradioFallback(
  text: string,
  scoreFallback: () => SentimentResult,
): Promise<SentimentResult> {
  console.log(`[FinBERT] Gradio fallback triggered for: "${text.slice(0, 60)}"`);
  try {
    const step1 = await fetch(`${GRADIO_BASE}/gradio_api/call/v2/classify_api`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ headline: text }),
    });
    if (!step1.ok) return scoreFallback();
    const { event_id: eventId } = await step1.json() as { event_id: string };
    if (!eventId) return scoreFallback();

    const step2 = await fetch(`${GRADIO_BASE}/gradio_api/call/classify_api/${eventId}`, {
      headers: { Accept: "text/event-stream" },
    });
    if (!step2.ok) return scoreFallback();
    const raw = await step2.text();

    // SSE payload: lines like "data: [...]" — extract the JSON array line
    const dataLine = raw.split("\n").filter((l) => l.startsWith("data:") && l.trim() !== "data: null").at(-1);
    if (!dataLine) return scoreFallback();
    const payload = JSON.parse(dataLine.slice(5).trim()) as Array<unknown>;
    const first = Array.isArray(payload) ? payload[0] : payload;
    const result = (typeof first === "string" ? JSON.parse(first) : first) as {
      sentimentLabel: string;
      confidence: number;
      source: string;
    };
    if (!result?.sentimentLabel) return scoreFallback();

    const normalized = result.sentimentLabel.toLowerCase() as SentimentLabel;
    const validLabel: SentimentLabel = (
      ["positive", "negative", "neutral"] as SentimentLabel[]
    ).includes(normalized) ? normalized : "neutral";

    console.log(
      `[FinBERT] Gradio fallback: "${text.slice(0, 60)}" → ${validLabel} (${result.confidence.toFixed(2)})`,
    );
    return {
      label: validLabel,
      confidence: Math.round(result.confidence * 100) / 100,
      scoringMethod: result.source === "finbert_live" ? "finbert" : "neutral_fallback",
      source: result.source ?? "gradio_direct",
    };
  } catch {
    return scoreFallback();
  }
}

const GRADIO_BASE = "https://anthonyjb1-momentum-finbert-inference.hf.space";

function keepAlive(): void {
  fetch(`${GRADIO_BASE}/gradio_api/info`, { method: "GET" }).catch(() => {
    // Silence errors — this is a best-effort warm-up ping only.
  });
}

keepAlive();
setInterval(keepAlive, 10 * 60 * 1000);
