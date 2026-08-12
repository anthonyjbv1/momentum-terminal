/**
 * OnboardingOverlay — 5-slide first-visit tutorial.
 *
 * Trigger: on mount, checks localStorage for a per-user onboarding key.
 * If the key exists (truthy), the overlay does not render. On dismiss
 * (Skip or Enter Terminal), sets the key and hides permanently.
 */

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

function stripIndexSuffix(name: string): string {
  return name.replace(/ (Index|Sentiment)$/, "");
}

function formatImpact(score: number): string {
  const sign = score >= 0 ? "+" : "";
  return `${sign}${score.toFixed(2)}`;
}

// ─── SLIDE 0 — Live index scores ─────────────────────────────────────────────

function Slide0Preview() {
  const { finalScores } = useOracleTick();
  const assets = FALLBACK_ASSET_DEFS.slice(0, 4);

  return (
    <div className="pointer-events-none w-full flex flex-col gap-2 py-1">
      {/* Header row */}
      <div className="flex items-center justify-between mb-1 px-1">
        <span className="text-[9px] uppercase tracking-widest text-zinc-600 font-semibold">Index</span>
        <span className="text-[9px] uppercase tracking-widest text-zinc-600 font-semibold">Score</span>
      </div>
      {assets.map((asset, i) => {
        const score = finalScores.get(asset.name);
        const isPos = score != null && score >= 50;
        return (
          <div
            key={asset.name}
            className="flex items-center justify-between px-2.5 py-2 rounded"
            style={{
              background: i % 2 === 0 ? "rgba(255,255,255,0.025)" : "transparent",
              borderLeft: score != null ? `2px solid ${isPos ? "#4ade80" : "#f87171"}` : "2px solid rgba(255,255,255,0.06)",
            }}
          >
            {score == null ? (
              <>
                <div className="h-2.5 w-28 rounded bg-zinc-800 animate-pulse" />
                <div className="h-2.5 w-10 rounded bg-zinc-800 animate-pulse" />
              </>
            ) : (
              <>
                <span className="text-[10px] font-medium text-zinc-300 truncate pr-2">
                  {stripIndexSuffix(asset.name)}
                </span>
                <span
                  className="font-mono text-[11px] font-bold tabular-nums shrink-0"
                  style={{ color: isPos ? "#4ade80" : "#f87171" }}
                >
                  {score.toFixed(1)}
                </span>
              </>
            )}
          </div>
        );
      })}
      <div className="flex items-center gap-1.5 mt-1 px-1">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
        <span className="text-[9px] text-zinc-600 uppercase tracking-wider">Oracle live · updating in real time</span>
      </div>
    </div>
  );
}

// ─── SLIDE 1 — Score / buy / redeem anatomy ───────────────────────────────────

function Slide1Preview() {
  const SCORE = 74.8;
  const BUY = (SCORE + 0.5).toFixed(1);
  const REDEEM = (SCORE - 0.5).toFixed(1);
  const SIZE = 80;
  const STROKE = 6;
  const R = (SIZE - STROKE) / 2;
  const C = 2 * Math.PI * R;
  const dashOffset = C * (1 - SCORE / 100);
  const green = "#4ade80";

  return (
    <div className="pointer-events-none w-full flex items-center gap-5 px-2 py-2">
      {/* Arc ring */}
      <div style={{ position: "relative", width: SIZE, height: SIZE, flexShrink: 0 }}>
        <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} style={{ transform: "rotate(-90deg)" }} aria-hidden="true">
          <title>Score arc</title>
          <circle cx={SIZE/2} cy={SIZE/2} r={R} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={STROKE} />
          <circle cx={SIZE/2} cy={SIZE/2} r={R} fill="none" stroke={green} strokeWidth={STROKE} strokeLinecap="round"
            strokeDasharray={C} strokeDashoffset={dashOffset}
            style={{ filter: "drop-shadow(0 0 4px rgba(74,222,128,0.35))" }}
          />
        </svg>
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 800, fontSize: "1.1rem", color: green, lineHeight: 1 }}>{SCORE}</span>
          <span style={{ fontSize: "0.55rem", color: "rgba(255,255,255,0.3)", letterSpacing: "0.05em", marginTop: 2 }}>SCORE</span>
        </div>
      </div>

      {/* Price columns */}
      <div className="flex flex-col gap-2 flex-1">
        <div className="flex items-center justify-between px-2.5 py-1.5 rounded" style={{ background: "rgba(74,222,128,0.06)", border: "1px solid rgba(74,222,128,0.15)" }}>
          <span className="text-[9px] uppercase tracking-widest text-zinc-500 font-semibold">Buy (High)</span>
          <span className="font-mono text-[11px] font-bold text-green-400">{BUY}</span>
        </div>
        <div className="flex items-center justify-between px-2.5 py-1.5 rounded" style={{ background: "rgba(248,113,113,0.06)", border: "1px solid rgba(248,113,113,0.15)" }}>
          <span className="text-[9px] uppercase tracking-widest text-zinc-500 font-semibold">Sell (Low)</span>
          <span className="font-mono text-[11px] font-bold text-red-400">{REDEEM}</span>
        </div>
        <div className="flex items-center justify-between px-2.5 py-1 rounded" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
          <span className="text-[9px] uppercase tracking-widest text-zinc-600 font-semibold">Spread</span>
          <span className="font-mono text-[10px] text-zinc-500">±0.50 pts</span>
        </div>
      </div>
    </div>
  );
}

