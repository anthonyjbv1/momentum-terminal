import React from "react";
import { AdminDashboard } from "../components/AdminDashboard";
import { AdminLoginScreen } from "../components/AdminLoginScreen";
import { useAdminAuth } from "../contexts/AdminAuthContext";

export function AdminPortal() {
  const { isAdminAuthenticated } = useAdminAuth();

  if (!isAdminAuthenticated) {
    return <AdminLoginScreen />;
  }

  return <AdminDashboard />;
}
