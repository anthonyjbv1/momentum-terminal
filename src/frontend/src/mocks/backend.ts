/* eslint-disable */
// @ts-nocheck
//
// Visual QA mock backend.
// Enabled by running the dev server with VITE_USE_MOCK=true.
// Mirrors the backendInterface shape from src/backend.d.ts so the frontend
// can render realistic LMSR-priced asset rows and the Oracle Health Panel
// subsidy reserve section without a live canister.
//
// NOTE: This file is intentionally permissive (@ts-nocheck + eslint-disable)
// because it is generated tooling, not shipped application code.

import type { backendInterface } from "../backend";

// ── Sample data ──────────────────────────────────────────────────────────────

// Per-index platform allocations used to derive LMSR spreads. The frontend's
// useQueries.ts recomputes buyPrice/redeemPrice from baseScore + LMSR spread,
// so the values returned here are the raw AssetPrice inputs (baseScore,
// currentAllocated, maxAllocation, volatilityBuffer). buyPrice/redeemPrice
// are also returned so AssetRow's activeSpread = buyPrice - baseScore resolves
// to a realistic LMSR spread value.
const SAMPLE_ASSETS = [
  {
    name: "AI Tech Index",
    category: "AI",
    baseScore: 40.4,
    buyPrice: 40.85,
    redeemPrice: 39.98,
    currentAllocated: 12000,
    maxAllocation: 90000,
    volatilityBuffer: 0.1,
  },
  {
    name: "Washington Policy Index",
    category: "Washington",
    baseScore: 52.3,
    buyPrice: 52.78,
    redeemPrice: 51.86,
    currentAllocated: 8500,
    maxAllocation: 90000,
    volatilityBuffer: 0.1,
  },
  {
    name: "Mexico Trade Index",
    category: "Mexico",
    baseScore: 38.6,
    buyPrice: 39.05,
    redeemPrice: 38.18,
    currentAllocated: 4200,
    maxAllocation: 90000,
    volatilityBuffer: 0.1,
  },
  {
    name: "Warriors Sentiment Index",
    category: "Warriors",
    baseScore: 45.1,
    buyPrice: 45.55,
    redeemPrice: 44.68,
    currentAllocated: 6300,
    maxAllocation: 90000,
    volatilityBuffer: 0.1,
  },
];

// Per-index subsidy reserves — drives the OracleHealthPanel breakdown.
const SAMPLE_SUBSIDY_RESERVES: Array<[string, number]> = [
  ["AI Tech Index", 1240.5],
  ["Washington Policy Index", 860.25],
  ["Mexico Trade Index", 412.0],
];

const SAMPLE_TOTAL_RESERVE = SAMPLE_SUBSIDY_RESERVES.reduce(
  (sum, [, amt]) => sum + amt,
  0,
);

// ── Mock implementation ──────────────────────────────────────────────────────

function notImplemented(method: string): never {
  throw new Error(`mockBackend: ${method} not implemented`);
}

export const mockBackend: backendInterface = {
  _initializeAccessControl: async () => undefined,
  adjustUserBalance: async () => undefined,
  allocateFunds: async () => true,
  analyzeSentiment: async () => "neutral",
  applyNewsEvent: async () => undefined,
  assignCallerUserRole: async () => undefined,
  classifyHeadline: async () => ({
    sentimentLabel: "neutral_fallback",
    source: "mock",
    confidence: 0.5,
  }),
  depositFunds: async () => undefined,
  execute: async () => ({ hasMore: false, rows: [] }),
  fetchACLUData: async () => "mock",
  fetchBLSData: async () => "mock",
  fetchCongressData: async () => "mock",
  fetchCongressTraditionalData: async () => "mock",
  fetchCourtListenerData: async () => "mock",
  fetchEPAData: async () => "mock",
  fetchFTCData: async () => "mock",
  fetchFedData: async () => "mock",
  fetchGDELTData: async () => "mock",
  fetchGlobeNewswire: async () => "mock",
  fetchNews: async () => "mock",
  fetchOMDBDCData: async () => "mock",
  fetchOMDBMarvelData: async () => "mock",
  fetchRedditFeed: async () => "mock",
  fetchReliefWebData: async () => "mock",
  fetchSCOTUSData: async () => "mock",
  fetchSECFilings: async () => "mock",
  fetchTMDBData: async () => "mock",
  fetchTMDBPopularData: async () => "mock",
  fetchUSPTOData: async () => "mock",
  fetchYouTubeData: async () => "mock",
  getAllHoldings: async () => [],
  getAllUsers: async () => [],
  getAssetPrices: async () => SAMPLE_ASSETS,
  getCallerUserProfile: async () => ({
    username: "Mock User",
    name: "Mock User",
  }),
  getCallerUserRole: async () => "user" as any,
  getCurrentTrends: async () => [],
  getCyclesBalance: async () => 2_000_000_000_000n,
  getHoldings: async () => null,
  getHuggingFaceKeyStatus: async () => "not_set",
  getIsTradingPaused: async () => false,
  getLatestHeadlines: async () => [],
  getLatestScores: async () =>
    SAMPLE_ASSETS.map((a) => [a.name, a.baseScore] as [string, number]),
  getLatestTicks: async () => [],
  getNextRefreshTimeNs: async () => 0n,
  getOracleStatus: async () => "ACTIVE",
  getPersistedHeadlines: async () => [],
  getRecentTransactions: async () => [],
  getSentimentScores: async () =>
    SAMPLE_ASSETS.map((a) => [a.name, a.baseScore] as [string, number]),
  getSubsidyReserves: async () => SAMPLE_SUBSIDY_RESERVES,
  getTotalAllocatedByIndex: async () =>
    SAMPLE_ASSETS.map((a) => [a.name, a.currentAllocated] as [string, number]),
  getTotalPlatformTVL: async () => 31000,
  getTotalSubsidyReserve: async () => SAMPLE_TOTAL_RESERVE,
  getTotalUsers: async () => 1n,
  getTransactionHistory: async () => [],
  getUserLatestScores: async () =>
    SAMPLE_ASSETS.map((a) => [a.name, a.baseScore] as [string, number]),
  getUserProfile: async () => null,
  getUserTickHistory: async () => [],
  getWalletBalance: async () => 5000,
  isCallerAdmin: async () => false,
  persistTick: async () => undefined,
  redeemAll: async () => true,
  redeemFunds: async () => true,
  resetRedditBackoff: async () => undefined,
  saveCallerUserProfile: async () => undefined,
  schema: async () => "{}",
  setHuggingFaceKey: async () => undefined,
  setUserStatus: async () => undefined,
  storeProcessedHeadline: async () => undefined,
  toggleTradingPaused: async () => undefined,
  transform: async () =>
    ({ status: 200n, body: new Uint8Array(), headers: [] }) as any,
  updateData: async () => undefined,
  withdrawFunds: async () => true,
};

void notImplemented;
