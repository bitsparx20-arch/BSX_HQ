import axios from "axios";

// In dev, default to same-origin `/api` (proxied to the backend by package.json "proxy").
const BACKEND_URL = (process.env.REACT_APP_BACKEND_URL || "").replace(/\/$/, "");
export const API_BASE = BACKEND_URL ? `${BACKEND_URL}/api` : "/api";

export const api = axios.create({
  baseURL: API_BASE,
  withCredentials: true,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("bx_token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (error) => {
    const detail = error.response?.data?.detail;
    const sessionEnded = error.response?.status === 401
      && typeof detail === "string"
      && (detail === "SESSION_SUPERSEDED" || detail === "SESSION_INVALID");
    if (sessionEnded) {
      localStorage.removeItem("bx_token");
      if (!window.location.pathname.startsWith("/login")) {
        window.location.href = `/login?reason=${encodeURIComponent(
          detail === "SESSION_SUPERSEDED"
            ? "signed-in-elsewhere"
            : "session-invalid",
        )}`;
      }
    }
    return Promise.reject(error);
  },
);

export function formatApiError(detail, error) {
  if (detail == null) {
    if (error?.code === "ERR_NETWORK" || !error?.response) {
      return `Cannot reach API at ${API_BASE}. Start the backend: cd backend && python -m uvicorn server:app --reload --host 127.0.0.1 --port 8000`;
    }
    return "Something went wrong.";
  }
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) return detail.map((e) => e?.msg || JSON.stringify(e)).join(" ");
  if (typeof detail === "object" && detail.msg) return detail.msg;
  return String(detail);
}
