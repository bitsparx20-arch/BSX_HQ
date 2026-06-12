export const IST = "Asia/Kolkata";

/** Parse API timestamps; naive values are treated as IST. */
export function parseAppInstant(iso) {
  if (!iso) return null;
  const s = String(iso).trim();
  if (/[Zz]$/.test(s)) return new Date(s);
  if (/[+-]\d{2}:\d{2}$/.test(s)) return new Date(s);
  return new Date(`${s.replace(" ", "T")}+05:30`);
}

/** Today's calendar date in IST (YYYY-MM-DD). */
export function todayIST() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: IST,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function shiftDateIST(dateStr, days) {
  const base = parseAppInstant(`${dateStr}T12:00:00+05:30`);
  if (!base || Number.isNaN(base.getTime())) return dateStr;
  base.setTime(base.getTime() + days * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: IST,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(base);
}

export function formatDateIST(value) {
  if (!value) return "—";
  const s = String(value).trim();
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s)
    ? parseAppInstant(`${s}T00:00:00+05:30`)
    : parseAppInstant(s);
  if (!d || Number.isNaN(d.getTime())) return s;
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: IST,
    year: "numeric",
    month: "short",
    day: "2-digit",
  }).format(d);
}

export function formatTimeIST(iso) {
  const d = parseAppInstant(iso);
  if (!d || Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: IST,
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  }).format(d);
}

export function formatDateTimeIST(iso) {
  const d = parseAppInstant(iso);
  if (!d || Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: IST,
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  }).format(d);
}

export function formatDayLabelIST(dateStr) {
  const today = todayIST();
  if (dateStr === today) return "Today";
  if (dateStr === shiftDateIST(today, -1)) return "Yesterday";
  if (dateStr === shiftDateIST(today, 1)) return "Tomorrow";
  const d = parseAppInstant(`${dateStr}T12:00:00+05:30`);
  if (!d || Number.isNaN(d.getTime())) return dateStr;
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: IST,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(d);
}

/** Value for `<input type="datetime-local" />` in IST wall time. */
export function toDatetimeLocalInputIST(value) {
  const d = value instanceof Date ? value : parseAppInstant(value);
  if (!d || Number.isNaN(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-IN", {
    timeZone: IST,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (type) => parts.find((p) => p.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

/** Calendar label formatters for react-big-calendar (always IST). */
export function calendarFormatsIST() {
  const time = (date) => formatTimeIST(date?.toISOString?.() || date);
  return {
    timeGutterFormat: time,
    eventTimeRangeFormat: ({ start, end }) => `${time(start)} – ${time(end)}`,
    agendaTimeFormat: time,
    agendaTimeRangeFormat: ({ start, end }) => `${time(start)} – ${time(end)}`,
    dayHeaderFormat: (date) => formatDateIST(date?.toISOString?.() || date),
    dayRangeHeaderFormat: ({ start, end }) => `${formatDateIST(start?.toISOString?.())} – ${formatDateIST(end?.toISOString?.())}`,
  };
}
