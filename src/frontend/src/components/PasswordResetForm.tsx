import { ArrowLeft, CheckCircle, Loader2, Mail } from "lucide-react";
import { useState } from "react";
import { useAuth } from "../contexts/AuthContext";

interface PasswordResetFormProps {
  onBackToSignIn: () => void;
}

export function PasswordResetForm({ onBackToSignIn }: PasswordResetFormProps) {
  const { resetPassword } = useAuth();
  const [email, setEmail] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!email.trim()) {
      setError("Please enter your email address.");
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      setError("Please enter a valid email address.");
      return;
    }

    setIsLoading(true);
    try {
      await resetPassword(email.trim());
      setIsSuccess(true);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    backgroundColor: "#141414",
    border: "1px solid #242424",
    color: "#ffffff",
    borderRadius: "4px",
    padding: "10px 13px",
    fontSize: "14px",
    width: "100%",
    outline: "none",
    transition: "border-color 0.15s",
  };

  if (isSuccess) {
    return (
      <div className="flex flex-col items-center gap-4 py-2">
        {/* Success icon */}
        <div
          className="flex items-center justify-center w-12 h-12 rounded-full"
          style={{
            backgroundColor: "oklch(0.72 0.18 145 / 0.10)",
            border: "1px solid oklch(0.72 0.18 145 / 0.30)",
          }}
        >
          <CheckCircle
            className="w-6 h-6"
            style={{ color: "var(--primary)" }}
          />
        </div>

        <div className="text-center">
          <p
            className="font-semibold text-sm mb-1.5"
            style={{ color: "#ffffff" }}
          >
            Check your inbox
          </p>
          <p
            className="text-xs leading-relaxed"
            style={{ color: "rgba(255,255,255,0.45)" }}
          >
            If an account with{" "}
            <span style={{ color: "rgba(255,255,255,0.7)" }}>{email}</span>{" "}
            exists, a password reset link has been sent.
          </p>
        </div>

        <button
          type="button"
          onClick={onBackToSignIn}
          className="w-full py-2.5 rounded-sm font-semibold text-sm tracking-wide transition-all duration-150 hover:brightness-110 active:scale-[0.98]"
          style={{
            backgroundColor: "var(--primary)",
            color: "oklch(0.10 0.008 240)",
            marginTop: "4px",
          }}
        >
          Back to Sign In
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
      {/* Header */}
      <div className="flex flex-col gap-1 mb-1">
        <div className="flex items-center gap-2">
          <div
            className="flex items-center justify-center w-7 h-7 rounded-sm"
            style={{
              backgroundColor: "oklch(0.72 0.18 145 / 0.08)",
              border: "1px solid oklch(0.72 0.18 145 / 0.18)",
            }}
          >
            <Mail className="w-3.5 h-3.5" style={{ color: "var(--primary)" }} />
          </div>
          <p className="font-semibold text-sm" style={{ color: "#ffffff" }}>
            Reset your password
          </p>
        </div>
        <p
          className="text-xs leading-relaxed"
          style={{ color: "rgba(255,255,255,0.40)", paddingLeft: "1px" }}
        >
          Enter the email address associated with your account and we'll send
          you a reset link.
        </p>
      </div>

      {/* Email */}
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="reset-email"
          style={{
            color: "#777",
            fontSize: "11px",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            fontWeight: 600,
          }}
        >
          Email Address
        </label>
        <input
          id="reset-email"
          type="email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            setError("");
          }}
          placeholder="you@example.com"
          style={inputStyle}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = "var(--primary)";
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = "#242424";
          }}
          autoComplete="email"
          disabled={isLoading}
        />
      </div>

      {/* Error */}
      {error && (
        <div
          style={{
            backgroundColor: "rgba(239,68,68,0.08)",
            border: "1px solid rgba(239,68,68,0.25)",
            borderRadius: "4px",
            padding: "10px 12px",
          }}
        >
          <p
            style={{
              color: "#ef4444",
              fontSize: "12px",
              margin: 0,
              lineHeight: "1.5",
            }}
          >
            {error}
          </p>
        </div>
      )}

      {/* Submit */}
      <button
        type="submit"
        disabled={isLoading}
        className="w-full py-2.5 rounded-sm font-semibold text-sm tracking-wide transition-all duration-150 hover:brightness-110 active:scale-[0.98] flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
        style={{
          backgroundColor: "var(--primary)",
          color: "oklch(0.10 0.008 240)",
          marginTop: "2px",
        }}
      >
        {isLoading ? (
          <>
            <Loader2 size={14} className="animate-spin" />
            Sending…
          </>
        ) : (
          "Send Reset Link"
        )}
      </button>

      {/* Back link */}
      <button
        type="button"
        onClick={onBackToSignIn}
        disabled={isLoading}
        className="flex items-center justify-center gap-1.5 w-full py-2 text-xs font-medium transition-colors duration-150 disabled:opacity-50"
        style={{
          color: "rgba(255,255,255,0.35)",
          background: "none",
          border: "none",
          cursor: "pointer",
        }}
        onMouseEnter={(e) => {
          if (!isLoading) e.currentTarget.style.color = "rgba(255,255,255,0.7)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = "rgba(255,255,255,0.35)";
        }}
      >
        <ArrowLeft size={12} />
        Back to Sign In
      </button>
    </form>
  );
}
