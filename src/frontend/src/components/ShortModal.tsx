import { useQueryClient } from "@tanstack/react-query";
import { Loader2, TrendingDown, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAuth } from "../contexts/AuthContext";
import { useLocalHoldings } from "../contexts/LocalHoldingsContext";
import { useWalletContext } from "../contexts/WalletContext";
import { useMomentumTemperature } from "../hooks/useMomentumTemperature";

interface ShortModalProps {
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
  /** Maximum short exposure per user, per index — defaults to 500 */
  shortPositionCap?: number;
  /** Score velocity over last 3 ticks (latestScore - scoreThreeTicksAgo). Negative = falling. */
  scoreVelocity?: number;
  /** Inverse pair index name, if this index has one */
  inversePairName?: string;
  /** Dollar value of user's long position in the inverse pair index */
  pairedLongExposure?: number;
}

// ── Scenario Preview helpers (short-specific, inverted formula) ───────────────
// Short profits when the score FALLS. The scenario labels are -5/-10/-20 PTS
// representing score drops that would profit the short. The inverted short
// mark-to-market formula is: value = units * (currentScore + delta - spread)
// where `delta` is the magnitude of the score drop (5, 10, 20) and `spread`
// is the ±0.5 entry/exit spread.
const SHORT_SCENARIO_DELTAS = [5, 10, 20] as const;
const SHORT_SPREAD = 0.5;

interface ShortScenarioResult {
  delta: number;
  positionValue: number;
  gain: number;
  gainPct: number;
}

function computeShortScenarios(
  currentScore: number,
  units: number,
): ShortScenarioResult[] {
  // Baseline short value at the current score (entry reference).
  const baselineValue = units * (currentScore - SHORT_SPREAD);
  return SHORT_SCENARIO_DELTAS.map((delta) => {
    // A score drop of `delta` points profits the short.
    // scenarioScore = currentScore - delta (score falls)
    // short value = units * (scenarioScore - spread) inverted → use (currentScore + delta - spread)
    const positionValue = units * (currentScore + delta - SHORT_SPREAD);
    const gain = positionValue - baselineValue;
    const gainPct = baselineValue > 0 ? (gain / baselineValue) * 100 : 0;
    return { delta, positionValue, gain, gainPct };
  });
}

// Signature Green — matches --primary token (kept for scenario gain text)
const PLATFORM_GREEN = "oklch(0.72 0.18 145)";

/** Max short exposure per user, per index — anti-whale cap */
const DEFAULT_SHORT_POSITION_CAP = 500;

// Shared modal background color — used for sticky header/footer backgrounds
const MODAL_BG = "#000000";

