/**
 * OracleHealthPanel.tsx
 * Read-only display panel showing canister cycle balance and Oracle source tier
 * health status. Pure display component — all data is passed via props.
 * No internal data fetching, no hooks, no store connections, no API calls.
 */

// ── Threshold constants — adjust here without touching any logic ──────────────
const CYCLES_WARNING_THRESHOLD = 500_000_000_000n; // 0.5T — below this = WARNING
const CYCLES_CRITICAL_THRESHOLD = 200_000_000_000n; // 0.2T — below this = CRITICAL

// ── Types ─────────────────────────────────────────────────────────────────────
type TierStatus = "ACTIVE" | "PAUSED" | null;

interface OracleHealthPanelProps {
  cyclesBalance: bigint | null | undefined;
  tierStatus:
    | {
        tierA: TierStatus;
        tierB: TierStatus;
        tierC: TierStatus;
      }
    | null
    | undefined;
  /**
   * Per-index subsidy reserve map: Array<[indexName, reserveAmount]>.
   * When omitted or null, the Subsidy Reserve section shows "Unavailable".
   * When present but empty, it shows the "No active reserves" empty state.
   */
  subsidyReserves?: Array<[string, number]> | null | undefined;
  /**
   * Summed total of all per-index subsidy reserves.
   * When omitted or null, the total line shows "Unavailable".
   */
  totalReserve?: number | null | undefined;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatCycles(cycles: bigint): string {
  const n = Number(cycles);
  if (n >= 1_000_000_000_000) {
    return `${(n / 1_000_000_000_000).toFixed(2)}T cycles`;
  }
  if (n >= 1_000_000_000) {
    return `${(n / 1_000_000_000).toFixed(2)}B cycles`;
  }
  return `${(n / 1_000_000).toFixed(2)}M cycles`;
}

type HealthState = "HEALTHY" | "WARNING" | "CRITICAL";

function getCyclesHealth(cycles: bigint): HealthState {
  if (cycles < CYCLES_CRITICAL_THRESHOLD) return "CRITICAL";
  if (cycles < CYCLES_WARNING_THRESHOLD) return "WARNING";
  return "HEALTHY";
}

const HEALTH_CONFIG: Record<
  HealthState,
  { dotColor: string; label: string; textColor: string }
> = {
  HEALTHY: {
    dotColor: "oklch(0.65 0.22 145)",
    label: "Healthy",
    textColor: "oklch(0.65 0.22 145)",
  },
  WARNING: {
    dotColor: "oklch(0.72 0.18 75)",
    label: "Low Cycles",
    textColor: "oklch(0.72 0.18 75)",
  },
  CRITICAL: {
    dotColor: "oklch(0.6 0.22 25)",
    label: "Critical",
    textColor: "oklch(0.6 0.22 25)",
  },
};

const TIER_ROWS: Array<{
  key: keyof NonNullable<OracleHealthPanelProps["tierStatus"]>;
  label: string;
  description: string;
}> = [
  { key: "tierA", label: "Tier A", description: "Premium data sources" },
  { key: "tierB", label: "Tier B", description: "Standard data sources" },
  { key: "tierC", label: "Tier C", description: "Extended data sources" },
];

// ── Subsidy Reserve helpers ───────────────────────────────────────────────────
function formatReserve(amount: number): string {
  return `$${amount.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

// ── Component ─────────────────────────────────────────────────────────────────
export function OracleHealthPanel({
  cyclesBalance,
  tierStatus,
  subsidyReserves,
  totalReserve,
}: OracleHealthPanelProps) {
  const hasCycles = cyclesBalance !== null && cyclesBalance !== undefined;

  const health = hasCycles ? getCyclesHealth(cyclesBalance!) : null;

  // Subsidy reserve data availability
  const hasReserveData =
    subsidyReserves !== null && subsidyReserves !== undefined;
  const hasTotal = totalReserve !== null && totalReserve !== undefined;
  const isEmpty = hasReserveData && subsidyReserves!.length === 0;

  return (
    <div
      className="rounded-2xl p-4"
      style={{ backgroundColor: "#141414", border: "1px solid #222222" }}
      data-ocid="oracle_health_panel"
    >
      {/* ── Section 1: Canister Health ── */}
      <p
        className="text-[11px] uppercase tracking-widest font-semibold mb-3"
        style={{ color: "oklch(0.48 0.008 240)", letterSpacing: "0.12em" }}
      >
        Canister Health
      </p>

      <div className="flex items-center justify-between">
        {hasCycles && health ? (
          <>
            {/* Cycle count */}
            <span
              className="text-[15px] font-semibold font-mono"
              style={{ color: "#ffffff" }}
              data-ocid="oracle_health_panel.cycles_balance"
            >
              {formatCycles(cyclesBalance!)}
            </span>

            {/* Status indicator */}
            <div
              className="flex items-center gap-1.5"
              data-ocid="oracle_health_panel.cycles_status"
            >
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: HEALTH_CONFIG[health].dotColor }}
              />
              <span
                className="text-[13px] font-medium"
                style={{ color: HEALTH_CONFIG[health].textColor }}
              >
                {HEALTH_CONFIG[health].label}
              </span>
            </div>
          </>
        ) : (
          <span
            className="text-[13px]"
            style={{ color: "oklch(0.40 0.008 240)" }}
            data-ocid="oracle_health_panel.cycles_unavailable"
          >
            Unavailable
          </span>
        )}
      </div>

      {/* ── Section 2: Source Tiers ── */}
      <p
        className="text-[11px] uppercase tracking-widest font-semibold mt-5 mb-3"
        style={{ color: "oklch(0.48 0.008 240)", letterSpacing: "0.12em" }}
      >
        Source Tiers
      </p>

      <div
        className="flex flex-col gap-2.5"
        data-ocid="oracle_health_panel.source_tiers"
      >
        {TIER_ROWS.map(({ key, label, description }) => {
          // Fail open — null/undefined defaults to ACTIVE
          const status: "ACTIVE" | "PAUSED" =
            tierStatus?.[key] === "PAUSED" ? "PAUSED" : "ACTIVE";

          const isActive = status === "ACTIVE";

          return (
            <div
              key={key}
              className="flex items-center justify-between"
              data-ocid={`oracle_health_panel.tier.${key}`}
            >
              <div className="flex flex-col min-w-0">
                <span
                  className="text-[13px] font-semibold leading-tight"
                  style={{ color: "#ffffff" }}
                >
                  {label}
                </span>
                <span
                  className="text-[11px] leading-tight mt-0.5"
                  style={{ color: "oklch(0.48 0.008 240)" }}
                >
                  {description}
                </span>
              </div>

              <span
                className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full shrink-0 ml-3"
                style={
                  isActive
                    ? {
                        backgroundColor: "oklch(0.65 0.22 145 / 0.12)",
                        color: "oklch(0.65 0.22 145)",
                      }
                    : {
                        backgroundColor: "oklch(0.72 0.18 75 / 0.15)",
                        color: "oklch(0.72 0.18 75)",
                      }
                }
                data-ocid={`oracle_health_panel.tier.${key}.badge`}
              >
                {status}
              </span>
            </div>
          );
        })}
      </div>

      {/* ── Section 3: Subsidy Reserve ── */}
      <p
        className="text-[11px] uppercase tracking-widest font-semibold mt-5 mb-3"
        style={{ color: "oklch(0.48 0.008 240)", letterSpacing: "0.12em" }}
      >
        Subsidy Reserve
      </p>

      <div data-ocid="oracle_health_panel.subsidy_reserve">
        {/* Total reserve line */}
        <div className="flex items-center justify-between mb-3">
          <span
            className="text-[11px] uppercase tracking-wider"
            style={{ color: "oklch(0.48 0.008 240)" }}
          >
            Total Reserve
          </span>
          {hasTotal ? (
            <span
              className="text-[15px] font-semibold font-mono"
              style={{ color: "#ffffff" }}
              data-ocid="oracle_health_panel.subsidy_reserve.total"
            >
              {formatReserve(totalReserve!)}
            </span>
          ) : (
            <span
              className="text-[13px]"
              style={{ color: "oklch(0.40 0.008 240)" }}
              data-ocid="oracle_health_panel.subsidy_reserve.total_unavailable"
            >
              Unavailable
            </span>
          )}
        </div>

        {/* Per-index breakdown or empty state */}
        {isEmpty ? (
          <div
            className="flex items-center justify-center py-4 rounded-lg"
            style={{
              backgroundColor: "oklch(0.12 0.008 240)",
              border: "1px solid #222222",
            }}
            data-ocid="oracle_health_panel.subsidy_reserve.empty_state"
          >
            <span
              className="text-[12px] font-medium"
              style={{ color: "oklch(0.48 0.008 240)" }}
            >
              No active reserves
            </span>
          </div>
        ) : hasReserveData && subsidyReserves!.length > 0 ? (
          <div
            className="flex flex-col gap-2"
            data-ocid="oracle_health_panel.subsidy_reserve.list"
          >
            {subsidyReserves!.map(([indexName, amount], idx) => (
              <div
                key={indexName}
                className="flex items-center justify-between"
                data-ocid={`oracle_health_panel.subsidy_reserve.item.${idx + 1}`}
              >
                <span
                  className="text-[12px] font-medium leading-tight truncate min-w-0 pr-2"
                  style={{ color: "oklch(0.80 0.01 240)" }}
                >
                  {indexName}
                </span>
                <span
                  className="text-[12px] font-semibold font-mono shrink-0"
                  style={{ color: "#ffffff" }}
                >
                  {formatReserve(amount)}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div
            className="flex items-center justify-center py-4"
            data-ocid="oracle_health_panel.subsidy_reserve.list_unavailable"
          >
            <span
              className="text-[12px]"
              style={{ color: "oklch(0.40 0.008 240)" }}
            >
              Unavailable
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
