import type React from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";

export interface UserAccount {
  username: string;
  email: string;
  avatar?: string;
  provider?: "email" | "google";
}

interface AuthContextValue {
  isAuthenticated: boolean;
  userAccount: UserAccount | null;
  login: (email: string, password: string) => void;
  signup: (username: string, email: string, password: string) => void;
  loginWithGoogle: () => void;
  logout: () => void;
  resetPassword: (email: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const SESSION_KEY = "userSession";
const ACCOUNTS_KEY = "registeredAccounts";

interface StoredAccount {
  username: string;
  email: string;
  password: string;
  provider: "email" | "google";
}

function getRegisteredAccounts(): StoredAccount[] {
  try {
    const raw = localStorage.getItem(ACCOUNTS_KEY);
    if (raw) return JSON.parse(raw) as StoredAccount[];
  } catch {
    // ignore
  }
  return [];
}

function saveRegisteredAccount(account: StoredAccount) {
  const accounts = getRegisteredAccounts();
  // Replace if email already exists, otherwise add
  const idx = accounts.findIndex(
    (a) => a.email.toLowerCase() === account.email.toLowerCase(),
  );
  if (idx >= 0) {
    accounts[idx] = account;
  } else {
    accounts.push(account);
  }
  localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
}

function validatePasswordStrength(password: string): void {
  const missingRules: string[] = [];
  if (!/[A-Z]/.test(password)) {
    missingRules.push("at least one uppercase letter");
  }
  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?`~]/.test(password)) {
    missingRules.push("at least one special character");
  }
  if (missingRules.length > 0) {
    throw new Error(`Password must contain ${missingRules.join(" and ")}.`);
  }
}

function generateTempPassword(): string {
  const upper = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const lower = "abcdefghijklmnopqrstuvwxyz";
  const digits = "0123456789";
  const special = "!@#$%^&*";
  const all = upper + lower + digits + special;

  // Ensure at least one uppercase and one special character
  let password = "";
  password += upper[Math.floor(Math.random() * upper.length)];
  password += special[Math.floor(Math.random() * special.length)];
  for (let i = 2; i < 8; i++) {
    password += all[Math.floor(Math.random() * all.length)];
  }
  // Shuffle
  return password
    .split("")
    .sort(() => Math.random() - 0.5)
    .join("");
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [userAccount, setUserAccount] = useState<UserAccount | null>(null);

  // On mount, check localStorage for a saved session
  useEffect(() => {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (raw) {
        const parsed: UserAccount = JSON.parse(raw);
        if (parsed?.username && parsed.email) {
          setUserAccount(parsed);
          setIsAuthenticated(true);
        }
      }
    } catch {
      localStorage.removeItem(SESSION_KEY);
    }
  }, []);

  const persistSession = useCallback((account: UserAccount) => {
    localStorage.setItem(SESSION_KEY, JSON.stringify(account));
    setUserAccount(account);
    setIsAuthenticated(true);
  }, []);

  const login = useCallback(
    (email: string, password: string) => {
      const accounts = getRegisteredAccounts();
      const match = accounts.find(
        (a) =>
          a.email.toLowerCase() === email.trim().toLowerCase() &&
          a.password === password,
      );

      if (!match) {
        // Check if the email exists at all to give a more specific message
        const emailExists = accounts.some(
          (a) => a.email.toLowerCase() === email.trim().toLowerCase(),
        );
        if (emailExists) {
          throw new Error("Invalid credentials");
        }
        throw new Error("User not found");
      }

      const account: UserAccount = {
        username: match.username,
        email: match.email,
        provider: "email",
      };
      persistSession(account);
    },
    [persistSession],
  );

  const signup = useCallback(
    (username: string, email: string, password: string) => {
      // Enforce password strength rules
      validatePasswordStrength(password);

      // Save to registered accounts registry
      saveRegisteredAccount({ username, email, password, provider: "email" });

      const account: UserAccount = {
        username,
        email,
        provider: "email",
      };
      persistSession(account);
    },
    [persistSession],
  );

  const loginWithGoogle = useCallback(() => {
    const account: UserAccount = {
      username: "Google User",
      email: "user@gmail.com",
      avatar: "G",
      provider: "google",
    };
    // Google sign-in always succeeds (OAuth flow simulation)
    persistSession(account);
  }, [persistSession]);

  const logout = useCallback(() => {
    // Capture the current user's email BEFORE nulling state
    const userEmail = userAccount?.email;

    // Remove the session key first
    localStorage.removeItem(SESSION_KEY);

    // Remove all user-namespaced keys for this user so the next account
    // on the same device starts with clean state
    if (userEmail) {
      const userKeys = [
        "walletBalance",
        "buyingPower",
        "activityHistory",
        "sentimentam_seeded_v5",
        "sentimentam_100_alloc_v1",
        "sentimentam_ai_tech_alloc_100_v1",
        "sentimentam_local_holdings_v5",
        "sentimentam_holdings_seeded_v6",
        "sentimentam_100_alloc_holdings_v1",
        "sentimentam_ai_tech_alloc_100_holdings_v1",
        "sentimentam_pnl_unlocked_v1",
        "portfolio_cache",
        "sentimentam_pnl_toggle_preference",
        "mt_onboarding_complete",
        "momentum_has_allocated",
        "sentimentam_active_tab",
      ];
      for (const suffix of userKeys) {
        localStorage.removeItem(`${userEmail}_${suffix}`);
      }
    }

    setUserAccount(null);
    setIsAuthenticated(false);
  }, [userAccount]);

  const resetPassword = useCallback(async (email: string): Promise<void> => {
    // Simulate async operation (e.g., network request)
    await new Promise((resolve) => setTimeout(resolve, 800));

    const accounts = getRegisteredAccounts();
    const idx = accounts.findIndex(
      (a) => a.email.toLowerCase() === email.trim().toLowerCase(),
    );

    // If account found, generate a new temporary password and update it
    if (idx >= 0) {
      const tempPassword = generateTempPassword();
      accounts[idx] = { ...accounts[idx], password: tempPassword };
      localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
    }

    // Always resolve without revealing whether the email was found (security)
  }, []);

  return (
    <AuthContext.Provider
      value={{
        isAuthenticated,
        userAccount,
        login,
        signup,
        loginWithGoogle,
        logout,
        resetPassword,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