// ─── SLIDE 2 — Oracle feed ────────────────────────────────────────────────────

function Slide2Preview() {
  const { lastDispatchedHeadline } = useOracleTick();
  const [entries, setEntries] = useState<DispatchedHeadlineEntry[]>([]);

  useEffect(() => {
    const refresh = () => setEntries(getAllDispatchedHeadlines(2));
    refresh();
    const unsub = subscribeToDispatchedHeadlines(refresh);
    return unsub;
  }, []);

  useEffect(() => {
    if (lastDispatchedHeadline != null) setEntries(getAllDispatchedHeadlines(2));
  }, [lastDispatchedHeadline]);

  const skeleton = (
    <div className="flex flex-col gap-1.5 px-2.5 py-2 rounded" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)" }}>
      <div className="h-2.5 w-full rounded bg-zinc-800 animate-pulse" />
      <div className="h-2.5 w-3/4 rounded bg-zinc-800 animate-pulse" />
      <div className="flex items-center gap-2 mt-0.5">
        <div className="h-2 w-14 rounded bg-zinc-800 animate-pulse" />
        <div className="h-2 w-10 rounded bg-zinc-800 animate-pulse" />
        <div className="h-2.5 w-8 rounded bg-zinc-800 animate-pulse ml-auto" />
      </div>
    </div>
  );

  return (
    <div className="pointer-events-none w-full flex flex-col gap-2 py-1">
      <div className="flex items-center gap-1.5 mb-0.5 px-1">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
        <span className="text-[9px] text-zinc-500 uppercase tracking-wider font-semibold">Oracle Feed</span>
      </div>
      {entries.length === 0
        ? [0, 1].map((i) => <div key={i}>{skeleton}</div>)
        : entries.map((entry) => {
            const { event } = entry;
            const impact = formatImpact(event.sentimentScore);
            const isPos = event.sentimentScore > 0;
            const tag = stripIndexSuffix(event.relatedIndex ?? "");
            return (
              <div
                key={`${entry.dispatchedAt}-${event.headline}`}
                className="flex flex-col gap-1.5 px-2.5 py-2 rounded"
                style={{
                  background: "rgba(255,255,255,0.02)",
                  border: "1px solid rgba(255,255,255,0.05)",
                  borderLeft: `2px solid ${isPos ? "#4ade80" : "#f87171"}`,
                }}
              >
                <p className="text-[10px] text-zinc-300 font-medium leading-relaxed line-clamp-2">
                  {event.headline}
                </p>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[9px] uppercase tracking-widest text-zinc-600 font-medium">
                    {event.source?.trim() || "NEWSWIRE"}
                  </span>
                  {tag && (
                    <span className="text-[9px] uppercase tracking-wider text-primary/70 font-semibold border border-primary/20 bg-primary/5 px-1 py-0.5 rounded-[3px]">
                      {tag}
                    </span>
                  )}
                  <span className={`font-mono text-[10px] font-bold tabular-nums ml-auto ${isPos ? "text-green-400" : "text-red-400"}`}>
                    {impact} pts
                  </span>
                </div>
              </div>
            );
          })}
    </div>
  );
}

// ─── SLIDE 3 — Loyalty tiers ──────────────────────────────────────────────────

