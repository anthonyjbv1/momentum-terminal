import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import { GoogleSignInButton } from "./GoogleSignInButton";

function validatePassword(password: string): string[] {
  const errors: string[] = [];
  if (!/[A-Z]/.test(password)) {
    errors.push("at least one uppercase letter (A–Z)");
  }
  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?`~]/.test(password)) {
    errors.push("at least one special character (e.g. !@#$%^&*)");
  }
  return errors;
}

export function CreateAccountForm() {
  const { signup } = useAuth();
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [passwordErrors, setPasswordErrors] = useState<string[]>([]);
  const [showPassword, setShowPassword] = useState(false);

  const handlePasswordChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setPassword(val);
    // Clear password errors as user types so they get live feedback
    if (passwordErrors.length > 0) {
      setPasswordErrors(validatePassword(val));
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!username.trim() || !email.trim() || !password.trim()) {
      setError("Please fill in all fields.");
      return;
    }

    const pwErrors = validatePassword(password);
    if (pwErrors.length > 0) {
      setPasswordErrors(pwErrors);
      return;
    }

    setPasswordErrors([]);
    signup(username.trim(), email.trim(), password);
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

      {/* Username */}
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="create-username"
          style={{
            color: "#777",
            fontSize: "11px",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            fontWeight: 600,
          }}
        >
          Username
        </label>
        <input
          id="create-username"
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="your_username"
          style={inputStyle}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = "var(--primary)";
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = "#242424";
          }}
          autoComplete="username"
        />
      </div>

      {/* Email */}
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="create-email"
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
          id="create-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
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
        <label
          htmlFor="create-password"
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
        <div style={{ position: "relative" }}>
          <input
            id="create-password"
            type={showPassword ? "text" : "password"}
            value={password}
            onChange={handlePasswordChange}
            placeholder="••••••••"
            style={{
              ...inputStyle,
              paddingRight: "42px",
              borderColor: passwordErrors.length > 0 ? "#ef4444" : "#242424",
            }}
            onFocus={(e) => {
              e.currentTarget.style.borderColor =
                passwordErrors.length > 0 ? "#ef4444" : "var(--primary)";
            }}
            onBlur={(e) => {
              e.currentTarget.style.borderColor =
                passwordErrors.length > 0 ? "#ef4444" : "#242424";
            }}
            autoComplete="new-password"
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

        {/* Inline password validation errors */}
        {passwordErrors.length > 0 && (
          <div style={{ marginTop: "4px" }}>
            <p
              style={{
                color: "#ef4444",
                fontSize: "12px",
                margin: "0 0 2px 0",
              }}
            >
              Password must include:
            </p>
            <ul style={{ margin: 0, paddingLeft: "16px" }}>
              {passwordErrors.map((err) => (
                <li key={err} style={{ color: "#ef4444", fontSize: "12px" }}>
                  {err}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* General Error */}
      {error && (
        <p style={{ color: "#ef4444", fontSize: "12px", margin: 0 }}>{error}</p>
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
        Create Account
      </button>
    </form>
  );
}
