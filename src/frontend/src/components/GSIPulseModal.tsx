import { X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import React, { useEffect } from "react";
import { createPortal } from "react-dom";
import { ACTIVE_INDICES, getBeta } from "../services/gsiCovarianceEngine";

interface GSIPulseModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentGSI: number | null;
}

function getBetaSensitivityTier(beta: number): string {
  if (beta >= 1.0) return "High";
  if (beta >= 0.5) return "Moderate";
  if (beta > 0) return "Low";
  return "Inverse";
}

function SensitivityRow({ name }: { name: string }) {
  const beta = getBeta(name);
  const tier = getBetaSensitivityTier(beta);
  const shortName = name.replace(" Index", "");

  const tierColor =
    tier === "High"
      ? "#4ade80"
      : tier === "Moderate"
        ? "#fbbf24"
        : tier === "Low"
          ? "#94a3b8"
          : "#f87171";

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr auto",
        gap: "12px",
        alignItems: "center",
        padding: "8px 0",
        borderBottom: "1px solid #1a1a1a",
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: "0.75rem",
      }}
    >
      <span style={{ color: "#e2e8f0", fontWeight: 600 }}>{shortName}</span>
      <span style={{ color: tierColor, textAlign: "right", fontWeight: 700 }}>
        {tier}
      </span>
    </div>
  );
}

