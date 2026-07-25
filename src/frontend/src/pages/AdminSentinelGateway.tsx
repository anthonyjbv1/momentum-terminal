import type React from "react";
import { useEffect, useRef, useState } from "react";
import { useAdminAuth } from "../contexts/AdminAuthContext";
import { validateAdminCredentials } from "../utils/adminAuth";

function generateSimulatedIP(): string {
  const octet = () => Math.floor(Math.random() * 254) + 1;
  return `${octet()}.${octet()}.${octet()}.${octet()}`;
}

export function AdminSentinelGateway() {
  const { login } = useAdminAuth();
  const [accessKey, setAccessKey] = useState("");
  const [securityToken, setSecurityToken] = useState("");
  const [error, setError] = useState("");
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [cursorVisible, setCursorVisible] = useState(true);
  const [bootLines, setBootLines] = useState<string[]>([]);
  const bootComplete = useRef(false);

  // Cursor blink
  useEffect(() => {
    const interval = setInterval(() => {
      setCursorVisible((v) => !v);
    }, 530);
    return () => clearInterval(interval);
  }, []);

  // Boot sequence
  useEffect(() => {
    if (bootComplete.current) return;
    bootComplete.current = true;

    const lines = [
      "SENTINEL SECURITY SYSTEM v4.2.1",
      "Initializing secure channel...",
      "Encryption layer: AES-256-GCM [OK]",
      "Identity verification module: LOADED",
      "Access control matrix: ACTIVE",
      "Awaiting administrator credentials...",
    ];

    lines.forEach((line, i) => {
      setTimeout(() => {
        setBootLines((prev) => [...prev, line]);
      }, i * 280);
    });
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setIsAuthenticating(true);

    setTimeout(() => {
      if (validateAdminCredentials(accessKey, securityToken)) {
        login();
        window.location.pathname = "/admin-portal";
      } else {
        const simulatedIP = generateSimulatedIP();
        console.warn("Unauthorized attempt from IP:", simulatedIP);
        setError("SYSTEM ALERT: UNAUTHORIZED ACCESS ATTEMPT");
        setIsAuthenticating(false);
      }
    }, 600);
  };

  const handleAccessKeyChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setAccessKey(e.target.value);
    if (error) setError("");
  };

  const handleSecurityTokenChange = (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    setSecurityToken(e.target.value);
    if (error) setError("");
  };

  return (
    <div style={styles.root}>
      {/* Scanline overlay */}
      <div style={styles.scanlines} />

      <div style={styles.container}>
        {/* Boot log */}
        <div style={styles.bootLog}>
          {bootLines.map((line) => (
            <div key={line} style={styles.bootLine}>
              <span style={styles.prompt}>&gt;&nbsp;</span>
              {line}
            </div>
          ))}
          {bootLines.length > 0 && (
            <div style={styles.bootLine}>
              <span style={styles.prompt}>&gt;&nbsp;</span>
              <span
                style={{ ...styles.cursor, opacity: cursorVisible ? 1 : 0 }}
              >
                █
              </span>
            </div>
          )}
        </div>

        {/* Login box */}
        <div style={styles.loginBox}>
          <div style={styles.header}>
            <div style={styles.headerBracket}>[ SENTINEL ADMIN ACCESS ]</div>
            <div style={styles.headerSub}>
              CLASSIFIED {/* AUTHORIZED PERSONNEL ONLY */}
            </div>
          </div>

          <div style={styles.divider} />

          <form onSubmit={handleSubmit} style={styles.form}>
            <div style={styles.fieldGroup}>
              <label style={styles.label} htmlFor="access-key">
                ADMIN ACCESS KEY
              </label>
              <div style={styles.inputWrapper}>
                <span style={styles.inputPrompt}>&gt;&nbsp;</span>
                <input
                  id="access-key"
                  type="password"
                  value={accessKey}
                  onChange={handleAccessKeyChange}
                  style={styles.input}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="Enter access key..."
                  disabled={isAuthenticating}
                />
              </div>
            </div>

            <div style={styles.fieldGroup}>
              <label style={styles.label} htmlFor="security-token">
                SECURITY TOKEN
              </label>
              <div style={styles.inputWrapper}>
                <span style={styles.inputPrompt}>&gt;&nbsp;</span>
                <input
                  id="security-token"
                  type="password"
                  value={securityToken}
                  onChange={handleSecurityTokenChange}
                  style={styles.input}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="Enter security token..."
                  disabled={isAuthenticating}
                />
              </div>
            </div>

            {error && (
              <div style={styles.errorBox}>
                <span style={styles.errorIcon}>⚠</span>
                <span style={styles.errorText}>{error}</span>
              </div>
            )}

            <button
              type="submit"
              style={{
                ...styles.button,
                ...(isAuthenticating ? styles.buttonDisabled : {}),
              }}
              disabled={isAuthenticating || !accessKey || !securityToken}
            >
              {isAuthenticating ? (
                <span style={styles.buttonContent}>
                  <span style={styles.spinner}>◌</span>
                  &nbsp;AUTHENTICATING...
                </span>
              ) : (
                <span style={styles.buttonContent}>
                  <span style={styles.lockIcon}>⬡</span>
                  &nbsp;AUTHENTICATE
                </span>
              )}
            </button>
          </form>

          <div style={styles.divider} />

          <div style={styles.footer}>
            <span>SESSION ENCRYPTED</span>
            <span style={styles.footerDot}>◆</span>
            <span>ACTIVITY MONITORED</span>
            <span style={styles.footerDot}>◆</span>
            <span>ALL ACCESS LOGGED</span>
          </div>
        </div>

        <div style={styles.bottomBar}>
          SENTINEL SECURITY SYSTEM &nbsp;|&nbsp; {new Date().getFullYear()}{" "}
          &nbsp;|&nbsp; Built with <span style={{ color: "#00FF41" }}>♥</span>{" "}
          using{" "}
          <a
            href={`https://caffeine.ai/?utm_source=Caffeine-footer&utm_medium=referral&utm_content=${encodeURIComponent(window.location.hostname || "unknown-app")}`}
            target="_blank"
            rel="noopener noreferrer"
            style={styles.footerLink}
          >
            caffeine.ai
          </a>
        </div>
      </div>

      <style>{`
        @keyframes sentinel-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes sentinel-blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }
        @keyframes sentinel-scanline {
          0% { transform: translateY(-100%); }
          100% { transform: translateY(100vh); }
        }
        #sentinel-access-key::placeholder,
        #sentinel-security-token::placeholder {
          color: #1a5c1a;
        }
        #access-key::placeholder,
        #security-token::placeholder {
          color: #1a5c1a;
        }
        #access-key:focus,
        #security-token:focus {
          outline: none;
          border-color: #00FF41 !important;
          box-shadow: 0 0 8px rgba(0, 255, 65, 0.4);
        }
        #access-key:disabled,
        #security-token:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
      `}</style>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    position: "fixed",
    inset: 0,
    backgroundColor: "#000000",
    color: "#00CC33",
    fontFamily: "'JetBrains Mono', 'Courier New', Courier, monospace",
    fontSize: "13px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    zIndex: 9999,
  },
  scanlines: {
    position: "fixed",
    inset: 0,
    background:
      "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,255,65,0.015) 2px, rgba(0,255,65,0.015) 4px)",
    pointerEvents: "none",
    zIndex: 1,
  },
  container: {
    position: "relative",
    zIndex: 2,
    width: "100%",
    maxWidth: "560px",
    padding: "0 16px",
    display: "flex",
    flexDirection: "column",
    gap: "16px",
  },
  bootLog: {
    backgroundColor: "rgba(0,20,0,0.6)",
    border: "1px solid #003300",
    padding: "12px 16px",
    fontSize: "11px",
    color: "#00882a",
    lineHeight: "1.7",
    maxHeight: "130px",
    overflowY: "hidden",
  },
  bootLine: {
    display: "flex",
    alignItems: "center",
  },
  prompt: {
    color: "#00FF41",
    flexShrink: 0,
  },
  cursor: {
    color: "#00FF41",
    transition: "opacity 0.1s",
  },
  loginBox: {
    backgroundColor: "#000000",
    border: "1px solid #00CC33",
    boxShadow: "0 0 20px rgba(0,204,51,0.15), inset 0 0 40px rgba(0,20,0,0.5)",
    padding: "28px 32px",
  },
  header: {
    textAlign: "center",
    marginBottom: "20px",
  },
  headerBracket: {
    color: "#00FF41",
    fontSize: "16px",
    fontWeight: "bold",
    letterSpacing: "3px",
    textShadow: "0 0 10px rgba(0,255,65,0.6)",
  },
  headerSub: {
    color: "#005c14",
    fontSize: "10px",
    letterSpacing: "2px",
    marginTop: "6px",
  },
  divider: {
    borderTop: "1px solid #003300",
    margin: "16px 0",
  },
  form: {
    display: "flex",
    flexDirection: "column",
    gap: "20px",
  },
  fieldGroup: {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
  },
  label: {
    color: "#00882a",
    fontSize: "10px",
    letterSpacing: "2px",
    fontWeight: "bold",
  },
  inputWrapper: {
    display: "flex",
    alignItems: "center",
    border: "1px solid #003d00",
    backgroundColor: "#000800",
    padding: "0 10px",
    transition: "border-color 0.2s",
  },
  inputPrompt: {
    color: "#00FF41",
    flexShrink: 0,
    fontSize: "13px",
  },
  input: {
    flex: 1,
    backgroundColor: "transparent",
    border: "none",
    outline: "none",
    color: "#00FF41",
    fontFamily: "'JetBrains Mono', 'Courier New', Courier, monospace",
    fontSize: "13px",
    padding: "10px 6px",
    caretColor: "#00FF41",
    letterSpacing: "1px",
  },
  errorBox: {
    display: "flex",
    alignItems: "flex-start",
    gap: "8px",
    backgroundColor: "rgba(255,0,0,0.08)",
    border: "1px solid #660000",
    padding: "10px 14px",
  },
  errorIcon: {
    color: "#FF3333",
    fontSize: "14px",
    flexShrink: 0,
    marginTop: "1px",
  },
  errorText: {
    color: "#FF3333",
    fontSize: "11px",
    letterSpacing: "1.5px",
    fontWeight: "bold",
    lineHeight: "1.5",
  },
  button: {
    backgroundColor: "#000000",
    border: "1px solid #00FF41",
    color: "#00FF41",
    fontFamily: "'JetBrains Mono', 'Courier New', Courier, monospace",
    fontSize: "13px",
    fontWeight: "bold",
    letterSpacing: "3px",
    padding: "12px 24px",
    cursor: "pointer",
    width: "100%",
    textAlign: "center",
    transition: "background-color 0.2s, box-shadow 0.2s",
    boxShadow: "0 0 8px rgba(0,255,65,0.2)",
  },
  buttonDisabled: {
    opacity: 0.5,
    cursor: "not-allowed",
    boxShadow: "none",
  },
  buttonContent: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "6px",
  },
  lockIcon: {
    fontSize: "14px",
  },
  spinner: {
    display: "inline-block",
    animation: "sentinel-spin 1s linear infinite",
    fontSize: "14px",
  },
  footer: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "8px",
    color: "#003d00",
    fontSize: "9px",
    letterSpacing: "1.5px",
    flexWrap: "wrap",
  },
  footerDot: {
    color: "#005c14",
    fontSize: "7px",
  },
  bottomBar: {
    textAlign: "center",
    color: "#003d00",
    fontSize: "10px",
    letterSpacing: "1px",
  },
  footerLink: {
    color: "#00882a",
    textDecoration: "none",
  },
};
