import { Building2, ChevronDown, Lock, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";

interface DepositModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (amount: number) => void;
}

export function DepositModal({
  isOpen,
  onClose,
  onConfirm,
}: DepositModalProps) {
  const [inputValue, setInputValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset input when modal opens
  useEffect(() => {
    if (isOpen) {
      setInputValue("");
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  // Close on Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [isOpen, onClose]);

  const parsedAmount = Number.parseFloat(inputValue.replace(/,/g, "")) || 0;
  const isValid = parsedAmount > 0;

  const handleQuickAdd = (amount: number) => {
    const current = Number.parseFloat(inputValue.replace(/,/g, "")) || 0;
    const next = current + amount;
    setInputValue(next % 1 === 0 ? String(next) : next.toFixed(2));
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    // Allow digits, one decimal point, and commas
    if (/^[\d,]*\.?\d{0,2}$/.test(val) || val === "") {
      setInputValue(val);
    }
  };

  const handleConfirm = () => {
    if (!isValid) return;
    onConfirm(parsedAmount);
    onClose();
    setInputValue("");
  };

  const displayValue = inputValue === "" ? "" : inputValue;

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.dialog
          open
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3, ease: "easeOut" }}
          className="fixed inset-0 z-[60] flex items-center justify-center p-4 m-0 max-w-none w-full h-full"
          style={{
            backdropFilter: "blur(8px)",
            WebkitBackdropFilter: "blur(8px)",
            backgroundColor: "rgba(0,0,0,0.75)",
            border: "none",
            padding: 0,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
          onKeyDown={(e) => {
            if (
              (e.key === "Enter" || e.key === " ") &&
              e.target === e.currentTarget
            )
              onClose();
          }}
          aria-label="Transfer Funds"
        >
          <div
            className="w-full max-w-sm flex flex-col rounded-xl overflow-hidden"
            style={{
              backgroundColor: "#000000",
              border: "1px solid #2a2a2a",
              fontFamily: "'Inter', sans-serif",
            }}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 pt-6 pb-5">
              <h2 className="text-xl font-bold" style={{ color: "#ffffff" }}>
                Transfer Funds
              </h2>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="flex items-center justify-center w-8 h-8 rounded-full transition-colors duration-150"
                style={{ color: "#6b6b6b" }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = "#ffffff";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = "#6b6b6b";
                }}
              >
                <X className="w-5 h-5" strokeWidth={2} />
              </button>
            </div>

            {/* Divider */}
            <div style={{ height: "1px", backgroundColor: "#1a1a1a" }} />

            <div className="px-6 py-5 flex flex-col gap-5">
              {/* Funding Source */}
              <div>
                <p
                  className="text-[10px] uppercase tracking-widest font-semibold mb-2"
                  style={{ color: "#6b6b6b" }}
                >
                  Funding Source
                </p>
                <div
                  className="flex items-center gap-3 px-4 py-3.5 rounded-xl cursor-default"
                  style={{
                    backgroundColor: "#111111",
                    border: "1px solid #1e1e1e",
                  }}
                >
                  <div
                    className="flex items-center justify-center w-9 h-9 rounded-lg shrink-0"
                    style={{ backgroundColor: "#1e1e1e" }}
                  >
                    <Building2
                      className="w-4 h-4"
                      style={{ color: "#8a8a8a" }}
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p
                      className="text-sm font-semibold"
                      style={{ color: "#ffffff" }}
                    >
                      Bank Account ****4242
                    </p>
                    <p className="text-xs" style={{ color: "#6b6b6b" }}>
                      Checking · Instant
                    </p>
                  </div>
                  <ChevronDown
                    className="w-4 h-4 shrink-0"
                    style={{ color: "#6b6b6b" }}
                  />
                </div>
              </div>

              {/* Amount */}
              <div>
                <p
                  className="text-[10px] uppercase tracking-widest font-semibold mb-2"
                  style={{ color: "#6b6b6b" }}
                >
                  Amount
                </p>
                <div
                  className="flex items-center gap-2 px-5 py-5 rounded-xl"
                  style={{
                    backgroundColor: "#111111",
                    border: "1px solid #1e1e1e",
                  }}
                >
                  <span
                    className="text-3xl font-light select-none"
                    style={{ color: "#4a4a4a" }}
                  >
                    $
                  </span>
                  <input
                    ref={inputRef}
                    type="text"
                    inputMode="decimal"
                    placeholder="0.00"
                    value={displayValue}
                    onChange={handleInputChange}
                    className="flex-1 bg-transparent outline-none text-4xl font-bold tabular-nums min-w-0"
                    style={{
                      color: isValid ? "#ffffff" : "#4a4a4a",
                      caretColor: "oklch(0.72 0.18 145)",
                    }}
                    aria-label="Deposit amount"
                  />
                </div>

                {/* Quick-select pills */}
                <div className="flex gap-2 mt-3">
                  {[
                    { label: "+$100", amount: 100 },
                    { label: "+$500", amount: 500 },
                    { label: "+$1,000", amount: 1000 },
                  ].map(({ label, amount }) => (
                    <button
                      key={label}
                      type="button"
                      onClick={() => handleQuickAdd(amount)}
                      className="flex-1 py-2.5 rounded-full text-sm font-medium transition-colors duration-150"
                      style={{
                        backgroundColor: "#1a1a1a",
                        color: "#ffffff",
                        border: "1px solid #2a2a2a",
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.backgroundColor = "#252525";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = "#1a1a1a";
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Confirm Button */}
              <button
                type="button"
                onClick={handleConfirm}
                disabled={!isValid}
                className="w-full py-4 rounded-xl text-sm font-semibold transition-all duration-150"
                style={{
                  backgroundColor: isValid ? "oklch(0.52 0.17 145)" : "#1a1a1a",
                  color: isValid ? "#ffffff" : "#4a4a4a",
                  cursor: isValid ? "pointer" : "not-allowed",
                  border: "none",
                }}
                onMouseEnter={(e) => {
                  if (isValid)
                    e.currentTarget.style.backgroundColor =
                      "oklch(0.58 0.18 145)";
                }}
                onMouseLeave={(e) => {
                  if (isValid)
                    e.currentTarget.style.backgroundColor =
                      "oklch(0.52 0.17 145)";
                }}
              >
                {isValid
                  ? `Confirm Transfer · ${formatCurrency(parsedAmount)}`
                  : "Enter an Amount"}
              </button>
            </div>

            {/* Legal Footer */}
            <div
              className="px-6 py-4 flex items-start gap-2.5"
              style={{ borderTop: "1px solid #1a1a1a" }}
            >
              <Lock
                className="w-3.5 h-3.5 shrink-0 mt-0.5"
                style={{ color: "#4a4a4a" }}
              />
              <p
                className="text-xs leading-relaxed"
                style={{ color: "#4a4a4a" }}
              >
                Buying Power is usually granted instantly. Transfers are secured
                via 256-bit encryption.
              </p>
            </div>
          </div>
        </motion.dialog>
      )}
    </AnimatePresence>
  );
}

function formatCurrency(value: number): string {
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
