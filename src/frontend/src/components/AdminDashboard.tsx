import type React from "react";
import { useState } from "react";
import { useAdminAuth } from "../contexts/AdminAuthContext";
import {
  useAdminAllUsers,
  useAdminLatestHeadlines,
  useAdminOracleStatus,
  useAdminRecentTransactions,
  useAdminSentimentScores,
  useAdminSetUserStatus,
  useAdminTotalPlatformTVL,
  useAdminTotalUsers,
} from "../hooks/useQueries";
import {
  AccountStatus,
  NewsEventCategory,
  TransactionType,
} from "../types/backendEnums";

// ── Terminal color palette ────────────────────────────────────────────────────
const T = {
  green: "#00ff88",
  dim: "#00aa55",
  bg: "#000000",
  surface: "#0a0a0a",
  border: "#003322",
  amber: "#ffaa00",
  red: "#ff4444",
  blue: "#00aaff",
  white: "#e0e0e0",
} as const;

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatRelativeTime(timestampNs: bigint | number): string {
  const ms =
    typeof timestampNs === "bigint"
      ? Number(timestampNs) / 1_000_000
      : timestampNs;
  const diffMs = Date.now() - ms;
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  return `${diffHr}h ago`;
}

function txTypeLabel(type: TransactionType): string {
  switch (type) {
    case TransactionType.buy:
      return "BUY";
    case TransactionType.sell:
      return "SELL";
    case TransactionType.deposit:
      return "DEPOSIT";
    case TransactionType.withdrawal:
      return "WITHDRAW";
    case TransactionType.redeemAll:
      return "REDEEM ALL";
    default:
      return String(type).toUpperCase();
  }
}

function txTypeColor(type: TransactionType): string {
  switch (type) {
    case TransactionType.buy:
      return T.green;
    case TransactionType.sell:
      return T.red;
    case TransactionType.deposit:
      return T.blue;
    case TransactionType.withdrawal:
      return T.amber;
    case TransactionType.redeemAll:
      return T.red;
    default:
      return T.dim;
  }
}

function categoryLabel(cat: NewsEventCategory): string {
  switch (cat) {
    case NewsEventCategory.AI:
      return "AI";
    case NewsEventCategory.Mexico:
      return "MEXICO";
    case NewsEventCategory.Warriors:
      return "WARRIORS";
    case NewsEventCategory.Washington:
      return "WASHINGTON";
    default:
      return String(cat).toUpperCase();
  }
}

function sentimentColor(score: number): string {
  if (score > 1.5) return T.green;
  if (score > 0) return "#88ffcc";
  if (score < -1.5) return T.red;
  if (score < 0) return "#ff8888";
  return T.dim;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function PanelHeader({ label }: { label: string }) {
  return (
    <div
      style={{
        color: T.dim,
        fontSize: "10px",
        letterSpacing: "0.22em",
        textTransform: "uppercase",
        marginBottom: "16px",
        borderBottom: `1px solid ${T.border}`,
        paddingBottom: "8px",
      }}
    >
      &gt; {label}
    </div>
  );
}

function StatRow({
  label,
  value,
  valueColor,
}: { label: string; value: React.ReactNode; valueColor?: string }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "10px 0",
        borderBottom: `1px solid ${T.border}`,
      }}
    >
      <span style={{ color: T.dim, fontSize: "11px", letterSpacing: "0.1em" }}>
        {label}
      </span>
      <span
        style={{
          color: valueColor ?? T.green,
          fontSize: "13px",
          fontWeight: 700,
          letterSpacing: "0.08em",
        }}
      >
        {value}
      </span>
    </div>
  );
}

function OracleStatusDot({ status }: { status: string }) {
  const isOnline = status === "ONLINE";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
      <div
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          backgroundColor: isOnline ? T.green : T.red,
          boxShadow: `0 0 6px ${isOnline ? T.green : T.red}`,
        }}
      />
      <span
        style={{
          color: isOnline ? T.green : T.red,
          fontSize: "13px",
          fontWeight: 700,
          letterSpacing: "0.08em",
        }}
      >
        {status}
      </span>
    </div>
  );
}

