import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { api } from "@/lib/api";

const AttendanceContext = createContext(null);

export const ATTENDANCE_PATH = "/attendance";

export const AttendanceProvider = ({ children }) => {
  const { user } = useAuth();
  const [today, setToday] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!user) {
      setToday(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const { data } = await api.get("/attendance/today");
      setToday(data || {});
    } catch {
      setToday({});
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

  const checkedInToday = !!today?.check_in;

  return (
    <AttendanceContext.Provider value={{ today, checkedInToday, loading, refresh }}>
      {children}
    </AttendanceContext.Provider>
  );
};

export const useAttendance = () => useContext(AttendanceContext);
