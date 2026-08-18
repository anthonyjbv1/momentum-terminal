import {
  AlertTriangle,
  ChevronDown,
  Clock,
  RefreshCw,
  Search,
  User,
} from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useContext, useEffect, useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import { useCrisisRegime } from "../contexts/CrisisRegimeContext";
import { useLoyalty } from "../contexts/LoyaltyContext";
import { NewsEventContext } from "../contexts/NewsEventContext";
import { useOracleTick } from "../contexts/OracleTickContext";
import { useCountdown } from "../hooks/useCountdown";
import { useNextRefreshTime } from "../hooks/useQueries";
import type { TabType } from "./BottomNav";
import GSIPulseModal from "./GSIPulseModal";
import { NewsFeedSidebar } from "./NewsFeedSidebar";
import { PortfolioHeader } from "./PortfolioHeader";
import { ProfilePage } from "./ProfilePage";
import { ProfileSlideOver } from "./ProfileSlideOver";

export interface LayoutProps {
  children: ReactNode;
  activeTab: TabType;
  onTabChange: (tab: TabType) => void;
  onOpenSearch?: () => void;
}

/** Momentum logo mark — two elliptical loops at ±35°, rounded caps, white on black, central diamond */
export function MomentumLogoMark() {
  return (
    <svg
      role="img"
      aria-label="Momentum logo"
      viewBox="0 0 28 28"
      width="28"
      height="28"
      xmlns="http://www.w3.org/2000/svg"
      style={{ display: "block" }}
    >
      {/* Black background square with rounded corners */}
      <rect width="28" height="28" rx="4" fill="#000000" />

      {/* Ellipse 1 — rotated +35° */}
      <ellipse
        cx="14"
        cy="14"
        rx="8"
        ry="3"
        fill="none"
        stroke="white"
        strokeWidth="2.2"
        strokeLinecap="round"
        transform="rotate(35 14 14)"
      />

      {/* Ellipse 2 — rotated -35° */}
      <ellipse
        cx="14"
        cy="14"
        rx="8"
        ry="3"
        fill="none"
        stroke="white"
        strokeWidth="2.2"
        strokeLinecap="round"
        transform="rotate(-35 14 14)"
      />

      {/* Central diamond — small square rotated 45°, filled white */}
      <rect
        x="12.2"
        y="12.2"
        width="3.6"
        height="3.6"
        rx="0.4"
        fill="white"
        transform="rotate(45 14 14)"
      />
    </svg>
  );
}

