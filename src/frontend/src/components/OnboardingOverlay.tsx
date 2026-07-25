/**
 * OnboardingOverlay — 5-slide first-visit tutorial.
 *
 * Trigger: on mount, checks localStorage.getItem('mt_onboarding_complete').
 * If the key exists (truthy), the overlay does not render. On dismiss
 * (Skip or Start Trading), sets the key and hides permanently.
 */

// TODO: wire when guide is published
const MOMENTUM_GUIDE_URL = "";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import { useOracleTick } from "../contexts/OracleTickContext";
import { FALLBACK_ASSET_DEFS } from "../data/fallbackAssets";
import {
  getAllDispatchedHeadlines,
  subscribeToDispatchedHeadlines,
} from "../services/dispatchedHeadlineLog";
import type { DispatchedHeadlineEntry } from "../services/dispatchedHeadlineLog";

// ─── helpers ─────────────────────────────────────────────────────────────────

function stripIndexSuffix(name: string): string {
  return name.replace(/ Index$/, "");
}

function formatImpact(score: number): string {
  const sign = score >= 0 ? "+" : "";
  return `${sign}${score.toFixed(2)}`;
}

// ─── SLIDE 0 — Index list miniature ──────────────────────────────────────────

function Slide0Preview() {
  const { finalScores } = useOracleTick();
  const first3 = FALLBACK_ASSET_DEFS.slice(0, 3);

  return (
    <div className="pointer-events-none flex flex-col gap-3 py-2 px-1">
      {first3.map((asset) => {
        const score = finalScores.get(asset.name);
        return (
          <div
            key={asset.name}
            className="flex items-center justify-between gap-3"
          >
            {score == null ? (
              <>
                <div className="h-3 w-32 rounded bg-zinc-800 animate-pulse" />
                <div className="h-3 w-12 rounded bg-zinc-800 animate-pulse" />
              </>
            ) : (
              <>
                <span className="text-[11px] font-medium text-zinc-300 truncate">
                  {stripIndexSuffix(asset.name)}
                </span>
                <span className="font-mono text-[11px] font-bold text-primary tabular-nums shrink-0">
                  {score.toFixed(1)}
                </span>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── SLIDE 1 — Static score preview (replaces live SentimentArc) ──────────────

function Slide1Preview() {
  // Mirror the exact SVG technique used in ConfidenceRing (OracleAuditModal.tsx)
  const SCORE = 74.8;
  const SIZE = 96;
  const STROKE = 7;
  const R = (SIZE - STROKE) / 2;
  const CIRCUMFERENCE = 2 * Math.PI * R;
  const progress = Math.min(100, Math.max(0, SCORE));
  const dashOffset = CIRCUMFERENCE * (1 - progress / 100);
  const color = "#4ade80";
  const glowColor = "rgba(74,222,128,0.35)";

  return (
    <div
      className="pointer-events-none"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "8px",
        padding: "1rem",
      }}
    >
      {/* SVG ring — exact same structure as ConfidenceRing in OracleAuditModal */}
      <div style={{ position: "relative", width: SIZE, height: SIZE }}>
        <svg
          width={SIZE}
          height={SIZE}
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          style={{ transform: "rotate(-90deg)" }}
          role="img"
          aria-label={`Confidence score: ${SCORE}%`}
        >
          <title>Confidence score: {SCORE}%</title>
          {/* Track ring */}
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={R}
            fill="none"
            stroke="rgba(255,255,255,0.07)"
            strokeWidth={STROKE}
          />
          {/* Progress arc */}
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={R}
            fill="none"
            stroke={color}
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={dashOffset}
            style={{
              filter: `drop-shadow(0 0 4px ${glowColor})`,
            }}
          />
        </svg>

        {/* Center label — exact same structure as ConfidenceRing */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "1px",
          }}
        >
          <span
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontWeight: 800,
              fontSize: "1.35rem",
              color,
              lineHeight: 1,
              letterSpacing: "-0.02em",
            }}
          >
            {SCORE}
          </span>
          <span
            style={{
              fontFamily: "'Inter', system-ui, sans-serif",
              fontSize: "0.6rem",
              color: "rgba(255,255,255,0.35)",
              fontWeight: 500,
              letterSpacing: "0.05em",
            }}
          >
            %
          </span>
        </div>
      </div>

      {/* Tier pill — exact same structure as ConfidenceRing tier pill */}
      <span
        style={{
          fontSize: "0.6rem",
          fontWeight: 700,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color,
          background: `${color}18`,
          border: `1px solid ${color}40`,
          borderRadius: "999px",
          padding: "2px 10px",
        }}
      >
        LIVE SCORE
      </span>
      <div
        style={{
          display: "flex",
          gap: "1rem",
        }}
      >
        <div style={{ textAlign: "center" }}>
          <div
            style={{
              color: "oklch(0.72 0.18 145)",
              fontSize: "0.875rem",
              fontFamily: "monospace",
              fontWeight: 600,
            }}
          >
            75.3
          </div>
          <div
            style={{
              color: "#8E8E93",
              fontSize: "0.625rem",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
            }}
          >
            BUY
          </div>
        </div>
        <div style={{ textAlign: "center" }}>
          <div
            style={{
              color: "#f87171",
              fontSize: "0.875rem",
              fontFamily: "monospace",
              fontWeight: 600,
            }}
          >
            74.3
          </div>
          <div
            style={{
              color: "#8E8E93",
              fontSize: "0.625rem",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
            }}
          >
            REDEEM
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── SLIDE 2 — Oracle feed snippet ───────────────────────────────────────────

function Slide2Preview() {
  const { lastDispatchedHeadline } = useOracleTick();
  const [entries, setEntries] = useState<DispatchedHeadlineEntry[]>([]);

  // Initialise + subscribe to dispatch log, same pattern as NewsFeedSidebar
  useEffect(() => {
    const refresh = () => {
      setEntries(getAllDispatchedHeadlines(2));
    };
    refresh();
    const unsub = subscribeToDispatchedHeadlines(refresh);
    return unsub;
  }, []);

  // Also re-read when a new headline fires via useOracleTick
  useEffect(() => {
    if (lastDispatchedHeadline != null) {
      setEntries(getAllDispatchedHeadlines(2));
    }
  }, [lastDispatchedHeadline]);

  const skeletonRow = (
    <div className="flex flex-col gap-1.5">
      <div className="h-3 w-full rounded bg-zinc-800 animate-pulse" />
      <div className="h-3 w-3/4 rounded bg-zinc-800 animate-pulse" />
      <div className="flex items-center gap-2 mt-0.5">
        <div className="h-2 w-16 rounded bg-zinc-800 animate-pulse" />
        <div className="h-2 w-10 rounded bg-zinc-800 animate-pulse" />
        <div className="h-3 w-8 rounded bg-zinc-800 animate-pulse ml-auto" />
      </div>
    </div>
  );

  // Cross-index divider label — inserted between entry 0 and entry 1
  const crossIndexDivider = (
    <div
      style={{
        textAlign: "center",
        padding: "0.375rem 0",
        color: "#8E8E93",
        fontSize: "0.625rem",
        textTransform: "uppercase",
        letterSpacing: "0.12em",
        fontStyle: "italic",
      }}
    >
      Same headline · Two indexes · Different impact
    </div>
  );

  return (
    <div className="pointer-events-none flex flex-col gap-3 py-2 px-1">
      {entries.length === 0
        ? [0, 1].map((i) => <div key={i}>{skeletonRow}</div>)
        : entries.map((entry, idx) => {
            const { event } = entry;
            const src = event.source?.trim() || "NEWSWIRE";
            const tag = stripIndexSuffix(event.relatedIndex ?? "");
            const impact = formatImpact(event.sentimentScore);
            const impactColor =
              event.sentimentScore > 0
                ? "text-green-400"
                : event.sentimentScore < 0
                  ? "text-red-400"
                  : "text-zinc-400";

            return (
              <div key={`${entry.dispatchedAt}-${event.headline}`}>
                <div className="flex flex-col gap-1">
                  <p className="text-[11px] text-zinc-300 font-medium leading-relaxed line-clamp-2">
                    {event.headline}
                  </p>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[9px] uppercase tracking-widest text-zinc-500 font-medium">
                      {src}
                    </span>
                    {tag && (
                      <span className="text-[9px] uppercase tracking-wider text-primary/70 font-semibold border border-primary/20 bg-primary/5 px-1 py-0.5 rounded-[3px]">
                        {tag}
                      </span>
                    )}
                    <span
                      className={`font-mono text-[10px] font-bold tabular-nums ml-auto ${impactColor}`}
                    >
                      {impact} pts
                    </span>
                  </div>
                </div>
                {/* Insert cross-index label after the first entry when 2 entries exist */}
                {idx === 0 && entries.length >= 2 && crossIndexDivider}
              </div>
            );
          })}
    </div>
  );
}

// ─── SLIDE 3 — Static SVG illustration ───────────────────────────────────────

function Slide3Preview() {
  return (
    <div className="flex items-center justify-center py-4">
      <svg
        viewBox="0 0 200 120"
        width="200"
        height="120"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        {/* Open book left page */}
        <path
          d="M60 30 Q60 20 70 18 L100 22 L100 90 L70 86 Q60 84 60 74 Z"
          fill="none"
          stroke="#4b5563"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
        {/* Open book right page */}
        <path
          d="M140 30 Q140 20 130 18 L100 22 L100 90 L130 86 Q140 84 140 74 Z"
          fill="none"
          stroke="#4b5563"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
        {/* Spine line */}
        <line
          x1="100"
          y1="22"
          x2="100"
          y2="90"
          stroke="#374151"
          strokeWidth="1"
        />
        {/* Left page lines */}
        <line
          x1="72"
          y1="40"
          x2="96"
          y2="41"
          stroke="#374151"
          strokeWidth="1"
          strokeLinecap="round"
        />
        <line
          x1="72"
          y1="50"
          x2="96"
          y2="51"
          stroke="#374151"
          strokeWidth="1"
          strokeLinecap="round"
        />
        <line
          x1="72"
          y1="60"
          x2="90"
          y2="61"
          stroke="#374151"
          strokeWidth="1"
          strokeLinecap="round"
        />
        {/* Right page lines */}
        <line
          x1="104"
          y1="40"
          x2="128"
          y2="41"
          stroke="#374151"
          strokeWidth="1"
          strokeLinecap="round"
        />
        <line
          x1="104"
          y1="50"
          x2="128"
          y2="51"
          stroke="#374151"
          strokeWidth="1"
          strokeLinecap="round"
        />
        <line
          x1="104"
          y1="60"
          x2="122"
          y2="61"
          stroke="#374151"
          strokeWidth="1"
          strokeLinecap="round"
        />
        {/* "MOMENTUM TERMINAL" text */}
        <text
          x="100"
          y="108"
          textAnchor="middle"
          fontSize="8"
          fontWeight="700"
          letterSpacing="2"
          fill="#6b7280"
          fontFamily="system-ui, sans-serif"
        >
          MOMENTUM TERMINAL
        </text>
      </svg>
    </div>
  );
}

// ─── Slide definitions ────────────────────────────────────────────────────────

interface SlideConfig {
  title: string;
  body: string;
  preview: React.ReactNode;
}

// ─── Main component ───────────────────────────────────────────────────────────

export interface OnboardingOverlayProps {
  onDismiss: (navigateToMarkets: boolean) => void;
}

const ONBOARDING_SUFFIX = "mt_onboarding_complete";

export function OnboardingOverlay({ onDismiss }: OnboardingOverlayProps) {
  const { userAccount } = useAuth();
  const onboardingKey = userAccount?.email
    ? `${userAccount.email}_${ONBOARDING_SUFFIX}`
    : ONBOARDING_SUFFIX;

  const [visible, setVisible] = useState<boolean>(() => {
    try {
      const key = userAccount?.email
        ? `${userAccount.email}_${ONBOARDING_SUFFIX}`
        : ONBOARDING_SUFFIX;
      return !localStorage.getItem(key);
    } catch {
      return false;
    }
  });

  const [currentSlide, setCurrentSlide] = useState(0);
  const startedRef = useRef(false);

  // Prevent re-show on accidental re-mount
  if (!visible) return null;

  const dismiss = (navigateToMarkets: boolean) => {
    try {
      localStorage.setItem(onboardingKey, "true");
    } catch {
      /* ignore */
    }
    setVisible(false);
    onDismiss(navigateToMarkets);
  };

  const handleSkip = () => dismiss(false);
  const handleStartTrading = () => {
    startedRef.current = true;
    dismiss(true);
  };
  const handleBack = () => setCurrentSlide((s) => Math.max(0, s - 1));
  const handleNext = () => {
    if (currentSlide < SLIDES.length - 1) setCurrentSlide((s) => s + 1);
  };

  const SLIDES: SlideConfig[] = [
    {
      title: "What is Momentum Terminal?",
      body: "Trade the narrative. Every index tracks the real-time momentum of a major global story — from Fed policy to cultural movements. No expiry. No binary bets. Just continuous conviction.",
      preview: <Slide0Preview />,
    },
    {
      title: "How to Trade",
      body: "Allocate capital to gain exposure to any index. If narrative momentum moves in your favor, your position gains value. Redeem at any time — a ±0.5 spread applies on entry and exit. The longer you hold, the lower your exit spread — rewarding conviction over reaction.",
      preview: <Slide1Preview />,
    },
    {
      title: "The Oracle",
      body: "Every price is driven by the Oracle — an AI pipeline that classifies incoming headlines, scores their impact, and updates index prices in real time. The same headline can move multiple indexes simultaneously at different magnitudes. Tap any index to see its full audit trail.",
      preview: <Slide2Preview />,
    },
    {
      title: "Learn More",
      body: "A detailed guide to Momentum Terminal — covering indexes, the Oracle, allocation strategy, and the loyalty tier system — is available in the Momentum Guide at the bottom of the platform.",
      preview: <Slide3Preview />,
    },
    {
      title: "The Longer You Hold",
      body: "Every position has its own loyalty clock. Hold longer and your exit spread drops — rewarding conviction, not just timing. Reach Obsidian tier and exit at nearly zero spread.",
      preview: (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "0.5rem",
            width: "100%",
            padding: "0.5rem 0",
          }}
        >
          {[
            {
              tier: "Bronze",
              days: "7 days",
              spread: "0.40 spread",
              color: "oklch(0.62 0.12 55)",
            },
            {
              tier: "Silver",
              days: "14 days",
              spread: "0.30 spread",
              color: "oklch(0.78 0.04 240)",
            },
            {
              tier: "Gold",
              days: "21 days",
              spread: "0.20 spread",
              color: "oklch(0.82 0.18 85)",
            },
            {
              tier: "Obsidian",
              days: "30 days",
              spread: "0.10 spread",
              color: "oklch(0.68 0.22 290)",
            },
          ].map((row) => (
            <div
              key={row.tier}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "0.5rem 0.75rem",
                borderRadius: "0.375rem",
                backgroundColor: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.06)",
              }}
            >
              <div
                style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}
              >
                <span
                  style={{
                    color: row.color,
                    fontSize: "0.75rem",
                    fontWeight: 700,
                    fontFamily: "monospace",
                    minWidth: "4.5rem",
                  }}
                >
                  {row.tier}
                </span>
                <span style={{ color: "#8E8E93", fontSize: "0.6875rem" }}>
                  {row.days}
                </span>
              </div>
              <span
                style={{
                  color: "oklch(0.72 0.18 145)",
                  fontSize: "0.75rem",
                  fontFamily: "monospace",
                  fontWeight: 600,
                }}
              >
                {row.spread}
              </span>
            </div>
          ))}
          <p
            style={{
              color: "#8E8E93",
              fontSize: "0.625rem",
              textAlign: "center",
              marginTop: "0.25rem",
              fontStyle: "italic",
            }}
          >
            Standard tier pays full 0.50 spread. Each tier above reduces it.
          </p>
        </div>
      ),
    },
  ];

  const slide = SLIDES[currentSlide];

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3, ease: "easeOut" }}
          className="fixed inset-0 z-[9999] bg-black/80 backdrop-blur-sm flex items-center justify-center"
          data-ocid="onboarding.dialog"
        >
          {/* Card */}
          <div className="relative bg-[#0a0a0a] border border-zinc-800 rounded-2xl w-full max-w-sm mx-4 overflow-hidden flex flex-col shadow-2xl">
            {/* Skip link — top-right absolute */}
            <button
              type="button"
              onClick={handleSkip}
              data-ocid="onboarding.skip_button"
              className="absolute top-3 right-4 text-xs text-zinc-500 hover:text-zinc-300 transition-colors duration-150 cursor-pointer z-10"
              aria-label="Skip onboarding"
            >
              Skip
            </button>

            {/* Preview panel */}
            <div className="h-[180px] bg-zinc-900/60 border-b border-zinc-800 flex items-center justify-center px-6 overflow-hidden shrink-0">
              {slide.preview}
            </div>

            {/* Content area */}
            <div className="px-6 pt-5 pb-4">
              <h2 className="text-foreground text-sm font-bold tracking-tight mb-2">
                {slide.title}
              </h2>
              <p className="text-zinc-400 text-xs leading-relaxed">
                {slide.body}
              </p>

              {/* Slide 3 (index 3) — guide indicator */}
              {currentSlide === 3 && (
                <div className="mt-4 flex items-center gap-2 justify-center">
                  {MOMENTUM_GUIDE_URL ? (
                    <a
                      href={MOMENTUM_GUIDE_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 text-xs text-primary/70 hover:text-primary transition-colors duration-150"
                      data-ocid="onboarding.guide_link"
                    >
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 12 12"
                        fill="none"
                        aria-hidden="true"
                      >
                        <path
                          d="M6 2.5V9.5M3 7L6 9.5L9 7"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                      Momentum Guide
                    </a>
                  ) : (
                    <span
                      className="flex items-center gap-1.5 text-xs text-zinc-600 cursor-default select-none"
                      data-ocid="onboarding.guide_label"
                    >
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 12 12"
                        fill="none"
                        aria-hidden="true"
                      >
                        <path
                          d="M6 2.5V9.5M3 7L6 9.5L9 7"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                      Momentum Guide
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Navigation row */}
            <div className="flex items-center justify-between px-6 pb-5 gap-3">
              {/* Back button */}
              <button
                type="button"
                onClick={handleBack}
                disabled={currentSlide === 0}
                data-ocid="onboarding.back_button"
                aria-label="Previous slide"
                className={`flex items-center justify-center w-8 h-8 rounded-lg border transition-colors duration-150 focus:outline-none focus-visible:ring-1 focus-visible:ring-primary/50 ${
                  currentSlide === 0
                    ? "border-zinc-800 text-zinc-700 opacity-30 cursor-not-allowed"
                    : "border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200 cursor-pointer"
                }`}
              >
                <ChevronLeft className="w-4 h-4" />
              </button>

              {/* Progress dots — auto-derived from SLIDES.length */}
              <div
                className="flex items-center gap-1.5"
                aria-label={`Slide ${currentSlide + 1} of ${SLIDES.length}`}
              >
                {SLIDES.map((s, i) => (
                  <span
                    key={s.title}
                    className={`inline-block w-2 h-2 rounded-full transition-colors duration-200 ${
                      i === currentSlide ? "bg-green-500" : "bg-zinc-700"
                    }`}
                    data-ocid={`onboarding.dot.${i + 1}`}
                    aria-hidden="true"
                  />
                ))}
              </div>

              {/* Next / Start Trading */}
              {currentSlide < SLIDES.length - 1 ? (
                <button
                  type="button"
                  onClick={handleNext}
                  data-ocid="onboarding.next_button"
                  className="flex items-center justify-center w-8 h-8 rounded-lg border border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200 transition-colors duration-150 cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-primary/50"
                  aria-label="Next slide"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleStartTrading}
                  data-ocid="onboarding.start_trading_button"
                  className="px-4 py-1.5 rounded-lg bg-green-600 hover:bg-green-500 text-white text-xs font-bold tracking-wide transition-colors duration-150 cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-green-400/50"
                >
                  Start Trading
                </button>
              )}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