// ── System Health Panel ───────────────────────────────────────────────────────

function SystemHealthPanel() {
  const { data: totalUsers, isLoading: loadingUsers } = useAdminTotalUsers();
  const { data: tvl, isLoading: loadingTVL } = useAdminTotalPlatformTVL();
  const { data: oracleStatus, isLoading: loadingOracle } =
    useAdminOracleStatus();

  return (
    <div
      style={{
        border: `1px solid ${T.border}`,
        backgroundColor: T.surface,
        padding: "20px",
        height: "100%",
      }}
    >
      <PanelHeader label="System Health" />
      <StatRow
        label="TOTAL USERS"
        value={loadingUsers ? "..." : String(totalUsers ?? 0)}
      />
      <StatRow
        label="PLATFORM TVL"
        value={loadingTVL ? "..." : formatCurrency(tvl ?? 0)}
      />
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "10px 0",
        }}
      >
        <span
          style={{ color: T.dim, fontSize: "11px", letterSpacing: "0.1em" }}
        >
          ORACLE STATUS
        </span>
        {loadingOracle ? (
          <span style={{ color: T.dim, fontSize: "13px" }}>...</span>
        ) : (
          <OracleStatusDot status={oracleStatus ?? "UNKNOWN"} />
        )}
      </div>
    </div>
  );
}

// ── Live Transaction Ledger Panel ─────────────────────────────────────────────