export function Layout({
  children,
  activeTab,
  onTabChange,
  onOpenSearch,
}: LayoutProps) {
  const year = new Date().getFullYear();
  const { userAccount } = useAuth();
  const userId = userAccount?.email ?? "";
  const hasAllocKey = userId
    ? `${userId}_momentum_has_allocated`
    : "momentum_has_allocated";

  const { data: nextRefreshTimeNs } = useNextRefreshTime();
  const { isSyncing } = useContext(NewsEventContext);
  const { isCrisisMode } = useCrisisRegime();

  const { tier: loyaltyTier } = useLoyalty();
  const [isGSIModalOpen, setIsGSIModalOpen] = useState(false);
  const { currentGSI, tickCount } = useOracleTick();
  const [countdown, secondsLeft] = useCountdown(nextRefreshTimeNs, tickCount);
  const isCountdownUrgent = secondsLeft <= 5;

  // ── Profile icon in header → switches to Profile tab ─────────────────────────
  const handleProfileIconClick = useCallback(() => {
    onTabChange("profile");
  }, [onTabChange]);

  const gsiDisplay = currentGSI !== null ? currentGSI.toFixed(1) : "—";
  const gsiColor =
    currentGSI === null
      ? "var(--muted-foreground, #64748b)"
      : currentGSI >= 55
        ? "oklch(0.72 0.18 145)"
        : currentGSI <= 45
          ? "#f87171"
          : "#fbbf24";

  // ── Collapsible hero — only relevant on Markets tab ───────────────────────────
  const heroCollapseKey = "momentum_hero_collapsed";
  const [isHeroCollapsed, setIsHeroCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    const saved = localStorage.getItem(heroCollapseKey);
    if (saved !== null) return saved === "true";
    return localStorage.getItem(hasAllocKey) === "true";
  });

  const toggleHeroCollapsed = useCallback((collapsed: boolean) => {
    setIsHeroCollapsed(collapsed);
    localStorage.setItem(heroCollapseKey, String(collapsed));
  }, [heroCollapseKey]);

  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === hasAllocKey && e.newValue === "true") {
        setIsHeroCollapsed(true);
        localStorage.setItem(heroCollapseKey, "true");
      }
    };
    window.addEventListener("storage", handleStorageChange);
    return () => window.removeEventListener("storage", handleStorageChange);
  }, [hasAllocKey, heroCollapseKey]);

  return (
    <div className="min-h-screen lg:h-screen flex flex-col bg-background text-foreground sm:overflow-x-hidden lg:overflow-hidden">
      {/* ── Global Header — visible on all tabs ── */}
      <header className="sticky top-0 z-50 w-full border-b border-border bg-black">
        <div className="max-w-screen-xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between overflow-x-auto scrollbar-hide sm:overflow-x-visible">
          {/* Logo */}
          <div className="flex items-center gap-2.5 -ml-1 sm:ml-0">
            <MomentumLogoMark />
            <div className="flex flex-col leading-none">
              <span className="text-foreground font-bold text-sm tracking-tight">
                Momentum
              </span>
              <span className="text-muted-foreground text-[9px] uppercase tracking-widest font-medium">
                Terminal
              </span>
            </div>
          </div>

          {/* Status indicators + profile button */}
          <div className="flex items-center gap-3 flex-nowrap flex-shrink-0">
            {isSyncing && (
              <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-sm bg-electric-blue/5 border border-electric-blue/20">
                <RefreshCw className="w-3 h-3 text-electric-blue animate-spin" />
                <span className="text-electric-blue text-[10px] font-semibold uppercase tracking-wider">
                  Syncing…
                </span>
              </div>
            )}

            {/* GSI Pulse widget */}
            <button
              type="button"
              aria-label={
                isCrisisMode
                  ? "CRISIS REGIME ACTIVE — Global Sentiment Index"
                  : "GSI Pulse — Global Sentiment Index"
              }
              data-ocid="gsi_pulse.open_modal_button"
              onClick={() => setIsGSIModalOpen(true)}
              title={
                isCrisisMode
                  ? "High volatility detected. Asset correlations are converging as global risk spikes."
                  : undefined
              }
              className={
                isCrisisMode
                  ? "flex items-center gap-2 px-3 py-1.5 rounded-sm border cursor-pointer transition-all duration-150 focus:outline-none focus-visible:ring-1 focus-visible:ring-red-700 bg-[#8B0000]/20 border-[#8B0000]/60 animate-pulse"
                  : "flex items-center gap-2 px-3 py-1.5 rounded-sm bg-white/[0.03] border border-border cursor-pointer transition-all duration-150 hover:border-primary/40 hover:bg-primary/5 focus:outline-none focus-visible:ring-1 focus-visible:ring-primary/50"
              }
              style={{ fontFamily: "inherit" }}
            >
              {isCrisisMode ? (
                <>
                  <AlertTriangle className="w-3 h-3 text-red-400 shrink-0" />
                  <span className="text-[10px] uppercase tracking-widest font-bold text-red-400">
                    Crisis Regime Active
                  </span>
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-500" />
                </>
              ) : (
                <>
                  <span
                    className="text-[10px] uppercase tracking-widest font-medium"
                    style={{ color: "var(--muted-foreground, #64748b)" }}
                  >
                    GSI
                  </span>
                  <span
                    className="font-mono text-[11px] font-bold tabular-nums"
                    style={{ color: gsiColor }}
                  >
                    {gsiDisplay}
                  </span>
                  <span
                    className="inline-block w-1.5 h-1.5 rounded-full animate-pulse"
                    style={{ backgroundColor: gsiColor }}
                  />
                </>
              )}
            </button>

            {/* Next Refresh countdown */}
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-sm bg-white/[0.03] border border-border">
              <Clock className="w-3 h-3 text-muted-foreground" />
              <span className="text-muted-foreground text-[10px] uppercase tracking-widest font-medium hidden sm:inline">
                Refresh
              </span>
              <span
                className={`font-mono text-[11px] tabular-nums tracking-wide transition-colors duration-150 ${
                  isCountdownUrgent ? "text-red-400" : "text-foreground/70"
                }`}
              >
                {countdown}
              </span>
            </div>

            {/* Search badge — click to open search */}
            <button
              type="button"
              aria-label="Search — open search"
              data-ocid="header.open_search_button"
              onClick={onOpenSearch}
              className="flex items-center gap-2 px-3 py-1.5 rounded-sm bg-white/[0.03] border border-border cursor-pointer transition-all duration-150 hover:border-primary/40 hover:bg-primary/5 focus:outline-none focus-visible:ring-1 focus-visible:ring-primary/50"
            >
              <Search className="w-3 h-3 text-primary" />
              <span
                className="text-[10px] uppercase tracking-widest font-medium"
                style={{ color: "var(--muted-foreground, #64748b)" }}
              >
                SEARCH
              </span>
            </button>

            {/* Loyalty Tier Pill — clicking goes to Profile tab */}
            <button
              type="button"
              aria-label="Loyalty tier — go to profile"
              onClick={handleProfileIconClick}
              className="hidden sm:flex items-center gap-1.5 px-3 py-1 rounded-full border border-white/20 text-sm font-mono text-gray-300 hover:border-white/40 hover:text-white transition-colors duration-150 focus:outline-none"
            >
              <span style={{ color: loyaltyTier.color }}>
                {loyaltyTier.emoji}
              </span>
              <span
                className="text-[11px] font-semibold"
                style={{ color: loyaltyTier.color }}
              >
                {loyaltyTier.name}
              </span>
              <span className="text-[11px] text-gray-400 font-mono">
                Exit: {(0.5 - loyaltyTier.spreadReduction).toFixed(2)}
              </span>
            </button>

            {/* Profile icon — navigates to Profile tab */}
            <button
              type="button"
              aria-label="Profile"
              onClick={handleProfileIconClick}
              data-ocid="header.profile_button"
              className={`flex items-center justify-center w-9 h-9 rounded-sm border transition-colors duration-150 focus:outline-none focus-visible:ring-1 focus-visible:ring-primary/50 ${
                activeTab === "profile"
                  ? "border-primary/50 bg-primary/10"
                  : "border-white/10 hover:border-white/20 hover:brightness-110"
              }`}
              style={{
                backgroundColor:
                  activeTab === "profile" ? undefined : "#000000",
              }}
            >
              <User
                className="w-4 h-4"
                style={{
                  color:
                    activeTab === "profile"
                      ? "oklch(0.72 0.18 145)"
                      : "oklch(0.72 0.18 145)",
                }}
                strokeWidth={1.75}
              />
            </button>
          </div>
        </div>
      </header>

      {/* ── Main content area — ALL tabs always mounted, CSS visibility only ── */}
      {/* None of the 4 tabs ever unmount — only display changes. This preserves  */}
      {/* hasLoadedOnceRef, query cache, and all component state across tab switches. */}
      <div className="flex-1 flex flex-col min-h-0 pb-16 lg:pb-0 bg-black lg:overflow-y-auto">
        {/* MARKETS TAB — always mounted */}
        <div
          style={{ display: activeTab === "markets" ? "flex" : "none" }}
          className="flex-1 flex-col lg:flex-row max-w-screen-xl mx-auto w-full min-h-0"
        >
          <div className="flex-1 min-w-0 overflow-y-auto">
            {/* ── Hero strip — Markets tab only ── */}
            {activeTab === "markets" && (
              <div className="w-full border-b border-border">
                {isHeroCollapsed ? (
                  <div className="max-w-screen-xl mx-auto px-4 sm:px-6 py-2 flex items-center justify-between overflow-hidden">
                    <div className="flex items-center gap-3 flex-nowrap flex-shrink-0 min-w-0">
                      <span className="text-foreground text-sm font-bold tracking-tight">
                        Momentum Terminal
                      </span>
                      <span
                        className="hidden sm:inline text-[10px] uppercase tracking-widest font-medium"
                        style={{ color: "#8E8E93" }}
                      >
                        Oracle-driven sentiment exchange
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => toggleHeroCollapsed(false)}
                      className="flex items-center gap-1 px-2 py-1 rounded-sm hover:bg-white/5 transition-colors"
                      aria-label="Expand platform description"
                    >
                      <span
                        className="text-[9px] uppercase tracking-widest font-medium"
                        style={{ color: "#8E8E93" }}
                      >
                        About
                      </span>
                      <ChevronDown
                        size={12}
                        style={{
                          color: "#8E8E93",
                          transform: "rotate(-90deg)",
                        }}
                      />
                    </button>
                  </div>
                ) : (
                  <div className="max-w-screen-xl mx-auto px-4 sm:px-6 py-6">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="text-muted-foreground text-[10px] uppercase tracking-widest font-medium mb-1">
                          Platform
                        </p>
                        <h1 className="text-foreground text-3xl sm:text-4xl font-bold tracking-tight leading-none">
                          Momentum Terminal
                        </h1>
                        <p className="text-muted-foreground text-sm mt-2 max-w-md">
                          Oracle-driven sentiment exchange for real-time
                          geopolitical and cultural narratives. Allocate
                          capital. Redeem value. No P2P. No expiry.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => toggleHeroCollapsed(true)}
                        className="flex items-center gap-1 px-2 py-1 rounded-sm hover:bg-white/5 transition-colors mt-1"
                        aria-label="Collapse platform description"
                      >
                        <span
                          className="text-[9px] uppercase tracking-widest font-medium"
                          style={{ color: "#8E8E93" }}
                        >
                          Collapse
                        </span>
                        <ChevronDown size={12} style={{ color: "#8E8E93" }} />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
            {children}
          </div>
          <div className="hidden lg:flex lg:flex-col lg:shrink-0">
            <NewsFeedSidebar />
          </div>
        </div>

        {/* PORTFOLIO TAB — always mounted */}
        <div
          style={{ display: activeTab === "portfolio" ? "flex" : "none" }}
          className="flex-1 flex-col overflow-y-auto"
        >
          <div className="max-w-screen-xl mx-auto px-4 sm:px-6 pt-6 pb-20 w-full">
            <PortfolioHeader onTabChange={onTabChange} />
          </div>
        </div>

        {/* FEED TAB — always mounted */}
        {/* [&>aside] overrides the internal lg:w-[280px] shrink-0 without touching NewsFeedSidebar.tsx */}
        <div
          style={{ display: activeTab === "feed" ? "flex" : "none" }}
          className="flex-1 flex-col overflow-hidden"
        >
          <div className="flex-1 flex flex-col w-full max-w-screen-xl mx-auto overflow-hidden [&>aside]:!w-full [&>aside]:lg:!w-full [&>aside]:lg:!shrink">
            <NewsFeedSidebar />
          </div>
        </div>

        {/* PROFILE TAB — always mounted */}
        <div
          style={{ display: activeTab === "profile" ? "block" : "none" }}
          className="flex-1 overflow-y-auto pb-20"
        >
          <ProfilePage />
        </div>
      </div>

      {/* ── Footer — only on Markets tab to avoid clutter on functional tabs ── */}
      {activeTab === "markets" && (
        <footer className="w-full border-t border-border lg:hidden">
          <div className="max-w-screen-xl mx-auto px-4 sm:px-6 py-5 flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="flex items-center gap-4">
              <span className="text-muted-foreground text-xs">
                &copy; {year} Momentum
              </span>
              <span className="text-border text-xs hidden sm:inline">
                &middot;
              </span>
              <span className="text-muted-foreground text-xs hidden sm:inline">
                Synthetic exposure only. Not financial advice.
              </span>
            </div>
          </div>
        </footer>
      )}

      {/* ── Bottom Navigation Bar — rendered at root level in App.tsx, not here ── */}

      {/* ── ProfileSlideOver — kept for backward compatibility, no longer opened from header ── */}
      <ProfileSlideOver isOpen={false} onClose={() => {}} />

      <GSIPulseModal
        isOpen={isGSIModalOpen}
        onClose={() => setIsGSIModalOpen(false)}
        currentGSI={currentGSI}
      />
    </div>
  );
}
