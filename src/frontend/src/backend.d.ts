import type { Principal } from "@icp-sdk/core/principal";
export interface Some<T> {
    __kind__: "Some";
    value: T;
}
export interface None {
    __kind__: "None";
}
export type Option<T> = Some<T> | None;
export interface CircuitBreakerStatus {
    velocity: number;
    breakerActive: boolean;
}
export interface AssetPrice {
    currentAllocated: number;
    name: string;
    baseScore: number;
    redeemPrice: number;
    buyPrice: number;
    category: string;
    maxAllocation: number;
    volatilityBuffer: number;
}
export type SubsidyReserveMap = Array<SubsidyReserveEntry>;
export interface ProcessedHeadline {
    impact: number;
    sentimentLabel: string;
    text: string;
    targetIndex: string;
    sourceTier: bigint;
    timestamp: bigint;
    confidence: number;
}
export interface NewsEvent {
    sentimentScore: number;
    headline: string;
    category: NewsEventCategory;
    relatedIndex?: string;
}
export interface TrendState {
    direction: TrendDirection;
    remainingDuration: bigint;
    stepSize: number;
}
export interface HttpHeader {
    value: string;
    name: string;
}
export interface Transaction {
    id: bigint;
    transactionType: TransactionType;
    username: string;
    timestamp: bigint;
    units?: number;
    assetName?: string;
    amount: number;
    assetInvolved?: string;
    dollarAmount?: number;
}
export type AllocateShortResult = {
    __kind__: "ok";
    ok: {
        unitsOpened: number;
    };
} | {
    __kind__: "err";
    err: string;
};
export interface TickRecord {
    topHeadline?: string;
    tickIndex: bigint;
    scores: Array<[string, number]>;
    gsiValue: number;
    timestamp: bigint;
}
export interface Result {
    hasMore: boolean;
    rows: Array<Array<Cell>>;
}
export interface Holding {
    allocationTimestamp: bigint;
    accruedYield: number;
    units: number;
    assetName: string;
    yieldStartTime: bigint;
}
export interface HttpResponse {
    status: bigint;
    body: Uint8Array;
    headers: Array<HttpHeader>;
}
export interface FullPositionView {
    shortUnits: number;
    longUnits: number;
    shortEntryScore: number;
    longEntryScore: number;
    shortMarkToMarketValue: number;
    longMarkToMarketValue: number;
}
export interface Cell {
    value: Value;
    name: string;
}
export interface ShortPositionView {
    shortUnits: number;
    shortEntryScore: number;
    markToMarketValue: number;
}
export type SubsidyReserveEntry = [string, number];
export type RedeemShortResult = {
    __kind__: "ok";
    ok: {
        valueCredited: number;
    };
} | {
    __kind__: "err";
    err: string;
};
export type Value = {
    __kind__: "int";
    int: bigint;
} | {
    __kind__: "nat";
    nat: bigint;
} | {
    __kind__: "float";
    float: number;
} | {
    __kind__: "bool";
    bool: boolean;
} | {
    __kind__: "null";
    null: null;
} | {
    __kind__: "text";
    text: string;
};
export interface UserProfile {
    username: string;
    name: string;
}
export interface TransformArgs {
    context: Uint8Array;
    response: HttpResponse;
}
export enum AccountStatus {
    Active = "Active",
    Suspended = "Suspended"
}
export enum NewsEventCategory {
    AI = "AI",
    Mexico = "Mexico",
    Washington = "Washington",
    Warriors = "Warriors"
}
export enum TransactionType {
    buy = "buy",
    sell = "sell",
    deposit = "deposit",
    shortAllocate = "shortAllocate",
    redeemAll = "redeemAll",
    withdrawal = "withdrawal",
    shortRedeem = "shortRedeem"
}
export enum TrendDirection {
    up = "up",
    down = "down"
}
export enum UserRole {
    admin = "admin",
    user = "user",
    guest = "guest"
}
export interface backendInterface {
    adjustUserBalance(_userId: string, amount: number): Promise<void>;
    allocateFunds(assetName: string, allocationAmount: number): Promise<boolean>;
    allocateShort(assetName: string, allocationAmount: number): Promise<AllocateShortResult>;
    /**
     * / Legacy function retained for backward compatibility.
     * / New callers should use classifyHeadline() instead.
     */
    analyzeSentiment(text: string): Promise<string>;
    applyNewsEvent(event: NewsEvent): Promise<void>;
    assignCallerUserRole(user: Principal, role: UserRole): Promise<void>;
    backfillVolume(): Promise<void>;
    /**
     * / Public update function — frontend calls this to classify a headline.
     * / HTTP outcalls require update calls (not query).
     * / Returns neutral_fallback if key is not set or on any error.
     * / NOTE: field is "sentimentLabel" not "label" — "label" is a reserved keyword in Motoko.
     */
    classifyHeadline(headline: string): Promise<{
        sentimentLabel: string;
        source: string;
        confidence: number;
    }>;
    depositFunds(amount: number): Promise<void>;
    execute(qJson: string): Promise<Result>;
    fetchACLUData(): Promise<string>;
    fetchBLSData(): Promise<string>;
    fetchCongressData(): Promise<string>;
    fetchCongressTraditionalData(): Promise<string>;
    fetchCourtListenerData(): Promise<string>;
    fetchEPAData(): Promise<string>;
    fetchFTCData(): Promise<string>;
    fetchFedData(): Promise<string>;
    fetchGDELTData(): Promise<string>;
    fetchGlobeNewswire(): Promise<string>;
    fetchNews(): Promise<string>;
    fetchOMDBDCData(): Promise<string>;
    fetchOMDBMarvelData(): Promise<string>;
    fetchRedditFeed(subreddit: string): Promise<string>;
    fetchReliefWebData(): Promise<string>;
    fetchSCOTUSData(): Promise<string>;
    fetchSECFilings(): Promise<string>;
    fetchTMDBData(): Promise<string>;
    fetchTMDBPopularData(): Promise<string>;
    fetchUSPTOData(): Promise<string>;
    fetchYouTubeData(): Promise<string>;
    getAllHoldings(): Promise<Array<[string, Holding]>>;
    getAllUsers(): Promise<Array<[string, number, number, number, AccountStatus]>>;
    getAssetPrices(): Promise<Array<AssetPrice>>;
    getCallerUserProfile(): Promise<UserProfile | null>;
    getCallerUserRole(): Promise<UserRole>;
    getCircuitBreakerStatus(assetName: string): Promise<CircuitBreakerStatus>;
    getCurrentTrends(): Promise<Array<[string, TrendState]>>;
    /**
     * / Returns the current cycles balance of this canister.
     * / PUBLIC — no auth required. Use for monitoring without controller access:
     * /   dfx canister call noek7-3yaaa-aaaaj-qn6ea-cai getCyclesBalance --network ic
     */
    getCyclesBalance(): Promise<bigint>;
    /**
     * / Returns Finnhub key status without exposing the value. Open during pre-deployment — any signed-in caller may check the key.
     */
    getFinnhubKeyStatus(): Promise<string>;
    getHoldings(assetName: string): Promise<Holding | null>;
    /**
     * / Returns key status without exposing the value. Open during pre-deployment — any signed-in caller may check the key.
     */
    getHuggingFaceKeyStatus(): Promise<string>;
    getIsTradingPaused(): Promise<boolean>;
    getLatestHeadlines(limit: bigint): Promise<Array<NewsEvent>>;
    /**
     * / Returns the latest score snapshot committed by persistTick.
     * / PUBLIC query — no auth restriction. Used on frontend mount to bootstrap scores.
     */
    getLatestScores(): Promise<Array<[string, number]>>;
    /**
     * / Returns the most recent `limit` tick records, oldest first.
     * / PUBLIC query — no auth restriction. Used on frontend mount for hydration.
     */
    getLatestTicks(limit: bigint): Promise<Array<TickRecord>>;
    getNextRefreshTimeNs(): Promise<bigint>;
    getOracleStatus(): Promise<string>;
    /**
     * / Returns all persisted AI-graded headlines, oldest first.
     * / PUBLIC — no auth restriction. Used on frontend mount to hydrate the Oracle Feed.
     */
    getPersistedHeadlines(): Promise<Array<ProcessedHeadline>>;
    getRecentTransactions(limit: bigint): Promise<Array<Transaction>>;
    getSentimentScores(): Promise<Array<[string, number]>>;
    getShortPositionCap(): Promise<number>;
    getSubsidyReserves(): Promise<SubsidyReserveMap>;
    getTotalAllocatedByIndex(): Promise<Array<[string, number]>>;
    getTotalPlatformTVL(): Promise<number>;
    getTotalSubsidyReserve(): Promise<number>;
    getTotalUsers(): Promise<bigint>;
    getTotalVolumeByIndex(): Promise<Array<[string, number]>>;
    getTransactionHistory(): Promise<Array<Transaction>>;
    getUserFullPosition(assetName: string): Promise<FullPositionView>;
    /**
     * / Returns the most recent scores from the caller's personal history.
     */
    getUserLatestScores(): Promise<Array<[string, number]>>;
    getUserProfile(user: Principal): Promise<UserProfile | null>;
    getUserShortPosition(assetName: string): Promise<ShortPositionView>;
    /**
     * / Returns the caller's personal tick history, limited to the last N entries.
     */
    getUserTickHistory(limit: bigint): Promise<Array<TickRecord>>;
    getWalletBalance(): Promise<number>;
    isCallerAdmin(): Promise<boolean>;
    /**
     * / Commits a single tick result to canister memory.
     * / Called fire-and-forget from OracleTickContext after each tick cycle.
     * / Capped at 720 entries (≈6 hours at 30-second ticks).
     */
    persistTick(record: TickRecord): Promise<void>;
    redeemAll(assetName: string): Promise<boolean>;
    redeemFunds(assetName: string, unitsToSell: number): Promise<boolean>;
    redeemShort(assetName: string, unitsToRedeem: number): Promise<RedeemShortResult>;
    /**
     * / Resets Reddit backoff state so the next heartbeat triggers an immediate retry.
     * / Use this after a canister top-up to avoid waiting up to 50 minutes for the
     * / backoff window to expire. Admin-gated — only canister admins may call this.
     */
    resetRedditBackoff(): Promise<void>;
    saveCallerUserProfile(profile: UserProfile): Promise<void>;
    schema(): Promise<string>;
    /**
     * / Sets the Finnhub API key. Open during pre-deployment — any signed-in caller may set the key.
     */
    setFinnhubKey(key: string): Promise<void>;
    /**
     * / Sets the HuggingFace API key. Open during pre-deployment — any signed-in caller may set the key.
     */
    setHuggingFaceKey(key: string): Promise<void>;
    setUserStatus(username: string, status: AccountStatus): Promise<void>;
    /**
     * / Persists a fully-scored headline to canister memory.
     * / Called fire-and-forget from OracleTickContext after FinBERT scoring.
     * / No auth restriction.
     */
    storeProcessedHeadline(h: ProcessedHeadline): Promise<void>;
    toggleTradingPaused(): Promise<void>;
    transform(args: TransformArgs): Promise<HttpResponse>;
    updateData(): Promise<void>;
    withdrawFunds(amount: number): Promise<boolean>;
}
