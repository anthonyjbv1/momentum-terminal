/**
 * ProfilePage.tsx
 * Full-page version of the profile content — same data, same sections as
 * ProfileSlideOver but rendered as a scrollable page body without modal chrome.
 * Used in the Profile tab of the bottom navigation.
 * DO NOT modify ProfileSlideOver.tsx — this is new standalone code.
 */
import { useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  FileText,
  LogOut,
  Newspaper,
  Plus,
  Shield,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import { useLocalHoldings } from "../contexts/LocalHoldingsContext";
import { useLoyalty } from "../contexts/LoyaltyContext";
import { useOracleTick } from "../contexts/OracleTickContext";
import {
  type ActivityEntry,
  useWalletContext,
} from "../contexts/WalletContext";
import { useInternetIdentity } from "../hooks/useInternetIdentity";
import {
  useFinnhubKeyStatus,
  useGetCallerUserProfile,
  useHuggingFaceKeyStatus,
  useSetFinnhubKey,
  useSetHuggingFaceKey,
  useSubsidyReserves,
  useTotalSubsidyReserve,
  useTransactionHistory,
  useWallet,
} from "../hooks/useQueries";
import { getDisplayName } from "../lib/oracle/indexCategoryRegistry";
import { LEXICON_OVERRIDES } from "../lib/oracle/lexiconOverrideService";
import type { Transaction } from "../types/backendEnums";
import { TransactionType } from "../types/backendEnums";
import { DepositModal } from "./DepositModal";
import { OracleHealthPanel } from "./OracleHealthPanel";
import { TierProgressBar } from "./TierProgressBar";

type ActiveView = "main" | "history" | "tax" | "legal" | "tx-detail";

function fmt(value: number) {
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatJoinDate(timestamp: bigint | number): string {
  const ms =
    typeof timestamp === "bigint" ? Number(timestamp) / 1_000_000 : timestamp;
  return new Date(ms).toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
  });
}