export default function GSIPulseModal({
  isOpen,
  onClose,
  currentGSI,
}: GSIPulseModalProps) {
  // Close on Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [isOpen, onClose]);

  // Prevent body scroll when open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  const gsiDisplay =
    currentGSI !== null ? currentGSI.toFixed(2) : "Calculating…";
  const gsiColor =
    currentGSI === null
      ? "#64748b"
      : currentGSI >= 55
        ? "#4ade80"
        : currentGSI <= 45
          ? "#f87171"
          : "#fbbf24";

  const modalContent = (
    <AnimatePresence>
      {isOpen && (
        <motion.dialog
          open
          aria-label="GSI Pulse — Global Sentiment Index"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3, ease: "easeOut" }}
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
            padding: "16px",
            fontFamily: "'Inter', system-ui, sans-serif",
          }}
        >
          {/* Backdrop */}
          <div
            onClick={onClose}
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
            }}
            role="presentation"
            style={{
              position: "absolute",
              inset: 0,
              background: "rgba(0,0,0,0.80)",
              backdropFilter: "blur(8px)",
              WebkitBackdropFilter: "blur(8px)",
              zIndex: 0,
            }}
          />

          {/* Modal panel */}
          <div
            style={{
              position: "relative",
              zIndex: 1,
              width: "100%",
              maxWidth: "540px",
              maxHeight: "90vh",
              background: "#000000",
              border: "1px solid #2a2a2a",
              borderRadius: "16px",
              boxShadow: "0 25px 60px rgba(0,0,0,0.8)",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
          >
            {/* Header */}
            <div
              style={{
                padding: "20px 24px 16px",
                borderBottom: "1px solid rgba(255,255,255,0.08)",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                flexShrink: 0,
                background: "#000000",
              }}
            >
              <div
                style={{ display: "flex", flexDirection: "column", gap: "2px" }}
              >
                <h2
                  style={{
                    fontSize: "1rem",
                    fontWeight: 700,
                    color: "#f1f5f9",
                    letterSpacing: "0.01em",
                    margin: 0,
                  }}
                >
                  GSI Pulse — Global Sentiment Index
                </h2>
                <span
                  style={{
                    fontSize: "0.65rem",
                    color: "#64748b",
                    textTransform: "uppercase",
                    letterSpacing: "0.12em",
                    fontWeight: 600,
                  }}
                >
                  Macro Engine · Tidal Propagation
                </span>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close GSI modal"
                data-ocid="gsi_modal.close_button"
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  padding: "6px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#94a3b8",
                  borderRadius: "8px",
                  transition: "color 0.15s, background 0.15s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = "#f1f5f9";
                  e.currentTarget.style.background = "rgba(255,255,255,0.08)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = "#94a3b8";
                  e.currentTarget.style.background = "none";
                }}
              >
                <X style={{ width: "18px", height: "18px" }} strokeWidth={2} />
              </button>
            </div>

            {/* Scrollable body */}
            <div style={{ overflowY: "auto", flex: 1 }}>
              <div style={{ padding: "20px 24px 28px" }}>
                {/* Live GSI Score */}
                <div
                  style={{
                    borderRadius: "12px",
                    border: "1px solid #2a2a2a",
                    background: "#000000",
                    padding: "20px",
                    marginBottom: "16px",
                    textAlign: "center",
                  }}
                >
                  <p
                    style={{
                      fontSize: "0.6rem",
                      color: "#64748b",
                      textTransform: "uppercase",
                      letterSpacing: "0.14em",
                      fontWeight: 600,
                      marginBottom: "10px",
                      margin: "0 0 10px 0",
                    }}
                  >
                    Current GSI Score
                  </p>
                  <span
                    style={{
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: "2.5rem",
                      fontWeight: 800,
                      color: gsiColor,
                      letterSpacing: "-0.02em",
                    }}
                  >
                    {gsiDisplay}
                  </span>
                  <p
                    style={{
                      fontSize: "0.7rem",
                      color: "#475569",
                      marginTop: "6px",
                      margin: "6px 0 0 0",
                    }}
                  >
                    Weighted composite of all 5 active indices
                  </p>
                </div>

                {/* What is the GSI */}
                <div
                  style={{
                    borderRadius: "10px",
                    border: "1px solid #2a2a2a",
                    background: "#000000",
                    padding: "16px",
                    marginBottom: "14px",
                  }}
                >
                  <p
                    style={{
                      fontSize: "0.65rem",
                      color: "#64748b",
                      textTransform: "uppercase",
                      letterSpacing: "0.12em",
                      fontWeight: 600,
                      marginBottom: "10px",
                      margin: "0 0 10px 0",
                    }}
                  >
                    What is the GSI?
                  </p>
                  <p
                    style={{
                      fontSize: "0.8rem",
                      color: "#94a3b8",
                      lineHeight: 1.7,
                      margin: 0,
                    }}
                  >
                    The{" "}
                    <span style={{ color: "#f1f5f9", fontWeight: 600 }}>
                      Global Sentiment Index (GSI)
                    </span>{" "}
                    is SentimentAM's proprietary macro pulse — a single
                    composite score that captures the aggregate sentiment state
                    of global markets. It is computed as a{" "}
                    <span style={{ color: "#86efac" }}>
                      proprietary weighted composite
                    </span>{" "}
                    of all active sentiment indices, reflecting the systemic
                    importance of each index to the global narrative economy.
                    When the GSI moves, it acts as a{" "}
                    <span style={{ color: "#86efac" }}>tidal force</span> —
                    driving correlated drift across every child index via each
                    index's Global Sensitivity coefficient.
                  </p>
                </div>

                {/* GSI Methodology */}
                <div
                  style={{
                    borderRadius: "10px",
                    border: "1px solid #2a2a2a",
                    background: "#000000",
                    padding: "16px",
                    marginBottom: "14px",
                  }}
                >
                  {/* GSI Methodology subsection */}
                  <p
                    style={{
                      fontSize: "0.65rem",
                      color: "#64748b",
                      textTransform: "uppercase",
                      letterSpacing: "0.12em",
                      fontWeight: 600,
                      marginBottom: "10px",
                      margin: "0 0 10px 0",
                    }}
                  >
                    GSI Methodology
                  </p>
                  <p
                    style={{
                      fontSize: "0.8rem",
                      color: "#94a3b8",
                      lineHeight: 1.7,
                      margin: "0 0 16px 0",
                    }}
                  >
                    The GSI is computed as a proprietary weighted composite of
                    all active sentiment indices, reflecting each index's
                    systemic importance to the global narrative economy.
                  </p>

                  {/* Tidal Propagation subsection */}
                  <p
                    style={{
                      fontSize: "0.65rem",
                      color: "#64748b",
                      textTransform: "uppercase",
                      letterSpacing: "0.12em",
                      fontWeight: 600,
                      marginBottom: "10px",
                      margin: "0 0 10px 0",
                    }}
                  >
                    Tidal Propagation
                  </p>
                  <p
                    style={{
                      fontSize: "0.8rem",
                      color: "#94a3b8",
                      lineHeight: 1.7,
                      margin: 0,
                    }}
                  >
                    GSI movement applies a correlated drift across all child
                    indexes via each index's Global Sensitivity coefficient.
                    Indexes with higher sensitivity respond more strongly to
                    macro-level narrative shifts. Indexes with inverse
                    sensitivity move counter to global sentiment — reflecting
                    safe-haven or contrarian narrative dynamics.
                  </p>
                </div>

                {/* Index sensitivity table */}
                <div
                  style={{
                    borderRadius: "10px",
                    border: "1px solid #2a2a2a",
                    background: "#000000",
                    padding: "16px",
                  }}
                >
                  <p
                    style={{
                      fontSize: "0.65rem",
                      color: "#64748b",
                      textTransform: "uppercase",
                      letterSpacing: "0.12em",
                      fontWeight: 600,
                      marginBottom: "4px",
                      margin: "0 0 4px 0",
                    }}
                  >
                    Index Sensitivity
                  </p>

                  {/* Column headers */}
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr auto",
                      gap: "12px",
                      padding: "6px 0",
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: "0.6rem",
                      color: "#475569",
                      textTransform: "uppercase",
                      letterSpacing: "0.1em",
                    }}
                  >
                    <span>Index</span>
                    <span style={{ textAlign: "right" }}>Sensitivity</span>
                  </div>

                  {ACTIVE_INDICES.map((name) => (
                    <SensitivityRow key={name} name={name} />
                  ))}

                  <p
                    style={{
                      fontSize: "0.65rem",
                      color: "#475569",
                      marginTop: "10px",
                      margin: "10px 0 0 0",
                      fontStyle: "italic",
                    }}
                  >
                    Indexes with Inverse sensitivity move counter to broader
                    sentiment trends.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </motion.dialog>
      )}
    </AnimatePresence>
  );

  return createPortal(modalContent, document.body);
}
