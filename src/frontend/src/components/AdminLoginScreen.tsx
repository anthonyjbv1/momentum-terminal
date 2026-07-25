import type React from "react";
import { useEffect, useRef, useState } from "react";
import { useAdminAuth } from "../contexts/AdminAuthContext";
import { validateAdminKey } from "../utils/adminAuth";

const TERMINAL_GREEN = "#00ff88";
const TERMINAL_DIM = "#00aa55";
const TERMINAL_RED = "#ff4444";
const TERMINAL_BG = "#000000";
const TERMINAL_SURFACE = "#0a0a0a";
const TERMINAL_BORDER = "#003322";

export function AdminLoginScreen() {
  const { login } = useAdminAuth();
  const [keyInput, setKeyInput] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [bootLines, setBootLines] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  // Boot sequence animation
  useEffect(() => {
    const lines = [
      "> INITIALIZING SECURE TERMINAL...",
      "> LOADING ENCRYPTION MODULES... OK",
      "> VERIFYING SYSTEM INTEGRITY... OK",
      "> AWAITING AUTHORIZATION KEY",
    ];
    let i = 0;
    const interval = setInterval(() => {
      if (i < lines.length) {
        setBootLines((prev) => [...prev, lines[i]]);
        i++;
      } else {
        clearInterval(interval);
        inputRef.current?.focus();
      }
    }, 300);
    return () => clearInterval(interval);
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError("");

    // Simulate brief processing delay for terminal feel
    setTimeout(() => {
      if (validateAdminKey(keyInput)) {
        login();
      } else {
        setError("ACCESS DENIED: Invalid credentials");
        setKeyInput("");
        setIsSubmitting(false);
        inputRef.current?.focus();
      }
    }, 600);
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        backgroundColor: TERMINAL_BG,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "'JetBrains Mono', 'Courier New', monospace",
        padding: "24px",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "560px",
          border: `1px solid ${TERMINAL_BORDER}`,
          backgroundColor: TERMINAL_SURFACE,
          boxShadow:
            "0 0 40px rgba(0, 255, 136, 0.08), 0 0 80px rgba(0, 255, 136, 0.04)",
        }}
      >
        {/* Terminal Title Bar */}
        <div
          style={{
            backgroundColor: "#050505",
            borderBottom: `1px solid ${TERMINAL_BORDER}`,
            padding: "10px 16px",
            display: "flex",
            alignItems: "center",
            gap: "8px",
          }}
        >
          <div
            style={{
              width: 10,
              height: 10,
              borderRadius: "50%",
              backgroundColor: "#333",
            }}
          />
          <div
            style={{
              width: 10,
              height: 10,
              borderRadius: "50%",
              backgroundColor: "#333",
            }}
          />
          <div
            style={{
              width: 10,
              height: 10,
              borderRadius: "50%",
              backgroundColor: TERMINAL_DIM,
            }}
          />
          <span
            style={{
              marginLeft: "12px",
              color: TERMINAL_DIM,
              fontSize: "11px",
              letterSpacing: "0.15em",
              textTransform: "uppercase",
            }}
          >
            admin-terminal — restricted access
          </span>
        </div>

        {/* Terminal Body */}
        <div style={{ padding: "32px" }}>
          {/* Header */}
          <div style={{ marginBottom: "28px" }}>
            <div
              style={{
                color: TERMINAL_GREEN,
                fontSize: "11px",
                letterSpacing: "0.2em",
                marginBottom: "8px",
                opacity: 0.6,
              }}
            >
              ████████████████████████████████
            </div>
            <h1
              style={{
                color: TERMINAL_GREEN,
                fontSize: "20px",
                fontWeight: 700,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                margin: 0,
                textShadow: "0 0 20px rgba(0, 255, 136, 0.4)",
              }}
            >
              ADMIN TERMINAL
            </h1>
            <p
              style={{
                color: TERMINAL_DIM,
                fontSize: "11px",
                letterSpacing: "0.15em",
                margin: "4px 0 0 0",
                textTransform: "uppercase",
              }}
            >
              {/* RESTRICTED ACCESS — AUTHORIZED PERSONNEL ONLY */}
            </p>
            <div
              style={{
                color: TERMINAL_GREEN,
                fontSize: "11px",
                letterSpacing: "0.2em",
                marginTop: "8px",
                opacity: 0.6,
              }}
            >
              ████████████████████████████████
            </div>
          </div>

          {/* Boot Lines */}
          <div style={{ marginBottom: "24px", minHeight: "80px" }}>
            {bootLines.map((line, idx) => (
              <div
                key={line}
                style={{
                  color:
                    idx === bootLines.length - 1
                      ? TERMINAL_GREEN
                      : TERMINAL_DIM,
                  fontSize: "12px",
                  letterSpacing: "0.05em",
                  lineHeight: "1.8",
                  opacity: idx === bootLines.length - 1 ? 1 : 0.5,
                }}
              >
                {line}
              </div>
            ))}
          </div>

          {/* Login Form */}
          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: "16px" }}>
              <label
                htmlFor="admin-auth-key"
                style={{
                  display: "block",
                  color: TERMINAL_DIM,
                  fontSize: "11px",
                  letterSpacing: "0.15em",
                  textTransform: "uppercase",
                  marginBottom: "8px",
                }}
              >
                Authorization Key
              </label>
              <div style={{ position: "relative" }}>
                <span
                  style={{
                    position: "absolute",
                    left: "12px",
                    top: "50%",
                    transform: "translateY(-50%)",
                    color: TERMINAL_GREEN,
                    fontSize: "14px",
                    pointerEvents: "none",
                  }}
                >
                  &gt;
                </span>
                <input
                  id="admin-auth-key"
                  ref={inputRef}
                  type="password"
                  value={keyInput}
                  onChange={(e) => {
                    setKeyInput(e.target.value);
                    setError("");
                  }}
                  placeholder="Enter authorization key..."
                  disabled={isSubmitting}
                  style={{
                    width: "100%",
                    backgroundColor: "#050505",
                    border: `1px solid ${error ? TERMINAL_RED : TERMINAL_BORDER}`,
                    color: TERMINAL_GREEN,
                    fontFamily: "'JetBrains Mono', 'Courier New', monospace",
                    fontSize: "13px",
                    padding: "12px 12px 12px 28px",
                    outline: "none",
                    letterSpacing: "0.05em",
                    boxSizing: "border-box",
                    transition: "border-color 0.2s",
                    caretColor: TERMINAL_GREEN,
                  }}
                  onFocus={(e) => {
                    if (!error) {
                      e.target.style.borderColor = TERMINAL_GREEN;
                      e.target.style.boxShadow =
                        "0 0 8px rgba(0, 255, 136, 0.15)";
                    }
                  }}
                  onBlur={(e) => {
                    if (!error) {
                      e.target.style.borderColor = TERMINAL_BORDER;
                      e.target.style.boxShadow = "none";
                    }
                  }}
                />
              </div>
            </div>

            {/* Error Message */}
            {error && (
              <div
                style={{
                  color: TERMINAL_RED,
                  fontSize: "12px",
                  letterSpacing: "0.1em",
                  marginBottom: "16px",
                  padding: "8px 12px",
                  border: "1px solid rgba(255, 68, 68, 0.3)",
                  backgroundColor: "rgba(255, 68, 68, 0.05)",
                }}
              >
                ⚠ {error}
              </div>
            )}

            {/* Submit Button */}
            <button
              type="submit"
              disabled={isSubmitting || !keyInput}
              style={{
                width: "100%",
                backgroundColor: isSubmitting ? "transparent" : "transparent",
                border: `1px solid ${isSubmitting ? TERMINAL_DIM : TERMINAL_GREEN}`,
                color: isSubmitting ? TERMINAL_DIM : TERMINAL_GREEN,
                fontFamily: "'JetBrains Mono', 'Courier New', monospace",
                fontSize: "12px",
                fontWeight: 700,
                letterSpacing: "0.2em",
                textTransform: "uppercase",
                padding: "14px",
                cursor: isSubmitting || !keyInput ? "not-allowed" : "pointer",
                transition: "all 0.2s",
                boxShadow: isSubmitting
                  ? "none"
                  : "0 0 12px rgba(0, 255, 136, 0.1)",
                opacity: !keyInput ? 0.4 : 1,
              }}
              onMouseEnter={(e) => {
                if (!isSubmitting && keyInput) {
                  (e.target as HTMLButtonElement).style.backgroundColor =
                    "rgba(0, 255, 136, 0.08)";
                  (e.target as HTMLButtonElement).style.boxShadow =
                    "0 0 20px rgba(0, 255, 136, 0.2)";
                }
              }}
              onMouseLeave={(e) => {
                (e.target as HTMLButtonElement).style.backgroundColor =
                  "transparent";
                (e.target as HTMLButtonElement).style.boxShadow = isSubmitting
                  ? "none"
                  : "0 0 12px rgba(0, 255, 136, 0.1)";
              }}
            >
              {isSubmitting ? "> AUTHENTICATING..." : "> AUTHENTICATE"}
            </button>
          </form>

          {/* Footer */}
          <div
            style={{
              marginTop: "24px",
              paddingTop: "16px",
              borderTop: `1px solid ${TERMINAL_BORDER}`,
              color: TERMINAL_DIM,
              fontSize: "10px",
              letterSpacing: "0.1em",
              opacity: 0.5,
              textAlign: "center",
            }}
          >
            UNAUTHORIZED ACCESS IS PROHIBITED AND MONITORED
          </div>
        </div>
      </div>
    </div>
  );
}
