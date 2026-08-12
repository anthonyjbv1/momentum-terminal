import { useState } from "react";
import { CreateAccountForm } from "./CreateAccountForm";
import { PasswordResetForm } from "./PasswordResetForm";
import { SignInForm } from "./SignInForm";

type View = "signin" | "create" | "resetPassword";

const STAT_ROWS = [
  { label: "Indexes", value: "53" },
  { label: "Oracle Model", value: "AI / NLP" },
  { label: "Update Freq", value: "Real-time" },
  { label: "Asset Class", value: "Sentiment" },
];

export function AuthGateway() {
  const [view, setView] = useState<View>("signin");
  const isResetView = view === "resetPassword";

  return (
    <div
      className="fixed inset-0 z-[100] flex overflow-hidden"
      style={{ backgroundColor: "#050505" }}
    >
      {/* ── Left panel — branding / data (hidden on mobile) ── */}
      <div
        className="hidden lg:flex flex-col justify-between w-[420px] shrink-0 px-10 py-10 border-r"
        style={{ borderColor: "rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.01)" }}
      >
        {/* Top: wordmark */}
        <div>
          <div className="flex items-center gap-2 mb-12">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
            <span
              className="text-[10px] uppercase tracking-widest font-bold"
              style={{ color: "rgba(255,255,255,0.3)", fontFamily: "'JetBrains Mono', monospace" }}
            >
              MOMENTUM TERMINAL
            </span>
          </div>

          <h1
            className="font-bold leading-tight mb-3"
            style={{ fontSize: "2rem", color: "#fff", letterSpacing: "-0.03em", fontFamily: "'Inter', system-ui, sans-serif" }}
          >
            Trade the<br />Narrative.
          </h1>
          <p
            className="text-sm leading-relaxed mb-10"
            style={{ color: "rgba(255,255,255,0.35)", maxWidth: "280px" }}
          >
            Oracle-powered sentiment indexes. Every headline moves prices. Every position has a clock.
          </p>

          {/* Stat grid */}
          <div className="grid grid-cols-2 gap-2">
            {STAT_ROWS.map((s) => (
              <div
                key={s.label}
                className="flex flex-col gap-1 px-3 py-2.5 rounded"
                style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.05)" }}
              >
                <span
                  className="text-[9px] uppercase tracking-widest font-semibold"
                  style={{ color: "rgba(255,255,255,0.25)" }}
                >
                  {s.label}
                </span>
                <span
                  className="font-bold text-sm"
                  style={{ color: "rgba(255,255,255,0.8)", fontFamily: "'JetBrains Mono', monospace" }}
                >
                  {s.value}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Bottom: status */}
        <div
          className="flex items-center gap-2 px-3 py-2 rounded"
          style={{ background: "rgba(74,222,128,0.05)", border: "1px solid rgba(74,222,128,0.12)" }}
        >
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse shrink-0" />
          <span className="text-[10px] uppercase tracking-wider font-semibold text-green-400">
            Oracle Systems Nominal
          </span>
        </div>
      </div>

      {/* ── Right panel — auth form ── */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-10 overflow-y-auto">
        {/* Mobile wordmark */}
        <div className="lg:hidden flex items-center gap-2 mb-8">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
          <span
            className="text-[10px] uppercase tracking-widest font-bold"
            style={{ color: "rgba(255,255,255,0.4)", fontFamily: "'JetBrains Mono', monospace" }}
          >
            MOMENTUM TERMINAL
          </span>
        </div>

        <div className="w-full max-w-sm">
          {/* Header */}
          <div className="mb-6">
            {isResetView ? (
              <>
                <h2 className="text-lg font-bold text-white mb-1" style={{ letterSpacing: "-0.01em" }}>
                  Reset Password
                </h2>
                <p className="text-xs" style={{ color: "rgba(255,255,255,0.35)" }}>
                  Enter your email and we'll send reset instructions.
                </p>
              </>
            ) : view === "signin" ? (
              <>
                <h2 className="text-lg font-bold text-white mb-1" style={{ letterSpacing: "-0.01em" }}>
                  Welcome back
                </h2>
                <p className="text-xs" style={{ color: "rgba(255,255,255,0.35)" }}>
                  Sign in to your Momentum Terminal account.
                </p>
              </>
            ) : (
              <>
                <h2 className="text-lg font-bold text-white mb-1" style={{ letterSpacing: "-0.01em" }}>
                  Create account
                </h2>
                <p className="text-xs" style={{ color: "rgba(255,255,255,0.35)" }}>
                  Start trading sentiment indexes with a clean slate.
                </p>
              </>
            )}
          </div>

          {/* Tab row — hidden on reset view */}
          {!isResetView && (
            <div
              className="flex mb-5 rounded"
              style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", padding: "3px" }}
            >
              {(["signin", "create"] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setView(tab)}
                  className="flex-1 py-2 text-[11px] font-semibold uppercase tracking-widest rounded transition-all duration-150"
                  style={{
                    background: view === tab ? "rgba(255,255,255,0.07)" : "transparent",
                    color: view === tab ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.25)",
                    border: view === tab ? "1px solid rgba(255,255,255,0.1)" : "1px solid transparent",
                  }}
                >
                  {tab === "signin" ? "Sign In" : "Create Account"}
                </button>
              ))}
            </div>
          )}

          {/* Form card */}
          <div
            className="rounded-lg p-5"
            style={{
              background: "#0a0a0a",
              border: "1px solid rgba(255,255,255,0.07)",
              boxShadow: "0 16px 40px rgba(0,0,0,0.5)",
            }}
          >
            {view === "signin" && (
              <SignInForm
                onSwitchToCreate={() => setView("create")}
                onForgotPassword={() => setView("resetPassword")}
              />
            )}
            {view === "create" && <CreateAccountForm />}
            {view === "resetPassword" && (
              <PasswordResetForm onBackToSignIn={() => setView("signin")} />
            )}
          </div>

          {/* Footer */}
          <p
            className="text-center text-[11px] mt-5"
            style={{ color: "rgba(255,255,255,0.14)" }}
          >
            Oracle-driven synthetic exposure to proprietary sentiment data.
          </p>
        </div>
      </div>
    </div>
  );
}
