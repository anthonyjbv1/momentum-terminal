import {
  ArrowLeft,
  Search,
  TrendingDown,
  TrendingUp,
  Volume2,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useOracleTick } from "../contexts/OracleTickContext";
import { useAssetPrices } from "../hooks/useQueries";
import { getDisplayName } from "../lib/oracle/indexCategoryRegistry";

// All 53 platform indices — search covers the full index universe.
const ALLOWED_INDEX_NAMES = new Set([
  // ── Core ──────────────────────────────────────────────────────────────────
  "Fed Policy Sentiment",
  "MENA Stability Sentiment",
  "AI Regulation Risk Sentiment",
  "Traditionalism Sentiment",
  "Progressivism Sentiment",
  "Masculism Sentiment",
  "Feminism Sentiment",
  "F1 Constructor Sentiment",
  "NASCAR Sentiment",
  "Obesity Drug Sentiment",
  "Whole Food & Wellness Sentiment",
  // ── Individuals ───────────────────────────────────────────────────────────
  "Elon Musk Sentiment",
  "MrBeast Sentiment",
  "Kai Cenat Sentiment",
  "Drake Sentiment",
  "Adin Ross Sentiment",
  "Patrick Mahomes Sentiment",
  "Kendrick Lamar Sentiment",
  "Jensen Huang Sentiment",
  "Mark Zuckerberg Sentiment",
  "Warren Buffett Sentiment",
  "Larry Ellison Sentiment",
  "Jeff Bezos Sentiment",
  "Larry Page Sentiment",
  "Sergey Brin Sentiment",
  "Michael Dell Sentiment",
  // ── Sports ────────────────────────────────────────────────────────────────
  "Kansas City Chiefs Sentiment",
  "Denver Broncos Sentiment",
  "F1 Ferrari Sentiment",
  "FC Barcelona Sentiment",
  "France National Team Sentiment",
  "F1 McLaren Sentiment",
  "Real Madrid CF Sentiment",
  "F1 Mercedes Sentiment",
  "Spain National Team Sentiment",
  // ── Universities ──────────────────────────────────────────────────────────
  "University of Michigan Sentiment",
  "Ohio State University Sentiment",
  "Harvard University Sentiment",
  "Yale University Sentiment",
  // ── Health ────────────────────────────────────────────────────────────────
  "Type 2 Diabetes Sentiment",
  "Alzheimer's Sentiment",
  "Seasonal Influenza Sentiment",
  "Ozempic Sentiment",
  "Wegovy Sentiment",
  "Mental Health Sentiment",
  "Cancer Research Sentiment",
  // ── Regional ──────────────────────────────────────────────────────────────
  "California Sentiment",
  "New York Sentiment",
  "Florida Sentiment",
  "Texas Sentiment",
  "China Sentiment",
  "Germany Sentiment",
  "United States Sentiment",
]);

interface SearchPageProps {
  onClose: () => void;
  onNavigateToIndex?: (indexName: string) => void;
}

interface IndexRowData {
  name: string;
  displayName: string;
  category: string;
  currentScore: number;
  changePct: number;
  volume: number;
}

const SECTION_META = {
  gainers: {
    label: "Top Gainers",
    icon: TrendingUp,
    accent: "oklch(0.72 0.18 145)",
    metric: "change" as const,
  },
  losers: {
    label: "Top Losers",
    icon: TrendingDown,
    accent: "#f87171",
    metric: "change" as const,
  },
  volume: {
    label: "Top Volume",
    icon: Volume2,
    accent: "oklch(0.65 0.22 250)",
    metric: "volume" as const,
  },
};

