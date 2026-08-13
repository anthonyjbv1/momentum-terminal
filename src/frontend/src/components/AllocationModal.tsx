import { useQueryClient } from "@tanstack/react-query";
import { Loader2, TrendingUp, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAuth } from "../contexts/AuthContext";
import { useLocalHoldings } from "../contexts/LocalHoldingsContext";
import { useWalletContext } from "../contexts/WalletContext";
import { useMomentumTemperature } from "../hooks/useMomentumTemperature";
import { getCurrentCap } from "../services/capacityTierService";

interface AllocationModalProps {
  isOpen: boolean;
  onClose: () => void;
  assetName: string;
  category: string;
  buyPrice: number;
  /** Current redeem price for the index */
  redeemPrice: number;
  /** Current score (baseScore) for the index — used for scenario math */
  currentScore: number;
  /** Remaining pool capacity for this index (effectiveCapacity - currentAllocated) */
  remainingPoolCapacity: number;
  /** Current user's position value for this index (unitsOwned * buyPrice) */
  userPositionValue: number;
}

// ── Scenario Preview helpers ──────────────────────────────────────────────────
const SCENARIO_DELTAS = [5, 10, 20] as const;

interface ScenarioResult {
  delta: number;
  scenarioRedeemPrice: number;
  positionValue: number;
  gain: number;
  gainPct: number;
}

function computeScenarios(
  currentScore: number,
  redeemPrice: number,
  units: number,
): ScenarioResult[] {
  return SCENARIO_DELTAS.map((delta) => {
    const scenarioRedeemPrice =
      ((currentScore + delta) / currentScore) * redeemPrice;
    const positionValue = units * scenarioRedeemPrice;
    const currentRedeemValue = units * redeemPrice;
    const gain = positionValue - currentRedeemValue;
    const gainPct = (gain / currentRedeemValue) * 100;
    return { delta, scenarioRedeemPrice, positionValue, gain, gainPct };
  });
}

// Signature Green — matches --primary token
const PLATFORM_GREEN = "oklch(0.72 0.18 145)";

/** Max position per user, per index (anti-whale cap = 20% of $90k pool) */
const MAX_USER_POSITION = 750;

// Shared modal background color — used for sticky header/footer backgrounds
const MODAL_BG = "#000000";

