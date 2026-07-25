import { TrendingUp } from "lucide-react";
import { useState } from "react";
import { CreateAccountForm } from "./CreateAccountForm";
import { PasswordResetForm } from "./PasswordResetForm";
import { SignInForm } from "./SignInForm";

type View = "signin" | "create" | "resetPassword";

export function AuthGateway() {
  const [view, setView] = useState<View>("signin");

  const isResetView = view === "resetPassword";

  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center overflow-y-auto"
      style={{ backgroundColor: "#000000" }}
    >
      {/* Background subtle grid pattern */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage:
            "linear-gradient(rgba(var(--primary-rgb, 74,222,128),0.025) 1px, transparent 1px), linear-gradient(90deg, rgba(var(--primary-rgb, 74,222,128),0.025) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
        }}
      />

      {/* Card */}
      <div
        className="relative w-full max-w-sm mx-4 flex flex-col"
        style={{ zIndex: 1 }}
      >
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div
            className="flex items-center justify-center w-10 h-10 rounded-sm mb-3"
            style={{
              backgroundColor: "oklch(0.72 0.18 145 / 0.08)",
              border: "1px solid oklch(0.72 0.18 145 / 0.22)",
            }}
          >
            <TrendingUp
              className="w-5 h-5"
              style={{ color: "var(--primary)" }}
              strokeWidth={2.5}
            />
          </div>
          <h1
            className="text-3xl font-bold tracking-tight"
            style={{
              color: "#ffffff",
              letterSpacing: "-0.02em",
            }}
          >
            Sentiment
          </h1>
          <p
            className="text-xs mt-1.5 uppercase tracking-widest font-medium"
            style={{ color: "rgba(255,255,255,0.28)" }}
          >
            Asset Management
          </p>
        </div>

        {/* Panel */}
        <div
          className="rounded-sm overflow-hidden"
          style={{
            backgroundColor: "#0a0a0a",
            border: "1px solid #1c1c1c",
          }}
        >
          {/* Tabs — hidden when on reset password view */}
          {!isResetView && (
            <div className="flex" style={{ borderBottom: "1px solid #1c1c1c" }}>
              <button
                type="button"
                onClick={() => setView("signin")}
                className="flex-1 py-3.5 text-xs font-semibold uppercase tracking-widest transition-all duration-150"
                style={{
                  color:
                    view === "signin"
                      ? "var(--primary)"
                      : "rgba(255,255,255,0.28)",
                  borderBottom:
                    view === "signin"
                      ? "2px solid var(--primary)"
                      : "2px solid transparent",
                  backgroundColor: "transparent",
                }}
              >
                Sign In
              </button>
              <button
                type="button"
                onClick={() => setView("create")}
                className="flex-1 py-3.5 text-xs font-semibold uppercase tracking-widest transition-all duration-150"
                style={{
                  color:
                    view === "create"
                      ? "var(--primary)"
                      : "rgba(255,255,255,0.28)",
                  borderBottom:
                    view === "create"
                      ? "2px solid var(--primary)"
                      : "2px solid transparent",
                  backgroundColor: "transparent",
                }}
              >
                Create Account
              </button>
            </div>
          )}

          {/* Reset password header bar */}
          {isResetView && (
            <div
              className="px-5 py-3.5"
              style={{ borderBottom: "1px solid #1c1c1c" }}
            >
              <p
                className="text-xs font-semibold uppercase tracking-widest"
                style={{ color: "rgba(255,255,255,0.28)" }}
              >
                Password Reset
              </p>
            </div>
          )}

          {/* Form area */}
          <div className="p-5">
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
        </div>

        {/* Footer note */}
        <p
          className="text-center text-xs mt-5"
          style={{ color: "rgba(255,255,255,0.18)" }}
        >
          Oracle-driven synthetic exposure to proprietary sentiment data.
        </p>
      </div>
    </div>
  );
}