function formatVolume(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

function formatPct(n: number): string {
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

export default function SearchPage({
  onClose,
  onNavigateToIndex,
}: SearchPageProps) {
  const { finalScores, scoreHistoryMap, platformVolumeByIndex } =
    useOracleTick();
  const { data: assets } = useAssetPrices();
  const [query, setQuery] = useState("");
  const [isClosing, setIsClosing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Smooth fade-out before unmount. Because SearchPage portals to document.body,
  // an App-level AnimatePresence cannot drive the exit animation — the portal
  // content is not a DOM child of the AnimatePresence location. Instead we keep
  // the component mounted locally, animate the overlay to opacity 0 via the
  // isClosing flag, and only call the parent onClose after the 0.25s transition
  // completes. This mirrors the GSIPulseModal canonical portal pattern.
  const handleClose = useCallback(() => {
    if (isClosing) return;
    setIsClosing(true);
    setTimeout(() => {
      onClose();
    }, 250);
  }, [isClosing, onClose]);

  // Navigate to an index on the markets page. Triggers the same smooth fade-out
  // as handleClose so the overlay disappears gracefully while the markets page
  // scrolls to the target row.
  const handleNavigate = useCallback(
    (indexName: string) => {
      if (isClosing) return;
      setIsClosing(true);
      setTimeout(() => {
        onNavigateToIndex?.(indexName);
      }, 250);
    },
    [isClosing, onNavigateToIndex],
  );

  // Escape to close
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [handleClose]);

  // Lock body scroll while open
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // Autofocus the search input on mount
  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 80);
    return () => clearTimeout(t);
  }, []);

  // Build the unified row dataset from existing hooks — no new backend calls.
  const rows = useMemo<IndexRowData[]>(() => {
    const categoryByName = new Map<string, string>();
    for (const a of assets ?? []) {
      categoryByName.set(a.name, a.category);
    }

    const seen = new Set<string>();
    const out: IndexRowData[] = [];

    const allNames = new Set<string>([
      ...finalScores.keys(),
      ...Object.keys(platformVolumeByIndex),
      ...(assets ?? []).map((a) => a.name),
    ]);

    for (const name of allNames) {
      if (seen.has(name)) continue;
      // Only show indices that are actually on the platform (canonical filter).
      if (!ALLOWED_INDEX_NAMES.has(name)) continue;
      seen.add(name);

      const history = scoreHistoryMap.get(name) ?? [];
      const latest = history.length > 0 ? history[history.length - 1] : null;
      const previous = history.length > 1 ? history[history.length - 2] : null;
      const currentScore =
        latest ??
        finalScores.get(name) ??
        assets?.find((a) => a.name === name)?.baseScore ??
        0;

      let changePct = 0;
      if (latest !== null && previous !== null && previous !== 0) {
        changePct = ((latest - previous) / Math.abs(previous)) * 100;
      }

      out.push({
        name,
        displayName: getDisplayName(name),
        category: categoryByName.get(name) ?? "",
        currentScore,
        changePct,
        volume: platformVolumeByIndex[name] ?? 0,
      });
    }

    return out;
  }, [assets, finalScores, scoreHistoryMap, platformVolumeByIndex]);

  // Filter by query (case-insensitive name match)
  const filtered = useMemo<IndexRowData[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.displayName.toLowerCase().includes(q) ||
        r.name.toLowerCase().includes(q) ||
        r.category.toLowerCase().includes(q),
    );
  }, [rows, query]);

  // Sectioned lists when no query
  const sections = useMemo(() => {
    const withChange = filtered.filter((r) => Number.isFinite(r.changePct));
    const gainers = [...withChange]
      .sort((a, b) => b.changePct - a.changePct)
      .slice(0, 5);
    const losers = [...withChange]
      .sort((a, b) => a.changePct - b.changePct)
      .slice(0, 5);
    const byVolume = [...filtered]
      .filter((r) => r.volume > 0)
      .sort((a, b) => b.volume - a.volume)
      .slice(0, 5);
    return { gainers, losers, volume: byVolume };
  }, [filtered]);

  const hasQuery = query.trim().length > 0;

  const content = (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: isClosing ? 0 : 1 }}
        transition={{ duration: 0.25, ease: "easeOut" }}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 99999,
          background: "rgba(0,0,0,0.96)",
          backdropFilter: "blur(6px)",
          display: "flex",
          flexDirection: "column",
          fontFamily: "'Inter', system-ui, sans-serif",
        }}
        data-ocid="search.page"
      >
        {/* Top bar: back arrow + search input */}
        <motion.div
          initial={{ y: -16, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.3, ease: "easeOut", delay: 0.05 }}
          style={{
            width: "100%",
            maxWidth: "720px",
            margin: "0 auto",
            padding: "20px 16px 12px",
            display: "flex",
            flexDirection: "column",
            gap: "12px",
          }}
        >
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleClose}
              aria-label="Back to markets"
              data-ocid="search.back_button"
              className="flex items-center justify-center w-10 h-10 rounded-full border border-border bg-white/[0.03] text-muted-foreground hover:text-foreground hover:border-primary/40 hover:bg-primary/5 transition-colors duration-150 focus:outline-none focus-visible:ring-1 focus-visible:ring-primary/50"
            >
              <ArrowLeft className="w-5 h-5" strokeWidth={2} />
            </button>
            <div className="flex flex-col leading-none">
              <span className="text-foreground font-bold text-base tracking-tight">
                Search Markets
              </span>
              <span className="text-muted-foreground text-[10px] uppercase tracking-widest font-medium mt-1">
                Sentiment Indices
              </span>
            </div>
          </div>

          {/* Search input */}
          <div className="relative">
            <Search
              className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none"
              strokeWidth={2}
            />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search markets"
              aria-label="Search markets"
              data-ocid="search.search_input"
              className="w-full h-12 pl-10 pr-4 rounded-sm border border-border bg-white/[0.03] text-foreground placeholder:text-muted-foreground text-sm font-medium tracking-tight focus:outline-none focus:border-primary/40 focus:bg-primary/5 focus-visible:ring-1 focus-visible:ring-primary/50 transition-colors duration-150"
            />
          </div>
        </motion.div>

        {/* Scrollable results */}
        <div
          className="flex-1 overflow-y-auto"
          style={{ overscrollBehavior: "contain" }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: "720px",
              margin: "0 auto",
              padding: "8px 16px 48px",
            }}
          >
            {filtered.length === 0 ? (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25, ease: "easeOut" }}
                className="flex flex-col items-center justify-center py-20 text-center"
                data-ocid="search.empty_state"
              >
                <Search
                  className="w-8 h-8 text-muted-foreground/40 mb-3"
                  strokeWidth={1.5}
                />
                <p className="text-foreground text-sm font-semibold">
                  No indices match "{query.trim()}"
                </p>
                <p className="text-muted-foreground text-xs mt-1">
                  Try a different name or category.
                </p>
              </motion.div>
            ) : hasQuery ? (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25, ease: "easeOut" }}
              >
                <SectionHeader
                  label={`${filtered.length} ${filtered.length === 1 ? "result" : "results"}`}
                  icon={Search}
                  accent="oklch(0.72 0.18 145)"
                />
                <div className="flex flex-col gap-2">
                  {filtered.map((row, i) => (
                    <SearchRow
                      key={row.name}
                      row={row}
                      index={i}
                      metric="change"
                      onSelect={
                        onNavigateToIndex
                          ? () => handleNavigate(row.name)
                          : undefined
                      }
                    />
                  ))}
                </div>
              </motion.div>
            ) : (
              <div className="flex flex-col gap-8">
                {(["gainers", "losers", "volume"] as const).map((key) => {
                  const meta = SECTION_META[key];
                  const items = sections[key];
                  if (items.length === 0) return null;
                  return (
                    <motion.div
                      key={key}
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{
                        duration: 0.3,
                        ease: "easeOut",
                        delay:
                          key === "gainers"
                            ? 0.05
                            : key === "losers"
                              ? 0.12
                              : 0.19,
                      }}
                    >
                      <SectionHeader
                        label={meta.label}
                        icon={meta.icon}
                        accent={meta.accent}
                      />
                      <div className="flex flex-col gap-2">
                        {items.map((row, i) => (
                          <SearchRow
                            key={row.name}
                            row={row}
                            index={i}
                            metric={meta.metric}
                            onSelect={
                              onNavigateToIndex
                                ? () => handleNavigate(row.name)
                                : undefined
                            }
                          />
                        ))}
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );

  return createPortal(content, document.body);
}

function SectionHeader({
  label,
  icon: Icon,
  accent,
}: {
  label: string;
  icon: React.ComponentType<{
    className?: string;
    strokeWidth?: number;
    style?: React.CSSProperties;
  }>;
  accent: string;
}) {
  return (
    <div className="flex items-center gap-2 mb-3 px-1">
      <Icon className="w-3.5 h-3.5" strokeWidth={2} style={{ color: accent }} />
      <span
        className="text-[11px] uppercase tracking-widest font-bold"
        style={{ color: accent }}
      >
        {label}
      </span>
      <div className="flex-1 h-px bg-border/60 ml-1" />
    </div>
  );
}

function SearchRow({
  row,
  index,
  metric,
  onSelect,
}: {
  row: IndexRowData;
  index: number;
  metric: "change" | "volume";
  onSelect?: () => void;
}) {
  const isGain = row.changePct >= 0;
  const changeColor = isGain ? "oklch(0.72 0.18 145)" : "#f87171";
  const TrendIcon = isGain ? TrendingUp : TrendingDown;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: 0.22,
        ease: "easeOut",
        delay: Math.min(index * 0.04, 0.24),
      }}
      data-ocid={`search.item.${index + 1}`}
      onClick={onSelect}
      role={onSelect ? "button" : undefined}
      tabIndex={onSelect ? 0 : undefined}
      onKeyDown={
        onSelect
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect();
              }
            }
          : undefined
      }
      className={`group flex items-center gap-3 px-3 py-3 rounded-sm border border-border bg-white/[0.03] hover:bg-white/[0.06] hover:border-primary/30 transition-colors duration-150 focus:outline-none focus-visible:ring-1 focus-visible:ring-primary/50 ${
        onSelect ? "cursor-pointer" : "cursor-default"
      }`}
    >
      {/* Rank index */}
      <span className="hidden sm:inline-block w-6 shrink-0 text-muted-foreground font-mono text-[11px] tabular-nums text-right">
        {String(index + 1).padStart(2, "0")}
      </span>

      {/* Name + category */}
      <div className="flex-1 min-w-0">
        <p className="text-foreground text-sm font-semibold tracking-tight truncate">
          {row.displayName}
        </p>
        {row.category && (
          <p className="text-muted-foreground text-[10px] uppercase tracking-widest font-medium mt-0.5 truncate">
            {row.category}
          </p>
        )}
      </div>

      {/* Current score */}
      <div className="text-right shrink-0 min-w-[56px]">
        <p className="text-muted-foreground text-[9px] uppercase tracking-widest font-medium mb-0.5">
          Score
        </p>
        <p className="text-foreground font-mono font-bold text-sm tabular-nums leading-none">
          {row.currentScore.toFixed(1)}
        </p>
      </div>

      {/* Metric column */}
      {metric === "change" ? (
        <div className="text-right shrink-0 min-w-[78px]">
          <p className="text-muted-foreground text-[9px] uppercase tracking-widest font-medium mb-0.5">
            Change
          </p>
          <div className="flex items-center justify-end gap-1">
            <TrendIcon
              className="w-3 h-3 shrink-0"
              strokeWidth={2}
              style={{ color: changeColor }}
            />
            <span
              className="font-mono font-bold text-sm tabular-nums leading-none"
              style={{ color: changeColor }}
            >
              {formatPct(row.changePct)}
            </span>
          </div>
        </div>
      ) : (
        <div className="text-right shrink-0 min-w-[78px]">
          <p className="text-muted-foreground text-[9px] uppercase tracking-widest font-medium mb-0.5">
            Volume
          </p>
          <span
            className="font-mono font-bold text-sm tabular-nums leading-none"
            style={{ color: "oklch(0.65 0.22 250)" }}
          >
            {formatVolume(row.volume)}
          </span>
        </div>
      )}
    </motion.div>
  );
}