export function AllocationModal({
  isOpen,
  onClose,
  assetName,
  category,
  buyPrice,
  redeemPrice,
  currentScore,
  remainingPoolCapacity,
  userPositionValue,
}: AllocationModalProps) {
  const [inputValue, setInputValue] = useState("");
  const [allocInputMode, setAllocInputMode] = useState<"dollar" | "units">(
    "dollar",
  );
  const [errorMsg, setErrorMsg] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [showScrollHint, setShowScrollHint] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const { walletBalance, deductFunds, logSpend } = useWalletContext();
  const { addHolding } = useLocalHoldings();
  const { userAccount } = useAuth();
  const userId = userAccount?.email ?? "";
  const temperature = useMomentumTemperature(assetName, category);
  const queryClient = useQueryClient();

  // Derived limit values
  const userRemainingAllowance = Math.max(
    0,
    MAX_USER_POSITION - userPositionValue,
  );

  const isPoolExhausted = remainingPoolCapacity <= 0;
  const isUserAtLimit = userPositionValue >= MAX_USER_POSITION;

  // shouldRender keeps the component mounted until the exit animation finishes.
  // isVisible drives the AnimatePresence child — set to false to trigger exit fade.
  // onClose() is called only after the exit animation completes.
  const [shouldRender, setShouldRender] = useState(false);
  const [isVisible, setIsVisible] = useState(false);

  // Handle open/close with fade transitions
  useEffect(() => {
    if (isOpen) {
      setShouldRender(true);
      setIsVisible(true);
      setInputValue("");
      setErrorMsg("");
      setAllocInputMode("dollar");
      setIsProcessing(false);
      setTimeout(() => inputRef.current?.focus(), 150);
    }
  }, [isOpen]);

  const handleClose = useCallback(() => {
    setInputValue("");
    setErrorMsg("");
    setIsVisible(false);
    onClose(); // Reset parent state immediately — don't depend on animation completing
  }, [onClose]);

  // Close on Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) handleClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [isOpen, handleClose]);

  // In units mode: raw input is a unit count; dollar cost = units × buyPrice
  const parsedUnitsInput =
    allocInputMode === "units"
      ? Number.parseFloat(inputValue.replace(/,/g, "")) || 0
      : 0;
  const parsedAmount =
    allocInputMode === "dollar"
      ? Number.parseFloat(inputValue.replace(/,/g, "")) || 0
      : parsedUnitsInput * buyPrice;
  const poolRemaining = Math.max(0, remainingPoolCapacity - parsedAmount);
  const isInsufficient = parsedAmount > walletBalance && parsedAmount > 0;
  const isValid = parsedAmount > 0 && parsedAmount <= walletBalance;

  // Real-time position limit validation — clears only when the POSITION LIMIT error is active
  const errorMsgRef = useRef("");
  errorMsgRef.current = errorMsg;
  useEffect(() => {
    if (parsedAmount > 0 && parsedAmount >= userRemainingAllowance) {
      const remaining = userRemainingAllowance.toLocaleString("en-US", {
        maximumFractionDigits: 0,
      });
      setErrorMsg(
        `POSITION LIMIT REACHED: Max ${MAX_USER_POSITION.toLocaleString()} per user, per index. ${remaining} remaining.`,
      );
    } else if (
      parsedAmount > 0 &&
      errorMsgRef.current.startsWith("POSITION LIMIT")
    ) {
      setErrorMsg("");
    }
  }, [parsedAmount, userRemainingAllowance]);

  // Scroll hint — show chevron when Scenario Preview is off-screen and amount > 0
  useEffect(() => {
    if (parsedAmount <= 0) {
      setShowScrollHint(false);
      return;
    }
    if (!previewRef.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        setShowScrollHint(!entry.isIntersecting);
      },
      { threshold: 0.1 },
    );
    observer.observe(previewRef.current);
    return () => observer.disconnect();
  }, [parsedAmount]);

  const handleQuickSelect = (value: number | "max") => {
    const effectiveCap = Math.min(
      walletBalance,
      poolRemaining,
      userRemainingAllowance,
    );
    if (value === "max") {
      const rounded = Math.floor(effectiveCap * 100) / 100;
      setInputValue(rounded % 1 === 0 ? String(rounded) : rounded.toFixed(2));
    } else {
      const current = Number.parseFloat(inputValue.replace(/,/g, "")) || 0;
      const next = Math.min(current + value, effectiveCap);
      const rounded = Math.floor(next * 100) / 100;
      setInputValue(rounded % 1 === 0 ? String(rounded) : rounded.toFixed(2));
    }
    setErrorMsg("");
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    // Dollar mode: up to 2 decimal places; Units mode: up to 4 decimal places
    const pattern =
      allocInputMode === "dollar" ? /^[\d,]*\.?\d{0,2}$/ : /^[\d,]*\.?\d{0,4}$/;
    if (pattern.test(val) || val === "") {
      setInputValue(val);
      setErrorMsg("");
    }
  };

  const handleConfirm = () => {
    if (!isValid || isProcessing) return;

    setErrorMsg("");
    setIsProcessing(true);

    // ── Guard 0: Dynamic capacity gate (tier-aware) ──────────────────────────
    // getCurrentCap reads the live tier cap from localStorage — same source
    // that AssetRow uses for remainingPoolCapacity, so they are always in sync.
    const currentCap = getCurrentCap(assetName);
    const currentAllocated = currentCap - remainingPoolCapacity;
    if (currentAllocated >= currentCap) {
      setErrorMsg(
        "This index is currently at capacity. Check back soon — capacity expands automatically based on demand.",
      );
      setIsProcessing(false);
      return;
    }

    // ── Guard 1: Pool capacity ceiling ──────────────────────────────────────
    if (parsedAmount > poolRemaining) {
      const fmt = poolRemaining.toLocaleString("en-US", {
        maximumFractionDigits: 0,
      });
      setErrorMsg(
        `ALLOCATION FAILED: Only $${fmt} liquidity remaining in this pool.`,
      );
      setIsProcessing(false);
      return;
    }

    // ── Guard 2: Anti-whale cap ($18k per user per index) ───────────────────
    if (parsedAmount >= userRemainingAllowance) {
      const remaining = userRemainingAllowance.toLocaleString("en-US", {
        maximumFractionDigits: 0,
      });
      setErrorMsg(
        `POSITION LIMIT REACHED: Max $${MAX_USER_POSITION.toLocaleString()} per user, per index. $${remaining} remaining.`,
      );
      setIsProcessing(false);
      return;
    }

    // ── Guard 3: Wallet balance ──────────────────────────────────────────────
    const deducted = deductFunds(parsedAmount);
    if (!deducted) {
      setErrorMsg("Insufficient funds in your wallet.");
      setIsProcessing(false);
      return;
    }

    // Calculate units purchased at the current buy price
    // In units mode, the user entered units directly — use them as-is.
    const unitsPurchased =
      allocInputMode === "units"
        ? parsedUnitsInput
        : buyPrice > 0
          ? parsedAmount / buyPrice
          : 0;

    // Write to local holdings store — pass parsedAmount as costBasis so the
    // P&L bar has the locked-in dollar cost for this allocation.
    addHolding(assetName, unitsPurchased, parsedAmount);

    // Persist first-allocation flag permanently — used to auto-collapse info
    // blocks in the Sentiment Assets section for returning users.
    const hasAllocKey = userId
      ? `${userId}_momentum_has_allocated`
      : "momentum_has_allocated";
    localStorage.setItem(hasAllocKey, "true");
    // Dispatch a storage event so same-tab listeners (Layout, AssetList) react
    // immediately — the native storage event only fires in other tabs.
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: hasAllocKey,
        newValue: "true",
        storageArea: localStorage,
      }),
    );

    // Log allocation to activity history — include fill detail for drilldown
    logSpend(parsedAmount, assetName, unitsPurchased, buyPrice);

    // Invalidate assetPrices cache so Arc Volume and Capacity Bar update
    // immediately without waiting for the next Oracle tick.
    queryClient.invalidateQueries({ queryKey: ["assetPrices"] });

    // Refresh useUserFullPosition so longUnits and the conditional REDEEM button
    // update immediately after a successful long allocation, without waiting
    // for the 30-second refetch interval.
    queryClient.invalidateQueries({
      queryKey: ["userFullPosition", assetName],
    });

    // Simulate brief Oracle processing delay, then trigger close animation
    setTimeout(() => {
      setInputValue("");
      setErrorMsg("");
      setIsProcessing(false);
      setIsVisible(false);
      // onClose() fires in onAnimationComplete after the exit fade completes
    }, 600);
  };

  if (!shouldRender) return null;

  const isConfirmDisabled =
    !isValid || isProcessing || isPoolExhausted || isUserAtLimit;

  const modalContent = (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          aria-label={`Allocate funds to ${assetName}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3, ease: "easeOut" }}
          onAnimationComplete={(def) => {
            if (def === "exit") {
              setShouldRender(false); // DOM cleanup only — onClose() already called in handleClose
            }
          }}
          style={{
            position: "fixed",
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
            zIndex: 99999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "1rem",
            margin: 0,
            maxWidth: "none",
            width: "100%",
            height: "100%",
            backgroundColor: "rgba(0, 0, 0, 0.80)",
            backdropFilter: "blur(8px)",
            border: "none",
          }}
          onClick={handleClose}
          onKeyDown={(e) => {
            if (
              (e.key === "Enter" || e.key === " ") &&
              e.target === e.currentTarget
            )
              handleClose();
          }}
        >
          {/* ── Scroll hint keyframe animation ── */}
          <style>{`
        @keyframes scrollHintBounce {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(4px); }
        }
      `}</style>
          {/* ── Card Container: flex column, max 90vh, overflow hidden ── */}
          <div
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
            style={{
              width: "100%",
              maxWidth: "24rem",
              maxHeight: "90vh",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
              borderRadius: "0.75rem",
              backgroundColor: MODAL_BG,
              border: "1px solid #2a2a2a",
              fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
            }}
          >
            {/* ── Sticky Header: always visible, close button never scrolls away ── */}
            <div
              style={{
                position: "sticky",
                top: 0,
                zIndex: 10,
                backgroundColor: MODAL_BG,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "1.25rem 1.25rem 0.75rem 1.25rem",
                borderBottom: "1px solid #2a2a2a",
                flexShrink: 0,
              }}
            >
              <h2
                style={{
                  color: "#ffffff",
                  fontSize: "1.25rem",
                  fontWeight: 800,
                  letterSpacing: "-0.01em",
                  fontFamily: "'JetBrains Mono', monospace",
                  margin: 0,
                }}
              >
                {assetName}
              </h2>
              <button
                type="button"
                onClick={handleClose}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: "#6b6b6b",
                  padding: "0.25rem",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <X size={18} />
              </button>
            </div>

            {/* ── Scrollable Body: all content between header and confirm button ── */}
            <div
              style={{
                overflowY: "auto",
                flex: 1,
                padding: "0 0 0.5rem 0",
              }}
            >
              {/* ── Momentum Temperature Block ── */}
              <div
                style={{
                  margin: "1rem 1.25rem 0 1.25rem",
                  padding: "0.75rem",
                  borderRadius: "0.5rem",
                  border: "1px solid #2a2a2a",
                  backgroundColor: "rgba(255,255,255,0.03)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: "0.375rem",
                  }}
                >
                  <span
                    style={{
                      color: "#6b6b6b",
                      fontSize: "0.625rem",
                      textTransform: "uppercase",
                      letterSpacing: "0.1em",
                      fontWeight: 500,
                    }}
                  >
                    Momentum Temperature
                  </span>
                  <span
                    style={{
                      fontSize: "0.75rem",
                      
                      fontWeight: 600,
                      color:
                        temperature.state === "HOT"
                          ? "#FF6B35"
                          : temperature.state === "WARM"
                            ? "#F59E0B"
                            : "#8E8E93",
                    }}
                  >
                    {temperature.displayLabel}
                  </span>
                </div>
                <p
                  style={{
                    color: "#6b6b6b",
                    fontSize: "0.6875rem",
                    lineHeight: 1.5,
                    margin: 0,
                  }}
                >
                  {temperature.displayDescription}
                </p>
              </div>

              {/* ── Pool Remaining and Your Allowance Row ── */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: "0.75rem",
                  margin: "1rem 1.25rem 0 1.25rem",
                }}
              >
                <div
                  style={{
                    padding: "0.75rem",
                    borderRadius: "0.75rem",
                    border: `1px solid ${
                      isPoolExhausted
                        ? "rgba(239,68,68,0.3)"
                        : poolRemaining < 10000
                          ? "rgba(245,158,11,0.3)"
                          : "#1e1e1e"
                    }`,
                    backgroundColor: "#111111",
                  }}
                >
                  <div
                    style={{
                      color: "#6b6b6b",
                      fontSize: "0.625rem",
                      textTransform: "uppercase",
                      letterSpacing: "0.1em",
                      marginBottom: "0.25rem",
                    }}
                  >
                    Pool Remaining
                  </div>
                  <div
                    style={{
                      color: isPoolExhausted
                        ? "#ef4444"
                        : poolRemaining < 10000
                          ? "#F59E0B"
                          : "#ffffff",
                      fontSize: "0.875rem",
                      fontWeight: 600,
                      
                    }}
                  >
                    $
                    {poolRemaining.toLocaleString("en-US", {
                      minimumFractionDigits: 0,
                      maximumFractionDigits: 0,
                    })}
                  </div>
                </div>
                <div
                  style={{
                    padding: "0.75rem",
                    borderRadius: "0.75rem",
                    border: `1px solid ${
                      isUserAtLimit
                        ? "rgba(239,68,68,0.3)"
                        : userRemainingAllowance < 2000
                          ? "rgba(245,158,11,0.3)"
                          : "#1e1e1e"
                    }`,
                    backgroundColor: "#111111",
                  }}
                >
                  <div
                    style={{
                      color: "#6b6b6b",
                      fontSize: "0.625rem",
                      textTransform: "uppercase",
                      letterSpacing: "0.1em",
                      marginBottom: "0.25rem",
                    }}
                  >
                    High Limit
                  </div>
                  <div
                    style={{
                      color: isUserAtLimit
                        ? "#ef4444"
                        : userRemainingAllowance < 2000
                          ? "#F59E0B"
                          : "#ffffff",
                      fontSize: "0.875rem",
                      fontWeight: 600,
                      
                    }}
                  >
                    $
                    {userRemainingAllowance.toLocaleString("en-US", {
                      minimumFractionDigits: 0,
                      maximumFractionDigits: 0,
                    })}
                  </div>
                </div>
              </div>

              {/* ── Input Mode Toggle ── */}
              <div
                style={{
                  display: "flex",
                  margin: "1rem 1.25rem 0 1.25rem",
                  backgroundColor: "rgba(255,255,255,0.04)",
                  borderRadius: "9999px",
                  padding: "3px",
                  gap: "3px",
                }}
              >
                {(["dollar", "units"] as const).map((mode) => {
                  const label = mode === "dollar" ? "$ Dollar" : "# Shares";
                  const isActive = allocInputMode === mode;
                  return (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => {
                        if (allocInputMode !== mode) {
                          setAllocInputMode(mode);
                          setInputValue("");
                          setErrorMsg("");
                        }
                      }}
                      style={{
                        flex: 1,
                        padding: "0.375rem 0",
                        borderRadius: "9999px",
                        border: isActive
                          ? "1px solid rgba(74,222,128,0.4)"
                          : "1px solid transparent",
                        backgroundColor: isActive
                          ? "rgba(74,222,128,0.15)"
                          : "transparent",
                        color: isActive ? "#4ade80" : "#8E8E93",
                        fontSize: "0.75rem",
                        fontWeight: 600,
                        cursor: "pointer",
                        
                        letterSpacing: "0.03em",
                        transition: "all 0.15s ease",
                      }}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>

              {/* ── Amount Input ── */}
              <div style={{ margin: "1rem 1.25rem 0 1.25rem" }}>
                <div
                  style={{
                    backgroundColor: "#111111",
                    borderRadius: "0.75rem",
                    border: `1px solid ${
                      isInsufficient ? "rgba(239,68,68,0.5)" : "#1e1e1e"
                    }`,
                    padding: "1rem",
                    display: "flex",
                    alignItems: "center",
                    gap: "0.5rem",
                  }}
                >
                  {allocInputMode === "dollar" && (
                    <span
                      style={{
                        fontSize: "1.875rem",
                        fontWeight: 300,
                        color: parsedAmount > 0 ? (isInsufficient ? "#ef4444" : "#4a4a4a") : "#4a4a4a",
                      }}
                    >
                      $
                    </span>
                  )}
                  <input
                    ref={inputRef}
                    type="text"
                    inputMode="decimal"
                    value={inputValue}
                    onChange={handleInputChange}
                    placeholder={
                      allocInputMode === "dollar" ? "0.00" : "0.0000"
                    }
                    aria-label={
                      allocInputMode === "dollar"
                        ? "Allocation amount in dollars"
                        : "Allocation amount in shares"
                    }
                    style={{
                      background: "none",
                      border: "none",
                      outline: "none",
                      color: isInsufficient ? "#ef4444" : (parsedAmount > 0 ? "#ffffff" : "#4a4a4a"),
                      fontSize: "2.25rem",
                      fontWeight: 700,
                      width: "100%",
                      caretColor: "oklch(0.72 0.18 145)",
                    }}
                  />
                </div>
                {errorMsg && (
                  <p
                    style={{
                      color: "#ef4444",
                      fontSize: "0.75rem",
                      marginTop: "0.375rem",
                      marginBottom: 0,
                    }}
                  >
                    {errorMsg}
                  </p>
                )}
              </div>

              {/* ── Quick Select Pills — dollar mode only ── */}
              {allocInputMode === "dollar" && (
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr 1fr",
                    gap: "0.5rem",
                    margin: "0.75rem 1.25rem 0 1.25rem",
                  }}
                >
                  {(["$100", "$500", "MAX"] as const).map((label) => {
                    const value =
                      label === "$100"
                        ? 100
                        : label === "$500"
                          ? 500
                          : ("max" as const);
                    return (
                      <button
                        key={label}
                        type="button"
                        onClick={() => handleQuickSelect(value)}
                        disabled={isPoolExhausted || isUserAtLimit}
                        style={{
                          backgroundColor: "#1a1a1a",
                          border: "1px solid #2a2a2a",
                          borderRadius: "9999px",
                          color:
                            isPoolExhausted || isUserAtLimit
                              ? "#4a4a4a"
                              : "#ffffff",
                          fontSize: "0.8125rem",
                          fontWeight: 500,
                          padding: "0.5rem 0",
                          cursor:
                            isPoolExhausted || isUserAtLimit
                              ? "not-allowed"
                              : "pointer",
                        }}
                      >
                        {label === "MAX" ? "MAX" : `+${label}`}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* ── Available Balance ── */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  margin: "0.75rem 1.25rem 0 1.25rem",
                }}
              >
                <span style={{ color: "#6b6b6b", fontSize: "0.75rem" }}>
                  Available:
                </span>
                <span
                  style={{
                    color: "#ffffff",
                    fontSize: "0.75rem",
                    
                    fontWeight: 500,
                  }}
                >
                  $
                  {walletBalance.toLocaleString("en-US", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </span>
              </div>

              {/* ── Estimated Units (dollar mode) / Dollar Cost Preview (units mode) ── */}
              {buyPrice > 0 &&
                (allocInputMode === "dollar"
                  ? parsedAmount > 0 && isValid
                  : parsedUnitsInput > 0) && (
                  <div
                    style={{
                      margin: "0.5rem 1.25rem 0 1.25rem",
                      textAlign: "center",
                    }}
                  >
                    <span
                      style={{
                        color: "#6b6b6b",
                        fontSize: "0.6875rem",
                        
                      }}
                    >
                      {allocInputMode === "dollar" ? (
                        <>
                          ≈ {(parsedAmount / buyPrice).toFixed(4)} shares @{" "}
                          {buyPrice.toFixed(2)}
                        </>
                      ) : (
                        <>
                          ≈ ${(parsedUnitsInput * buyPrice).toFixed(2)} cost @{" "}
                          {buyPrice.toFixed(2)}
                        </>
                      )}
                    </span>
                  </div>
                )}

              {/* ── Scroll hint chevron ── */}
              {parsedAmount > 0 && showScrollHint && (
                <div
                  style={{
                    textAlign: "center",
                    marginTop: "4px",
                    transition: "opacity 0.3s",
                    opacity: showScrollHint ? 0.6 : 0,
                  }}
                >
                  <span
                    style={{
                      color: "#6b7280",
                      fontSize: "12px",
                      display: "inline-block",
                      animation: "scrollHintBounce 1.5s ease-in-out infinite",
                    }}
                  >
                    ↓
                  </span>
                </div>
              )}

              {/* ── Scenario Preview — renders ONLY when parsedAmount > 0; hidden entirely when input is empty ── */}
              {parsedAmount > 0 &&
                buyPrice > 0 &&
                currentScore > 0 &&
                redeemPrice > 0 &&
                (() => {
                  const units = parsedAmount / buyPrice;
                  if (units <= 0) return null;
                  const scenarios = computeScenarios(
                    currentScore,
                    redeemPrice,
                    units,
                  );
                  return (
                    <div
                      ref={previewRef}
                      style={{ margin: "0.875rem 1.25rem 0 1.25rem" }}
                    >
                      {/* Section header */}
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "0.3rem",
                          marginBottom: "0.5rem",
                        }}
                      >
                        <TrendingUp size={10} style={{ color: "#6b6b6b" }} />
                        <span
                          style={{
                            color: "#6b6b6b",
                            fontSize: "0.625rem",
                            textTransform: "uppercase",
                            letterSpacing: "0.1em",
                            fontWeight: 500,
                          }}
                        >
                          Scenario Preview
                        </span>
                      </div>

                      {/* Scenario columns card */}
                      <div
                        className="grid grid-cols-1 sm:grid-cols-3"
                        style={{
                          borderRadius: "0.5rem",
                          border: "1px solid #2a2a2a",
                          backgroundColor: "rgba(255,255,255,0.03)",
                          overflow: "hidden",
                        }}
                      >
                        {scenarios.map((s, i) => (
                          <div
                            key={s.delta}
                            style={{
                              padding: "0.625rem 0.5rem",
                              textAlign: "center",
                              borderLeft: i > 0 ? "1px solid #2a2a2a" : "none",
                              display: "flex",
                              flexDirection: "column",
                              gap: "0.25rem",
                            }}
                          >
                            <span
                              style={{
                                color: "#6b6b6b",
                                fontSize: "0.6rem",
                                textTransform: "uppercase",
                                letterSpacing: "0.08em",
                                fontWeight: 500,
                              }}
                            >
                              +{s.delta} pts
                            </span>
                            <span
                              style={{
                                color: "#ffffff",
                                fontSize: "0.8125rem",
                                
                                fontWeight: 600,
                                letterSpacing: "-0.01em",
                              }}
                            >
                              ${s.positionValue.toFixed(2)}
                            </span>
                            <span
                              style={{
                                color: PLATFORM_GREEN,
                                fontSize: "0.6rem",
                                
                                fontWeight: 500,
                              }}
                            >
                              +${s.gain.toFixed(2)}
                              <br />
                              <span style={{ opacity: 0.8 }}>
                                (+{s.gainPct.toFixed(1)}%)
                              </span>
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })()}

              {/* Footer note — inside scroll area, last item */}
              <div
                style={{
                  padding: "1rem 1.25rem 0.25rem 1.25rem",
                  display: "flex",
                  alignItems: "center",
                  gap: "0.375rem",
                }}
              >
                <span style={{ color: "#6b6b6b", fontSize: "0.625rem" }}>
                  🔒
                </span>
                <span
                  style={{
                    color: "#6b6b6b",
                    fontSize: "0.625rem",
                    lineHeight: 1.4,
                  }}
                >
                  Prices are Oracle-driven and updated in real time. Spread
                  applies on entry and exit. This is a HIGH (long) position.
                </span>
              </div>
            </div>

            {/* ── Sticky Confirm Button: always visible at bottom ── */}
            <div
              style={{
                position: "sticky",
                bottom: 0,
                backgroundColor: MODAL_BG,
                borderTop: "1px solid #2a2a2a",
                padding: "0.875rem 1.25rem 1.25rem 1.25rem",
                flexShrink: 0,
              }}
            >
              <button
                type="button"
                onClick={handleConfirm}
                disabled={isConfirmDisabled}
                style={{
                  width: "100%",
                  padding: "0.875rem",
                  borderRadius: "0.5rem",
                  border: "none",
                  backgroundColor: isConfirmDisabled
                    ? "#1a1a1a"
                    : "oklch(0.52 0.17 145)",
                  color: isConfirmDisabled ? "#4a4a4a" : "#ffffff",
                  fontSize: "0.875rem",
                  fontWeight: 600,
                  cursor: isConfirmDisabled ? "not-allowed" : "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "0.5rem",
                }}
              >
                {isProcessing && <Loader2 size={14} className="animate-spin" />}
                {isPoolExhausted
                  ? "Liquidity Pool Exhausted"
                  : isUserAtLimit
                    ? "Position Limit Reached"
                    : !isValid && parsedAmount === 0
                      ? allocInputMode === "units"
                        ? "Enter Share Count"
                        : "Enter an Amount"
                      : isInsufficient
                        ? "Insufficient Funds"
                        : isProcessing
                          ? "Processing..."
                          : `Confirm High · $${parsedAmount.toLocaleString(
                              "en-US",
                              {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              },
                            )}`}
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  return createPortal(modalContent, document.body);
}