function Slide3Preview() {
  const tiers = [
    { tier: "Bronze",  days: "7d+",  spread: "0.40", color: "oklch(0.62 0.12 55)" },
    { tier: "Silver",  days: "14d+", spread: "0.30", color: "oklch(0.78 0.04 240)" },
    { tier: "Gold",    days: "21d+", spread: "0.20", color: "oklch(0.82 0.18 85)" },
    { tier: "Obsidian",days: "30d+", spread: "0.10", color: "oklch(0.68 0.22 290)" },
  ];

  return (
    <div className="pointer-events-none w-full flex flex-col gap-1.5 py-1">
      <div className="flex items-center justify-between px-1 mb-1">
        <span className="text-[9px] uppercase tracking-widest text-zinc-600 font-semibold">Tier</span>
        <div className="flex items-center gap-6">
          <span className="text-[9px] uppercase tracking-widest text-zinc-600 font-semibold">Hold</span>
          <span className="text-[9px] uppercase tracking-widest text-zinc-600 font-semibold">Spread</span>
        </div>
      </div>
      {tiers.map((row) => (
        <div
          key={row.tier}
          className="flex items-center justify-between px-2.5 py-2 rounded"
          style={{
            background: "rgba(255,255,255,0.02)",
            border: "1px solid rgba(255,255,255,0.05)",
            borderLeft: `2px solid ${row.color}`,
          }}
        >
          <span style={{ color: row.color, fontSize: "0.7rem", fontWeight: 700, fontFamily: "'JetBrains Mono', monospace", minWidth: "5rem" }}>
            {row.tier}
          </span>
          <div className="flex items-center gap-6">
            <span style={{ color: "#8E8E93", fontSize: "0.65rem", fontFamily: "'JetBrains Mono', monospace" }}>{row.days}</span>
            <span style={{ color: "oklch(0.72 0.18 145)", fontSize: "0.7rem", fontFamily: "'JetBrains Mono', monospace", fontWeight: 600 }}>
              {row.spread}
            </span>
          </div>
        </div>
      ))}
      <p className="text-[9px] text-zinc-600 text-center mt-1 italic">
        Standard tier pays full 0.50 spread. Hold longer, pay less.
      </p>
    </div>
  );
}

// ─── SLIDE 4 — Ready state ────────────────────────────────────────────────────

