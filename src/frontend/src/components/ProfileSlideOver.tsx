import { useQueryClient } from "@tanstack/react-query";
import {
  ChevronRight,
  Clock,
  FileText,
  LogOut,
  Plus,
  Shield,
  TrendingUp,
  X,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import { useLocalHoldings } from "../contexts/LocalHoldingsContext";
import { useLoyalty } from "../contexts/LoyaltyContext";
import { useOracleTick } from "../contexts/OracleTickContext";
import {
  type ActivityEntry,
  useWalletContext,
} from "../contexts/WalletContext";
import { useDailyPnL } from "../hooks/useDailyPnL";
import { useInternetIdentity } from "../hooks/useInternetIdentity";
import { useLocalHoldingsQuery } from "../hooks/useLocalHoldingsQuery";
import {
  useAssetPrices,
  useGetCallerUserProfile,
  useHoldings,
  useTransactionHistory,
  useWallet,
} from "../hooks/useQueries";
import type { Transaction } from "../types/backendEnums";
import { TransactionType } from "../types/backendEnums";
import { DepositModal } from "./DepositModal";
import { TierProgressBar } from "./TierProgressBar";

interface ProfileSlideOverProps {
  isOpen: boolean;
  onClose: () => void;
}

type ActiveView = "main" | "history" | "tax" | "legal" | "tx-detail";

function fmt(value: number) {
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatJoinDate(timestamp: bigint | number): string {
  const ms =
    typeof timestamp === "bigint" ? Number(timestamp) / 1_000_000 : timestamp;
  const date = new Date(ms);
  return date.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

function formatTxDate(timestamp: bigint | number): string {
  const ms =
    typeof timestamp === "bigint" ? Number(timestamp) / 1_000_000 : timestamp;
  const date = new Date(ms);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatActivityDate(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function txTypeLabel(type: TransactionType): string {
  switch (type) {
    case TransactionType.buy:
      return "Allocation";
    case TransactionType.sell:
      return "Redemption";
    case TransactionType.redeemAll:
      return "Full Redemption";
    case TransactionType.deposit:
      return "Deposit";
    case TransactionType.withdrawal:
      return "Withdrawal";
    default:
      return "Transaction";
  }
}

function txTypeColor(type: TransactionType): string {
  switch (type) {
    case TransactionType.buy:
      return "oklch(0.72 0.18 145)";
    case TransactionType.sell:
    case TransactionType.redeemAll:
      return "oklch(0.65 0.22 250)";
    default:
      return "oklch(0.52 0.012 240)";
  }
}

function isActivityTx(type: TransactionType): boolean {
  return (
    type === TransactionType.buy ||
    type === TransactionType.sell ||
    type === TransactionType.redeemAll
  );
}

function activityEntryLabel(entry: ActivityEntry): string {
  switch (entry.type) {
    case "Deposit":
      return "Deposit";
    case "Spend":
      return `Allocated — ${entry.source}`;
    case "Credit":
      return `Credited — ${entry.source}`;
    default:
      return entry.type;
  }
}

function activityEntryColor(entry: ActivityEntry): string {
  switch (entry.type) {
    case "Deposit":
      return "oklch(0.72 0.18 145)";
    case "Credit":
      return "oklch(0.72 0.18 145)";
    case "Spend":
      return "oklch(0.65 0.22 250)";
    default:
      return "#ffffff";
  }
}

function activityEntrySign(entry: ActivityEntry): string {
  return entry.type === "Spend" ? "-" : "+";
}

export function ProfileSlideOver({ isOpen, onClose }: ProfileSlideOverProps) {
  const [activeView, setActiveView] = useState<ActiveView>("main");
  const [isDepositOpen, setIsDepositOpen] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState<ActivityEntry | null>(
    null,
  );
  const { clear } = useInternetIdentity();
  const queryClient = useQueryClient();
  const { userAccount, logout } = useAuth();
  const {
    walletBalance: localWalletBalance,
    buyingPower,
    activityHistory,
    depositFunds,
  } = useWalletContext();

  // Reset to main view when panel closes
  useEffect(() => {
    if (!isOpen) {
      const timeout = setTimeout(() => setActiveView("main"), 300);
      return () => clearTimeout(timeout);
    }
  }, [isOpen]);

  // Data hooks
  const { data: userProfile } = useGetCallerUserProfile();
  const { data: walletBalance } = useWallet();
  const { data: holdingsData } = useHoldings();
  const { data: assetPrices } = useAssetPrices();
  const { data: transactions } = useTransactionHistory();

  // Local holdings (same source as PortfolioHeader) for live total portfolio value
  const { data: localHoldingsData } = useLocalHoldingsQuery();
  const { finalScores } = useOracleTick();
  const { costBasisMap, shortPositions } = useLocalHoldings();
  void costBasisMap;

  const SPREAD = 0.5;

  // Compute portfolio value using live Oracle prices (same logic as PortfolioHeader)
  const redeemPriceMap: Record<string, number> = {};
  if (assetPrices) {
    for (const ap of assetPrices) {
      const liveScore = finalScores.get(ap.name);
      if (liveScore !== undefined) {
        const spreadOffset = ap.backendSpread ?? ap.buyPrice - ap.baseScore;
        redeemPriceMap[ap.name] =
          Math.round((liveScore - spreadOffset) * 100) / 100;
      } else {
        redeemPriceMap[ap.name] = ap.redeemPrice;
      }
    }
  }

  let holdingsTotal = 0;
  let positionCount = 0;
  if (localHoldingsData) {
    for (const [name, holding] of localHoldingsData) {
      if (holding.units > 0) {
        const redeemPrice = redeemPriceMap[name] ?? 0;
        holdingsTotal += (holding.units + holding.accruedYield) * redeemPrice;
        positionCount++;
      }
    }
  }

  // Short positions MTM (same formula as useUserFullPosition)
  let shortHoldingsTotal = 0;
  for (const [name, short] of shortPositions) {
    if (short.entryScore > 0) {
      const currentScore = finalScores.get(name) ?? short.entryScore;
      const mtm = Math.max(
        0,
        short.dollars + ((short.entryScore - currentScore) / short.entryScore) * short.dollars,
      );
      shortHoldingsTotal += mtm;
      positionCount++;
    }
  }

  let earliestTimestamp: bigint = BigInt(0);

  if (holdingsData) {
    for (const [, holding] of holdingsData) {
      if (holding.units > 0) {
        if (
          holding.allocationTimestamp > BigInt(0) &&
          (earliestTimestamp === BigInt(0) ||
            holding.allocationTimestamp < earliestTimestamp)
        ) {
          earliestTimestamp = holding.allocationTimestamp;
        }
      }
    }
  }

  // Use local wallet balance (from WalletContext) as it reflects deposits immediately
  const cash = localWalletBalance > 0 ? localWalletBalance : (walletBalance ?? 0);
  const totalPortfolioValue = cash + holdingsTotal + shortHoldingsTotal;
  const deployedValue = holdingsTotal + shortHoldingsTotal;
  const {
    formatted: dailyChangeFormatted,
    isPositive: dailyPos,
    isNegative: dailyNeg,
  } = useDailyPnL(totalPortfolioValue);

  // Loyalty tier — from LoyaltyContext (single source of truth)
  const {
    tier: loyaltyTier,
    progressPercent: tierProgressPercent,
    daysUntilNextTier,
    nextTier,
  } = useLoyalty();

  // Activity transactions (buy, sell, redeemAll only)
  const activityTxs: Transaction[] = (transactions ?? [])
    .filter((tx) => isActivityTx(tx.transactionType))
    .slice()
    .sort((a, b) => Number(b.timestamp) - Number(a.timestamp))
    .slice(0, 20);

  // Join date from earliest transaction or profile
  const joinDate = (() => {
    if (transactions && transactions.length > 0) {
      const sorted = [...transactions].sort(
        (a, b) => Number(a.timestamp) - Number(b.timestamp),
      );
      return `Joined ${formatJoinDate(sorted[0].timestamp)}`;
    }
    return "Joined Feb 2026";
  })();
  void joinDate;

  // Resolve display name: prefer userAccount (localStorage session), then backend profile
  const displayName = userAccount?.username ?? userProfile?.name ?? "—";
  const displayEmail = userAccount?.email ?? "";

  // Sub-views need full height; main view sizes to content
  const isSubView = activeView !== "main";

  const handleLogout = async () => {
    onClose();
    logout();
    await clear();
    queryClient.clear();
  };

  const handleDepositConfirm = (amount: number) => {
    depositFunds(amount);
  };

  // Tier badge display helpers
  const TIER_BORDER: Record<string, string> = {
    Standard: "oklch(0.45 0 0)",
    Bronze: "oklch(0.62 0.12 55 / 0.7)",
    Silver: "oklch(0.78 0.04 240 / 0.7)",
    Gold: "oklch(0.82 0.18 85 / 0.7)",
    Obsidian: "oklch(0.68 0.22 290 / 0.7)",
  };
  const tierEmoji: Record<string, string> = {
    Standard: "◈",
    Bronze: "◆",
    Silver: "◆",
    Gold: "★",
    Obsidian: "✦",
  };

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 z-40 transition-opacity duration-300"
        style={{
          backgroundColor: "rgba(0,0,0,0.6)",
          backdropFilter: "blur(4px)",
          WebkitBackdropFilter: "blur(4px)",
          opacity: isOpen ? 1 : 0,
          pointerEvents: isOpen ? "auto" : "none",
        }}
        onClick={onClose}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
        }}
        role="presentation"
        aria-hidden="true"
      />

      {/* Slide-over panel */}
      <div
        className={`fixed top-0 right-0 z-50 flex flex-col overflow-hidden ${isSubView ? "h-full" : "max-h-screen"}`}
        style={{
          width: "min(390px, 100vw)",
          backgroundColor: "#0a0a0a",
          borderLeft: "1px solid #1C1C1E",
          transform: isOpen ? "translateX(0)" : "translateX(110%)",
          transition: "transform 300ms cubic-bezier(0.4, 0, 0.2, 1)",
          visibility: isOpen ? "visible" : "hidden",
          opacity: isOpen ? 1 : 0,
          pointerEvents: isOpen ? "auto" : "none",
          fontFamily: "'Inter', system-ui, sans-serif",
          boxSizing: "border-box",
        }}
        aria-label="Profile"
      >
        {/* ── MAIN VIEW ── */}
        <AnimatePresence>
          {activeView === "main" && (
            <motion.div
              key="main"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3, ease: "easeOut" }}
              className="flex flex-col overflow-y-auto"
            >
              {/* ── Header: Avatar + Name + Email + Close ── */}
              <div className="flex items-center justify-between px-5 pt-6 pb-5">
                <div className="flex flex-col">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-semibold mb-1">
                    Account
                  </p>
                  <p
                    className="text-[17px] font-bold leading-tight"
                    style={{ color: "#ffffff", letterSpacing: "-0.01em" }}
                  >
                    {displayName}
                  </p>
                  {displayEmail && (
                    <p
                      className="text-[13px] mt-0.5"
                      style={{ color: "oklch(0.50 0.008 240)" }}
                    >
                      {displayEmail}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close profile"
                  className="flex items-center justify-center w-8 h-8 rounded-full transition-colors duration-150"
                  style={{ color: "oklch(0.50 0.008 240)" }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.color = "#ffffff";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.color = "oklch(0.50 0.008 240)";
                  }}
                >
                  <X className="w-5 h-5" strokeWidth={2} />
                </button>
              </div>

              {/* ── Loyalty Tier Card ── */}
              <div className="px-4 pb-3">
                <div
                  className="rounded-2xl p-4"
                  style={{
                    backgroundColor: "#141414",
                    border: "1px solid #222222",
                  }}
                >
                  {/* Row 1: LOYALTY TIER label + tier badge + multiplier */}
                  <div className="flex items-center justify-between mb-3">
                    <p
                      className="text-[11px] uppercase tracking-widest font-semibold"
                      style={{
                        color: "oklch(0.48 0.008 240)",
                        letterSpacing: "0.12em",
                      }}
                    >
                      Loyalty Tier
                    </p>
                    <div className="flex items-center gap-2">
                      {/* Bordered tier pill */}
                      <span
                        className="inline-flex items-center gap-1.5 px-3 py-1 rounded-sm text-[11px] font-semibold uppercase tracking-widest"
                        style={{
                          color: loyaltyTier.color,
                          backgroundColor: "transparent",
                          border: `1px solid ${TIER_BORDER[loyaltyTier.name] ?? "oklch(0.45 0 0)"}`,
                          letterSpacing: "0.08em",
                        }}
                      >
                        <span style={{ fontSize: "10px" }}>
                          {tierEmoji[loyaltyTier.name] ?? "◈"}
                        </span>
                        {loyaltyTier.name}
                      </span>
                      {/* Exit Spread */}
                      <span
                        className="text-[13px] font-semibold font-mono"
                        style={{ color: "oklch(0.75 0.008 240)" }}
                      >
                        Exit: {(0.5 - loyaltyTier.spreadReduction).toFixed(2)}
                      </span>
                    </div>
                  </div>

                  {/* Tier Progress Bar */}
                  <TierProgressBar
                    progressPercent={tierProgressPercent}
                    daysUntilNextTier={daysUntilNextTier}
                    nextTierName={nextTier?.name ?? null}
                    tierName={loyaltyTier.name}
                    tierColor={loyaltyTier.color}
                  />
                </div>
              </div>

              {/* ── Buying Power Card — tap anywhere to deposit ── */}
              <div className="px-4 pb-3">
                <button
                  type="button"
                  onClick={() => setIsDepositOpen(true)}
                  className="w-full rounded-2xl p-4 text-left transition-colors duration-150"
                  style={{
                    backgroundColor: "#141414",
                    border: "1px solid #222222",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = "#1a1a1a";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = "#141414";
                  }}
                >
                  <p
                    className="text-[11px] uppercase tracking-widest font-semibold mb-3"
                    style={{
                      color: "oklch(0.48 0.008 240)",
                      letterSpacing: "0.12em",
                    }}
                  >
                    Buying Power
                  </p>
                  <p
                    className="text-[38px] font-bold tracking-tight leading-none"
                    style={{
                      color: "#ffffff",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {fmt(buyingPower > 0 ? buyingPower : cash)}
                  </p>
                  <p
                    className="text-[13px] mt-2"
                    style={{ color: "oklch(0.48 0.008 240)" }}
                  >
                    Tap to deposit funds instantly
                  </p>
                </button>
              </div>

              {/* ── Wallet Balance Card ── */}
              <div className="px-4 pb-3">
                <div
                  className="rounded-2xl p-4"
                  style={{
                    backgroundColor: "#141414",
                    border: "1px solid #222222",
                  }}
                >
                  <div className="flex items-center justify-between mb-3">
                    <p
                      className="text-[11px] uppercase tracking-widest font-semibold"
                      style={{
                        color: "oklch(0.48 0.008 240)",
                        letterSpacing: "0.12em",
                      }}
                    >
                      Total Portfolio Value
                    </p>
                    <TrendingUp
                      className="w-5 h-5"
                      style={{ color: "oklch(0.48 0.008 240)" }}
                      strokeWidth={1.5}
                    />
                  </div>
                  <p
                    className="text-[32px] font-bold tracking-tight leading-none"
                    style={{
                      color: "#ffffff",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {fmt(totalPortfolioValue)}
                  </p>
                  <p
                    className={`font-mono text-sm font-medium mt-1 ${dailyPos ? "text-green-400" : dailyNeg ? "text-red-400" : "text-gray-500"}`}
                  >
                    {dailyChangeFormatted}
                  </p>
                </div>
              </div>

              {/* ── Activity + Tax Center (2-column grid) ── */}
              <div className="px-4 pb-3 grid grid-cols-2 gap-3">
                {/* Activity tile */}
                <button
                  type="button"
                  onClick={() => setActiveView("history")}
                  className="flex items-center justify-between px-4 py-4 rounded-2xl text-left transition-colors duration-150"
                  style={{
                    backgroundColor: "#141414",
                    border: "1px solid #222222",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = "#1a1a1a";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = "#141414";
                  }}
                >
                  <div className="flex items-center gap-2.5">
                    <Clock
                      className="w-5 h-5 shrink-0"
                      style={{ color: "oklch(0.65 0.008 240)" }}
                      strokeWidth={1.5}
                    />
                    <span
                      className="text-[15px] font-medium"
                      style={{ color: "#ffffff" }}
                    >
                      Activity
                    </span>
                  </div>
                  <ChevronRight
                    className="w-4 h-4 shrink-0"
                    style={{ color: "oklch(0.48 0.008 240)" }}
                    strokeWidth={2}
                  />
                </button>

                {/* Tax Center tile */}
                <button
                  type="button"
                  onClick={() => setActiveView("tax")}
                  className="flex items-center justify-between px-4 py-4 rounded-2xl text-left transition-colors duration-150"
                  style={{
                    backgroundColor: "#141414",
                    border: "1px solid #222222",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = "#1a1a1a";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = "#141414";
                  }}
                >
                  <div className="flex items-center gap-2.5">
                    <FileText
                      className="w-5 h-5 shrink-0"
                      style={{ color: "oklch(0.65 0.008 240)" }}
                      strokeWidth={1.5}
                    />
                    <span
                      className="text-[15px] font-medium"
                      style={{ color: "#ffffff" }}
                    >
                      Tax Center
                    </span>
                  </div>
                  <ChevronRight
                    className="w-4 h-4 shrink-0"
                    style={{ color: "oklch(0.48 0.008 240)" }}
                    strokeWidth={2}
                  />
                </button>
              </div>

              {/* ── Legal & Disclosures (full-width) ── */}
              <div className="px-4 pb-3">
                <button
                  type="button"
                  onClick={() => setActiveView("legal")}
                  className="flex items-center justify-between w-full px-4 py-4 rounded-2xl text-left transition-colors duration-150"
                  style={{
                    backgroundColor: "#141414",
                    border: "1px solid #222222",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = "#1a1a1a";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = "#141414";
                  }}
                >
                  <div className="flex items-center gap-2.5">
                    <Shield
                      className="w-5 h-5 shrink-0"
                      style={{ color: "oklch(0.65 0.008 240)" }}
                      strokeWidth={1.5}
                    />
                    <span
                      className="text-[15px] font-medium"
                      style={{ color: "#ffffff" }}
                    >
                      Legal &amp; Disclosures
                    </span>
                  </div>
                  <ChevronRight
                    className="w-4 h-4 shrink-0"
                    style={{ color: "oklch(0.48 0.008 240)" }}
                    strokeWidth={2}
                  />
                </button>
              </div>

              {/* ── Sign Out (full-width) ── */}
              <div className="px-4 pb-8">
                <button
                  type="button"
                  onClick={handleLogout}
                  className="flex items-center gap-3 w-full px-4 py-4 rounded-2xl text-left transition-colors duration-150"
                  style={{
                    backgroundColor: "#141414",
                    border: "1px solid #222222",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor =
                      "rgba(239,68,68,0.06)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = "#141414";
                  }}
                >
                  <LogOut
                    className="w-5 h-5 shrink-0"
                    style={{ color: "oklch(0.60 0.20 25)" }}
                    strokeWidth={1.5}
                  />
                  <span
                    className="text-[15px] font-medium"
                    style={{ color: "oklch(0.60 0.20 25)" }}
                  >
                    Sign Out
                  </span>
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── HISTORY VIEW ── */}
        <AnimatePresence>
          {activeView === "history" && (
            <motion.div
              key="history"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3, ease: "easeOut" }}
              className="flex flex-col h-full"
            >
              {/* Header */}
              <div className="flex items-center justify-between px-6 pt-6 pb-4 shrink-0">
                <button
                  type="button"
                  onClick={() => setActiveView("main")}
                  className="flex items-center gap-2 transition-colors duration-150"
                  style={{ color: "oklch(0.52 0.012 240)" }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.color = "#ffffff";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.color = "oklch(0.52 0.012 240)";
                  }}
                >
                  <ChevronRight
                    className="w-4 h-4 rotate-180"
                    strokeWidth={2}
                  />
                  <span className="text-[10px] uppercase tracking-widest font-semibold">
                    Back
                  </span>
                </button>
                <span
                  className="text-[10px] uppercase tracking-widest font-semibold"
                  style={{ color: "oklch(0.52 0.012 240)" }}
                >
                  Activity
                </span>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close"
                  className="flex items-center justify-center w-8 h-8 rounded-sm"
                  style={{ color: "oklch(0.52 0.012 240)" }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.color = "#ffffff";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.color = "oklch(0.52 0.012 240)";
                  }}
                >
                  <X className="w-4 h-4" strokeWidth={2} />
                </button>
              </div>

              <div
                style={{
                  height: "1px",
                  backgroundColor: "#1C1C1E",
                  margin: "0 24px",
                }}
              />

              {/* Transaction list */}
              <div className="flex-1 overflow-y-auto px-6 py-4">
                {activityHistory.length === 0 && activityTxs.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full gap-3 py-16">
                    <Clock
                      className="w-8 h-8"
                      style={{ color: "oklch(0.35 0.008 240)" }}
                    />
                    <p
                      className="text-sm text-center"
                      style={{ color: "oklch(0.45 0.010 240)" }}
                    >
                      No activity yet
                    </p>
                  </div>
                ) : (
                  <div className="flex flex-col gap-0">
                    {/* Local activity entries from WalletContext */}
                    {activityHistory.length > 0 &&
                      activityHistory
                        .slice()
                        .sort(
                          (a: ActivityEntry, b: ActivityEntry) =>
                            b.timestamp - a.timestamp,
                        )
                        .map((entry: ActivityEntry) => (
                          <button
                            type="button"
                            key={entry.id}
                            data-ocid="activity.item.1"
                            className="flex items-center justify-between py-3.5 w-full text-left transition-colors duration-100"
                            style={{
                              borderBottom: "1px solid #1C1C1E",
                              background: "none",
                              cursor: "pointer",
                            }}
                            onClick={() => {
                              setSelectedEntry(entry);
                              setActiveView("tx-detail");
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.backgroundColor =
                                "rgba(255,255,255,0.03)";
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.backgroundColor =
                                "transparent";
                            }}
                          >
                            <div className="flex flex-col gap-0.5">
                              <span
                                className="text-sm font-medium"
                                style={{ color: "#ffffff" }}
                              >
                                {activityEntryLabel(entry)}
                              </span>
                              <span
                                className="text-xs"
                                style={{ color: "oklch(0.45 0.010 240)" }}
                              >
                                {formatActivityDate(entry.timestamp)}
                              </span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span
                                className="text-sm font-semibold font-mono"
                                style={{ color: activityEntryColor(entry) }}
                              >
                                {activityEntrySign(entry)}
                                {fmt(Math.abs(entry.amount))}
                              </span>
                              <ChevronRight
                                className="w-3.5 h-3.5 shrink-0"
                                style={{ color: "oklch(0.38 0.008 240)" }}
                                strokeWidth={2}
                              />
                            </div>
                          </button>
                        ))}

                    {/* Backend transactions */}
                    {activityTxs.map((tx) => (
                      <div
                        key={tx.id.toString()}
                        className="flex items-center justify-between py-3.5"
                        style={{ borderBottom: "1px solid #1C1C1E" }}
                      >
                        <div className="flex flex-col gap-0.5">
                          <span
                            className="text-sm font-medium"
                            style={{ color: "#ffffff" }}
                          >
                            {txTypeLabel(tx.transactionType)}
                            {tx.assetName ? ` — ${tx.assetName}` : ""}
                          </span>
                          <span
                            className="text-xs"
                            style={{ color: "oklch(0.45 0.010 240)" }}
                          >
                            {formatTxDate(tx.timestamp)}
                          </span>
                        </div>
                        <span
                          className="text-sm font-semibold font-mono"
                          style={{ color: txTypeColor(tx.transactionType) }}
                        >
                          {fmt(tx.amount)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── TX DETAIL VIEW ── */}
        {activeView === "tx-detail" && selectedEntry && (
          <div className="flex flex-col h-full">
            {/* Header */}
            <div className="flex items-center justify-between px-6 pt-6 pb-4 shrink-0">
              <button
                type="button"
                onClick={() => setActiveView("history")}
                className="flex items-center gap-2 transition-colors duration-150"
                style={{ color: "oklch(0.52 0.012 240)" }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = "#ffffff";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = "oklch(0.52 0.012 240)";
                }}
              >
                <ChevronRight className="w-4 h-4 rotate-180" strokeWidth={2} />
                <span className="text-[10px] uppercase tracking-widest font-semibold">
                  Back
                </span>
              </button>
              <span
                className="text-[10px] uppercase tracking-widest font-semibold"
                style={{ color: "oklch(0.52 0.012 240)" }}
              >
                Order Details
              </span>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="flex items-center justify-center w-8 h-8 rounded-sm"
                style={{ color: "oklch(0.52 0.012 240)" }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = "#ffffff";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = "oklch(0.52 0.012 240)";
                }}
              >
                <X className="w-4 h-4" strokeWidth={2} />
              </button>
            </div>

            <div
              style={{
                height: "1px",
                backgroundColor: "#1C1C1E",
                margin: "0 24px",
              }}
            />

            {/* Detail content */}
            <div className="flex-1 overflow-y-auto px-6 py-6">
              {/* Transaction type badge */}
              <div className="flex items-center gap-3 mb-6">
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center shrink-0"
                  style={{
                    backgroundColor:
                      selectedEntry.type === "Spend"
                        ? "rgba(100,180,255,0.1)"
                        : selectedEntry.type === "Credit"
                          ? "rgba(100,220,130,0.1)"
                          : "rgba(100,220,130,0.1)",
                  }}
                >
                  <Clock
                    className="w-4 h-4"
                    style={{
                      color: activityEntryColor(selectedEntry),
                    }}
                    strokeWidth={1.5}
                  />
                </div>
                <div>
                  <p
                    className="text-base font-semibold"
                    style={{ color: "#ffffff" }}
                  >
                    {activityEntryLabel(selectedEntry)}
                  </p>
                  <p
                    className="text-xs mt-0.5"
                    style={{ color: "oklch(0.48 0.008 240)" }}
                  >
                    {selectedEntry.type === "Spend"
                      ? "Allocation"
                      : selectedEntry.type === "Credit"
                        ? "Redemption"
                        : "Deposit"}
                  </p>
                </div>
              </div>

              {/* Detail rows */}
              <div
                className="rounded-2xl overflow-hidden"
                style={{
                  backgroundColor: "#111111",
                  border: "1px solid #1e1e1e",
                }}
              >
                {/* Date & Time */}
                <div
                  className="flex items-start justify-between px-4 py-4"
                  style={{ borderBottom: "1px solid #1a1a1a" }}
                >
                  <span
                    className="text-[13px]"
                    style={{ color: "oklch(0.50 0.008 240)" }}
                  >
                    Date & Time Filled
                  </span>
                  <span
                    className="text-[13px] font-medium text-right"
                    style={{ color: "#ffffff", maxWidth: "55%" }}
                  >
                    {new Date(selectedEntry.timestamp).toLocaleDateString(
                      "en-US",
                      {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      },
                    )}{" "}
                    <span
                      className="font-mono"
                      style={{
                        color: "oklch(0.65 0.008 240)",
                        fontSize: "12px",
                      }}
                    >
                      {new Date(selectedEntry.timestamp).toLocaleTimeString(
                        "en-US",
                        {
                          hour: "2-digit",
                          minute: "2-digit",
                          second: "2-digit",
                        },
                      )}
                    </span>
                  </span>
                </div>

                {/* Entered Amount */}
                <div
                  className="flex items-center justify-between px-4 py-4"
                  style={{ borderBottom: "1px solid #1a1a1a" }}
                >
                  <span
                    className="text-[13px]"
                    style={{ color: "oklch(0.50 0.008 240)" }}
                  >
                    {selectedEntry.type === "Deposit"
                      ? "Amount Deposited"
                      : selectedEntry.type === "Spend"
                        ? "Amount Paid"
                        : "Amount Received"}
                  </span>
                  <span
                    className="text-[13px] font-semibold font-mono"
                    style={{ color: activityEntryColor(selectedEntry) }}
                  >
                    {activityEntrySign(selectedEntry)}
                    {fmt(Math.abs(selectedEntry.amount))}
                  </span>
                </div>

                {/* Filled Quantity — only for Spend/Credit */}
                {(selectedEntry.type === "Spend" ||
                  selectedEntry.type === "Credit") && (
                  <div className="flex items-center justify-between px-4 py-4">
                    <span
                      className="text-[13px]"
                      style={{ color: "oklch(0.50 0.008 240)" }}
                    >
                      Filled Quantity
                    </span>
                    <span
                      className="text-[13px] font-medium font-mono text-right"
                      style={{ color: "#ffffff" }}
                    >
                      {selectedEntry.units !== undefined &&
                      selectedEntry.pricePerUnit !== undefined ? (
                        <>
                          {selectedEntry.units.toLocaleString("en-US", {
                            minimumFractionDigits: 4,
                            maximumFractionDigits: 4,
                          })}{" "}
                          Shares
                          <br />
                          <span
                            style={{
                              color: "oklch(0.50 0.008 240)",
                              fontSize: "11px",
                            }}
                          >
                            @ $
                            {selectedEntry.pricePerUnit.toLocaleString(
                              "en-US",
                              {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              },
                            )}{" "}
                            / share
                          </span>
                        </>
                      ) : (
                        <span style={{ color: "oklch(0.40 0.008 240)" }}>
                          —
                        </span>
                      )}
                    </span>
                  </div>
                )}
              </div>

              {/* Status badge */}
              <div className="flex items-center gap-2 mt-5 px-1">
                <div
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ backgroundColor: "oklch(0.72 0.18 145)" }}
                />
                <span
                  className="text-[11px] uppercase tracking-widest font-semibold"
                  style={{ color: "oklch(0.48 0.008 240)" }}
                >
                  Order Filled
                </span>
              </div>
            </div>
          </div>
        )}

        {/* ── TAX VIEW ── */}
        <AnimatePresence>
          {activeView === "tax" && (
            <motion.div
              key="tax"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3, ease: "easeOut" }}
              className="flex flex-col h-full"
            >
              <div className="flex items-center justify-between px-6 pt-6 pb-4 shrink-0">
                <button
                  type="button"
                  onClick={() => setActiveView("main")}
                  className="flex items-center gap-2 transition-colors duration-150"
                  style={{ color: "oklch(0.52 0.012 240)" }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.color = "#ffffff";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.color = "oklch(0.52 0.012 240)";
                  }}
                >
                  <ChevronRight
                    className="w-4 h-4 rotate-180"
                    strokeWidth={2}
                  />
                  <span className="text-[10px] uppercase tracking-widest font-semibold">
                    Back
                  </span>
                </button>
                <span
                  className="text-[10px] uppercase tracking-widest font-semibold"
                  style={{ color: "oklch(0.52 0.012 240)" }}
                >
                  Tax Center
                </span>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close"
                  className="flex items-center justify-center w-8 h-8 rounded-sm"
                  style={{ color: "oklch(0.52 0.012 240)" }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.color = "#ffffff";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.color = "oklch(0.52 0.012 240)";
                  }}
                >
                  <X className="w-4 h-4" strokeWidth={2} />
                </button>
              </div>
              <div
                style={{
                  height: "1px",
                  backgroundColor: "#1C1C1E",
                  margin: "0 24px",
                }}
              />
              <div className="flex-1 flex flex-col items-center justify-center gap-3 px-6 py-16">
                <FileText
                  className="w-10 h-10"
                  style={{ color: "oklch(0.35 0.008 240)" }}
                />
                <p
                  className="text-sm text-center"
                  style={{ color: "oklch(0.45 0.010 240)" }}
                >
                  Tax documents will appear here when available.
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── LEGAL VIEW ── */}
        <AnimatePresence>
          {activeView === "legal" && (
            <motion.div
              key="legal"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3, ease: "easeOut" }}
              className="flex flex-col h-full"
            >
              <div className="flex items-center justify-between px-6 pt-6 pb-4 shrink-0">
                <button
                  type="button"
                  onClick={() => setActiveView("main")}
                  className="flex items-center gap-2 transition-colors duration-150"
                  style={{ color: "oklch(0.52 0.012 240)" }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.color = "#ffffff";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.color = "oklch(0.52 0.012 240)";
                  }}
                >
                  <ChevronRight
                    className="w-4 h-4 rotate-180"
                    strokeWidth={2}
                  />
                  <span className="text-[10px] uppercase tracking-widest font-semibold">
                    Back
                  </span>
                </button>
                <span
                  className="text-[10px] uppercase tracking-widest font-semibold"
                  style={{ color: "oklch(0.52 0.012 240)" }}
                >
                  Legal &amp; Disclosures
                </span>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close"
                  className="flex items-center justify-center w-8 h-8 rounded-sm"
                  style={{ color: "oklch(0.52 0.012 240)" }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.color = "#ffffff";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.color = "oklch(0.52 0.012 240)";
                  }}
                >
                  <X className="w-4 h-4" strokeWidth={2} />
                </button>
              </div>
              <div
                style={{
                  height: "1px",
                  backgroundColor: "#1C1C1E",
                  margin: "0 24px",
                }}
              />
              <div className="flex-1 flex flex-col items-center justify-center gap-3 px-6 py-16">
                <Shield
                  className="w-10 h-10"
                  style={{ color: "oklch(0.35 0.008 240)" }}
                />
                <p
                  className="text-sm text-center"
                  style={{ color: "oklch(0.45 0.010 240)" }}
                >
                  Legal documents and disclosures will appear here.
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Deposit Modal */}
      <DepositModal
        isOpen={isDepositOpen}
        onClose={() => setIsDepositOpen(false)}
        onConfirm={handleDepositConfirm}
      />
    </>
  );
}
