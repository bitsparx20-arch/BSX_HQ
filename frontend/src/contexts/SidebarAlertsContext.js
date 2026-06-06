import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { api } from "@/lib/api";

const SidebarAlertsContext = createContext(null);

export const SidebarAlertsProvider = ({ children }) => {
  const { user } = useAuth();
  const [alerts, setAlerts] = useState({ assigned_tasks: 0, shared_notes: 0 });
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!user) {
      setAlerts({ assigned_tasks: 0, shared_notes: 0 });
      setLoading(false);
      return;
    }
    try {
      const { data } = await api.get("/me/sidebar-alerts");
      setAlerts({
        assigned_tasks: data?.assigned_tasks || 0,
        shared_notes: data?.shared_notes || 0,
      });
    } catch {
      setAlerts({ assigned_tasks: 0, shared_notes: 0 });
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refresh]);

  return (
    <SidebarAlertsContext.Provider value={{ alerts, loading, refresh }}>
      {children}
    </SidebarAlertsContext.Provider>
  );
};

export const useSidebarAlerts = () => useContext(SidebarAlertsContext);
