/**
 * backendEnums.ts
 *
 * Runtime enum values that mirror the backend data model.
 * These are local definitions used by the mock layer — when the real backend
 * is connected, these values must match the Candid-generated types.
 *
 * This file exists because backend.d.ts is auto-generated and protected,
 * and backend.ts does not export runtime enum values.
 */

export enum NewsEventCategory {
  AI = "AI",
  Mexico = "Mexico",
  Warriors = "Warriors",
  Washington = "Washington",
}

export enum TransactionType {
  buy = "buy",
  sell = "sell",
  redeemAll = "redeemAll",
  deposit = "deposit",
  withdrawal = "withdrawal",
}

export enum AccountStatus {
  Active = "Active",
  Suspended = "Suspended",
}

// ── Type aliases mirroring backend.d.ts shapes ───────────────────────────────
// These are used for type annotations in files that import types from backend.

export interface NewsEvent {
  headline: string;
  sentimentScore: number;
  category: NewsEventCategory;
  relatedIndex: string;
}

export interface AssetPrice {
  name: string;
  category: string;
  baseScore: number;
  buyPrice: number;
  redeemPrice: number;
  maxAllocation: number;
  volatilityBuffer: number;
  currentAllocated: number;
  backendSpread?: number;
}

export interface Holding {
  assetName: string;
  units: number;
  accruedYield: number;
  yieldStartTime: bigint;
  allocationTimestamp: bigint;
}

export interface Transaction {
  id: bigint;
  transactionType: TransactionType;
  amount: number;
  assetName: string | null;
  timestamp: number;
}

export interface UserProfile {
  name: string;
}
