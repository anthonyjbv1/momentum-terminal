import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import { GoogleSignInButton } from "./GoogleSignInButton";

interface SignInFormProps {
  onSwitchToCreate?: () => void;
  onForgotPassword?: () => void;
}

export function SignInForm({
  onSwitchToCreate,
  onForgotPassword,
}: SignInFormProps) {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [errorType, setErrorType] = useState<
    "not-found" | "invalid" | "generic" | null
  >(null);
  const [showPassword, setShowPassword] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setErrorType(null);

    if (!email.trim() || !password.trim()) {
      setError("Please fill in all fields.");
      setErrorType("generic");
      return;
    }

    try {
      login(email.trim(), password);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Sign in failed";
      if (message === "User not found") {
        setError("No account found with that email.");
        setErrorType("not-found");
      } else if (message === "Invalid credentials") {
        setError("Incorrect password. Please try again.");
        setErrorType("invalid");
      } else {
        setError(message);
        setErrorType("generic");
      }
    }
  };

  const clearError = () => {
    setError("");
    setErrorType(null);
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

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
      {/* Google Sign-In */}
      <GoogleSignInButton />

      {/* Divider */}
      <div className="flex items-center gap-3">
        <div style={{ flex: 1, height: "1px", backgroundColor: "#242424" }} />
        <span
          style={{
            color: "#444",
            fontSize: "11px",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
          }}
        >
          or
        </span>
        <div style={{ flex: 1, height: "1px", backgroundColor: "#242424" }} />
      </div>

      {/* Email */}
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="signin-email"
          style={{
            color: "#777",
            fontSize: "11px",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            fontWeight: 600,
          }}
        >
          Email
        </label>
        <input
          id="signin-email"
          type="email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            clearError();
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
        />
      </div>

      {/* Password */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <label
            htmlFor="signin-password"
            style={{
              color: "#777",
              fontSize: "11px",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              fontWeight: 600,
            }}
          >
            Password
          </label>
          {onForgotPassword && (
            <button
              type="button"
              onClick={onForgotPassword}
              style={{
                background: "none",
                border: "none",
                padding: 0,
                cursor: "pointer",
                color: "rgba(255,255,255,0.35)",
                fontSize: "11px",
                fontWeight: 500,
                letterSpacing: "0.02em",
                transition: "color 0.15s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = "var(--primary)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = "rgba(255,255,255,0.35)";
              }}
            >
              Forgot password?
            </button>
          )}
        </div>
        <div style={{ position: "relative" }}>
          <input
            id="signin-password"
            type={showPassword ? "text" : "password"}
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              clearError();
            }}
            placeholder="••••••••"
            style={{ ...inputStyle, paddingRight: "42px" }}
            onFocus={(e) => {
              e.currentTarget.style.borderColor = "var(--primary)";
            }}
            onBlur={(e) => {
              e.currentTarget.style.borderColor = "#242424";
            }}
            autoComplete="current-password"
          />
          <button
            type="button"
            onClick={() => setShowPassword((prev) => !prev)}
            style={{
              position: "absolute",
              right: "12px",
              top: "50%",
              transform: "translateY(-50%)",
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: "0",
              display: "flex",
              alignItems: "center",
              color: "#555",
              transition: "color 0.15s",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = "var(--primary)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = "#555";
            }}
            aria-label={showPassword ? "Hide password" : "Show password"}
          >
            {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
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
          {errorType === "not-found" && onSwitchToCreate && (
            <p
              style={{
                color: "#888",
                fontSize: "12px",
                margin: "6px 0 0 0",
                lineHeight: "1.5",
              }}
            >
              Don't have an account?{" "}
              <button
                type="button"
                onClick={onSwitchToCreate}
                style={{
                  background: "none",
                  border: "none",
                  padding: 0,
                  cursor: "pointer",
                  color: "var(--primary)",
                  fontSize: "12px",
                  fontWeight: 600,
                  textDecoration: "underline",
                  textUnderlineOffset: "2px",
                }}
              >
                Create an account
              </button>
            </p>
          )}
        </div>
      )}

      {/* Submit */}
      <button
        type="submit"
        className="w-full py-2.5 rounded-sm font-semibold text-sm tracking-wide transition-all duration-150 hover:brightness-110 active:scale-[0.98]"
        style={{
          backgroundColor: "var(--primary)",
          color: "oklch(0.10 0.008 240)",
          marginTop: "2px",
        }}
      >
        Sign In
      </button>
    </form>
  );
}