export function ShortModal({
  isOpen,
  onClose,
  assetName,
  category,
  buyPrice,
  redeemPrice,
  currentScore,
  remainingPoolCapacity,
  userPositionValue,
  shortPositionCap = DEFAULT_SHORT_POSITION_CAP,
  scoreVelocity = 0,
  inversePairName,
  pairedLongExposure = 0,
}: ShortModalProps) {
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
  const { userAccount } = useAuth();
  const { addShortCostBasis, openShort } = useLocalHoldings();
  const userId = userAccount?.email ?? "";
  const temperature = useMomentumTemperature(assetName, category);
  const queryClient = useQueryClient();

  // Derived limit values — short-specific: cap is shortPositionCap (default 500)
  const userRemainingAllowance = Math.max(
    0,
    shortPositionCap - userPositionValue,
  );

  const isPoolExhausted = remainingPoolCapacity <= 0;
  const isUserAtLimit = userPositionValue >= shortPositionCap;

  // ── Uptick Rule ───────────────────────────────────────────────────────────
  const DROP_THRESHOLD = -3.0;
  const DROP_WARNING_THRESHOLD = -2.0;
  const isVelocityBlocked = scoreVelocity < DROP_THRESHOLD;
  const isVelocityWarning =
    !isVelocityBlocked &&
    scoreVelocity < DROP_WARNING_THRESHOLD &&
    scoreVelocity >= DROP_THRESHOLD;

  // ── Correlated Pair Exposure ──────────────────────────────────────────────
  const SINGLE_POSITION_LIMIT = 750;
  const isPairedLongBlocking = pairedLongExposure >= SINGLE_POSITION_LIMIT;
  const isCapReduced = !isPairedLongBlocking && shortPositionCap < DEFAULT_SHORT_POSITION_CAP && !!inversePairName;

  // shouldRender keeps the component mounted until the exit animation finishes.
  // isVisible drives the AnimatePresence child — set to false to trigger exit fade.
  // onClose() is called only after the exit animation completes.
  const [shouldRender, setShouldRender] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const closedByHandleClose = useRef(false);

  // Handle open/close with fade transitions
  useEffect(() => {
    if (isOpen) {
      setShouldRender(true);
      setIsVisible(true);
      closedByHandleClose.current = false;
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
    closedByHandleClose.current = true;
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
        `POSITION LIMIT REACHED: Max $${shortPositionCap.toLocaleString()} short per user, per index. ${remaining} remaining.`,
      );
    } else if (
      parsedAmount > 0 &&
      errorMsgRef.current.startsWith("POSITION LIMIT")
    ) {
      setErrorMsg("");
    }
  }, [parsedAmount, userRemainingAllowance, shortPositionCap]);

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
    // Quick select pills are capped at shortPositionCap - userPositionValue
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

    // ── Guard 0: Uptick Rule — block entry during active score decline ───────
    if (isVelocityBlocked) {
      setErrorMsg(
        "Short entry restricted — score is in active decline. " +
          "Wait for score stabilization before opening a short position.",
      );
      setIsProcessing(false);
      return;
    }

    // ── Guard 0b: Correlated pair long blocks full short entry ───────────────
    if (isPairedLongBlocking) {
      setErrorMsg(
        `Short entry unavailable — your existing long position in ${inversePairName} reaches the combined narrative exposure limit.`,
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

    // ── Guard 2: Short position cap ($500 per user per index) ────────────────
    if (parsedAmount >= userRemainingAllowance) {
      const remaining = userRemainingAllowance.toLocaleString("en-US", {
        maximumFractionDigits: 0,
      });
      setErrorMsg(
        `POSITION LIMIT REACHED: Max $${shortPositionCap.toLocaleString()} short per user, per index. $${remaining} remaining.`,
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

    // Calculate units shorted at the current buy price
    const unitsShorted =
      allocInputMode === "units"
        ? parsedUnitsInput
        : buyPrice > 0
          ? parsedAmount / buyPrice
          : 0;

    // Short positions are tracked exclusively in the backend via allocateShort
    // (below) and read back via useUserFullPosition. Do NOT write short units
    // into the legacy local holdings 'units' field — that pollutes unitsOwned
    // for shorts and breaks the long-path redeem bounds.

    // Persist first-allocation flag permanently
    const hasAllocKey = userId
      ? `${userId}_momentum_has_allocated`
      : "momentum_has_allocated";
    localStorage.setItem(hasAllocKey, "true");
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: hasAllocKey,
        newValue: "true",
        storageArea: localStorage,
      }),
    );

    // Log short allocation to activity history
    logSpend(parsedAmount, assetName, unitsShorted, buyPrice);

    // ── Local short position — no canister dependency ────────────────────────
    openShort(assetName, unitsShorted, buyPrice, parsedAmount);
    addShortCostBasis(assetName, parsedAmount);

    // Invalidate assetPrices so capacity bar updates
    queryClient.invalidateQueries({ queryKey: ["assetPrices"] });

    setTimeout(() => {
      setInputValue("");
      setErrorMsg("");
      setIsProcessing(false);
      setIsVisible(false);
    }, 600);
  };

  if (!shouldRender) return null;

  const isConfirmDisabled =
    !isValid ||
    isProcessing ||
    isPoolExhausted ||
    isUserAtLimit ||
    isVelocityBlocked ||
    isPairedLongBlocking;

  const modalContent = (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          aria-label={`Short ${assetName}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3, ease: "easeOut" }}
          onAnimationComplete={(def) => {
            if (def === "exit") {
              setShouldRender(false);
              if (!closedByHandleClose.current) onClose();
              closedByHandleClose.current = false;
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
              fontFamily: "'Inter', system-ui, sans-serif",
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
                  fontWeight: 700,
                  letterSpacing: "-0.01em",
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

              {/* ── Pool Remaining and Short Limit Row ── */}
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
                    Short Limit
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

              {/* ── Velocity Warning (amber) — shown when score approaching drop threshold ── */}
              {isVelocityWarning && (
                <div
                  style={{
                    margin: "0.75rem 1.25rem 0 1.25rem",
                    padding: "0.5rem 0.75rem",
                    borderRadius: "0.5rem",
                    border: "1px solid rgba(245,158,11,0.35)",
                    backgroundColor: "rgba(245,158,11,0.08)",
                    color: "#F59E0B",
                    fontSize: "0.6875rem",
                    lineHeight: 1.5,
                  }}
                >
                  ⚠ Score declining — short entry may be restricted
                </div>
              )}

              {/* ── Velocity Blocked (red) — entry hard-blocked ── */}
              {isVelocityBlocked && (
                <div
                  style={{
                    margin: "0.75rem 1.25rem 0 1.25rem",
                    padding: "0.5rem 0.75rem",
                    borderRadius: "0.5rem",
                    border: "1px solid rgba(239,68,68,0.35)",
                    backgroundColor: "rgba(239,68,68,0.08)",
                    color: "#ef4444",
                    fontSize: "0.6875rem",
                    lineHeight: 1.5,
                  }}
                >
                  Short entry restricted — score is in active decline. Wait for score stabilization.
                </div>
              )}

              {/* ── Correlated pair blocking notice ── */}
              {isPairedLongBlocking && inversePairName && (
                <div
                  style={{
                    margin: "0.75rem 1.25rem 0 1.25rem",
                    padding: "0.5rem 0.75rem",
                    borderRadius: "0.5rem",
                    border: "1px solid rgba(239,68,68,0.35)",
                    backgroundColor: "rgba(239,68,68,0.08)",
                    color: "#ef4444",
                    fontSize: "0.6875rem",
                    lineHeight: 1.5,
                  }}
                >
                  Short entry unavailable — your existing long position in {inversePairName} reaches the combined narrative exposure limit.
                </div>
              )}

              {/* ── Correlated pair cap-reduced notice (amber) ── */}
              {isCapReduced && inversePairName && (
                <div
                  style={{
                    margin: "0.75rem 1.25rem 0 1.25rem",
                    padding: "0.5rem 0.75rem",
                    borderRadius: "0.5rem",
                    border: "1px solid rgba(245,158,11,0.35)",
                    backgroundColor: "rgba(245,158,11,0.08)",
                    color: "#F59E0B",
                    fontSize: "0.6875rem",
                    lineHeight: 1.5,
                  }}
                >
                  Cap reduced — you hold a correlated long position in {inversePairName}. Combined exposure limit: ${SINGLE_POSITION_LIMIT.toLocaleString()}
                </div>
              )}

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
                          ? "1px solid rgba(239,68,68,0.4)"
                          : "1px solid transparent",
                        backgroundColor: isActive
                          ? "rgba(239,68,68,0.15)"
                          : "transparent",
                        color: isActive ? "#ef4444" : "#8E8E93",
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
                        color: parsedAmount > 0 ? (isInsufficient ? "#ef4444" : "#4a4a4a") : "#4a4a4a",
                        fontSize: "1.875rem",
                        fontWeight: 300,
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
                        ? "Short amount in dollars"
                        : "Short amount in shares"
                    }
                    style={{
                      background: "none",
                      border: "none",
                      outline: "none",
                      color: isInsufficient ? "#ef4444" : (parsedAmount > 0 ? "#ffffff" : "#4a4a4a"),
                      fontSize: "2.25rem",
                      fontWeight: 700,
                      caretColor: "#f87171",
                      width: "100%",
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
                  {(["$100", "$250", "MAX"] as const).map((label) => {
                    const value =
                      label === "$100"
                        ? 100
                        : label === "$250"
                          ? 250
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
                  const scenarios = computeShortScenarios(currentScore, units);
                  return (
                    <div
                      ref={previewRef}
                      style={{ margin: "0.875rem 1.25rem 0 1.25rem" }}
                    >
                      {/* Section header — short uses downward trend icon */}
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "0.3rem",
                          marginBottom: "0.5rem",
                        }}
                      >
                        <TrendingDown size={10} style={{ color: "#6b6b6b" }} />
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
                              -{s.delta} pts
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
                  Prices are Oracle-driven and updated in real time. Short
                  positions profit when the score falls. $500 maximum short
                  exposure per index.
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
                  backgroundColor: isConfirmDisabled ? "#1a1a1a" : "#ef4444",
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
                {isVelocityBlocked
                  ? "Entry Restricted — Score Declining"
                  : isPairedLongBlocking
                    ? "Blocked — Correlated Long at Limit"
                    : isPoolExhausted
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
                              : `Confirm Low · $${parsedAmount.toFixed(2)}`}
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  return createPortal(modalContent, document.body);
}
