import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { acquireSingleTabLock, getDeviceId, getTabId } from "@/lib/session";

const HEARTBEAT_MS = 20000;
const RESTRICTED_ROLES = new Set(["employee", "manager"]);

export function useSessionGuard(user) {
  const [tabBlocked, setTabBlocked] = useState(false);
  const heartbeatRef = useRef(null);
  const releaseLockRef = useRef(() => {});

  const restricted = user && RESTRICTED_ROLES.has(user.role);

  const blockTab = useCallback(() => {
    setTabBlocked(true);
  }, []);

  const claimTab = useCallback(async () => {
    if (!restricted) return true;
    try {
      await api.post("/auth/session/claim-tab", {
        device_id: getDeviceId(),
        tab_id: getTabId(),
      });
      return true;
    } catch (e) {
      if (e.response?.status === 409) {
        blockTab();
        return false;
      }
      return false;
    }
  }, [restricted, blockTab]);

  const startHeartbeat = useCallback(() => {
    if (!restricted) return;
    if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    heartbeatRef.current = setInterval(async () => {
      try {
        await api.post("/auth/session/heartbeat", {
          device_id: getDeviceId(),
          tab_id: getTabId(),
        });
      } catch (e) {
        if (e.response?.status === 409) {
          blockTab();
        }
      }
    }, HEARTBEAT_MS);
  }, [restricted, blockTab]);

  useEffect(() => {
    if (!restricted) {
      setTabBlocked(false);
      return undefined;
    }

    setTabBlocked(false);

    releaseLockRef.current = acquireSingleTabLock({
      onGranted: async () => {
        const ok = await claimTab();
        if (ok) startHeartbeat();
      },
      onBlocked: blockTab,
    });

    return () => {
      releaseLockRef.current?.();
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    };
  }, [restricted, user?.id, claimTab, startHeartbeat, blockTab]);

  return { tabBlocked, restricted };
}
