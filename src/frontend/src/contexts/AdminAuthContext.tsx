import type React from "react";
import { createContext, useCallback, useContext, useState } from "react";

interface AdminAuthContextValue {
  isAdminAuthenticated: boolean;
  login: () => void;
  logout: () => void;
}

const ADMIN_SESSION_KEY = "admin_session";

const AdminAuthContext = createContext<AdminAuthContextValue>({
  isAdminAuthenticated: false,
  login: () => {},
  logout: () => {},
});

export function AdminAuthProvider({ children }: { children: React.ReactNode }) {
  const [isAdminAuthenticated, setIsAdminAuthenticated] = useState<boolean>(
    () => {
      return sessionStorage.getItem(ADMIN_SESSION_KEY) === "true";
    },
  );

  const login = useCallback(() => {
    sessionStorage.setItem(ADMIN_SESSION_KEY, "true");
    setIsAdminAuthenticated(true);
  }, []);

  const logout = useCallback(() => {
    sessionStorage.removeItem(ADMIN_SESSION_KEY);
    setIsAdminAuthenticated(false);
  }, []);

  return (
    <AdminAuthContext.Provider value={{ isAdminAuthenticated, login, logout }}>
      {children}
    </AdminAuthContext.Provider>
  );
}

export function useAdminAuth(): AdminAuthContextValue {
  return useContext(AdminAuthContext);
}
