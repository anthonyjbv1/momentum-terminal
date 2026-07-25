import { AnimatePresence } from "motion/react";
import React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { AuthGateway } from "./components/AuthGateway";
import { BottomNav } from "./components/BottomNav";
import type { TabType } from "./components/BottomNav";
import { Layout } from "./components/Layout";
import { OnboardingOverlay } from "./components/OnboardingOverlay";
import { AdminAuthProvider } from "./contexts/AdminAuthContext";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { CrisisRegimeProvider } from "./contexts/CrisisRegimeContext";
import {
  LocalHoldingsProvider,
  useLocalHoldings,
} from "./contexts/LocalHoldingsContext";
import { LoyaltyProvider, useLoyalty } from "./contexts/LoyaltyContext";
import { NewsEventContext } from "./contexts/NewsEventContext";
import { OracleTickProvider } from "./contexts/OracleTickContext";
import { WalletProvider } from "./contexts/WalletContext";
import { useNewsEventDispatcher } from "./hooks/useNewsEventDispatcher";
import { AdminPortal } from "./pages/AdminPortal";
import { AdminSentinelGateway } from "./pages/AdminSentinelGateway";
import { AssetList } from "./pages/AssetList";
import SearchPage from "./pages/SearchPage";

const TAB_STORAGE_SUFFIX = "sentimentam_active_tab";

function loadActiveTab(userId: string): TabType {
  if (!userId) return "markets";
  try {
    const stored = localStorage.getItem(`${userId}_${TAB_STORAGE_SUFFIX}`);
    if (
      stored === "markets" ||
      stored === "portfolio" ||
      stored === "feed" ||
      stored === "profile"
    ) {
      return stored;
    }
  } catch {
    /* ignore */
  }
  return "markets";
}

function saveActiveTab(userId: string, tab: TabType): void {
  if (!userId) return;
  try {
    localStorage.setItem(`${userId}_${TAB_STORAGE_SUFFIX}`, tab);
  } catch {
    /* ignore */
  }
}

/**
 * Bridges LocalHoldingsContext -> LoyaltyContext.
 *
 * B4: Per-position loyalty tracking.
 * - Calls setPositionEntry(indexName, timestampMs) when a new position is detected.
 * - Calls clearPositionTier(indexName) when a specific position is removed.
 * - Does NOT reset the entire streak when any holding is cleared.
 */
function LoyaltySyncer() {
  const { holdings } = useLocalHoldings();
  const { setPositionEntry, clearPositionTier, positionTimestamps } =
    useLoyalty();

  // Track the set of active index names from the previous render
  const prevNamesRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const currentNames = new Set(holdings.map(([name]) => name));

    // Detect newly opened positions and record their entry timestamp
    for (const [name, h] of holdings) {
      if (!prevNamesRef.current.has(name)) {
        // New position detected — record the allocationTimestamp as entry time
        const entryMs = Number(h.allocationTimestamp) / 1_000_000;
        if (entryMs > 0) {
          setPositionEntry(name, entryMs);
        }
      }
    }

    // Detect closed positions and clear their individual clock
    for (const prevName of prevNamesRef.current) {
      if (!currentNames.has(prevName)) {
        clearPositionTier(prevName);
      }
    }

    prevNamesRef.current = currentNames;
  }, [holdings, setPositionEntry, clearPositionTier]);

  // On mount: seed entry timestamps for any existing positions that are not
  // yet tracked in the loyalty map (handles cold-start / page refresh cases).
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional mount-only seed
  useEffect(() => {
    for (const [name, h] of holdings) {
      if (!positionTimestamps.has(name)) {
        const entryMs = Number(h.allocationTimestamp) / 1_000_000;
        if (entryMs > 0) {
          setPositionEntry(name, entryMs);
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}

function AppContent({
  activeTab,
  onTabChange,
}: {
  activeTab: TabType;
  onTabChange: (tab: TabType) => void;
}) {
  const { isAuthenticated, userAccount } = useAuth();
  const userId = userAccount?.email ?? "";
  const newsState = useNewsEventDispatcher();
  const [searchOpen, setSearchOpen] = useState(false);

  // Navigate from search overlay → markets tab + scroll target index into view.
  // Switches the tab first, then waits for the markets page to be visible and
  // the row to be mounted before scrolling (mirrors NewsFeedSidebar pattern).
  const handleNavigateToIndex = useCallback(
    (indexName: string) => {
      setSearchOpen(false);
      onTabChange("markets");
      setTimeout(() => {
        const el = document.querySelector<HTMLElement>(
          `[data-asset-name="${indexName}"]`,
        );
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
          el.style.transition = "box-shadow 0.3s ease";
          el.style.boxShadow = "0 0 0 1px oklch(0.72 0.18 145 / 0.5)";
          setTimeout(() => {
            el.style.boxShadow = "";
          }, 1500);
        }
      }, 80);
    },
    [onTabChange],
  );

  // Wrap onTabChange to persist the tab for the current user
  const handleTabChange = useCallback(
    (tab: TabType) => {
      saveActiveTab(userId, tab);
      onTabChange(tab);
    },
    [userId, onTabChange],
  );

  // Load the persisted tab for this user once they are authenticated
  const loadedForRef = useRef<string | null>(null);
  useEffect(() => {
    if (!userId || loadedForRef.current === userId) return;
    loadedForRef.current = userId;
    const persisted = loadActiveTab(userId);
    if (persisted !== activeTab) {
      onTabChange(persisted);
    }
  }, [userId, activeTab, onTabChange]);

  const pathname = window.location.pathname;

  if (pathname === "/admin-sentinel") {
    return <AdminSentinelGateway />;
  }

  if (pathname === "/admin-portal") {
    return <AdminPortal />;
  }

  if (!isAuthenticated) {
    return <AuthGateway />;
  }

  return (
    <NewsEventContext.Provider value={newsState}>
      <LoyaltySyncer />
      <div style={{ paddingBottom: "64px" }}>
        <Layout
          activeTab={activeTab}
          onTabChange={handleTabChange}
          onOpenSearch={() => setSearchOpen(true)}
        >
          <AssetList />
        </Layout>
      </div>
      <BottomNav activeTab={activeTab} onTabChange={handleTabChange} />
      <OnboardingOverlay
        onDismiss={(navigateToMarkets) => {
          if (navigateToMarkets) handleTabChange("markets");
        }}
      />
      {searchOpen && (
        <SearchPage
          onClose={() => setSearchOpen(false)}
          onNavigateToIndex={handleNavigateToIndex}
        />
      )}
    </NewsEventContext.Provider>
  );
}

export default function App() {
  // Default to "markets" — AppContent will restore the persisted tab
  // for the authenticated user once userId is available.
  const [activeTab, setActiveTab] = useState<TabType>("markets");

  const handleTabChange = useCallback((tab: TabType) => {
    setActiveTab(tab);
  }, []);

  return (
    <AdminAuthProvider>
      <AuthProvider>
        <WalletProvider>
          <LocalHoldingsProvider>
            <LoyaltyProvider>
              <OracleTickProvider>
                <CrisisRegimeProvider>
                  <AppContent
                    activeTab={activeTab}
                    onTabChange={handleTabChange}
                  />
                </CrisisRegimeProvider>
              </OracleTickProvider>
            </LoyaltyProvider>
          </LocalHoldingsProvider>
        </WalletProvider>
      </AuthProvider>
    </AdminAuthProvider>
  );
}