function formatTxDate(timestamp: bigint | number): string {
  const ms =
    typeof timestamp === "bigint" ? Number(timestamp) / 1_000_000 : timestamp;
  return new Date(ms).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatActivityDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString("en-US", {
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

const TIER_BORDER: Record<string, string> = {
  Standard: "oklch(0.45 0 0)",
  Bronze: "oklch(0.62 0.12 55 / 0.7)",
  Silver: "oklch(0.78 0.04 240 / 0.7)",
  Gold: "oklch(0.82 0.18 85 / 0.7)",
  Obsidian: "oklch(0.68 0.22 290 / 0.7)",
};

const TIER_EMOJI: Record<string, string> = {
  Standard: "◈",
  Bronze: "◆",
  Silver: "◆",
  Gold: "★",
  Obsidian: "✦",
};

const STOP_WORDS = new Set([
  "the",
  "a",
  "an",
  "is",
  "are",
  "was",
  "were",
  "of",
  "in",
  "on",
  "at",
  "to",
  "for",
  "with",
  "and",
  "or",
  "but",
  "as",
  "it",
  "its",
  "has",
  "have",
  "had",
  "be",
  "been",
  "will",
  "would",
  "could",
  "should",
  "may",
  "might",
  "that",
  "this",
  "these",
  "those",
  "by",
  "from",
  "about",
  "into",
  "through",
  "after",
  "before",
  "over",
  "under",
]);

type FinBertLogEntry = {
  headline: string;
  indexName: string;
  source: string;
  tickId: number;
  timestamp: number;
  confidence: number;
  scoringMethod: string;
  suggestedDirection: string;
};
type BehaviorProfile =
  | "aggressive"
  | "long_holder"
  | "panic_redeemer"
  | "score_reactive";

type SimPosition = {
  indexName: string;
  shares: number;
  entryPrice: number;
  entryTimestamp: number;
  holdDurationMs: number;
};

type SimUser = {
  id: string;
  label: string;
  profile: BehaviorProfile;
  walletBalance: number;
  positions: SimPosition[];
  totalAllocated: number;
  totalRedeemed: number;
  spreadEarned: number;
  isMember: boolean;
  roundTrips: number;
  simDaysHeld: number;
};

type SimTransaction = {
  id: string;
  userId: string;
  userLabel: string;
  type: "allocate" | "redeem";
  indexName: string;
  amount: number;
  shares: number;
  price: number;
  entryPrice: number;
  spread: number;
  timestamp: number;
  profile: BehaviorProfile;
  triggerReason: string;
  tickId: number;
  poolCoverageRatio: number;
  scenarioName: string;
};

type SimMetrics = {
  totalSpread: number;
  totalAllocated: number;
  totalRedeemed: number;
  spreadByIndex: Record<string, number>;
  panicCount: number;
};

type ScenarioPreset = {
  id: string;
  name: string;
  shortName: string;
  userCount: number;
  avgPositionSize: number;
  profileDistribution: Record<BehaviorProfile, number>;
  holdRangeOverride?: Partial<Record<BehaviorProfile, [number, number]>>;
  membershipRate: number;
  institutionalAPIRevenue: number;
  crisisEnabled: boolean;
  crisisTriggerSec: number;
  crisisScoreDecline: number;
  crisisUserPct: number;
  tickIntervalMs: number;
  description: string;
  reserveSeed: number;
};

const SCENARIO_PRESETS: Record<string, ScenarioPreset> = {
  scenario1: {
    id: "scenario1",
    name: "Baseline Healthy Growth",
    shortName: "Baseline",
    userCount: 100,
    avgPositionSize: 200,
    profileDistribution: {
      long_holder: 0.4,
      aggressive: 0.3,
      score_reactive: 0.2,
      panic_redeemer: 0.1,
    },
    holdRangeOverride: {
      aggressive: [12_960_000, 17_280_000],
      long_holder: [43_200_000, 86_400_000],
      score_reactive: [6_480_000, 17_280_000],
      panic_redeemer: [5000, 15000],
    },
    membershipRate: 0.2,
    institutionalAPIRevenue: 0,
    crisisEnabled: false,
    crisisTriggerSec: 0,
    crisisScoreDecline: 0,
    crisisUserPct: 0,
    tickIntervalMs: 4000,
    description:
      "100 users, $200 avg position. 40% Long Holders, 30% Aggressive, 20% Score Reactive, 10% Panic. 20% membership. No crisis events.",
    reserveSeed: 15000,
  },
  scenario2: {
    id: "scenario2",
    name: "High Velocity Traders",
    shortName: "High Velocity",
    userCount: 50,
    avgPositionSize: 500,
    profileDistribution: {
      aggressive: 0.7,
      score_reactive: 0.2,
      panic_redeemer: 0.1,
      long_holder: 0,
    },
    holdRangeOverride: {
      aggressive: [6_048_000, 8_640_000],
      score_reactive: [3_024_000, 6_048_000],
      panic_redeemer: [5000, 10000],
      long_holder: [60000, 120000],
    },
    membershipRate: 0.3,
    institutionalAPIRevenue: 0,
    crisisEnabled: false,
    crisisTriggerSec: 0,
    crisisScoreDecline: 0,
    crisisUserPct: 0,
    tickIntervalMs: 4000,
    description:
      "50 users, $500 avg position. 70% Aggressive traders. 4 round trips/month frequency. 30% membership.",
    reserveSeed: 10000,
  },
  scenario3: {
    id: "scenario3",
    name: "Long Term Holders",
    shortName: "Long Holders",
    userCount: 50,
    avgPositionSize: 1000,
    profileDistribution: {
      long_holder: 0.8,
      score_reactive: 0.15,
      aggressive: 0.05,
      panic_redeemer: 0,
    },
    holdRangeOverride: {
      long_holder: [240_000, 480_000],
      score_reactive: [120_000, 240_000],
      aggressive: [60_000, 120_000],
      panic_redeemer: [60_000, 120_000],
    },
    membershipRate: 0.4,
    institutionalAPIRevenue: 0,
    crisisEnabled: false,
    crisisTriggerSec: 0,
    crisisScoreDecline: 0,
    crisisUserPct: 0,
    tickIntervalMs: 4000,
    description:
      "50 users, $1000 avg position. 80% Long Holders with 60+ sim-day minimum holds. 40% membership.",
    reserveSeed: 20000,
  },
  scenario4: {
    id: "scenario4",
    name: "Crisis Event Stress Test",
    shortName: "Crisis",
    userCount: 500,
    avgPositionSize: 300,
    profileDistribution: {
      panic_redeemer: 0.4,
      score_reactive: 0.3,
      aggressive: 0.2,
      long_holder: 0.1,
    },
    holdRangeOverride: {
      panic_redeemer: [5000, 15000],
      score_reactive: [10000, 40000],
      aggressive: [8000, 30000],
      long_holder: [60000, 180000],
    },
    membershipRate: 0,
    institutionalAPIRevenue: 0,
    crisisEnabled: true,
    crisisTriggerSec: 60,
    crisisScoreDecline: 15,
    crisisUserPct: 0.25,
    tickIntervalMs: 4000,
    description:
      "500 users, $300 avg. Crisis fires at 60s: forced 15-pt score decline + 25% simultaneous redemptions. Staggered queue when volume >15% pool.",
    reserveSeed: 25000,
  },
  scenario5: {
    id: "scenario5",
    name: "Scale Test",
    shortName: "Scale Test",
    userCount: 10000,
    avgPositionSize: 150,
    profileDistribution: {
      long_holder: 0.35,
      aggressive: 0.35,
      score_reactive: 0.2,
      panic_redeemer: 0.1,
    },
    holdRangeOverride: {
      aggressive: [8000, 30000],
      long_holder: [60000, 180000],
      panic_redeemer: [5000, 15000],
      score_reactive: [10000, 60000],
    },
    membershipRate: 0.25,
    institutionalAPIRevenue: 5000,
    crisisEnabled: false,
    crisisTriggerSec: 0,
    crisisScoreDecline: 0,
    crisisUserPct: 0,
    tickIntervalMs: 4000,
    description:
      "10,000 users, $150 avg position. 25% membership. $5,000/mo Institutional API revenue. Full scale stress test.",
    reserveSeed: 50000,
  },
};

const SIM_CONFIG = {
  NUM_USERS: 8,
  WALLET_RANGE: [500, 5000] as [number, number],
  MIN_ALLOC: 50,
  MAX_ALLOC_PER_TRADE: 500,
  MAX_USER_POSITION: 5000,
  TICK_INTERVAL_MS: 4000,
  HOLD_RANGES: {
    aggressive: [8000, 30000] as [number, number],
    long_holder: [60000, 180000] as [number, number],
    panic_redeemer: [5000, 15000] as [number, number],
    score_reactive: [10000, 60000] as [number, number],
  },
  PANIC_SCORE_THRESHOLD: 45,
  ALLOC_SCORE_MIN: 50,
};

const SIM_INDEXES = [
  "Fed Policy Sentiment",
  "MENA Stability Sentiment",
  "AI Regulation Risk Sentiment",
  "Traditional Values Sentiment",
  "Progressive Values Sentiment",
  "Masculinity Discourse Sentiment",
  "Feminism Wave Sentiment",
  "F1 Constructor Sentiment",
  "NASCAR Racing Sentiment",
  "Obesity Drug Sentiment",
  "Whole Food & Wellness Sentiment",
];

const PROFILES: BehaviorProfile[] = [
  "aggressive",
  "long_holder",
  "panic_redeemer",
  "score_reactive",
];
type SimSpeedMode = "observe" | "analyze" | "accelerate" | "stress";

const SIM_SPEED_MODES: Record<
  SimSpeedMode,
  { label: string; intervalMs: number; simDaysPerTick: number }
> = {
  observe: { label: "OBSERVE", intervalMs: 8000, simDaysPerTick: 1 },
  analyze: { label: "ANALYZE", intervalMs: 3000, simDaysPerTick: 3 },
  accelerate: { label: "ACCELERATE", intervalMs: 800, simDaysPerTick: 10 },
  stress: { label: "STRESS TEST", intervalMs: 200, simDaysPerTick: 30 },
};

const PROFILE_LABELS: Record<BehaviorProfile, string> = {
  aggressive: "Aggressive",
  long_holder: "Long Holder",
  panic_redeemer: "Panic Redeemer",
  score_reactive: "Score Reactive",
};

function extractPatterns(headline: string): string[] {
  const words = headline
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
  return Array.from(new Set(words)).slice(0, 3);
}

function formatEntryBlock(entry: FinBertLogEntry): string {
  const patterns = extractPatterns(entry.headline);
  const operator = patterns.length === 1 ? "OR" : "AND";
  const time = new Date(entry.timestamp).toLocaleString();
  const patternStr = patterns.map((p) => `"${p}"`).join(", ");
  return [
    `// "${entry.headline}"`,
    `// INDEX: ${getDisplayName(entry.indexName)} | SOURCE: ${entry.source} | TICK: #${String(entry.tickId)} | ${time}`,
    `// SUGGESTED: ${entry.suggestedDirection} — REVIEW BEFORE ADDING`,
    "{",
    `  patterns: [${patternStr}],`,
    `  operator: "${operator}",`,
    `  direction: "${entry.suggestedDirection}",`,
    "  minConfidence: 0.80,",
    "  maxConfidence: 0.91,",
    "},",
  ].join("\n");
}

export function ProfilePage() {
  const [activeView, setActiveView] = useState<ActiveView>("main");
  const [isDepositOpen, setIsDepositOpen] = useState(false);
  const [hfKeyValue, setHfKeyValue] = useState<string>("");
  const [finnhubKeyValue, setFinnhubKeyValue] = useState<string>("");
  const [selectedEntry, setSelectedEntry] = useState<ActivityEntry | null>(
    null,
  );
  const [finbertLogOpen, setFinbertLogOpen] = useState(false);
  const [finbertLog, setFinbertLog] = useState<FinBertLogEntry[]>([]);
  const [finbertClearMsg, setFinbertClearMsg] = useState<string | null>(null);
  const [finbertExportMsg, setFinbertExportMsg] = useState<string | null>(null);
  const [lexiconReviewOpen, setLexiconReviewOpen] = useState(false);
  const [lexiconClearMsg, setLexiconClearMsg] = useState<string | null>(null);
  const [lexiconExportMsg, setLexiconExportMsg] = useState<string | null>(null);
  const [simulationOpen, setSimulationOpen] = useState(false);
  const [simRunning, setSimRunning] = useState(false);
  const [simUserCount, setSimUserCount] = useState(100);
  const simReserveBalanceRef = useRef<number>(0);
  const [simReserveSeedDisplay, setSimReserveSeedDisplay] =
    useState<number>(15000);
  const [simTxFilter, setSimTxFilter] = useState<BehaviorProfile | "all">(
    "all",
  );
  const [simExportMsg, setSimExportMsg] = useState<string | null>(null);
  const [simUsers, setSimUsers] = useState<SimUser[]>([]);
  const [simTxLog, setSimTxLog] = useState<SimTransaction[]>([]);
  const [simMetrics, setSimMetrics] = useState<SimMetrics>({
    totalSpread: 0,
    totalAllocated: 0,
    totalRedeemed: 0,
    spreadByIndex: {},
    panicCount: 0,
  });
  const simIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const simUsersRef = useRef<SimUser[]>([]);
  const [selectedScenario, setSelectedScenario] = useState<string>("scenario1");
  const [simTickCount, setSimTickCount] = useState<number>(0);
  const simStartTimeRef = useRef<number>(0);
  const crisisFiredRef = useRef<boolean>(false);
  const crisisResolvedTickRef = useRef<number | null>(null);
  const simTickCountRef = useRef<number>(0);
  const crisisScoreOffsetRef = useRef<number>(0);
  const staggeredQueueRef = useRef<SimUser[]>([]);
  const spreadTickHistoryRef = useRef<number[]>([]);
  const redemptionFreqHistoryRef = useRef<number[]>([]);
  const [simSpeedMode, setSimSpeedMode] = useState<SimSpeedMode>("observe");
  const simSpeedModeRef = useRef<SimSpeedMode>("observe");
  const simDaysRef = useRef<number>(0);
  const [_simDays, setSimDays] = useState<number>(0);
  // Enhancement 2 — per-tick allocation velocity throttle
  const pendingAllocQueueRef = useRef<
    Array<{
      userId: string;
      indexName: string;
      amount: number;
      holdMs: number;
      buyPrice: number;
    }>
  >([]);
  // Enhancement 3 — redemption queue at high pool utilization
  const redemptionQueueRef = useRef<
    Array<{ userId: string; positions: SimPosition[]; triggerReason: string }>
  >([]);
  const [redemptionQueueDepth, setRedemptionQueueDepth] = useState(0);

  const [crisisMetrics, setCrisisMetrics] = useState({
    status: "pending" as "pending" | "triggered" | "resolved",
    scoreDeclineMagnitude: 0,
    simultaneousRedemptions: 0,
    staggeredQueueDepth: 0,
    peakCoverageRatio: 1.0,
    lowestCoverageRatio: 99.0,
    recoveryTicks: 0,
  });
  const [extMetrics, setExtMetrics] = useState({
    spreadRevPerTick: 0,
    spreadRevPerUser: 0,
    membershipRevenue: 0,
    institutionalAPIRevenue: 0,
    totalPlatformRevenue: 0,
    totalCapitalDeployed: 0,
    totalRedemptionLiability: 0,
    liquidityCoverageRatio: 0,
    poolUtilizationPct: 0,
    reserveBuffer: 0,
    activePositionsByProfile: {} as Record<
      string,
      { count: number; pct: number }
    >,
    avgHoldDuration: 0,
    redemptionFrequency: 0,
    loyaltyTiers: { bronze: 0, silver: 0, gold: 0, obsidian: 0 },
    panicRedemptionEvents: 0,
  });

  const { clear } = useInternetIdentity();
  const { finalScores } = useOracleTick();

  const queryClient = useQueryClient();
  const { userAccount, logout } = useAuth();
  const {
    walletBalance: localWalletBalance,
    buyingPower,
    activityHistory,
    depositFunds,
  } = useWalletContext();

  const { data: userProfile } = useGetCallerUserProfile();
  const { data: walletBalance } = useWallet();
  const { data: transactions } = useTransactionHistory();
  const { data: subsidyReserves } = useSubsidyReserves();
  const { data: totalReserve } = useTotalSubsidyReserve();
  const hfKeyStatusQuery = useHuggingFaceKeyStatus();
  const setHfKeyMutation = useSetHuggingFaceKey();
  const finnhubKeyStatusQuery = useFinnhubKeyStatus();
  const setFinnhubKeyMutation = useSetFinnhubKey();
  const { costBasisMap, shortPositions } = useLocalHoldings();

  const {
    tier: loyaltyTier,
    progressPercent: tierProgressPercent,
    daysUntilNextTier,
    nextTier,
  } = useLoyalty();

  const activityTxs: Transaction[] = (transactions ?? [])
    .filter((tx) => isActivityTx(tx.transactionType))
    .slice()
    .sort((a, b) => Number(b.timestamp) - Number(a.timestamp))
    .slice(0, 20);

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

  const displayName = userAccount?.username ?? userProfile?.name ?? "—";
  const displayEmail = userAccount?.email ?? "";

  const handleLogout = async () => {
    logout();
    await clear();
    queryClient.clear();
  };

  const handleDepositConfirm = (amount: number) => {
    depositFunds(amount);
  };

  const handleFinbertLogOpen = useCallback(() => {
    if (!finbertLogOpen) {
      try {
        const raw = localStorage.getItem("momentum_finbert_log_v1");
        const entries: FinBertLogEntry[] = raw ? JSON.parse(raw) : [];
        setFinbertLog(entries);
      } catch {
        setFinbertLog([]);
      }
    }
    setFinbertLogOpen((prev) => !prev);
  }, [finbertLogOpen]);

  const handleFinbertClear = useCallback(() => {
    const count = finbertLog.length;
    if (
      !window.confirm(
        `Clear all ${String(count)} entries? This cannot be undone.`,
      )
    )
      return;
    try {
      localStorage.removeItem("momentum_finbert_log_v1");
    } catch {
      /* silent */
    }
    setFinbertLog([]);
    setFinbertClearMsg("Cleared");
    setTimeout(() => setFinbertClearMsg(null), 2000);
  }, [finbertLog.length]);

  const handleFinbertExport = useCallback(() => {
    const content = [...finbertLog]
      .reverse()
      .map(formatEntryBlock)
      .join("\n\n");
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const today = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `finbert-log-${today}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    setFinbertExportMsg("Exported!");
    setTimeout(() => setFinbertExportMsg(null), 2000);
  }, [finbertLog]);

  const handleMLExport = () => {
    const raw = localStorage.getItem("momentum_finbert_log_v1") ?? "[]";
    const entries: FinBertLogEntry[] = JSON.parse(raw);

    const jsonl = entries
      .map((e) =>
        JSON.stringify({
          text: e.headline,
          label: e.suggestedDirection,
          target_index: e.indexName,
          source_platform: e.source,
          classification_method: e.scoringMethod,
          model_confidence: e.confidence,
          tick_sequence: e.tickId,
          timestamp_iso: new Date(e.timestamp).toISOString(),
          is_lexicon_hit: e.scoringMethod === "lexicon",
          is_neutral_fallback: e.scoringMethod === "neutral_fallback",
          word_count: e.headline.split(" ").length,
        }),
      )
      .join("\n");

    const blob = new Blob([jsonl], { type: "application/jsonl" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `momentum-training-data-${new Date().toISOString().split("T")[0]}.jsonl`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleLexiconMLExport = () => {
    const lexiconEntries = LEXICON_OVERRIDES.map((entry) =>
      JSON.stringify({
        text: entry.patterns.join(" "),
        patterns: entry.patterns,
        operator: entry.operator,
        label: entry.direction,
        min_confidence: entry.minConfidence,
        max_confidence: entry.maxConfidence,
        is_lexicon_ground_truth: true,
        source_platform: "lexicon",
      }),
    ).join("\n");

    const blob = new Blob([lexiconEntries], { type: "application/jsonl" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `momentum-lexicon-training-${new Date().toISOString().split("T")[0]}.jsonl`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── SIMULATION LOGIC ────────────────────────────────────────────────────────
  const getScore = (indexName: string): number =>
    finalScores.get(indexName) ?? 50;
  const getBuyPrice = (indexName: string): number => getScore(indexName) + 0.5;
  const getRedeemPrice = (indexName: string): number =>
    Math.max(0.1, getScore(indexName) - 0.5);

  const createSimUsers = (preset: ScenarioPreset): SimUser[] => {
    const { userCount, profileDistribution, avgPositionSize, membershipRate } =
      preset;
    const profiles = Object.entries(profileDistribution)
      .filter(([, frac]) => frac > 0)
      .map(([prof, frac]) => ({ prof: prof as BehaviorProfile, frac }));
    return Array.from({ length: userCount }, (_, i) => {
      let rnd = Math.random();
      let profile: BehaviorProfile = profiles[0].prof;
      for (const { prof, frac } of profiles) {
        rnd -= frac;
        if (rnd <= 0) {
          profile = prof;
          break;
        }
      }
      const minWallet = avgPositionSize * 2;
      const maxWallet = avgPositionSize * 5;
      const wallet = minWallet + Math.random() * (maxWallet - minWallet);
      // Candidate A — runtime assertion: profile must be a valid non-empty BehaviorProfile string
      if (!profile || typeof profile !== "string") {
        throw new Error(
          `Sim user sim-user-${i + 1} failed initialization: profile is ${JSON.stringify(profile)}`,
        );
      }
      return {
        id: `sim-user-${i + 1}`,
        label: `User ${i + 1}`,
        profile,
        walletBalance: Math.round(wallet),
        positions: [],
        totalAllocated: 0,
        totalRedeemed: 0,
        spreadEarned: 0,
        isMember: Math.random() < membershipRate,
        roundTrips: 0,
        simDaysHeld: 0,
      };
    });
  };

  const runSimTick = () => {
    const now = Date.now();
    const preset =
      SCENARIO_PRESETS[selectedScenario] ?? SCENARIO_PRESETS.scenario1;
    simTickCountRef.current += 1;
    setSimTickCount(simTickCountRef.current);
    const speedCfg = SIM_SPEED_MODES[simSpeedModeRef.current];
    simDaysRef.current += speedCfg.simDaysPerTick;
    setSimDays(simDaysRef.current);
    const tickId = simTickCountRef.current;
    const users = simUsersRef.current;
    const newTxs: SimTransaction[] = [];
    const POOL_TOTAL_CAPACITY = preset.userCount * preset.avgPositionSize * 2;

    // Profile tagging fix: build snapshot from raw users BEFORE any mutations
    const profileSnapshot = new Map<string, BehaviorProfile>(
      users.map((u) => [u.id, u.profile]),
    );

    // Enhancement 2 — drain pending alloc queue from prior tick (up to MAX_ALLOCS_PER_TICK)
    const MAX_ALLOCS_PER_TICK = 8;
    let allocCountThisTick = 0;
    if (pendingAllocQueueRef.current.length > 0) {
      const toDrain = pendingAllocQueueRef.current.splice(
        0,
        MAX_ALLOCS_PER_TICK,
      );
      for (const pending of toDrain) {
        const u = users.find((x) => x.id === pending.userId);
        if (!u || u.walletBalance < pending.amount) continue;
        u.walletBalance -= pending.amount;
        u.totalAllocated += pending.amount;
        u.positions.push({
          indexName: pending.indexName,
          shares: pending.amount / pending.buyPrice,
          entryPrice: pending.buyPrice,
          entryTimestamp: now,
          holdDurationMs: pending.holdMs,
        });
        const capNow = users.reduce(
          (s, uu) =>
            s +
            uu.positions.reduce(
              (ps, p) => ps + p.shares * getRedeemPrice(p.indexName),
              0,
            ),
          0,
        );
        const lcr = POOL_TOTAL_CAPACITY / Math.max(1, capNow);
        newTxs.push({
          id: `${u.id}-${now}-queued-alloc-${pending.indexName}`,
          userId: u.id,
          userLabel: u.label,
          type: "allocate",
          indexName: pending.indexName,
          amount: pending.amount,
          shares: pending.amount / pending.buyPrice,
          price: pending.buyPrice,
          entryPrice: pending.buyPrice,
          spread: 0,
          timestamp: now,
          profile: profileSnapshot.get(u.id) ?? u.profile,
          triggerReason: "Queued alloc",
          tickId,
          poolCoverageRatio: lcr,
          scenarioName: preset.name,
        });
        allocCountThisTick++;
      }
    }

    // Enhancement 3 — drain redemption queue FIRST (FIFO), regardless of current utilization
    if (redemptionQueueRef.current.length > 0) {
      const queuedItems = redemptionQueueRef.current.splice(
        0,
        redemptionQueueRef.current.length,
      );
      for (const item of queuedItems) {
        const u = users.find((x) => x.id === item.userId);
        if (!u) continue;
        for (const pos of item.positions) {
          const offset = crisisScoreOffsetRef.current;
          const redeemPrice = Math.max(
            0.1,
            getRedeemPrice(pos.indexName) - offset,
          );
          const proceeds = pos.shares * redeemPrice;
          const spread = Math.abs(pos.shares * (pos.entryPrice - redeemPrice));
          u.walletBalance += proceeds;
          u.totalRedeemed += proceeds;
          u.spreadEarned += spread;
          u.roundTrips += 1;
          const capNow = users.reduce(
            (s, uu) =>
              s +
              uu.positions.reduce(
                (ps, p) => ps + p.shares * getRedeemPrice(p.indexName),
                0,
              ),
            0,
          );
          const lcr = POOL_TOTAL_CAPACITY / Math.max(1, capNow);
          newTxs.push({
            id: `${u.id}-${now}-rq-${pos.indexName}`,
            userId: u.id,
            userLabel: u.label,
            type: "redeem",
            indexName: pos.indexName,
            amount: proceeds,
            shares: pos.shares,
            price: redeemPrice,
            entryPrice: pos.entryPrice,
            spread,
            timestamp: now,
            profile: profileSnapshot.get(u.id) ?? u.profile,
            triggerReason: item.triggerReason,
            tickId,
            poolCoverageRatio: lcr,
            scenarioName: preset.name,
          });
        }
      }
      setRedemptionQueueDepth(0);
    }

    // Crisis trigger check
    let crisisActiveThisTick = false;
    let crisisRedemptionUsers: SimUser[] = [];
    if (preset.crisisEnabled && !crisisFiredRef.current) {
      const elapsed = now - simStartTimeRef.current;
      if (elapsed >= preset.crisisTriggerSec * 1000) {
        crisisFiredRef.current = true;
        crisisActiveThisTick = true;
        crisisScoreOffsetRef.current = preset.crisisScoreDecline;
        const usersWithPositions = users.filter((u) => u.positions.length > 0);
        const crisisCount = Math.ceil(
          usersWithPositions.length * preset.crisisUserPct,
        );
        crisisRedemptionUsers = usersWithPositions.slice(0, crisisCount);
        setCrisisMetrics((prev) => ({
          ...prev,
          status: "triggered",
          scoreDeclineMagnitude: preset.crisisScoreDecline,
          simultaneousRedemptions: crisisRedemptionUsers.length,
        }));
      }
    }

    // Process staggered queue from prior tick
    if (staggeredQueueRef.current.length > 0) {
      const toProcess = staggeredQueueRef.current.splice(
        0,
        Math.max(1, Math.ceil((POOL_TOTAL_CAPACITY * 0.15) / 1000)),
      );
      for (const qUser of toProcess) {
        const u = users.find((x) => x.id === qUser.id);
        if (!u || u.positions.length === 0) continue;
        const redeemed = [...u.positions];
        u.positions = [];
        for (const pos of redeemed) {
          const offset = crisisScoreOffsetRef.current;
          const redeemPrice = Math.max(
            0.1,
            getRedeemPrice(pos.indexName) - offset,
          );
          const proceeds = pos.shares * redeemPrice;
          const spread = Math.abs(pos.shares * (pos.entryPrice - redeemPrice));
          u.walletBalance += proceeds;
          u.totalRedeemed += proceeds;
          u.spreadEarned += spread;
          u.roundTrips += 1;
          const capNow = users.reduce(
            (s, uu) =>
              s +
              uu.positions.reduce(
                (ps, p) => ps + p.shares * getRedeemPrice(p.indexName),
                0,
              ),
            0,
          );
          const lcr = POOL_TOTAL_CAPACITY / Math.max(1, capNow);
          newTxs.push({
            id: `${u.id}-${now}-stagger-${pos.indexName}`,
            userId: u.id,
            userLabel: u.label,
            type: "redeem",
            indexName: pos.indexName,
            amount: proceeds,
            shares: pos.shares,
            price: redeemPrice,
            entryPrice: pos.entryPrice,
            spread,
            timestamp: now,
            profile: profileSnapshot.get(u.id) ?? u.profile,
            triggerReason: "⚡ Staggered Queue",
            tickId,
            poolCoverageRatio: lcr,
            scenarioName: preset.name,
          });
        }
      }
      setCrisisMetrics((prev) => ({
        ...prev,
        staggeredQueueDepth: staggeredQueueRef.current.length,
      }));
    }

    const updatedUsers = users.map((user) => {
      // Candidate B — read u from the map callback parameter directly at the point of transaction build,
      // not from a closed-over snapshot
      const u = { ...user, positions: [...user.positions] };
      // Fix 1 — only increment simDaysHeld when the user has at least one active position
      if (u.positions.length > 0) {
        u.simDaysHeld = (u.simDaysHeld ?? 0) + speedCfg.simDaysPerTick;
      }
      const isCrisisUser =
        crisisActiveThisTick &&
        crisisRedemptionUsers.some((cu) => cu.id === user.id);
      if (isCrisisUser) return u;

      const toRedeem: SimPosition[] = [];
      const toKeep: SimPosition[] = [];
      for (const pos of u.positions) {
        if (now - pos.entryTimestamp >= pos.holdDurationMs) toRedeem.push(pos);
        else toKeep.push(pos);
      }
      u.positions = toKeep;
      if (u.profile === "score_reactive") {
        const stillKeep: SimPosition[] = [];
        for (const pos of u.positions) {
          if (getScore(pos.indexName) < SIM_CONFIG.PANIC_SCORE_THRESHOLD)
            toRedeem.push(pos);
          else stillKeep.push(pos);
        }
        u.positions = stillKeep;
      }
      const holdRanges = preset.holdRangeOverride ?? SIM_CONFIG.HOLD_RANGES;
      for (const pos of toRedeem) {
        const redeemPrice = getRedeemPrice(pos.indexName);
        const proceeds = pos.shares * redeemPrice;
        const spread = Math.abs(pos.shares * (pos.entryPrice - redeemPrice));
        u.walletBalance += proceeds;
        u.totalRedeemed += proceeds;
        u.spreadEarned += spread;
        u.roundTrips += 1;
        const capNow = users.reduce(
          (s, uu) =>
            s +
            uu.positions.reduce(
              (ps, p) => ps + p.shares * getRedeemPrice(p.indexName),
              0,
            ),
          0,
        );
        const lcr = POOL_TOTAL_CAPACITY / Math.max(1, capNow);
        newTxs.push({
          id: `${u.id}-${now}-redeem-${pos.indexName}`,
          userId: u.id,
          userLabel: u.label,
          type: "redeem",
          indexName: pos.indexName,
          amount: proceeds,
          shares: pos.shares,
          price: redeemPrice,
          entryPrice: pos.entryPrice,
          spread,
          timestamp: now,
          profile: profileSnapshot.get(u.id) ?? u.profile,
          triggerReason:
            u.profile === "score_reactive"
              ? "Score threshold"
              : "Hold duration",
          tickId,
          poolCoverageRatio: lcr,
          scenarioName: preset.name,
        });
      }
      if (u.walletBalance >= SIM_CONFIG.MIN_ALLOC) {
        // Issue 3 fix: use all SIM_INDEXES without score gating
        const eligibleIndexes = SIM_INDEXES.slice();
        if (eligibleIndexes.length > 0 && Math.random() > 0.6) {
          const indexName =
            eligibleIndexes[Math.floor(Math.random() * eligibleIndexes.length)];
          const currentPositionValue = u.positions.reduce(
            (s, p) => s + p.shares * getBuyPrice(p.indexName),
            0,
          );
          // Enhancement 1 — per-user per-index $500 cap (simulation only)
          const existingIndexPosition = u.positions
            .filter((p) => p.indexName === indexName)
            .reduce((s, p) => s + p.shares * getBuyPrice(p.indexName), 0);
          const INDEX_CAP = 500;
          if (existingIndexPosition >= INDEX_CAP) {
            // Already at cap for this index — skip
          } else {
            const maxAdditional = Math.min(
              u.walletBalance,
              SIM_CONFIG.MAX_ALLOC_PER_TRADE,
              SIM_CONFIG.MAX_USER_POSITION - currentPositionValue,
              INDEX_CAP - existingIndexPosition,
            );
            if (maxAdditional >= SIM_CONFIG.MIN_ALLOC) {
              const amount =
                SIM_CONFIG.MIN_ALLOC +
                Math.random() * (maxAdditional - SIM_CONFIG.MIN_ALLOC);
              const buyPrice = getBuyPrice(indexName);
              const shares = amount / buyPrice;
              const defaultRange = SIM_CONFIG.HOLD_RANGES[u.profile];
              const [minHold, maxHold] = (holdRanges[u.profile] ??
                defaultRange) as [number, number];
              const holdMs = minHold + Math.random() * (maxHold - minHold);
              // Enhancement 2 — per-tick allocation velocity throttle
              if (allocCountThisTick >= MAX_ALLOCS_PER_TICK) {
                // Queue excess allocation for next tick
                pendingAllocQueueRef.current.push({
                  userId: u.id,
                  indexName,
                  amount,
                  holdMs,
                  buyPrice,
                });
              } else {
                u.walletBalance -= amount;
                u.totalAllocated += amount;
                u.positions.push({
                  indexName,
                  shares,
                  entryPrice: buyPrice,
                  entryTimestamp: now,
                  holdDurationMs: holdMs,
                });
                const capNow = users.reduce(
                  (s, uu) =>
                    s +
                    uu.positions.reduce(
                      (ps, p) => ps + p.shares * getRedeemPrice(p.indexName),
                      0,
                    ),
                  0,
                );
                const lcr = POOL_TOTAL_CAPACITY / Math.max(1, capNow);
                newTxs.push({
                  id: `${u.id}-${now}-alloc-${indexName}`,
                  userId: u.id,
                  userLabel: u.label,
                  type: "allocate",
                  indexName,
                  amount,
                  shares,
                  price: buyPrice,
                  entryPrice: buyPrice,
                  spread: 0,
                  timestamp: now,
                  profile: profileSnapshot.get(u.id) ?? u.profile,
                  triggerReason: "Auto-allocate",
                  tickId,
                  poolCoverageRatio: lcr,
                  scenarioName: preset.name,
                });
                allocCountThisTick++;
              }
            }
          }
        }
      }
      return u;
    });

    // Enhancement 3 — check pool utilization before normal redemptions; if >130% queue excess
    // (applied to the toRedeem paths above within the updatedUsers.map — handled below after map)
    // Now check post-map pool utilization for queuing new redemptions
    const postMapCapDeployed = updatedUsers.reduce(
      (s, u) =>
        s +
        u.positions.reduce(
          (ps, p) => ps + p.shares * getRedeemPrice(p.indexName),
          0,
        ),
      0,
    );
    const postMapPoolUtilPct =
      (postMapCapDeployed / Math.max(1, POOL_TOTAL_CAPACITY)) * 100;
    // If utilization >130%, collect all normal hold-duration redemption txs generated in the map
    // and move the excess back to queue. First redemption in tick always processes immediately.
    if (postMapPoolUtilPct > 130) {
      const redeemTxsThisTick = newTxs.filter((tx) => tx.type === "redeem");
      if (redeemTxsThisTick.length > 1) {
        const toQueueTxs = redeemTxsThisTick.slice(1);
        // Group by userId and push to redemptionQueueRef
        for (const tx of toQueueTxs) {
          const u = updatedUsers.find((x) => x.id === tx.userId);
          if (!u) continue;
          // Move the position back (undo the redemption from the map)
          u.positions.push({
            indexName: tx.indexName,
            shares: tx.shares,
            entryPrice: tx.entryPrice,
            entryTimestamp: now - tx.shares * 1000,
            holdDurationMs: 0,
          });
          u.walletBalance -= tx.amount;
          u.totalRedeemed -= tx.amount;
          u.spreadEarned -= tx.spread;
          u.roundTrips -= 1;
          redemptionQueueRef.current.push({
            userId: tx.userId,
            positions: [
              {
                indexName: tx.indexName,
                shares: tx.shares,
                entryPrice: tx.entryPrice,
                entryTimestamp: now,
                holdDurationMs: 0,
              },
            ],
            triggerReason: `${tx.triggerReason} (queued)`,
          });
        }
        // Remove queued txs from newTxs
        const keepIds = new Set(
          newTxs
            .filter(
              (tx) => tx.type !== "redeem" || toQueueTxs.indexOf(tx) === -1,
            )
            .map((tx) => tx.id),
        );
        newTxs.splice(
          0,
          newTxs.length,
          ...newTxs.filter((tx) => keepIds.has(tx.id)),
        );
        setRedemptionQueueDepth(redemptionQueueRef.current.length);
      }
    }

    // Process crisis redemptions
    if (crisisActiveThisTick && crisisRedemptionUsers.length > 0) {
      const totalCapDeployedNow = updatedUsers.reduce(
        (s, u) =>
          s +
          u.positions.reduce(
            (ps, p) => ps + p.shares * getRedeemPrice(p.indexName),
            0,
          ),
        0,
      );
      const maxThisTick = Math.max(
        1,
        Math.ceil(
          (POOL_TOTAL_CAPACITY * 0.15) /
            Math.max(
              100,
              totalCapDeployedNow /
                Math.max(
                  1,
                  updatedUsers.filter((u) => u.positions.length > 0).length,
                ),
            ),
        ),
      );
      const processNow = crisisRedemptionUsers.slice(0, maxThisTick);
      const stagger = crisisRedemptionUsers.slice(maxThisTick);
      staggeredQueueRef.current = [...staggeredQueueRef.current, ...stagger];
      for (const crisisUser of processNow) {
        const u = updatedUsers.find((x) => x.id === crisisUser.id);
        if (!u || u.positions.length === 0) continue;
        const redeemed = [...u.positions];
        u.positions = [];
        for (const pos of redeemed) {
          const offset = crisisScoreOffsetRef.current;
          const redeemPrice = Math.max(
            0.1,
            getRedeemPrice(pos.indexName) - offset,
          );
          const proceeds = pos.shares * redeemPrice;
          const spread = Math.abs(pos.shares * (pos.entryPrice - redeemPrice));
          u.walletBalance += proceeds;
          u.totalRedeemed += proceeds;
          u.spreadEarned += spread;
          u.roundTrips += 1;
          const capNow = updatedUsers.reduce(
            (s, uu) =>
              s +
              uu.positions.reduce(
                (ps, p) => ps + p.shares * getRedeemPrice(p.indexName),
                0,
              ),
            0,
          );
          const lcr = POOL_TOTAL_CAPACITY / Math.max(1, capNow);
          newTxs.push({
            id: `${u.id}-${now}-crisis-${pos.indexName}`,
            userId: u.id,
            userLabel: u.label,
            type: "redeem",
            indexName: pos.indexName,
            amount: proceeds,
            shares: pos.shares,
            price: redeemPrice,
            entryPrice: pos.entryPrice,
            spread,
            timestamp: now,
            profile: profileSnapshot.get(u.id) ?? u.profile,
            triggerReason: "🚨 CRISIS EVENT",
            tickId,
            poolCoverageRatio: lcr,
            scenarioName: preset.name,
          });
        }
      }
      setCrisisMetrics((prev) => ({
        ...prev,
        staggeredQueueDepth: stagger.length,
      }));
    }

    simUsersRef.current = updatedUsers;

    // Extended metrics
    const totalCapDeployed = updatedUsers.reduce(
      (s, u) =>
        s +
        u.positions.reduce(
          (ps, p) => ps + p.shares * getRedeemPrice(p.indexName),
          0,
        ),
      0,
    );
    // Fix 3 — update running reserve balance: increases by spread captured this tick, decreases by redemption proceeds
    const tickSpreadEarned = newTxs
      .filter((tx) => tx.type === "redeem")
      .reduce((s, tx) => s + tx.spread, 0);
    const tickRedemptionPayouts = newTxs
      .filter((tx) => tx.type === "redeem")
      .reduce((s, tx) => s + tx.amount, 0);
    const tickAllocationsReceived = newTxs
      .filter((tx) => tx.type === "allocate")
      .reduce((s, tx) => s + tx.amount, 0);
    simReserveBalanceRef.current = Math.max(
      0,
      simReserveBalanceRef.current +
        tickAllocationsReceived +
        tickSpreadEarned -
        tickRedemptionPayouts,
    );
    const lcr = simReserveBalanceRef.current / Math.max(1, totalCapDeployed);
    const poolUtilPct =
      (totalCapDeployed / Math.max(1, POOL_TOTAL_CAPACITY)) * 100;
    const reserveBuf = simReserveBalanceRef.current;

    // Crisis recovery tracking
    if (
      crisisFiredRef.current &&
      crisisResolvedTickRef.current === null &&
      lcr >= 1.0
    ) {
      crisisResolvedTickRef.current = tickId;
      setCrisisMetrics((prev) => ({
        ...prev,
        status: "resolved",
        lowestCoverageRatio: Math.min(prev.lowestCoverageRatio, lcr),
        recoveryTicks: tickId,
      }));
    } else if (
      crisisFiredRef.current &&
      crisisResolvedTickRef.current === null
    ) {
      setCrisisMetrics((prev) => ({
        ...prev,
        lowestCoverageRatio: Math.min(prev.lowestCoverageRatio, lcr),
      }));
    }

    const profileCounts: Record<string, number> = {};
    let totalPositions = 0;
    for (const u of updatedUsers) {
      for (const p of u.positions) {
        void p;
        profileCounts[u.profile] = (profileCounts[u.profile] ?? 0) + 1;
        totalPositions += 1;
      }
    }
    const activePositionsByProfile: Record<
      string,
      { count: number; pct: number }
    > = {};
    for (const [prof, cnt] of Object.entries(profileCounts)) {
      activePositionsByProfile[prof] = {
        count: cnt,
        pct: totalPositions > 0 ? (cnt / totalPositions) * 100 : 0,
      };
    }

    const allPositions = updatedUsers.flatMap((u) => u.positions);
    const avgHoldMs =
      allPositions.length > 0
        ? allPositions.reduce((s, p) => s + (now - p.entryTimestamp), 0) /
          allPositions.length
        : 0;
    const avgHoldSimDays = avgHoldMs / 4000;

    const loyaltyTiers = { bronze: 0, silver: 0, gold: 0, obsidian: 0 };
    for (const u of updatedUsers) {
      if (u.simDaysHeld >= 30) loyaltyTiers.obsidian += 1;
      else if (u.simDaysHeld >= 21) loyaltyTiers.gold += 1;
      else if (u.simDaysHeld >= 14) loyaltyTiers.silver += 1;
      else if (u.simDaysHeld >= 7) loyaltyTiers.bronze += 1;
    }

    const tickSpread = newTxs
      .filter((tx) => tx.type === "redeem")
      .reduce((s, tx) => s + tx.spread, 0);
    spreadTickHistoryRef.current = [
      ...spreadTickHistoryRef.current,
      tickSpread,
    ].slice(-10);
    const spreadRevPerTick =
      spreadTickHistoryRef.current.reduce((s, v) => s + v, 0) /
      Math.max(1, spreadTickHistoryRef.current.length);

    const redeemCount = newTxs.filter((tx) => tx.type === "redeem").length;
    redemptionFreqHistoryRef.current = [
      ...redemptionFreqHistoryRef.current,
      redeemCount,
    ].slice(-10);
    const redemptionFreq =
      redemptionFreqHistoryRef.current.reduce((s, v) => s + v, 0) /
      Math.max(1, redemptionFreqHistoryRef.current.length);

    const memberCount = updatedUsers.filter((u) => u.isMember).length;
    const simDaysPerTick = speedCfg.simDaysPerTick;
    const membershipRevenue =
      memberCount * 5 * ((tickId * simDaysPerTick) / 30);
    const instAPIRevenue = preset.institutionalAPIRevenue;

    setSimTxLog((prev) =>
      newTxs.length > 0 ? [...newTxs, ...prev].slice(0, 500) : prev,
    );
    // Keep the lcr recalc inside setSimMetrics consistent after reserve balance update
    setSimMetrics((prev) => {
      const next = { ...prev, spreadByIndex: { ...prev.spreadByIndex } };
      for (const tx of newTxs) {
        if (tx.type === "allocate") next.totalAllocated += tx.amount;
        if (tx.type === "redeem") {
          next.totalRedeemed += tx.amount;
          next.totalSpread += tx.spread;
          next.spreadByIndex[tx.indexName] =
            (next.spreadByIndex[tx.indexName] ?? 0) + tx.spread;
        }
      }
      setExtMetrics({
        spreadRevPerTick,
        spreadRevPerUser: next.totalSpread / Math.max(1, updatedUsers.length),
        membershipRevenue,
        institutionalAPIRevenue: instAPIRevenue,
        totalPlatformRevenue:
          next.totalSpread + membershipRevenue + instAPIRevenue,
        totalCapitalDeployed: totalCapDeployed,
        totalRedemptionLiability: totalCapDeployed,
        liquidityCoverageRatio: lcr,
        poolUtilizationPct: poolUtilPct,
        reserveBuffer: reserveBuf,
        activePositionsByProfile,
        avgHoldDuration: avgHoldSimDays,
        redemptionFrequency: redemptionFreq,
        loyaltyTiers,
        panicRedemptionEvents: next.panicCount,
      });
      return next;
    });
    if (preset.userCount <= 100) setSimUsers([...updatedUsers]);
  };

  const handleStartSimulation = () => {
    const preset =
      SCENARIO_PRESETS[selectedScenario] ?? SCENARIO_PRESETS.scenario1;
    // Fix 3 — seed reserve balance before any allocations
    simReserveBalanceRef.current = preset.reserveSeed;
    setSimReserveSeedDisplay(preset.reserveSeed);
    const users = createSimUsers(preset);
    simUsersRef.current = users;
    setSimUsers(preset.userCount <= 100 ? users : []);
    setSimTxLog([]);
    setSimMetrics({
      totalSpread: 0,
      totalAllocated: 0,
      totalRedeemed: 0,
      spreadByIndex: Object.fromEntries(SIM_INDEXES.map((idx) => [idx, 0])),
      panicCount: 0,
    });
    setExtMetrics({
      spreadRevPerTick: 0,
      spreadRevPerUser: 0,
      membershipRevenue: 0,
      institutionalAPIRevenue: 0,
      totalPlatformRevenue: 0,
      totalCapitalDeployed: 0,
      totalRedemptionLiability: 0,
      // Fix 3 — initial lcr at tick 0 reflects the seeded reserve divided by 1 (no deployed capital yet)
      liquidityCoverageRatio: preset.reserveSeed,
      poolUtilizationPct: 0,
      reserveBuffer: preset.reserveSeed,
      activePositionsByProfile: {},
      avgHoldDuration: 0,
      redemptionFrequency: 0,
      loyaltyTiers: { bronze: 0, silver: 0, gold: 0, obsidian: 0 },
      panicRedemptionEvents: 0,
    });
    setCrisisMetrics({
      status: "pending",
      scoreDeclineMagnitude: 0,
      simultaneousRedemptions: 0,
      staggeredQueueDepth: 0,
      peakCoverageRatio: 1.0,
      lowestCoverageRatio: 99.0,
      recoveryTicks: 0,
    });
    crisisFiredRef.current = false;
    crisisResolvedTickRef.current = null;
    crisisScoreOffsetRef.current = 0;
    staggeredQueueRef.current = [];
    pendingAllocQueueRef.current = [];
    redemptionQueueRef.current = [];
    setRedemptionQueueDepth(0);
    spreadTickHistoryRef.current = [];
    redemptionFreqHistoryRef.current = [];
    simTickCountRef.current = 0;
    setSimTickCount(0);
    simDaysRef.current = 0;
    setSimDays(0);
    simStartTimeRef.current = Date.now();
    setSimRunning(true);
    simIntervalRef.current = setInterval(
      runSimTick,
      SIM_SPEED_MODES[simSpeedModeRef.current].intervalMs,
    );
  };

  const handleStopSimulation = () => {
    if (simIntervalRef.current) {
      clearInterval(simIntervalRef.current);
      simIntervalRef.current = null;
    }
    setSimRunning(false);
    setSimTxFilter("all");
  };

  const handleResetScenario = () => {
    if (simIntervalRef.current) {
      clearInterval(simIntervalRef.current);
      simIntervalRef.current = null;
    }
    // Fix 3 — re-seed reserve balance to the active scenario's seed on reset
    const resetPreset =
      SCENARIO_PRESETS[selectedScenario] ?? SCENARIO_PRESETS.scenario1;
    simReserveBalanceRef.current = resetPreset.reserveSeed;
    setSimReserveSeedDisplay(resetPreset.reserveSeed);
    setSimRunning(false);
    setSimUsers([]);
    setSimTxLog([]);
    setSimMetrics({
      totalSpread: 0,
      totalAllocated: 0,
      totalRedeemed: 0,
      spreadByIndex: Object.fromEntries(SIM_INDEXES.map((idx) => [idx, 0])),
      panicCount: 0,
    });
    setExtMetrics({
      spreadRevPerTick: 0,
      spreadRevPerUser: 0,
      membershipRevenue: 0,
      institutionalAPIRevenue: 0,
      totalPlatformRevenue: 0,
      totalCapitalDeployed: 0,
      totalRedemptionLiability: 0,
      liquidityCoverageRatio: 0,
      poolUtilizationPct: 0,
      reserveBuffer: 0,
      activePositionsByProfile: {},
      avgHoldDuration: 0,
      redemptionFrequency: 0,
      loyaltyTiers: { bronze: 0, silver: 0, gold: 0, obsidian: 0 },
      panicRedemptionEvents: 0,
    });
    setCrisisMetrics({
      status: "pending",
      scoreDeclineMagnitude: 0,
      simultaneousRedemptions: 0,
      staggeredQueueDepth: 0,
      peakCoverageRatio: 1.0,
      lowestCoverageRatio: 99.0,
      recoveryTicks: 0,
    });
    crisisFiredRef.current = false;
    crisisResolvedTickRef.current = null;
    crisisScoreOffsetRef.current = 0;
    staggeredQueueRef.current = [];
    pendingAllocQueueRef.current = [];
    redemptionQueueRef.current = [];
    setRedemptionQueueDepth(0);
    spreadTickHistoryRef.current = [];
    redemptionFreqHistoryRef.current = [];
    simTickCountRef.current = 0;
    setSimTickCount(0);
    simDaysRef.current = 0;
    setSimDays(0);
    simUsersRef.current = [];
  };

  const handleExportSimCsv = () => {
    if (simTxLog.length === 0) return;
    const header =
      "Tick,User ID,Behavioral Profile,Action,Index Name,Amount,Entry Price,Exit Price,Spread Captured,Pool Coverage Ratio,Scenario Name";
    const rows = simTxLog.map((tx) => {
      const profile = PROFILE_LABELS[tx.profile];
      const type = tx.type === "allocate" ? "Allocate" : "Redeem";
      const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
      const entryPrice =
        tx.type === "allocate" ? tx.price.toFixed(2) : tx.entryPrice.toFixed(2);
      const exitPrice = tx.type === "redeem" ? tx.price.toFixed(2) : "";
      return [
        String(tx.tickId),
        esc(tx.userId),
        esc(profile),
        esc(type),
        esc(tx.indexName),
        tx.amount.toFixed(2),
        entryPrice,
        exitPrice,
        tx.spread.toFixed(2),
        tx.poolCoverageRatio.toFixed(3),
        esc(tx.scenarioName),
      ].join(",");
    });
    const csv = [header, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "sim-transaction-log.csv";
    link.click();
    URL.revokeObjectURL(url);
    setSimExportMsg("Exported!");
    setTimeout(() => setSimExportMsg(null), 2000);
  };

  const handlePanicMode = () => {
    const now = Date.now();
    const preset =
      SCENARIO_PRESETS[selectedScenario] ?? SCENARIO_PRESETS.scenario1;
    const POOL_TOTAL_CAPACITY = preset.userCount * preset.avgPositionSize * 2;
    const newTxs: SimTransaction[] = [];
    const currentUsers = [...simUsersRef.current];
    // Profile snapshot for panic mode
    const panicProfileSnapshot = new Map<string, BehaviorProfile>(
      currentUsers.map((u) => [u.id, u.profile]),
    );
    const updatedUsers = currentUsers.map((user) => {
      if (user.positions.length === 0) return user;
      const u = { ...user };
      const redeemed = u.positions;
      u.positions = [];
      for (const pos of redeemed) {
        const redeemPrice = getRedeemPrice(pos.indexName);
        const proceeds = pos.shares * redeemPrice;
        const spread = Math.abs(pos.shares * (pos.entryPrice - redeemPrice));
        u.walletBalance += proceeds;
        u.totalRedeemed += proceeds;
        u.spreadEarned += spread;
        u.roundTrips += 1;
        const capNow = currentUsers.reduce(
          (s, uu) =>
            s +
            uu.positions.reduce(
              (ps, p) => ps + p.shares * getRedeemPrice(p.indexName),
              0,
            ),
          0,
        );
        const lcr = POOL_TOTAL_CAPACITY / Math.max(1, capNow);
        newTxs.push({
          id: `${u.id}-${now}-panic-${pos.indexName}`,
          userId: u.id,
          userLabel: u.label,
          type: "redeem",
          indexName: pos.indexName,
          amount: proceeds,
          shares: pos.shares,
          price: redeemPrice,
          entryPrice: pos.entryPrice,
          spread,
          timestamp: now,
          profile: panicProfileSnapshot.get(u.id) ?? u.profile,
          triggerReason: "⚠ PANIC MODE",
          tickId: simTickCountRef.current,
          poolCoverageRatio: lcr,
          scenarioName: preset.name,
        });
      }
      return u;
    });
    simUsersRef.current = updatedUsers;
    setSimUsers(preset.userCount <= 100 ? [...updatedUsers] : []);
    if (newTxs.length > 0) {
      setSimTxLog((prev) => [...newTxs, ...prev].slice(0, 500));
      setSimMetrics((prev) => {
        const next = {
          ...prev,
          spreadByIndex: { ...prev.spreadByIndex },
          panicCount: prev.panicCount + 1,
        };
        for (const tx of newTxs) {
          next.totalRedeemed += tx.amount;
          next.totalSpread += tx.spread;
          next.spreadByIndex[tx.indexName] =
            (next.spreadByIndex[tx.indexName] ?? 0) + tx.spread;
        }
        return next;
      });
    }
  };

  useEffect(() => {
    return () => {
      if (simIntervalRef.current) clearInterval(simIntervalRef.current);
    };
  }, []);

  // Clear the HuggingFace key input on successful mutation
  useEffect(() => {
    if (setHfKeyMutation.isSuccess) {
      setHfKeyValue("");
    }
  }, [setHfKeyMutation.isSuccess]);

  // Clear the Finnhub key input on successful mutation
  useEffect(() => {
    if (setFinnhubKeyMutation.isSuccess) {
      setFinnhubKeyValue("");
    }
  }, [setFinnhubKeyMutation.isSuccess]);

  // Restart interval on speed mode change without resetting any state
  // biome-ignore lint/correctness/useExhaustiveDependencies: runSimTick reads only refs
  useEffect(() => {
    simSpeedModeRef.current = simSpeedMode;
    if (!simRunning) return;
    if (simIntervalRef.current) clearInterval(simIntervalRef.current);
    simIntervalRef.current = setInterval(
      runSimTick,
      SIM_SPEED_MODES[simSpeedMode].intervalMs,
    );
  }, [simSpeedMode, simRunning]);

  // ── MAIN VIEW ────────────────────────────────────────────────────────────────
  if (activeView === "main") {
    // ── Portfolio snapshot — derived inline, not extracted ──────────────
    const holdingsTotal = Array.from(costBasisMap.entries()).reduce(
      (sum, [indexId, basis]) => {
        const score = finalScores.get(indexId) ?? 100;
        return sum + basis * (score / 100);
      },
      0,
    );
    const shortHoldingsTotal = Array.from(shortPositions.entries()).reduce(
      (sum, [indexId, short]) => {
        const currentScore = finalScores.get(indexId) ?? short.entryScore;
        const mtm =
          short.entryScore > 0
            ? Math.max(
                0,
                short.dollars +
                  ((short.entryScore - currentScore) / short.entryScore) *
                    short.dollars,
              )
            : 0;
        return sum + mtm;
      },
      0,
    );
    const deployedValue = holdingsTotal + shortHoldingsTotal;
    const totalValue = buyingPower + deployedValue;
    const activePositions = costBasisMap.size + shortPositions.size;
    // ─────────────────────────────────────────────────────────────────

    const finbertEntryCount = (() => {
      if (finbertLogOpen) return finbertLog.length;
      try {
        const raw = localStorage.getItem("momentum_finbert_log_v1");
        return raw ? (JSON.parse(raw) as FinBertLogEntry[]).length : 0;
      } catch {
        return 0;
      }
    })();

    const frequencyMap = new Map<
      string,
      { count: number; indexName: string; suggestedDirection: string }
    >();
    for (const entry of finbertLog) {
      const key = entry.headline;
      if (frequencyMap.has(key)) {
        frequencyMap.get(key)!.count += 1;
      } else {
        frequencyMap.set(key, {
          count: 1,
          indexName: entry.indexName,
          suggestedDirection: entry.suggestedDirection,
        });
      }
    }
    const topHeadlines = Array.from(frequencyMap.entries())
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 50);

    return (
      <div
        className="w-full max-w-2xl mx-auto px-4 py-6 flex flex-col gap-3"
        style={{ fontFamily: "'Inter', system-ui, sans-serif" }}
        data-ocid="profile_page"
      >
        {/* Account header — no avatar */}
        <div className="flex flex-col px-1 pb-2">
          <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-semibold mb-1">
            Account
          </p>
          <p
            className="text-[18px] font-bold leading-tight truncate"
            style={{ color: "#ffffff", letterSpacing: "-0.01em" }}
          >
            {displayName}
          </p>
          {displayEmail && (
            <p
              className="text-[13px] mt-0.5 truncate"
              style={{ color: "oklch(0.50 0.008 240)" }}
            >
              {displayEmail}
            </p>
          )}
        </div>

        {/* Portfolio Snapshot Card — CHANGE 1 + CHANGE 3 (entrance animation) */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: "easeOut" }}
          className="rounded-2xl p-4"
          style={{ backgroundColor: "#141414", border: "1px solid #222222" }}
          data-ocid="profile_page.portfolio_snapshot"
        >
          {/* Top row: PORTFOLIO label + join date */}
          <div className="flex items-center justify-between mb-1">
            <p
              className="text-[10px] uppercase tracking-widest font-semibold"
              style={{
                color: "oklch(0.48 0.008 240)",
                letterSpacing: "0.12em",
              }}
            >
              Portfolio
            </p>
            <p
              className="text-[10px] uppercase tracking-widest font-semibold"
              style={{
                color: "oklch(0.48 0.008 240)",
                letterSpacing: "0.12em",
              }}
            >
              {joinDate}
            </p>
          </div>

          {/* Total portfolio value */}
          <p
            className="text-2xl font-mono font-bold tracking-tight mt-1 mb-3"
            style={{ color: "#ffffff" }}
          >
            {fmt(totalValue)}
          </p>

          {/* Three stat columns */}
          <div className="flex gap-4">
            <div className="flex flex-col">
              <p
                className="text-[10px] uppercase tracking-widest font-semibold"
                style={{
                  color: "oklch(0.48 0.008 240)",
                  letterSpacing: "0.10em",
                }}
              >
                Positions
              </p>
              <p
                className="text-sm font-mono font-semibold mt-0.5"
                style={{ color: "#ffffff" }}
              >
                {activePositions}
              </p>
            </div>
            <div className="flex flex-col">
              <p
                className="text-[10px] uppercase tracking-widest font-semibold"
                style={{
                  color: "oklch(0.48 0.008 240)",
                  letterSpacing: "0.10em",
                }}
              >
                Deployed
              </p>
              <p
                className="text-sm font-mono font-semibold mt-0.5"
                style={{ color: "#ffffff" }}
              >
                {fmt(deployedValue)}
              </p>
            </div>
            <div className="flex flex-col">
              <p
                className="text-[10px] uppercase tracking-widest font-semibold"
                style={{
                  color: "oklch(0.48 0.008 240)",
                  letterSpacing: "0.10em",
                }}
              >
                Available
              </p>
              <p
                className="text-sm font-mono font-semibold mt-0.5"
                style={{ color: "#ffffff" }}
              >
                {fmt(buyingPower)}
              </p>
            </div>
          </div>
        </motion.div>

        {/* Loyalty Tier Card — CHANGE 3 (delayed entrance animation) */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: "easeOut", delay: 0.08 }}
          className="rounded-2xl p-4"
          style={{ backgroundColor: "#141414", border: "1px solid #222222" }}
        >
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
                  {TIER_EMOJI[loyaltyTier.name] ?? "◈"}
                </span>
                {loyaltyTier.name}
              </span>
              <span
                className="text-[13px] font-semibold font-mono"
                style={{ color: "oklch(0.75 0.008 240)" }}
              >
                Exit: {(0.5 - loyaltyTier.spreadReduction).toFixed(2)}
              </span>
            </div>
          </div>
          <TierProgressBar
            progressPercent={tierProgressPercent}
            daysUntilNextTier={daysUntilNextTier}
            nextTierName={nextTier?.name ?? null}
            tierName={loyaltyTier.name}
            tierColor={loyaltyTier.color}
          />
        </motion.div>

        {/* Buying Power Card — tap anywhere to deposit */}
        <motion.button
          type="button"
          onClick={() => setIsDepositOpen(true)}
          data-ocid="profile_page.add_funds"
          className="w-full rounded-2xl p-4 text-left transition-colors duration-150"
          style={{ backgroundColor: "#141414", border: "1px solid #222222" }}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: "easeOut", delay: 0.16 }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = "#1a1a1a";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = "#141414";
          }}
        >
          <p
            className="text-[11px] uppercase tracking-widest font-semibold mb-3"
            style={{ color: "oklch(0.48 0.008 240)", letterSpacing: "0.12em" }}
          >
            Buying Power
          </p>
          <p
            className="text-2xl font-mono font-bold tracking-tight mt-1 mb-3"
            style={{ color: "#ffffff" }}
          >
            {fmt(
              buyingPower > 0
                ? buyingPower
                : localWalletBalance > 0
                  ? localWalletBalance
                  : (walletBalance ?? 0),
            )}
          </p>
          <p className="text-[13px] mt-2" style={{ color: "oklch(0.48 0.008 240)" }}>
            Tap to deposit funds instantly
          </p>
        </motion.button>

        {/* Consolidated nav card — Activity, Tax Center, Legal — CHANGE 2A */}
        <motion.div
          className="rounded-2xl overflow-hidden"
          style={{ backgroundColor: "#141414", border: "1px solid #222222" }}
          data-ocid="profile_page.nav_card"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: "easeOut", delay: 0.24 }}
        >
          {/* Activity row */}
          <button
            type="button"
            onClick={() => setActiveView("history")}
            data-ocid="profile_page.activity"
            className="flex items-center justify-between w-full px-4 py-4 text-left transition-colors duration-150 border-b"
            style={{ borderColor: "#222222" }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = "#1a1a1a";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = "transparent";
            }}
          >
            <div className="flex items-center gap-2.5">
              <Activity
                className="w-5 h-5 shrink-0"
                style={{ color: "oklch(0.55 0.008 240)" }}
                strokeWidth={1.5}
              />
              <span
                className="text-[15px] font-medium"
                style={{ color: "oklch(0.80 0.008 240)" }}
              >
                Activity
              </span>
            </div>
            <ChevronRight
              className="w-4 h-4 shrink-0"
              style={{ color: "oklch(0.40 0.008 240)" }}
              strokeWidth={2}
            />
          </button>

          {/* Tax Center row */}
          <button
            type="button"
            onClick={() => setActiveView("tax")}
            data-ocid="profile_page.tax_center"
            className="flex items-center justify-between w-full px-4 py-4 text-left transition-colors duration-150 border-b"
            style={{ borderColor: "#222222" }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = "#1a1a1a";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = "transparent";
            }}
          >
            <div className="flex items-center gap-2.5">
              <FileText
                className="w-5 h-5 shrink-0"
                style={{ color: "oklch(0.55 0.008 240)" }}
                strokeWidth={1.5}
              />
              <span
                className="text-[15px] font-medium"
                style={{ color: "oklch(0.80 0.008 240)" }}
              >
                Tax Center
              </span>
            </div>
            <ChevronRight
              className="w-4 h-4 shrink-0"
              style={{ color: "oklch(0.40 0.008 240)" }}
              strokeWidth={2}
            />
          </button>

          {/* Legal & Disclosures row */}
          <button
            type="button"
            onClick={() => setActiveView("legal")}
            data-ocid="profile_page.legal"
            className="flex items-center justify-between w-full px-4 py-4 text-left transition-colors duration-150"
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = "#1a1a1a";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = "transparent";
            }}
          >
            <div className="flex items-center gap-2.5">
              <Shield
                className="w-5 h-5 shrink-0"
                style={{ color: "oklch(0.55 0.008 240)" }}
                strokeWidth={1.5}
              />
              <span
                className="text-[15px] font-medium"
                style={{ color: "oklch(0.80 0.008 240)" }}
              >
                Legal &amp; Disclosures
              </span>
            </div>
            <ChevronRight
              className="w-4 h-4 shrink-0"
              style={{ color: "oklch(0.40 0.008 240)" }}
              strokeWidth={2}
            />
          </button>
        </motion.div>

        {/* Sign Out — plain muted text link — CHANGE 2B */}
        <button
          type="button"
          onClick={handleLogout}
          data-ocid="profile_page.sign_out"
          className="text-sm text-center w-full mt-4 mb-6 transition-colors duration-150 hover:text-foreground"
          style={{
            color: "oklch(0.45 0.008 240)",
            background: "none",
            border: "none",
          }}
        >
          Sign out
        </button>

        {/* Oracle Health Panel */}
        {/* TODO: Replace with real canister health data when hook is available */}
        <OracleHealthPanel
          cyclesBalance={null}
          tierStatus={null}
          subsidyReserves={subsidyReserves ?? null}
          totalReserve={totalReserve ?? null}
        />

        {/* ── FinBERT Log ── */}
        <div
          className="rounded-2xl overflow-hidden"
          style={{ backgroundColor: "#141414", border: "1px solid #222222" }}
          data-ocid="profile_page.finbert_log.panel"
        >
          {/* Accordion Header */}
          <button
            type="button"
            onClick={handleFinbertLogOpen}
            className="flex items-center gap-3 w-full px-4 py-3 text-left"
            data-ocid="profile_page.finbert_log.toggle"
          >
            <Shield
              className="w-4 h-4 shrink-0"
              style={{ color: "oklch(0.65 0.22 145)" }}
              strokeWidth={1.5}
            />
            <div className="flex-1 min-w-0">
              <span
                className="text-[11px] uppercase tracking-widest font-semibold"
                style={{ color: "oklch(0.65 0.22 145)" }}
              >
                FinBERT Log
              </span>
              {finbertEntryCount >= 100 && (
                <span
                  className="inline-flex items-center justify-center w-4 h-4 rounded-full text-[10px] font-bold leading-none ml-1.5"
                  style={{
                    backgroundColor: "oklch(0.60 0.20 25)",
                    color: "#ffffff",
                  }}
                  data-ocid="profile_page.finbert_log.alert_badge"
                >
                  !
                </span>
              )}
            </div>
            <span
              className="text-[11px] font-medium px-2 py-0.5 rounded-full shrink-0"
              style={{
                backgroundColor: "oklch(0.65 0.22 145 / 0.12)",
                color: "oklch(0.65 0.22 145)",
              }}
              data-ocid="profile_page.finbert_log.count"
            >
              {finbertEntryCount} entries
            </span>
            {finbertLogOpen && (
              <>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleFinbertExport();
                  }}
                  className="shrink-0 text-[11px] font-semibold px-2.5 py-1 rounded-lg transition-colors duration-150"
                  style={{
                    backgroundColor: "oklch(0.65 0.22 145 / 0.15)",
                    color: "oklch(0.65 0.22 145)",
                    border: "1px solid oklch(0.65 0.22 145 / 0.25)",
                  }}
                  data-ocid="profile_page.finbert_log.export_button"
                >
                  {finbertExportMsg ?? "Export"}
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleMLExport();
                  }}
                  className="shrink-0 text-[11px] font-semibold px-2.5 py-1 rounded-lg transition-colors duration-150"
                  style={{
                    backgroundColor: "oklch(0.65 0.22 145 / 0.15)",
                    color: "oklch(0.65 0.22 145)",
                    border: "1px solid oklch(0.65 0.22 145 / 0.25)",
                  }}
                  data-ocid="profile_page.finbert_log.export_ml_dataset_button"
                >
                  Export ML Dataset
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleLexiconMLExport();
                  }}
                  className="shrink-0 text-[11px] font-semibold px-2.5 py-1 rounded-lg transition-colors duration-150"
                  style={{
                    backgroundColor: "oklch(0.65 0.22 145 / 0.15)",
                    color: "oklch(0.65 0.22 145)",
                    border: "1px solid oklch(0.65 0.22 145 / 0.25)",
                  }}
                  data-ocid="profile_page.finbert_log.export_lexicon_dataset_button"
                >
                  Export Lexicon Dataset
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleFinbertClear();
                  }}
                  className="shrink-0 text-[11px] font-semibold px-2.5 py-1 rounded-lg transition-colors duration-150"
                  style={{
                    backgroundColor: "oklch(0.60 0.20 25 / 0.10)",
                    color: "oklch(0.60 0.20 25)",
                    border: "1px solid oklch(0.60 0.20 25 / 0.25)",
                  }}
                  data-ocid="profile_page.finbert_log.clear_button"
                >
                  {finbertClearMsg ?? "Clear"}
                </button>
              </>
            )}
            <ChevronDown
              className="w-4 h-4 shrink-0 transition-transform duration-200"
              style={{
                color: "oklch(0.48 0.008 240)",
                transform: finbertLogOpen ? "rotate(180deg)" : "rotate(0deg)",
              }}
              strokeWidth={2}
            />
          </button>

          {/* Accordion Body */}
          {finbertLogOpen && (
            <div className="border-t" style={{ borderColor: "#222222" }}>
              {finbertLog.length === 0 ? (
                <p
                  className="px-4 py-4 text-[13px] leading-relaxed"
                  style={{ color: "oklch(0.52 0.012 240)" }}
                  data-ocid="profile_page.finbert_log.empty_state"
                >
                  No FinBERT headlines captured yet. Headlines that pass the
                  lexicon and reach FinBERT classification will appear here for
                  lexicon review.
                </p>
              ) : (
                <div
                  className="flex flex-col gap-0 max-h-[480px] overflow-y-auto overflow-x-auto"
                  data-ocid="profile_page.finbert_log.list"
                >
                  {[...finbertLog]
                    .reverse()
                    .slice(0, 50)
                    .map((entry, i) => {
                      const patterns = extractPatterns(entry.headline);
                      const operator = patterns.length === 1 ? "OR" : "AND";
                      const timeStr = new Date(
                        entry.timestamp,
                      ).toLocaleTimeString("en-US", {
                        hour: "numeric",
                        minute: "2-digit",
                      });
                      const codeBlock = [
                        `// "${entry.headline}"`,
                        `// INDEX: ${getDisplayName(entry.indexName)} | SOURCE: ${entry.source} | TICK: #${String(entry.tickId)} | ${timeStr}`,
                        `// SUGGESTED: ${entry.suggestedDirection} — REVIEW BEFORE ADDING`,
                        "{",
                        `  patterns: [${patterns.map((p) => `"${p}"`).join(", ")}],`,
                        `  operator: "${operator}",`,
                        `  direction: "${entry.suggestedDirection}",`,
                        "  minConfidence: 0.80,",
                        "  maxConfidence: 0.91,",
                        "},",
                      ].join("\n");
                      return (
                        <div
                          key={`${String(entry.timestamp)}-${String(i)}`}
                          className="border-b last:border-b-0 px-3 py-3"
                          style={{ borderColor: "#1e1e1e" }}
                          data-ocid={`profile_page.finbert_log.item.${String(i + 1)}`}
                        >
                          <div className="flex items-center gap-2 mb-1.5">
                            <span
                              className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded"
                              style={{
                                backgroundColor:
                                  entry.scoringMethod === "finbert"
                                    ? "oklch(0.65 0.22 145 / 0.15)"
                                    : "oklch(0.52 0.012 240 / 0.15)",
                                color:
                                  entry.scoringMethod === "finbert"
                                    ? "oklch(0.65 0.22 145)"
                                    : "oklch(0.52 0.012 240)",
                              }}
                            >
                              {entry.scoringMethod === "finbert"
                                ? "FINBERT"
                                : "NEUTRAL"}
                            </span>
                            <span
                              className="text-[11px]"
                              style={{ color: "oklch(0.48 0.008 240)" }}
                            >
                              {timeStr}
                            </span>
                            <span
                              className="text-[10px]"
                              style={{ color: "oklch(0.40 0.008 240)" }}
                            >
                              tick #{String(entry.tickId)}
                            </span>
                          </div>
                          <pre
                            className="text-[11px] leading-relaxed rounded-lg p-3 overflow-x-auto whitespace-pre-wrap break-words font-mono"
                            style={{
                              backgroundColor: "#0d0d0d",
                              color: "oklch(0.68 0.012 240)",
                              border: "1px solid #1e1e1e",
                            }}
                          >
                            {codeBlock}
                          </pre>
                        </div>
                      );
                    })}
                </div>
              )}
            </div>
          )}

          {/* ── Lexicon Review ── */}
          <div
            className="rounded-2xl overflow-hidden"
            style={{ backgroundColor: "#141414", border: "1px solid #222222" }}
            data-ocid="profile_page.lexicon_review.panel"
          >
            {/* Accordion Header */}
            <button
              type="button"
              onClick={() => setLexiconReviewOpen((prev) => !prev)}
              className="flex items-center gap-3 w-full px-4 py-3.5 text-left"
              data-ocid="profile_page.lexicon_review.toggle"
            >
              <Shield
                className="w-4 h-4 shrink-0"
                style={{ color: "oklch(0.65 0.22 145)" }}
                strokeWidth={1.5}
              />
              <div className="flex-1 min-w-0">
                <span
                  className="text-[11px] uppercase tracking-widest font-semibold"
                  style={{ color: "oklch(0.65 0.22 145)" }}
                >
                  LEXICON REVIEW
                </span>
              </div>
              <span
                className="text-[11px] font-medium px-2 py-0.5 rounded-full shrink-0"
                style={{
                  backgroundColor: "oklch(0.65 0.22 145 / 0.12)",
                  color: "oklch(0.65 0.22 145)",
                }}
                data-ocid="profile_page.lexicon_review.count"
              >
                {topHeadlines.length} unique
              </span>
              {lexiconReviewOpen && (
                <>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      const blob = new Blob(
                        [
                          JSON.stringify(
                            topHeadlines.map(
                              ([
                                headline,
                                { count, indexName, suggestedDirection },
                              ]) => ({
                                headline,
                                indexName,
                                suggestedDirection,
                                count,
                              }),
                            ),
                            null,
                            2,
                          ),
                        ],
                        { type: "application/json" },
                      );
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = "lexicon-review-export.json";
                      a.click();
                      URL.revokeObjectURL(url);
                      setLexiconExportMsg("Exported!");
                      setTimeout(() => setLexiconExportMsg(null), 2000);
                    }}
                    className="shrink-0 text-[11px] font-semibold px-2.5 py-1 rounded-lg transition-colors duration-150"
                    style={{
                      backgroundColor: "oklch(0.65 0.22 145 / 0.15)",
                      color: "oklch(0.65 0.22 145)",
                      border: "1px solid oklch(0.65 0.22 145 / 0.25)",
                    }}
                    data-ocid="profile_page.lexicon_review.export_button"
                  >
                    {lexiconExportMsg ?? "Export"}
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (
                        !window.confirm(
                          `Clear all ${String(finbertLog.length)} entries? This cannot be undone.`,
                        )
                      )
                        return;
                      try {
                        localStorage.removeItem("momentum_finbert_log_v1");
                      } catch {
                        /* silent */
                      }
                      setFinbertLog([]);
                      setLexiconReviewOpen(false);
                      setLexiconClearMsg("Cleared");
                      setTimeout(() => setLexiconClearMsg(null), 2000);
                    }}
                    className="shrink-0 text-[11px] font-semibold px-2.5 py-1 rounded-lg transition-colors duration-150"
                    style={{
                      backgroundColor: "oklch(0.60 0.20 25 / 0.10)",
                      color: "oklch(0.60 0.20 25)",
                      border: "1px solid oklch(0.60 0.20 25 / 0.25)",
                    }}
                    data-ocid="profile_page.lexicon_review.clear_button"
                  >
                    {lexiconClearMsg ?? "Clear"}
                  </button>
                </>
              )}
              <ChevronDown
                className="w-4 h-4 shrink-0 transition-transform duration-200"
                style={{
                  color: "oklch(0.48 0.008 240)",
                  transform: lexiconReviewOpen
                    ? "rotate(180deg)"
                    : "rotate(0deg)",
                }}
                strokeWidth={2}
              />
            </button>

            {/* Accordion Body */}
            {lexiconReviewOpen && (
              <div className="border-t" style={{ borderColor: "#222222" }}>
                <div
                  className="max-h-[480px] overflow-y-auto px-4 py-3 flex flex-col gap-3"
                  data-ocid="profile_page.lexicon_review.list"
                >
                  {topHeadlines.length === 0 ? (
                    <p
                      className="text-[13px] leading-relaxed"
                      style={{ color: "oklch(0.52 0.012 240)" }}
                      data-ocid="profile_page.lexicon_review.empty_state"
                    >
                      No entries yet
                    </p>
                  ) : (
                    topHeadlines.map(
                      (
                        [headline, { count, indexName, suggestedDirection }],
                        i,
                      ) => (
                        <div
                          key={`lexicon-${String(i)}`}
                          className="flex flex-col gap-1.5"
                          data-ocid={`profile_page.lexicon_review.item.${String(i + 1)}`}
                        >
                          <pre
                            className="text-[11px] leading-relaxed rounded-lg p-3 font-mono"
                            style={{
                              backgroundColor: "#0d0d0d",
                              color: "oklch(0.68 0.012 240)",
                              border: "1px solid #1e1e1e",
                              whiteSpace: "pre-wrap",
                              wordBreak: "break-word",
                            }}
                          >
                            {headline}
                          </pre>
                          <div className="flex flex-row items-center gap-2 flex-wrap">
                            <span
                              className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded"
                              style={{
                                backgroundColor: "oklch(0.65 0.22 145 / 0.15)",
                                color: "oklch(0.65 0.22 145)",
                              }}
                            >
                              {indexName}
                            </span>
                            <span
                              className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded"
                              style={{
                                backgroundColor:
                                  count > 1
                                    ? "oklch(0.65 0.22 145 / 0.15)"
                                    : "oklch(0.52 0.012 240 / 0.15)",
                                color:
                                  count > 1
                                    ? "oklch(0.65 0.22 145)"
                                    : "oklch(0.52 0.012 240)",
                              }}
                            >
                              ×{count}
                            </span>
                            <span
                              className="text-[11px]"
                              style={{ color: "oklch(0.48 0.008 240)" }}
                            >
                              {suggestedDirection}
                            </span>
                          </div>
                        </div>
                      ),
                    )
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── HUGGINGFACE SETTINGS ─────────────────── */}
        <div className="mt-4" data-ocid="profile_page.admin_settings.section">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-semibold flex items-center gap-1.5">
              <Shield className="w-3 h-3" strokeWidth={2} />
              HuggingFace Settings
            </p>
          </div>

          <div className="rounded bg-white/[0.03] border border-border/50 p-3 space-y-4">
            {/* HuggingFace API key input */}
            <div>
              <label
                htmlFor="hf-key-input"
                className="block text-[10px] uppercase tracking-widest font-semibold text-muted-foreground mb-1.5"
              >
                HuggingFace API Key
              </label>
              <div className="flex gap-2">
                <input
                  id="hf-key-input"
                  type="password"
                  value={hfKeyValue}
                  onChange={(e) => setHfKeyValue(e.target.value)}
                  placeholder="Enter new API key"
                  autoComplete="off"
                  spellCheck={false}
                  data-ocid="profile_page.admin_settings.key_input"
                  className="flex-1 min-w-0 rounded border border-border/50 bg-white/[0.02] px-2.5 py-2 text-[12px] font-mono text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-green-500/50 transition-colors"
                />
                <button
                  type="button"
                  onClick={() => {
                    const trimmed = hfKeyValue.trim();
                    if (!trimmed) return;
                    setHfKeyMutation.mutate(trimmed);
                  }}
                  disabled={
                    hfKeyValue.trim().length === 0 || setHfKeyMutation.isPending
                  }
                  data-ocid="profile_page.admin_settings.submit_button"
                  className="shrink-0 rounded border border-green-500/40 bg-green-500/10 text-green-400 text-[11px] uppercase tracking-widest font-bold px-3 py-2 hover:bg-green-500/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  {setHfKeyMutation.isPending
                    ? "Saving…"
                    : setHfKeyMutation.isSuccess
                      ? "Saved"
                      : setHfKeyMutation.isError
                        ? "Error"
                        : "Save"}
                </button>
              </div>
              {setHfKeyMutation.isSuccess && (
                <p className="mt-1.5 text-[11px] text-green-400 font-mono">
                  Key updated successfully.
                </p>
              )}
              {setHfKeyMutation.isError && (
                <p className="mt-1.5 text-[11px] text-red-400 font-mono">
                  Failed to update key:{" "}
                  {setHfKeyMutation.error?.message ?? "unknown error"}
                </p>
              )}
            </div>

            {/* HuggingFace key status indicator */}
            <div>
              <p className="text-[10px] uppercase tracking-widest font-semibold text-muted-foreground mb-1.5">
                Key Status
              </p>
              <div
                className="flex items-center gap-2 rounded bg-white/[0.02] border border-border/50 px-3 py-2"
                data-ocid="profile_page.admin_settings.status"
              >
                <span
                  className={`inline-block w-1.5 h-1.5 rounded-full ${
                    hfKeyStatusQuery.data === "set"
                      ? "bg-green-400"
                      : hfKeyStatusQuery.data === "missing"
                        ? "bg-red-400"
                        : "bg-muted-foreground"
                  }`}
                />
                <span className="font-mono text-[12px] text-foreground">
                  {hfKeyStatusQuery.isLoading
                    ? "loading…"
                    : hfKeyStatusQuery.isError
                      ? "error"
                      : (hfKeyStatusQuery.data ?? "unknown")}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* ── FINNHUB SETTINGS ─────────────────── */}
        <div className="mt-4" data-ocid="profile_page.finnhub_settings.section">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-semibold flex items-center gap-1.5">
              <Newspaper className="w-3 h-3" strokeWidth={2} />
              Finnhub Settings
            </p>
          </div>

          <div className="rounded bg-white/[0.03] border border-border/50 p-3 space-y-4">
            {/* Finnhub API key input */}
            <div>
              <label
                htmlFor="finnhub-key-input"
                className="block text-[10px] uppercase tracking-widest font-semibold text-muted-foreground mb-1.5"
              >
                Finnhub API Key
              </label>
              <div className="flex gap-2">
                <input
                  id="finnhub-key-input"
                  type="password"
                  value={finnhubKeyValue}
                  onChange={(e) => setFinnhubKeyValue(e.target.value)}
                  placeholder="Enter new API key"
                  autoComplete="off"
                  spellCheck={false}
                  data-ocid="profile_page.finnhub_settings.key_input"
                  className="flex-1 min-w-0 rounded border border-border/50 bg-white/[0.02] px-2.5 py-2 text-[12px] font-mono text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-green-500/50 transition-colors"
                />
                <button
                  type="button"
                  onClick={() => {
                    const trimmed = finnhubKeyValue.trim();
                    if (!trimmed) return;
                    setFinnhubKeyMutation.mutate(trimmed);
                  }}
                  disabled={
                    finnhubKeyValue.trim().length === 0 ||
                    setFinnhubKeyMutation.isPending
                  }
                  data-ocid="profile_page.finnhub_settings.submit_button"
                  className="shrink-0 rounded border border-green-500/40 bg-green-500/10 text-green-400 text-[11px] uppercase tracking-widest font-bold px-3 py-2 hover:bg-green-500/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  {setFinnhubKeyMutation.isPending
                    ? "Saving…"
                    : setFinnhubKeyMutation.isSuccess
                      ? "Saved"
                      : setFinnhubKeyMutation.isError
                        ? "Error"
                        : "Save"}
                </button>
              </div>
              {setFinnhubKeyMutation.isSuccess && (
                <p className="mt-1.5 text-[11px] text-green-400 font-mono">
                  Key updated successfully.
                </p>
              )}
              {setFinnhubKeyMutation.isError && (
                <p className="mt-1.5 text-[11px] text-red-400 font-mono">
                  Failed to update key:{" "}
                  {setFinnhubKeyMutation.error?.message ?? "unknown error"}
                </p>
              )}
            </div>

            {/* Finnhub key status indicator */}
            <div>
              <p className="text-[10px] uppercase tracking-widest font-semibold text-muted-foreground mb-1.5">
                Key Status
              </p>
              <div
                className="flex items-center gap-2 rounded bg-white/[0.02] border border-border/50 px-3 py-2"
                data-ocid="profile_page.finnhub_settings.status"
              >
                <span
                  className={`inline-block w-1.5 h-1.5 rounded-full ${
                    finnhubKeyStatusQuery.data === "set"
                      ? "bg-green-400"
                      : finnhubKeyStatusQuery.data === "missing"
                        ? "bg-red-400"
                        : "bg-muted-foreground"
                  }`}
                />
                <span className="font-mono text-[12px] text-foreground">
                  {finnhubKeyStatusQuery.isLoading
                    ? "loading…"
                    : finnhubKeyStatusQuery.isError
                      ? "error"
                      : (finnhubKeyStatusQuery.data ?? "unknown")}
                </span>
              </div>
            </div>
          </div>
        </div>

        <DepositModal
          isOpen={isDepositOpen}
          onClose={() => setIsDepositOpen(false)}
          onConfirm={handleDepositConfirm}
        />
        {/* ── Simulation ── */}
        <div
          className="rounded-2xl overflow-hidden"
          style={{ backgroundColor: "#141414", border: "1px solid #222222" }}
          data-ocid="profile_page.simulation.panel"
        >
          {/* Accordion Header */}
          <button
            type="button"
            onClick={() => setSimulationOpen((prev) => !prev)}
            className="flex items-center gap-2 w-full px-4 py-3.5 text-left"
            data-ocid="profile_page.simulation.toggle"
          >
            <Activity
              className="w-4 h-4 shrink-0"
              style={{ color: "oklch(0.65 0.22 145)" }}
              strokeWidth={1.5}
            />
            <div className="flex-1 min-w-0">
              <span
                className="text-[11px] uppercase tracking-widest font-semibold"
                style={{ color: "oklch(0.65 0.22 145)" }}
              >
                SIMULATION
              </span>
            </div>
            <span
              className="text-[10px] font-medium px-2 py-0.5 rounded-full shrink-0"
              style={{
                backgroundColor: simRunning
                  ? "oklch(0.65 0.22 145 / 0.12)"
                  : "oklch(0.52 0.012 240 / 0.12)",
                color: simRunning
                  ? "oklch(0.65 0.22 145)"
                  : "oklch(0.52 0.012 240)",
              }}
              data-ocid="profile_page.simulation.status"
            >
              {simRunning
                ? `RUNNING · ${String(SCENARIO_PRESETS[selectedScenario]?.userCount ?? simUsers.length)}u · tick ${String(simTickCount)} · ${SIM_SPEED_MODES[simSpeedMode].label}`
                : "IDLE"}
            </span>
            {simulationOpen && (
              <>
                {!simRunning ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleStartSimulation();
                    }}
                    className="shrink-0 text-[11px] font-semibold px-2.5 py-1 rounded-lg transition-colors duration-150"
                    style={{
                      backgroundColor: "oklch(0.65 0.22 145 / 0.15)",
                      color: "oklch(0.65 0.22 145)",
                      border: "1px solid oklch(0.65 0.22 145 / 0.25)",
                    }}
                    data-ocid="profile_page.simulation.start_button"
                  >
                    Start
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleStopSimulation();
                    }}
                    className="shrink-0 text-[11px] font-semibold px-2.5 py-1 rounded-lg transition-colors duration-150"
                    style={{
                      backgroundColor: "oklch(0.60 0.20 25 / 0.10)",
                      color: "oklch(0.60 0.20 25)",
                      border: "1px solid oklch(0.60 0.20 25 / 0.25)",
                    }}
                    data-ocid="profile_page.simulation.stop_button"
                  >
                    Stop
                  </button>
                )}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleResetScenario();
                  }}
                  className="shrink-0 text-[11px] font-semibold px-2.5 py-1 rounded-lg transition-colors duration-150"
                  style={{
                    backgroundColor: "oklch(0.62 0.18 60 / 0.12)",
                    color: "oklch(0.72 0.18 60)",
                    border: "1px solid oklch(0.62 0.18 60 / 0.25)",
                  }}
                  data-ocid="profile_page.simulation.reset_button"
                >
                  Reset
                </button>
                {/* Speed Mode Toggle */}
                <div
                  className="flex items-center gap-0.5 shrink-0"
                  data-ocid="profile_page.simulation.speed_toggle"
                >
                  {(
                    Object.entries(SIM_SPEED_MODES) as [
                      SimSpeedMode,
                      (typeof SIM_SPEED_MODES)[SimSpeedMode],
                    ][]
                  ).map(([key, cfg]) => {
                    const isActive = simSpeedMode === key;
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => {
                          setSimSpeedMode(key);
                          simSpeedModeRef.current = key;
                        }}
                        className="shrink-0 text-[10px] font-semibold px-2 py-1 transition-colors duration-150"
                        style={{
                          backgroundColor: isActive
                            ? "oklch(0.65 0.22 145 / 0.18)"
                            : "oklch(0.52 0.012 240 / 0.08)",
                          color: isActive
                            ? "oklch(0.65 0.22 145)"
                            : "oklch(0.48 0.008 240)",
                          border: isActive
                            ? "1px solid oklch(0.65 0.22 145 / 0.35)"
                            : "1px solid oklch(0.52 0.012 240 / 0.15)",
                          borderRadius:
                            key === "observe"
                              ? "6px 0 0 6px"
                              : key === "stress"
                                ? "0 6px 6px 0"
                                : "0",
                          borderRight: key !== "stress" ? "none" : undefined,
                        }}
                        data-ocid={`profile_page.simulation.speed_${key}`}
                        title={cfg.label}
                      >
                        {cfg.label}
                      </button>
                    );
                  })}
                </div>
                {simRunning && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handlePanicMode();
                    }}
                    className="shrink-0 text-[11px] font-semibold px-2.5 py-1 rounded-lg transition-colors duration-150"
                    style={{
                      backgroundColor: "oklch(0.60 0.20 25 / 0.15)",
                      color: "oklch(0.60 0.20 25)",
                      border: "1px solid oklch(0.60 0.20 25 / 0.35)",
                    }}
                    data-ocid="profile_page.simulation.panic_button"
                  >
                    ⚠ Panic
                  </button>
                )}
              </>
            )}
            <ChevronDown
              className="w-4 h-4 shrink-0 transition-transform duration-200"
              style={{
                color: "oklch(0.48 0.008 240)",
                transform: simulationOpen ? "rotate(180deg)" : "rotate(0deg)",
              }}
              strokeWidth={2}
            />
          </button>

          {/* Accordion Body */}
          {simulationOpen && (
            <div className="border-t" style={{ borderColor: "#222222" }}>
              <div
                className="max-h-[800px] overflow-y-auto px-4 py-4 flex flex-col gap-4"
                data-ocid="profile_page.simulation.body"
              >
                {/* Scenario Selector */}
                <div className="flex flex-col gap-2">
                  <span
                    className="text-[10px] uppercase tracking-widest font-medium"
                    style={{ color: "oklch(0.48 0.008 240)" }}
                  >
                    Scenario
                  </span>
                  <div
                    className="flex gap-1 overflow-x-auto pb-1"
                    data-ocid="profile_page.simulation.scenario_selector"
                  >
                    {Object.values(SCENARIO_PRESETS).map((preset) => {
                      const isActive = selectedScenario === preset.id;
                      return (
                        <button
                          key={preset.id}
                          type="button"
                          onClick={() => {
                            if (simRunning) handleStopSimulation();
                            setSelectedScenario(preset.id);
                            // Fix 2B — remove the Math.min cap so preset applies full user count
                            // For scenarios 1–3 set slider within range; 4 and 5 use fixed counts
                            setSimUserCount(Math.min(preset.userCount, 100));
                            // Fix 3 — update reserve seed display when scenario changes
                            setSimReserveSeedDisplay(preset.reserveSeed);
                            crisisFiredRef.current = false;
                            setCrisisMetrics({
                              status: "pending",
                              scoreDeclineMagnitude: 0,
                              simultaneousRedemptions: 0,
                              staggeredQueueDepth: 0,
                              peakCoverageRatio: 1.0,
                              lowestCoverageRatio: 99.0,
                              recoveryTicks: 0,
                            });
                          }}
                          className="shrink-0 text-[10px] font-semibold px-2.5 py-1 rounded-lg transition-colors duration-150 whitespace-nowrap"
                          style={{
                            backgroundColor: isActive
                              ? "oklch(0.65 0.22 145 / 0.18)"
                              : "oklch(0.52 0.012 240 / 0.08)",
                            color: isActive
                              ? "oklch(0.65 0.22 145)"
                              : "oklch(0.52 0.012 240)",
                            border: isActive
                              ? "1px solid oklch(0.65 0.22 145 / 0.35)"
                              : "1px solid #333",
                          }}
                          data-ocid={`profile_page.simulation.scenario.${preset.id}`}
                        >
                          {preset.shortName}
                        </button>
                      );
                    })}
                  </div>
                  {/* Scenario description */}
                  <p
                    className="text-[10px] leading-relaxed"
                    style={{ color: "oklch(0.48 0.008 240)" }}
                  >
                    {SCENARIO_PRESETS[selectedScenario]?.description}
                  </p>
                </div>

                {/* User Count Slider — only for scenarios 1–3 */}
                {!simRunning &&
                  (selectedScenario === "scenario1" ||
                    selectedScenario === "scenario2" ||
                    selectedScenario === "scenario3") && (
                    <div className="flex flex-col gap-1.5">
                      <div className="flex items-center justify-between">
                        <span
                          className="text-[11px] uppercase tracking-widest font-medium"
                          style={{ color: "oklch(0.52 0.012 240)" }}
                        >
                          Mock Users
                        </span>
                        <span
                          className="text-[11px] font-mono font-semibold px-2 py-0.5 rounded-full"
                          style={{
                            backgroundColor: "oklch(0.65 0.22 145 / 0.12)",
                            color: "oklch(0.65 0.22 145)",
                          }}
                          data-ocid="profile_page.simulation.user_count_display"
                        >
                          {String(simUserCount)}
                        </span>
                      </div>
                      <input
                        type="range"
                        min={2}
                        max={100}
                        step={1}
                        value={simUserCount}
                        onChange={(e) =>
                          setSimUserCount(Number(e.target.value))
                        }
                        className="w-full h-1 rounded-full appearance-none cursor-pointer"
                        style={{
                          accentColor: "oklch(0.65 0.22 145)",
                          backgroundColor: "#1e1e1e",
                        }}
                        data-ocid="profile_page.simulation.user_count_slider"
                      />
                      <div className="flex justify-between">
                        <span
                          className="text-[10px]"
                          style={{ color: "oklch(0.38 0.008 240)" }}
                        >
                          2
                        </span>
                        <span
                          className="text-[10px]"
                          style={{ color: "oklch(0.38 0.008 240)" }}
                        >
                          100
                        </span>
                      </div>
                    </div>
                  )}
                {/* Locked user count for scenarios 4 & 5 */}
                {!simRunning &&
                  (selectedScenario === "scenario4" ||
                    selectedScenario === "scenario5") && (
                    <div
                      className="rounded-xl px-3 py-2 flex items-center gap-2"
                      style={{
                        backgroundColor: "#0d0d0d",
                        border: "1px solid #1e1e1e",
                      }}
                    >
                      <span
                        className="text-[10px] uppercase tracking-widest"
                        style={{ color: "oklch(0.48 0.008 240)" }}
                      >
                        Users
                      </span>
                      <span
                        className="text-[11px] font-mono font-semibold ml-auto"
                        style={{ color: "oklch(0.65 0.22 145)" }}
                      >
                        {SCENARIO_PRESETS[
                          selectedScenario
                        ]?.userCount.toLocaleString()}{" "}
                        (locked to preset)
                      </span>
                    </div>
                  )}

                {/* Scenario 4: Pool Coverage Ratio prominent display */}
                {selectedScenario === "scenario4" && simRunning && (
                  <div
                    className="rounded-xl px-4 py-3 flex items-center justify-between"
                    style={{
                      backgroundColor:
                        extMetrics.liquidityCoverageRatio < 1.0
                          ? "oklch(0.60 0.20 25 / 0.10)"
                          : "oklch(0.65 0.22 145 / 0.10)",
                      border:
                        extMetrics.liquidityCoverageRatio < 1.0
                          ? "1px solid oklch(0.60 0.20 25 / 0.35)"
                          : "1px solid #1e1e1e",
                    }}
                    data-ocid="profile_page.simulation.pool_coverage_prominent"
                  >
                    <span
                      className="text-[10px] uppercase tracking-widest"
                      style={{ color: "oklch(0.48 0.008 240)" }}
                    >
                      Pool Coverage Ratio
                    </span>
                    <span
                      className="text-[22px] font-bold font-mono"
                      style={{
                        color:
                          extMetrics.liquidityCoverageRatio < 1.0
                            ? "oklch(0.60 0.20 25)"
                            : "oklch(0.65 0.22 145)",
                      }}
                    >
                      {extMetrics.liquidityCoverageRatio.toFixed(2)}x
                    </span>
                  </div>
                )}

                {/* ── METRICS DASHBOARD ── */}

                {/* Section 1: Revenue Metrics */}
                <div
                  className="rounded-xl p-3 flex flex-col gap-2"
                  style={{
                    backgroundColor: "#0d0d0d",
                    border: "1px solid #1e1e1e",
                  }}
                  data-ocid="profile_page.simulation.revenue_metrics"
                >
                  <span
                    className="text-[10px] uppercase tracking-widest font-semibold"
                    style={{ color: "oklch(0.65 0.22 145)" }}
                  >
                    Revenue
                  </span>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                    {(
                      [
                        {
                          label: "Cumulative Spread",
                          value: `$${simMetrics.totalSpread.toFixed(2)}`,
                          green: true,
                        },
                        {
                          label: "Spread / Tick (10-avg)",
                          value: `$${extMetrics.spreadRevPerTick.toFixed(2)}`,
                          green: false,
                        },
                        {
                          label: "Spread / User",
                          value: `$${extMetrics.spreadRevPerUser.toFixed(2)}`,
                          green: false,
                        },
                        {
                          label: "Membership Revenue",
                          value: `$${extMetrics.membershipRevenue.toFixed(2)}`,
                          green: false,
                        },
                        {
                          label: "Total Platform Rev",
                          value: `$${extMetrics.totalPlatformRevenue.toFixed(2)}`,
                          green: true,
                        },
                      ] as const
                    ).map((m) => (
                      <div key={m.label} className="flex flex-col gap-0">
                        <span
                          className="text-[9px] uppercase tracking-widest"
                          style={{ color: "oklch(0.42 0.008 240)" }}
                        >
                          {m.label}
                        </span>
                        <span
                          className="text-[13px] font-mono font-semibold"
                          style={{
                            color: m.green ? "oklch(0.65 0.22 145)" : "#fff",
                          }}
                        >
                          {m.value}
                        </span>
                      </div>
                    ))}
                    {selectedScenario === "scenario5" && (
                      <div className="flex flex-col gap-0">
                        <span
                          className="text-[9px] uppercase tracking-widest"
                          style={{ color: "oklch(0.42 0.008 240)" }}
                        >
                          Institutional API
                        </span>
                        <span
                          className="text-[13px] font-mono font-semibold"
                          style={{ color: "oklch(0.72 0.18 60)" }}
                        >
                          ${extMetrics.institutionalAPIRevenue.toLocaleString()}
                          /mo
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Section 2: Liquidity Metrics */}
                <div
                  className="rounded-xl p-3 flex flex-col gap-2"
                  style={{
                    backgroundColor: "#0d0d0d",
                    border: "1px solid #1e1e1e",
                  }}
                  data-ocid="profile_page.simulation.liquidity_metrics"
                >
                  <span
                    className="text-[10px] uppercase tracking-widest font-semibold"
                    style={{ color: "oklch(0.65 0.22 145)" }}
                  >
                    Liquidity
                  </span>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                    <div className="flex flex-col gap-0">
                      <span
                        className="text-[9px] uppercase tracking-widest"
                        style={{ color: "oklch(0.42 0.008 240)" }}
                      >
                        Capital Deployed
                      </span>
                      <span
                        className="text-[13px] font-mono font-semibold"
                        style={{ color: "#fff" }}
                      >
                        ${extMetrics.totalCapitalDeployed.toFixed(0)}
                      </span>
                    </div>
                    <div className="flex flex-col gap-0">
                      <span
                        className="text-[9px] uppercase tracking-widest"
                        style={{ color: "oklch(0.42 0.008 240)" }}
                      >
                        Redemption Liability
                      </span>
                      <span
                        className="text-[13px] font-mono font-semibold"
                        style={{ color: "#fff" }}
                      >
                        ${extMetrics.totalRedemptionLiability.toFixed(0)}
                      </span>
                    </div>
                    <div className="flex flex-col gap-0">
                      <span
                        className="text-[9px] uppercase tracking-widest"
                        style={{ color: "oklch(0.42 0.008 240)" }}
                      >
                        Coverage Ratio
                      </span>
                      <span
                        className="text-[13px] font-mono font-semibold"
                        style={{
                          color:
                            extMetrics.liquidityCoverageRatio < 1.0
                              ? "oklch(0.60 0.20 25)"
                              : "oklch(0.65 0.22 145)",
                        }}
                        data-ocid="profile_page.simulation.coverage_ratio"
                      >
                        {extMetrics.liquidityCoverageRatio.toFixed(3)}x
                      </span>
                    </div>
                    <div className="flex flex-col gap-0">
                      <span
                        className="text-[9px] uppercase tracking-widest"
                        style={{ color: "oklch(0.42 0.008 240)" }}
                      >
                        Pool Utilization
                      </span>
                      <span
                        className="text-[13px] font-mono font-semibold"
                        style={{ color: "#fff" }}
                      >
                        {extMetrics.poolUtilizationPct.toFixed(1)}%
                      </span>
                      {redemptionQueueDepth > 0 && (
                        <span
                          className="text-[10px] font-mono mt-0.5"
                          style={{ color: "oklch(0.60 0.20 25)" }}
                        >
                          REDEMPTION QUEUE:{" "}
                          <span style={{ color: "#fff" }}>
                            {String(redemptionQueueDepth)}
                          </span>
                        </span>
                      )}
                      {redemptionQueueDepth === 0 && (
                        <span
                          className="text-[10px] font-mono mt-0.5"
                          style={{ color: "oklch(0.42 0.008 240)" }}
                        >
                          REDEMPTION QUEUE:{" "}
                          <span style={{ color: "#fff" }}>0</span>
                        </span>
                      )}
                    </div>
                    <div className="flex flex-col gap-0">
                      <span
                        className="text-[9px] uppercase tracking-widest"
                        style={{ color: "oklch(0.42 0.008 240)" }}
                      >
                        Reserve Buffer
                      </span>
                      <span
                        className="text-[13px] font-mono font-semibold"
                        style={{ color: "#fff" }}
                      >
                        ${extMetrics.reserveBuffer.toFixed(0)}
                      </span>
                    </div>
                    <div className="flex flex-col gap-0">
                      <span
                        className="text-[9px] uppercase tracking-widest"
                        style={{ color: "oklch(0.42 0.008 240)" }}
                      >
                        Reserve Seed
                      </span>
                      <span
                        className="text-[13px] font-mono font-semibold"
                        style={{ color: "oklch(0.72 0.18 60)" }}
                        data-ocid="profile_page.simulation.reserve_seed"
                      >
                        RESERVE SEED: ${simReserveSeedDisplay.toLocaleString()}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Section 3: User Behavior Metrics */}
                <div
                  className="rounded-xl p-3 flex flex-col gap-2"
                  style={{
                    backgroundColor: "#0d0d0d",
                    border: "1px solid #1e1e1e",
                  }}
                  data-ocid="profile_page.simulation.behavior_metrics"
                >
                  <span
                    className="text-[10px] uppercase tracking-widest font-semibold"
                    style={{ color: "oklch(0.65 0.22 145)" }}
                  >
                    User Behavior
                  </span>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                    <div className="flex flex-col gap-0">
                      <span
                        className="text-[9px] uppercase tracking-widest"
                        style={{ color: "oklch(0.42 0.008 240)" }}
                      >
                        Avg Hold Duration
                      </span>
                      <span
                        className="text-[13px] font-mono font-semibold"
                        style={{ color: "#fff" }}
                      >
                        {extMetrics.avgHoldDuration.toFixed(1)} sim-days
                      </span>
                    </div>
                    <div className="flex flex-col gap-0">
                      <span
                        className="text-[9px] uppercase tracking-widest"
                        style={{ color: "oklch(0.42 0.008 240)" }}
                      >
                        Redeem Freq / Tick
                      </span>
                      <span
                        className="text-[13px] font-mono font-semibold"
                        style={{ color: "#fff" }}
                      >
                        {extMetrics.redemptionFrequency.toFixed(1)}
                      </span>
                    </div>
                    <div className="flex flex-col gap-0">
                      <span
                        className="text-[9px] uppercase tracking-widest"
                        style={{ color: "oklch(0.42 0.008 240)" }}
                      >
                        Panic Events
                      </span>
                      <span
                        className="text-[13px] font-mono font-semibold"
                        style={{ color: "oklch(0.60 0.20 25)" }}
                      >
                        {String(simMetrics.panicCount)}
                      </span>
                    </div>
                    <div className="flex flex-col gap-0">
                      <span
                        className="text-[9px] uppercase tracking-widest"
                        style={{ color: "oklch(0.42 0.008 240)" }}
                      >
                        Loyalty Tiers
                      </span>
                      <span
                        className="text-[11px] font-mono"
                        style={{ color: "#fff" }}
                      >
                        <span
                          style={{
                            display: "inline-block",
                            width: "8px",
                            height: "8px",
                            borderRadius: "50%",
                            backgroundColor: "#cd7f32",
                            marginRight: "3px",
                            verticalAlign: "middle",
                          }}
                        />
                        {String(extMetrics.loyaltyTiers.bronze)}{" "}
                        <span
                          style={{
                            display: "inline-block",
                            width: "8px",
                            height: "8px",
                            borderRadius: "50%",
                            backgroundColor: "#a8a9ad",
                            marginRight: "3px",
                            marginLeft: "4px",
                            verticalAlign: "middle",
                          }}
                        />
                        {String(extMetrics.loyaltyTiers.silver)}{" "}
                        <span
                          style={{
                            display: "inline-block",
                            width: "8px",
                            height: "8px",
                            borderRadius: "50%",
                            backgroundColor: "#ffd700",
                            marginRight: "3px",
                            marginLeft: "4px",
                            verticalAlign: "middle",
                          }}
                        />
                        {String(extMetrics.loyaltyTiers.gold)}{" "}
                        <span
                          style={{
                            display: "inline-block",
                            width: "8px",
                            height: "8px",
                            borderRadius: "50%",
                            backgroundColor: "#9b59b6",
                            marginRight: "3px",
                            marginLeft: "4px",
                            verticalAlign: "middle",
                          }}
                        />
                        {String(extMetrics.loyaltyTiers.obsidian)}
                      </span>
                    </div>
                  </div>
                  {/* Active Positions by Profile */}
                  {Object.keys(extMetrics.activePositionsByProfile).length >
                    0 && (
                    <div className="flex flex-col gap-1 mt-1">
                      <span
                        className="text-[9px] uppercase tracking-widest"
                        style={{ color: "oklch(0.42 0.008 240)" }}
                      >
                        Active Positions by Profile
                      </span>
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                        {Object.entries(
                          extMetrics.activePositionsByProfile,
                        ).map(([prof, data]) => (
                          <span
                            key={prof}
                            className="text-[10px] font-mono"
                            style={{ color: "oklch(0.65 0.22 145)" }}
                          >
                            {PROFILE_LABELS[prof as BehaviorProfile] ?? prof}:{" "}
                            {String(data.count)} ({data.pct.toFixed(0)}%)
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Section 4: Crisis Metrics — only for Scenario 4 */}
                {selectedScenario === "scenario4" && (
                  <div
                    className="rounded-xl p-3 flex flex-col gap-2"
                    style={{
                      backgroundColor: "#0d0d0d",
                      border:
                        crisisMetrics.status === "triggered"
                          ? "1px solid oklch(0.60 0.20 25 / 0.5)"
                          : "1px solid #1e1e1e",
                    }}
                    data-ocid="profile_page.simulation.crisis_metrics"
                  >
                    <span
                      className="text-[10px] uppercase tracking-widest font-semibold"
                      style={{ color: "oklch(0.60 0.20 25)" }}
                    >
                      Crisis Event
                    </span>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                      <div className="flex flex-col gap-0">
                        <span
                          className="text-[9px] uppercase tracking-widest"
                          style={{ color: "oklch(0.42 0.008 240)" }}
                        >
                          Status
                        </span>
                        <span
                          className="text-[13px] font-mono font-semibold uppercase"
                          style={{
                            color:
                              crisisMetrics.status === "triggered"
                                ? "oklch(0.60 0.20 25)"
                                : crisisMetrics.status === "resolved"
                                  ? "oklch(0.65 0.22 145)"
                                  : "oklch(0.52 0.012 240)",
                          }}
                          data-ocid="profile_page.simulation.crisis_status"
                        >
                          {crisisMetrics.status}
                        </span>
                      </div>
                      <div className="flex flex-col gap-0">
                        <span
                          className="text-[9px] uppercase tracking-widest"
                          style={{ color: "oklch(0.42 0.008 240)" }}
                        >
                          Score Decline
                        </span>
                        <span
                          className="text-[13px] font-mono font-semibold"
                          style={{
                            color:
                              crisisMetrics.scoreDeclineMagnitude > 0
                                ? "oklch(0.60 0.20 25)"
                                : "oklch(0.52 0.012 240)",
                          }}
                        >
                          {crisisMetrics.scoreDeclineMagnitude > 0
                            ? `-${String(crisisMetrics.scoreDeclineMagnitude)} pts`
                            : "—"}
                        </span>
                      </div>
                      <div className="flex flex-col gap-0">
                        <span
                          className="text-[9px] uppercase tracking-widest"
                          style={{ color: "oklch(0.42 0.008 240)" }}
                        >
                          Simultaneous Redeems
                        </span>
                        <span
                          className="text-[13px] font-mono font-semibold"
                          style={{ color: "#fff" }}
                        >
                          {String(crisisMetrics.simultaneousRedemptions)}
                        </span>
                      </div>
                      <div className="flex flex-col gap-0">
                        <span
                          className="text-[9px] uppercase tracking-widest"
                          style={{ color: "oklch(0.42 0.008 240)" }}
                        >
                          Staggered Queue
                        </span>
                        <span
                          className="text-[13px] font-mono font-semibold"
                          style={{ color: "#fff" }}
                        >
                          {String(crisisMetrics.staggeredQueueDepth)}
                        </span>
                      </div>
                      <div className="flex flex-col gap-0">
                        <span
                          className="text-[9px] uppercase tracking-widest"
                          style={{ color: "oklch(0.42 0.008 240)" }}
                        >
                          Lowest Coverage
                        </span>
                        <span
                          className="text-[13px] font-mono font-semibold"
                          style={{
                            color:
                              crisisMetrics.lowestCoverageRatio < 1.0
                                ? "oklch(0.60 0.20 25)"
                                : "oklch(0.65 0.22 145)",
                          }}
                        >
                          {crisisMetrics.lowestCoverageRatio < 99
                            ? `${crisisMetrics.lowestCoverageRatio.toFixed(3)}x`
                            : "—"}
                        </span>
                      </div>
                      <div className="flex flex-col gap-0">
                        <span
                          className="text-[9px] uppercase tracking-widest"
                          style={{ color: "oklch(0.42 0.008 240)" }}
                        >
                          Recovery Ticks
                        </span>
                        <span
                          className="text-[13px] font-mono font-semibold"
                          style={{ color: "#fff" }}
                        >
                          {String(crisisMetrics.recoveryTicks)}
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Mock Users Table */}
                {simRunning && (
                  <div>
                    <p
                      className="text-[10px] uppercase tracking-widest mb-2"
                      style={{ color: "oklch(0.48 0.008 240)" }}
                    >
                      Mock Users
                    </p>
                    {simUsers.length > 0 ? (
                      <div
                        className="flex flex-col gap-1"
                        data-ocid="profile_page.simulation.users_list"
                      >
                        {simUsers.slice(0, 20).map((user, i) => {
                          const posValue = user.positions.reduce(
                            (s, p) => s + p.shares * getBuyPrice(p.indexName),
                            0,
                          );
                          const pnl =
                            posValue + user.totalRedeemed - user.totalAllocated;
                          return (
                            <div
                              key={user.id}
                              className="flex items-center gap-2 py-1.5 border-b last:border-b-0"
                              style={{ borderColor: "#1e1e1e" }}
                              data-ocid={`profile_page.simulation.user.${String(i + 1)}`}
                            >
                              <span
                                className="text-[10px] font-mono shrink-0"
                                style={{ color: "oklch(0.48 0.008 240)" }}
                              >
                                {user.id}
                              </span>
                              <span
                                className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded shrink-0"
                                style={{
                                  backgroundColor:
                                    "oklch(0.65 0.22 145 / 0.12)",
                                  color: "oklch(0.65 0.22 145)",
                                }}
                              >
                                {PROFILE_LABELS[user.profile]}
                              </span>
                              {user.isMember && (
                                <span
                                  className="text-[9px] px-1 py-0.5 rounded shrink-0"
                                  style={{
                                    backgroundColor:
                                      "oklch(0.72 0.18 60 / 0.12)",
                                    color: "oklch(0.72 0.18 60)",
                                  }}
                                >
                                  MBR
                                </span>
                              )}
                              <span
                                className="text-[10px] font-mono shrink-0"
                                style={{ color: "oklch(0.52 0.012 240)" }}
                              >
                                {String(user.positions.length)} pos
                              </span>
                              <span
                                className="text-[10px] font-mono shrink-0 ml-auto"
                                style={{
                                  color:
                                    pnl >= 0
                                      ? "oklch(0.65 0.22 145)"
                                      : "oklch(0.60 0.20 25)",
                                }}
                              >
                                {pnl >= 0 ? "+" : ""}
                                {pnl.toFixed(1)}
                              </span>
                            </div>
                          );
                        })}
                        {simUsers.length > 20 && (
                          <p
                            className="text-[10px] text-center pt-1"
                            style={{ color: "oklch(0.42 0.008 240)" }}
                          >
                            +{String(simUsers.length - 20)} more users
                          </p>
                        )}
                      </div>
                    ) : (
                      <div
                        className="rounded-xl px-3 py-2"
                        style={{
                          backgroundColor: "oklch(0.65 0.22 145 / 0.05)",
                          border: "1px solid oklch(0.65 0.22 145 / 0.15)",
                        }}
                      >
                        <p
                          className="text-[10px] font-mono"
                          style={{ color: "oklch(0.65 0.22 145)" }}
                        >
                          {SCENARIO_PRESETS[
                            selectedScenario
                          ]?.userCount.toLocaleString()}{" "}
                          users active — showing profile summary only
                          (large-scale scenario)
                        </p>
                        {Object.keys(extMetrics.activePositionsByProfile)
                          .length > 0 && (
                          <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
                            {Object.entries(
                              extMetrics.activePositionsByProfile,
                            ).map(([prof, data]) => (
                              <span
                                key={prof}
                                className="text-[10px] font-mono"
                                style={{ color: "oklch(0.52 0.012 240)" }}
                              >
                                {PROFILE_LABELS[prof as BehaviorProfile] ??
                                  prof}
                                : {String(data.count)} pos
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Spread by Index */}
                {Object.keys(simMetrics.spreadByIndex).length > 0 && (
                  <div>
                    <p
                      className="text-[10px] uppercase tracking-widest mb-2"
                      style={{ color: "oklch(0.48 0.008 240)" }}
                    >
                      Spread by Index
                    </p>
                    <div className="flex flex-col gap-1">
                      {Object.entries(simMetrics.spreadByIndex)
                        .sort(([, a], [, b]) => b - a)
                        .map(([indexName, spread]) => (
                          <div
                            key={indexName}
                            className="flex items-center justify-between py-1 border-b last:border-b-0"
                            style={{ borderColor: "#1e1e1e" }}
                          >
                            <span
                              className="text-[11px] truncate"
                              style={{ color: "oklch(0.68 0.012 240)" }}
                            >
                              {indexName}
                            </span>
                            <span
                              className="text-[11px] font-mono font-semibold shrink-0 ml-3"
                              style={{ color: "oklch(0.65 0.22 145)" }}
                            >
                              ${spread.toFixed(2)}
                            </span>
                          </div>
                        ))}
                    </div>
                  </div>
                )}

                {/* Transaction Log */}
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <p
                      className="text-[10px] uppercase tracking-widest flex-1"
                      style={{ color: "oklch(0.48 0.008 240)" }}
                    >
                      Transaction Log ({String(simTxLog.length)})
                    </p>
                    {simTxLog.length > 0 && (
                      <button
                        type="button"
                        onClick={handleExportSimCsv}
                        className="text-[11px] font-medium px-3 py-1 rounded-lg transition-colors duration-150 shrink-0"
                        style={{
                          backgroundColor: "oklch(0.65 0.22 145 / 0.12)",
                          color: "oklch(0.65 0.22 145)",
                          border: "1px solid oklch(0.65 0.22 145 / 0.25)",
                        }}
                        data-ocid="profile_page.simulation.export_csv_button"
                      >
                        {simExportMsg ?? "Export CSV"}
                      </button>
                    )}
                  </div>
                  {/* Profile Filter Pills */}
                  {simTxLog.length > 0 && (
                    <div
                      className="flex flex-wrap gap-1 mb-2"
                      data-ocid="profile_page.simulation.filter_row"
                    >
                      {(
                        ["all", ...PROFILES] as Array<BehaviorProfile | "all">
                      ).map((p) => {
                        const label = p === "all" ? "All" : PROFILE_LABELS[p];
                        const isActive = simTxFilter === p;
                        return (
                          <button
                            key={p}
                            type="button"
                            onClick={() => setSimTxFilter(p)}
                            className="text-[10px] font-medium px-2 py-0.5 rounded-full cursor-pointer transition-colors duration-100"
                            style={{
                              backgroundColor: isActive
                                ? "oklch(0.65 0.22 145 / 0.18)"
                                : "transparent",
                              color: isActive
                                ? "oklch(0.65 0.22 145)"
                                : "oklch(0.48 0.008 240)",
                              border: isActive
                                ? "1px solid oklch(0.65 0.22 145 / 0.35)"
                                : "1px solid #333",
                            }}
                            data-ocid={`profile_page.simulation.filter.${p}`}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  {simTxLog.length === 0 ? (
                    <p
                      className="text-[11px]"
                      style={{ color: "oklch(0.48 0.008 240)" }}
                      data-ocid="profile_page.simulation.tx_empty_state"
                    >
                      No transactions yet. Start the simulation to generate
                      activity.
                    </p>
                  ) : (
                    <div
                      className="flex flex-col gap-0"
                      data-ocid="profile_page.simulation.tx_list"
                    >
                      {simTxLog
                        .filter(
                          (tx) =>
                            simTxFilter === "all" || tx.profile === simTxFilter,
                        )
                        .slice(0, 50)
                        .map((tx, i) => {
                          const timeStr = new Date(
                            tx.timestamp,
                          ).toLocaleTimeString("en-US", {
                            hour: "numeric",
                            minute: "2-digit",
                            second: "2-digit",
                          });
                          const isCrisis =
                            tx.triggerReason.includes("CRISIS") ||
                            tx.triggerReason.includes("PANIC") ||
                            tx.triggerReason.includes("Stagger");
                          return (
                            <div
                              key={tx.id}
                              className="flex items-start gap-2 py-1.5 border-b last:border-b-0"
                              style={{ borderColor: "#1e1e1e" }}
                              data-ocid={`profile_page.simulation.tx.${String(i + 1)}`}
                            >
                              <span
                                className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded shrink-0 mt-0.5"
                                style={{
                                  backgroundColor:
                                    tx.type === "allocate"
                                      ? "oklch(0.65 0.22 145 / 0.15)"
                                      : isCrisis
                                        ? "oklch(0.60 0.20 25 / 0.20)"
                                        : "oklch(0.60 0.20 25 / 0.12)",
                                  color:
                                    tx.type === "allocate"
                                      ? "oklch(0.65 0.22 145)"
                                      : "oklch(0.60 0.20 25)",
                                }}
                              >
                                {tx.type === "allocate" ? "ALLOC" : "REDEEM"}
                              </span>
                              <div className="flex flex-col min-w-0 flex-1">
                                <span
                                  className="text-[11px] truncate"
                                  style={{ color: "oklch(0.68 0.012 240)" }}
                                >
                                  {tx.userId} — {tx.indexName}
                                </span>
                                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                  <span
                                    className="text-[10px] font-mono"
                                    style={{ color: "oklch(0.52 0.012 240)" }}
                                  >
                                    ${tx.amount.toFixed(2)} @{" "}
                                    {tx.price.toFixed(2)}
                                  </span>
                                  {tx.spread > 0 && (
                                    <span
                                      className="text-[10px] font-mono"
                                      style={{ color: "oklch(0.65 0.22 145)" }}
                                    >
                                      +${tx.spread.toFixed(2)} spread
                                    </span>
                                  )}
                                  {isCrisis && (
                                    <span
                                      className="text-[10px]"
                                      style={{ color: "oklch(0.60 0.20 25)" }}
                                    >
                                      {tx.triggerReason}
                                    </span>
                                  )}
                                  <span
                                    className="text-[9px] font-mono"
                                    style={{ color: "oklch(0.38 0.008 240)" }}
                                  >
                                    t{String(tx.tickId)}
                                  </span>
                                </div>
                              </div>
                              <span
                                className="text-[10px] font-mono shrink-0"
                                style={{ color: "oklch(0.48 0.008 240)" }}
                              >
                                {timeStr}
                              </span>
                            </div>
                          );
                        })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── HISTORY VIEW ─────────────────────────────────────────────────────────────
  if (activeView === "history") {
    return (
      <AnimatePresence mode="wait">
        <motion.div
          key="history"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3, ease: "easeOut" }}
          className="w-full max-w-2xl mx-auto px-4 py-6"
          style={{ fontFamily: "'Inter', system-ui, sans-serif" }}
          data-ocid="profile_page.history"
        >
          {/* Sub-header */}
          <div className="flex items-center gap-3 mb-5">
            <button
              type="button"
              onClick={() => setActiveView("main")}
              className="flex items-center gap-1.5 transition-colors duration-150"
              style={{ color: "oklch(0.52 0.012 240)" }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = "#ffffff";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = "oklch(0.52 0.012 240)";
              }}
            >
              <ChevronLeft className="w-4 h-4" strokeWidth={2} />
              <span className="text-[10px] uppercase tracking-widest font-semibold">
                Back
              </span>
            </button>
            <span
              className="text-[13px] font-semibold"
              style={{ color: "#ffffff" }}
            >
              Activity
            </span>
          </div>

          <div
            style={{
              height: "1px",
              backgroundColor: "#1C1C1E",
              marginBottom: "16px",
            }}
          />

          {activityHistory.length === 0 && activityTxs.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 py-16">
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
                      data-ocid="profile_page.activity.item"
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
                        e.currentTarget.style.backgroundColor = "transparent";
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
        </motion.div>
      </AnimatePresence>
    );
  }

  // ── TX DETAIL VIEW ────────────────────────────────────────────────────────────
  if (activeView === "tx-detail" && selectedEntry) {
    return (
      <div
        className="w-full max-w-2xl mx-auto px-4 py-6"
        style={{ fontFamily: "'Inter', system-ui, sans-serif" }}
        data-ocid="profile_page.tx_detail"
      >
        <div className="flex items-center gap-3 mb-5">
          <button
            type="button"
            onClick={() => setActiveView("history")}
            className="flex items-center gap-1.5 transition-colors duration-150"
            style={{ color: "oklch(0.52 0.012 240)" }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = "#ffffff";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = "oklch(0.52 0.012 240)";
            }}
          >
            <ChevronLeft className="w-4 h-4" strokeWidth={2} />
            <span className="text-[10px] uppercase tracking-widest font-semibold">
              Back
            </span>
          </button>
          <span
            className="text-[13px] font-semibold"
            style={{ color: "#ffffff" }}
          >
            Order Details
          </span>
        </div>

        <div
          style={{
            height: "1px",
            backgroundColor: "#1C1C1E",
            marginBottom: "24px",
          }}
        />

        <div className="flex items-center gap-3 mb-6">
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center shrink-0"
            style={{
              backgroundColor:
                selectedEntry.type === "Spend"
                  ? "rgba(100,180,255,0.1)"
                  : "rgba(100,220,130,0.1)",
            }}
          >
            <Clock
              className="w-4 h-4"
              style={{ color: activityEntryColor(selectedEntry) }}
              strokeWidth={1.5}
            />
          </div>
          <div>
            <p className="text-base font-semibold" style={{ color: "#ffffff" }}>
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

        <div
          className="rounded-2xl overflow-hidden"
          style={{ backgroundColor: "#111111", border: "1px solid #1e1e1e" }}
        >
          <div
            className="flex items-start justify-between px-4 py-4"
            style={{ borderBottom: "1px solid #1a1a1a" }}
          >
            <span
              className="text-[13px]"
              style={{ color: "oklch(0.50 0.008 240)" }}
            >
              Date &amp; Time Filled
            </span>
            <span
              className="text-[13px] font-medium text-right"
              style={{ color: "#ffffff", maxWidth: "55%" }}
            >
              {new Date(selectedEntry.timestamp).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}{" "}
              <span
                className="font-mono"
                style={{ color: "oklch(0.65 0.008 240)", fontSize: "12px" }}
              >
                {new Date(selectedEntry.timestamp).toLocaleTimeString("en-US", {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                })}
              </span>
            </span>
          </div>

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
                    Units
                    <br />
                    <span
                      style={{
                        color: "oklch(0.50 0.008 240)",
                        fontSize: "11px",
                      }}
                    >
                      @ $
                      {selectedEntry.pricePerUnit.toLocaleString("en-US", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}{" "}
                      / unit
                    </span>
                  </>
                ) : (
                  <span style={{ color: "oklch(0.40 0.008 240)" }}>—</span>
                )}
              </span>
            </div>
          )}
        </div>

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
    );
  }

  // ── TAX VIEW ─────────────────────────────────────────────────────────────────
  if (activeView === "tax") {
    return (
      <AnimatePresence mode="wait">
        <motion.div
          key="tax"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3, ease: "easeOut" }}
          className="w-full max-w-2xl mx-auto px-4 py-6"
          style={{ fontFamily: "'Inter', system-ui, sans-serif" }}
          data-ocid="profile_page.tax"
        >
          <div className="flex items-center gap-3 mb-5">
            <button
              type="button"
              onClick={() => setActiveView("main")}
              className="flex items-center gap-1.5 transition-colors duration-150"
              style={{ color: "oklch(0.52 0.012 240)" }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = "#ffffff";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = "oklch(0.52 0.012 240)";
              }}
            >
              <ChevronLeft className="w-4 h-4" strokeWidth={2} />
              <span className="text-[10px] uppercase tracking-widest font-semibold">
                Back
              </span>
            </button>
            <span
              className="text-[13px] font-semibold"
              style={{ color: "#ffffff" }}
            >
              Tax Center
            </span>
          </div>
          <div
            style={{
              height: "1px",
              backgroundColor: "#1C1C1E",
              marginBottom: "24px",
            }}
          />
          <div className="flex flex-col items-center justify-center gap-3 py-16">
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
      </AnimatePresence>
    );
  }

  // ── LEGAL VIEW ────────────────────────────────────────────────────────────────
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key="legal"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
        className="w-full max-w-2xl mx-auto px-4 py-6"
        style={{ fontFamily: "'Inter', system-ui, sans-serif" }}
        data-ocid="profile_page.legal"
      >
        <div className="flex items-center gap-3 mb-5">
          <button
            type="button"
            onClick={() => setActiveView("main")}
            className="flex items-center gap-1.5 transition-colors duration-150"
            style={{ color: "oklch(0.52 0.012 240)" }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = "#ffffff";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = "oklch(0.52 0.012 240)";
            }}
          >
            <ChevronLeft className="w-4 h-4" strokeWidth={2} />
            <span className="text-[10px] uppercase tracking-widest font-semibold">
              Back
            </span>
          </button>
          <span
            className="text-[13px] font-semibold"
            style={{ color: "#ffffff" }}
          >
            Legal &amp; Disclosures
          </span>
        </div>
        <div
          style={{
            height: "1px",
            backgroundColor: "#1C1C1E",
            marginBottom: "24px",
          }}
        />
        <div className="flex flex-col items-center justify-center gap-3 py-16">
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
    </AnimatePresence>
  );
}