function TransactionLedgerPanel() {
  const { data: transactions, isLoading } = useAdminRecentTransactions(20);

  return (
    <div
      style={{
        border: `1px solid ${T.border}`,
        backgroundColor: T.surface,
        padding: "20px",
        height: "100%",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <PanelHeader label="Live Transaction Ledger" />
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          maxHeight: "340px",
        }}
      >
        {isLoading ? (
          <div
            style={{
              color: T.dim,
              fontSize: "12px",
              textAlign: "center",
              padding: "20px",
            }}
          >
            LOADING...
          </div>
        ) : !transactions || transactions.length === 0 ? (
          <div
            style={{
              color: T.dim,
              fontSize: "12px",
              textAlign: "center",
              padding: "20px",
              opacity: 0.6,
            }}
          >
            NO TRANSACTIONS YET
          </div>
        ) : (
          [...transactions].reverse().map((tx) => (
            <div
              key={String(tx.id)}
              style={{
                display: "grid",
                gridTemplateColumns: "60px 1fr 80px 70px",
                gap: "8px",
                alignItems: "center",
                padding: "7px 0",
                borderBottom: `1px solid ${T.border}`,
                fontSize: "11px",
              }}
            >
              <span
                style={{
                  color: txTypeColor(tx.transactionType),
                  fontWeight: 700,
                  letterSpacing: "0.08em",
                }}
              >
                {txTypeLabel(tx.transactionType)}
              </span>
              <span
                style={{
                  color: T.white,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {tx.assetName || "anon"}
              </span>
              <span style={{ color: T.green, textAlign: "right" }}>
                {formatCurrency(tx.amount)}
              </span>
              <span
                style={{ color: T.dim, textAlign: "right", fontSize: "10px" }}
              >
                {formatRelativeTime(tx.timestamp)}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ── Oracle Feed Panel ─────────────────────────────────────────────────────────

function OracleFeedPanel() {
  const { data: sentimentScores, isLoading: loadingScores } =
    useAdminSentimentScores();
  const { data: headlines, isLoading: loadingHeadlines } =
    useAdminLatestHeadlines(10);

  return (
    <div
      style={{
        border: `1px solid ${T.border}`,
        backgroundColor: T.surface,
        padding: "20px",
        height: "100%",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <PanelHeader label="Oracle Feed" />

      {/* Sentiment Scores */}
      <div style={{ marginBottom: "16px" }}>
        <div
          style={{
            color: T.dim,
            fontSize: "10px",
            letterSpacing: "0.15em",
            marginBottom: "8px",
          }}
        >
          SENTIMENT SCORES
        </div>
        {loadingScores ? (
          <div style={{ color: T.dim, fontSize: "11px" }}>LOADING...</div>
        ) : !sentimentScores || sentimentScores.length === 0 ? (
          <div style={{ color: T.dim, fontSize: "11px", opacity: 0.6 }}>
            NO SCORES AVAILABLE
          </div>
        ) : (
          sentimentScores.map(([category, score]) => (
            <div
              key={category}
              style={{
                display: "flex",
                justifyContent: "space-between",
                padding: "4px 0",
                fontSize: "11px",
                borderBottom: `1px solid ${T.border}`,
              }}
            >
              <span style={{ color: T.dim, letterSpacing: "0.08em" }}>
                {category.toUpperCase()}
              </span>
              <span style={{ color: sentimentColor(score), fontWeight: 700 }}>
                {score >= 0 ? "+" : ""}
                {score.toFixed(2)}
              </span>
            </div>
          ))
        )}
      </div>

      {/* Latest Headlines */}
      <div style={{ flex: 1, overflowY: "auto", maxHeight: "220px" }}>
        <div
          style={{
            color: T.dim,
            fontSize: "10px",
            letterSpacing: "0.15em",
            marginBottom: "8px",
          }}
        >
          LATEST HEADLINES
        </div>
        {loadingHeadlines ? (
          <div style={{ color: T.dim, fontSize: "11px" }}>LOADING...</div>
        ) : !headlines || headlines.length === 0 ? (
          <div style={{ color: T.dim, fontSize: "11px", opacity: 0.6 }}>
            NO HEADLINES YET
          </div>
        ) : (
          [...headlines].reverse().map((h) => (
            <div
              key={h.headline}
              style={{
                padding: "8px 0",
                borderBottom: `1px solid ${T.border}`,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  marginBottom: "4px",
                }}
              >
                <span
                  style={{
                    backgroundColor: T.border,
                    color: T.amber,
                    fontSize: "9px",
                    letterSpacing: "0.12em",
                    padding: "2px 6px",
                    fontWeight: 700,
                  }}
                >
                  {categoryLabel(h.category)}
                </span>
                <span
                  style={{
                    color: sentimentColor(h.sentimentScore),
                    fontSize: "10px",
                    fontWeight: 700,
                  }}
                >
                  {h.sentimentScore >= 0 ? "+" : ""}
                  {h.sentimentScore.toFixed(1)}
                </span>
              </div>
              <div
                style={{
                  color: T.white,
                  fontSize: "11px",
                  lineHeight: "1.4",
                  opacity: 0.85,
                }}
              >
                {h.headline}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ── User Management Section ───────────────────────────────────────────────────

function UserManagementSection() {
  const [search, setSearch] = useState("");
  const { data: users, isLoading } = useAdminAllUsers();
  const setStatusMutation = useAdminSetUserStatus();

  const filtered = (users ?? []).filter(([username]) =>
    username.toLowerCase().includes(search.toLowerCase()),
  );

  const handleToggleStatus = (
    username: string,
    currentStatus: AccountStatus,
  ) => {
    const newStatus =
      currentStatus === AccountStatus.Active
        ? AccountStatus.Suspended
        : AccountStatus.Active;
    setStatusMutation.mutate({ username, status: newStatus });
  };

  return (
    <div
      style={{
        border: `1px solid ${T.border}`,
        backgroundColor: T.surface,
        padding: "24px",
        marginTop: "24px",
      }}
    >
      {/* Section Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "20px",
          borderBottom: `1px solid ${T.border}`,
          paddingBottom: "12px",
        }}
      >
        <div
          style={{
            color: T.dim,
            fontSize: "10px",
            letterSpacing: "0.22em",
            textTransform: "uppercase",
          }}
        >
          &gt; User Management
        </div>
        <div style={{ color: T.dim, fontSize: "11px" }}>
          {filtered.length} / {(users ?? []).length} USERS
        </div>
      </div>

      {/* Search Input */}
      <div style={{ marginBottom: "16px" }}>
        <input
          type="text"
          placeholder="SEARCH BY USERNAME..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            width: "100%",
            backgroundColor: "#050505",
            border: `1px solid ${T.border}`,
            color: T.green,
            fontFamily: "'JetBrains Mono', 'Courier New', monospace",
            fontSize: "12px",
            letterSpacing: "0.08em",
            padding: "10px 14px",
            outline: "none",
            boxSizing: "border-box",
          }}
          onFocus={(e) => {
            e.target.style.borderColor = T.dim;
          }}
          onBlur={(e) => {
            e.target.style.borderColor = T.border;
          }}
        />
      </div>

      {/* Table */}
      <div style={{ overflowX: "auto" }}>
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontSize: "12px",
          }}
        >
          <thead>
            <tr>
              {[
                "USERNAME",
                "BUYING POWER",
                "TOTAL UNITS OWNED",
                "ACCOUNT STATUS",
                "ACTION",
              ].map((col) => (
                <th
                  key={col}
                  style={{
                    color: T.dim,
                    fontSize: "10px",
                    letterSpacing: "0.15em",
                    textAlign: "left",
                    padding: "8px 12px",
                    borderBottom: `1px solid ${T.border}`,
                    fontWeight: 400,
                    whiteSpace: "nowrap",
                  }}
                >
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td
                  colSpan={5}
                  style={{
                    color: T.dim,
                    textAlign: "center",
                    padding: "24px",
                    fontSize: "12px",
                  }}
                >
                  LOADING USER DATA...
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td
                  colSpan={5}
                  style={{
                    color: T.dim,
                    textAlign: "center",
                    padding: "24px",
                    fontSize: "12px",
                    opacity: 0.6,
                  }}
                >
                  {search ? "NO USERS MATCH SEARCH" : "NO REGISTERED USERS"}
                </td>
              </tr>
            ) : (
              filtered.map(
                (
                  [username, buyingPower, _holdingsValue, totalUnits, status],
                  idx,
                ) => {
                  const isActive = status === AccountStatus.Active;
                  const isToggling =
                    setStatusMutation.isPending &&
                    (setStatusMutation.variables as { username: string })
                      ?.username === username;

                  return (
                    <tr
                      key={username}
                      style={{
                        backgroundColor:
                          idx % 2 === 0
                            ? "transparent"
                            : "rgba(0,255,136,0.02)",
                      }}
                    >
                      <td
                        style={{
                          padding: "10px 12px",
                          color: T.green,
                          letterSpacing: "0.06em",
                          borderBottom: `1px solid ${T.border}`,
                        }}
                      >
                        {username}
                      </td>
                      <td
                        style={{
                          padding: "10px 12px",
                          color: T.white,
                          borderBottom: `1px solid ${T.border}`,
                        }}
                      >
                        {formatCurrency(buyingPower)}
                      </td>
                      <td
                        style={{
                          padding: "10px 12px",
                          color: T.white,
                          borderBottom: `1px solid ${T.border}`,
                        }}
                      >
                        {totalUnits.toFixed(4)}
                      </td>
                      <td
                        style={{
                          padding: "10px 12px",
                          borderBottom: `1px solid ${T.border}`,
                        }}
                      >
                        <span
                          style={{
                            display: "inline-block",
                            padding: "3px 10px",
                            fontSize: "10px",
                            fontWeight: 700,
                            letterSpacing: "0.12em",
                            backgroundColor: isActive
                              ? "rgba(0,255,136,0.1)"
                              : "rgba(255,68,68,0.1)",
                            color: isActive ? T.green : T.red,
                            border: `1px solid ${isActive ? T.green : T.red}`,
                          }}
                        >
                          {isActive ? "ACTIVE" : "SUSPENDED"}
                        </span>
                      </td>
                      <td
                        style={{
                          padding: "10px 12px",
                          borderBottom: `1px solid ${T.border}`,
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => handleToggleStatus(username, status)}
                          disabled={isToggling}
                          style={{
                            backgroundColor: "transparent",
                            border: `1px solid ${isActive ? T.red : T.green}`,
                            color: isActive ? T.red : T.green,
                            fontFamily:
                              "'JetBrains Mono', 'Courier New', monospace",
                            fontSize: "10px",
                            letterSpacing: "0.12em",
                            padding: "4px 10px",
                            cursor: isToggling ? "not-allowed" : "pointer",
                            opacity: isToggling ? 0.5 : 1,
                            transition: "all 0.15s",
                          }}
                        >
                          {isToggling
                            ? "..."
                            : isActive
                              ? "SUSPEND"
                              : "ACTIVATE"}
                        </button>
                      </td>
                    </tr>
                  );
                },
              )
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Main AdminDashboard ───────────────────────────────────────────────────────

export function AdminDashboard() {
  const { logout } = useAdminAuth();

  const now = new Date();
  const timestamp = `${now.toISOString().replace("T", " ").slice(0, 19)} UTC`;

  return (
    <div
      style={{
        minHeight: "100vh",
        backgroundColor: T.bg,
        fontFamily: "'JetBrains Mono', 'Courier New', monospace",
        color: T.green,
      }}
    >
      {/* Top Bar */}
      <div
        style={{
          backgroundColor: "#050505",
          borderBottom: `1px solid ${T.border}`,
          padding: "12px 24px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          position: "sticky",
          top: 0,
          zIndex: 10,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <div
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              backgroundColor: T.green,
              boxShadow: `0 0 8px ${T.green}`,
              animation: "pulse 2s infinite",
            }}
          />
          <span
            style={{
              color: T.green,
              fontSize: "13px",
              fontWeight: 700,
              letterSpacing: "0.15em",
              textTransform: "uppercase",
            }}
          >
            ADMIN COCKPIT
          </span>
          <span
            style={{
              color: T.dim,
              fontSize: "11px",
              letterSpacing: "0.1em",
            }}
          >
            {/* PHASE 17 — RESTRICTED */}
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "20px" }}>
          <span
            style={{
              color: T.dim,
              fontSize: "11px",
              letterSpacing: "0.08em",
            }}
          >
            SESSION: {timestamp}
          </span>
          <button
            type="button"
            onClick={logout}
            style={{
              backgroundColor: "transparent",
              border: `1px solid ${T.border}`,
              color: T.dim,
              fontFamily: "'JetBrains Mono', 'Courier New', monospace",
              fontSize: "11px",
              letterSpacing: "0.15em",
              textTransform: "uppercase",
              padding: "6px 14px",
              cursor: "pointer",
              transition: "all 0.2s",
            }}
            onMouseEnter={(e) => {
              (e.target as HTMLButtonElement).style.borderColor = T.red;
              (e.target as HTMLButtonElement).style.color = T.red;
            }}
            onMouseLeave={(e) => {
              (e.target as HTMLButtonElement).style.borderColor = T.border;
              (e.target as HTMLButtonElement).style.color = T.dim;
            }}
          >
            &gt; LOGOUT
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div
        style={{ padding: "28px 24px", maxWidth: "1400px", margin: "0 auto" }}
      >
        {/* 3-Column Cockpit Layout */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1.6fr 1.2fr",
            gap: "16px",
            alignItems: "start",
          }}
        >
          <SystemHealthPanel />
          <TransactionLedgerPanel />
          <OracleFeedPanel />
        </div>

        {/* User Management */}
        <UserManagementSection />
      </div>
    </div>
  );
}
