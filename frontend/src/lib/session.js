const DEVICE_KEY = "bx_device_id";
const TAB_KEY = "bx_tab_id";

export function getDeviceId() {
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

export function getTabId() {
  let id = sessionStorage.getItem(TAB_KEY);
  if (!id) {
    id = crypto.randomUUID();
    sessionStorage.setItem(TAB_KEY, id);
  }
  return id;
}

/** Exclusive tab lock via Web Locks API (one tab per browser profile). */
export function acquireSingleTabLock({ onGranted, onBlocked }) {
  const lockName = "bitsparx-hq-single-tab";

  if (!navigator.locks?.request) {
    onGranted();
    return () => {};
  }

  let cancelled = false;

  navigator.locks.request(lockName, { mode: "exclusive", ifAvailable: true }, (lock) => {
    if (cancelled) return;
    if (!lock) {
      onBlocked();
      return;
    }
    onGranted();
    return new Promise(() => {});
  });

  return () => {
    cancelled = true;
  };
}