function Slide4Preview() {
  const stats = [
    { label: "Indexes Tracked", value: "53" },
    { label: "Oracle Model", value: "AI / NLP" },
    { label: "Starting Balance", value: "$0" },
    { label: "Min. Allocation", value: "$1.00" },
  ];

  return (
    <div className="pointer-events-none w-full flex flex-col gap-2 py-1">
      <div
        className="flex items-center justify-center gap-2 px-3 py-2 rounded mb-1"
        style={{ background: "rgba(74,222,128,0.06)", border: "1px solid rgba(74,222,128,0.15)" }}
      >
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
        <span className="text-[10px] uppercase tracking-widest text-green-400 font-bold">Systems Nominal</span>
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        {stats.map((s) => (
          <div
            key={s.label}
            className="flex flex-col gap-0.5 px-2.5 py-2 rounded"
            style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)" }}
          >
            <span className="text-[9px] uppercase tracking-widest text-zinc-600 font-semibold">{s.label}</span>
            <span className="font-mono text-[11px] font-bold text-zinc-200">{s.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Slide definitions ────────────────────────────────────────────────────────

interface SlideConfig {
  label: string;
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

  if (!visible) return null;

  const dismiss = (navigateToMarkets: boolean) => {
    try {
      localStorage.setItem(onboardingKey, "true");
    } catch { /* ignore */ }
    setVisible(false);
    onDismiss(navigateToMarkets);
  };

  const handleSkip = () => dismiss(false);
  const handleEnter = () => { startedRef.current = true; dismiss(true); };
  const handleBack = () => setCurrentSlide((s) => Math.max(0, s - 1));
  const handleNext = () => { if (currentSlide < SLIDES.length - 1) setCurrentSlide((s) => s + 1); };

  const SLIDES: SlideConfig[] = [
    {
      label: "01 / MARKETS",
      title: "Trade the Narrative",
      body: "Every index tracks the real-time momentum of a major global story — Fed policy, AI regulation, geopolitical risk. No expiry. No binary bets. Continuous conviction with live price discovery.",
      preview: <Slide0Preview />,
    },
    {
      label: "02 / POSITIONS",
      title: "High, Low, and Redeem",
      body: "HIGH allocates capital long on an index. LOW opens a short position. REDEEM closes your position at the live oracle price minus spread. All positions are marked to market in real time.",
      preview: <Slide1Preview />,
    },
    {
      label: "03 / ORACLE",
      title: "AI-Powered Price Engine",
      body: "The Oracle classifies incoming headlines, scores their sentiment impact, and updates every index price in real time. One headline can move multiple indexes simultaneously at different magnitudes.",
      preview: <Slide2Preview />,
    },
    {
      label: "04 / LOYALTY",
      title: "Hold Longer, Pay Less",
      body: "Every position has its own loyalty clock. The longer you hold, the lower your exit spread — rewarding conviction over reaction. Reach Obsidian tier and exit at near-zero spread.",
      preview: <Slide3Preview />,
    },
    {
      label: "05 / READY",
      title: "Terminal Initialized",
      body: "Your account starts with a clean slate — no pre-seeded positions and no buying power until you add funds. Build your portfolio from the ground up. The Oracle is live.",
      preview: <Slide4Preview />,
    },
  ];

  const slide = SLIDES[currentSlide];
  const isLast = currentSlide === SLIDES.length - 1;

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25, ease: "easeOut" }}
          className="fixed inset-0 z-[9999] flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.88)", backdropFilter: "blur(6px)" }}
          data-ocid="onboarding.dialog"
        >
          <div
            className="relative w-full max-w-sm mx-4 flex flex-col overflow-hidden"
            style={{
              background: "#080808",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: "12px",
              boxShadow: "0 32px 64px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.04)",
            }}
          >
            {/* Terminal header bar */}
            <div
              className="flex items-center justify-between px-4 py-2.5 shrink-0"
              style={{ borderBottom: "1px solid rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.02)" }}
            >
              <div className="flex items-center gap-2">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                <span
                  className="text-[9px] uppercase tracking-widest font-bold"
                  style={{ color: "rgba(255,255,255,0.25)", fontFamily: "'JetBrains Mono', monospace" }}
                >
                  MOMENTUM TERMINAL
                </span>
              </div>
              <span
                className="text-[9px] font-semibold"
                style={{ color: "rgba(255,255,255,0.2)", fontFamily: "'JetBrains Mono', monospace", letterSpacing: "0.08em" }}
              >
                {slide.label}
              </span>
            </div>

            {/* Preview panel */}
            <div
              className="px-4 py-4 shrink-0"
              style={{
                minHeight: "180px",
                borderBottom: "1px solid rgba(255,255,255,0.06)",
                background: "rgba(255,255,255,0.01)",
                display: "flex",
                alignItems: "center",
              }}
            >
              {slide.preview}
            </div>

            {/* Content */}
            <div className="px-5 pt-4 pb-3">
              <h2
                className="mb-1.5"
                style={{
                  fontSize: "0.875rem",
                  fontWeight: 700,
                  color: "rgba(255,255,255,0.92)",
                  letterSpacing: "-0.01em",
                  lineHeight: 1.3,
                }}
              >
                {slide.title}
              </h2>
              <p style={{ fontSize: "0.75rem", color: "#71717a", lineHeight: 1.65 }}>
                {slide.body}
              </p>

              {currentSlide === 3 && MOMENTUM_GUIDE_URL && (
                <a
                  href={MOMENTUM_GUIDE_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-3 flex items-center gap-1.5 text-xs text-primary/60 hover:text-primary transition-colors duration-150"
                >
                  Momentum Guide ↗
                </a>
              )}
            </div>

            {/* Nav row */}
            <div
              className="flex items-center justify-between px-5 pb-4 pt-2"
              style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}
            >
              {/* Back */}
              <button
                type="button"
                onClick={handleBack}
                disabled={currentSlide === 0}
                aria-label="Previous slide"
                className={`flex items-center justify-center w-8 h-8 rounded-lg transition-colors duration-150 focus:outline-none ${
                  currentSlide === 0
                    ? "text-zinc-700 cursor-not-allowed"
                    : "text-zinc-500 hover:text-zinc-200 cursor-pointer"
                }`}
                style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}
              >
                <ChevronLeft className="w-4 h-4" />
              </button>

              {/* Dots */}
              <div className="flex items-center gap-1.5">
                {SLIDES.map((s, i) => (
                  <button
                    key={s.label}
                    type="button"
                    onClick={() => setCurrentSlide(i)}
                    aria-label={`Go to slide ${i + 1}`}
                    className="transition-all duration-200 rounded-full"
                    style={{
                      width: i === currentSlide ? "16px" : "6px",
                      height: "6px",
                      background: i === currentSlide ? "#4ade80" : "rgba(255,255,255,0.12)",
                    }}
                  />
                ))}
              </div>

              {/* Next or Enter */}
              {isLast ? (
                <button
                  type="button"
                  onClick={handleEnter}
                  data-ocid="onboarding.start_trading_button"
                  className="px-4 py-1.5 rounded-lg text-xs font-bold tracking-wide transition-all duration-150 cursor-pointer focus:outline-none"
                  style={{
                    background: "rgba(74,222,128,0.15)",
                    border: "1px solid rgba(74,222,128,0.3)",
                    color: "#4ade80",
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.background = "#4ade80";
                    (e.currentTarget as HTMLButtonElement).style.color = "#000";
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.background = "rgba(74,222,128,0.15)";
                    (e.currentTarget as HTMLButtonElement).style.color = "#4ade80";
                  }}
                >
                  Enter Terminal
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleNext}
                  data-ocid="onboarding.next_button"
                  aria-label="Next slide"
                  className="flex items-center justify-center w-8 h-8 rounded-lg text-zinc-400 hover:text-zinc-200 transition-colors duration-150 cursor-pointer focus:outline-none"
                  style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Skip link */}
            <button
              type="button"
              onClick={handleSkip}
              data-ocid="onboarding.skip_button"
              className="absolute top-2.5 right-14 text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors duration-150 cursor-pointer"
              aria-label="Skip onboarding"
            >
              skip
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
