import {
  startOfWeek, endOfWeek, startOfMonth, endOfMonth, addMonths, subMonths,
} from "date-fns";

const MAX_OCCURRENCES = 366;
const IST = "Asia/Kolkata";

/** Parse meeting timestamps; naive values are treated as IST. */
export function parseMeetingInstant(iso) {
  if (!iso) return null;
  const s = String(iso).trim();
  if (/[Zz]|[+-]\d{2}:\d{2}$/.test(s)) return new Date(s);
  return new Date(`${s.replace(" ", "T")}+05:30`);
}

export function formatMeetingDateTimeIST(iso) {
  const d = parseMeetingInstant(iso);
  if (!d || Number.isNaN(d.getTime())) return "—";
  const parts = new Intl.DateTimeFormat("en-IN", {
    timeZone: IST,
    weekday: "long",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(d);
  const get = (type) => parts.find((p) => p.type === type)?.value || "";
  return `${get("weekday")}, ${get("day")} ${get("month")} ${get("year")}, ${get("hour")}:${get("minute")} ${get("dayPeriod")} IST`;
}

export const getMeetingLink = (meeting) => {
  const link = (meeting?.meeting_link || "").trim();
  if (link) {
    return /^https?:\/\//i.test(link) ? link : `https://${link}`;
  }
  const loc = (meeting?.location || "").trim();
  if (/^https?:\/\//i.test(loc)) return loc;
  if (/^(zoom\.us|meet\.google|teams\.microsoft)/i.test(loc)) return `https://${loc}`;
  return null;
};

export const meetingEndTime = (meeting) => {
  if (!meeting?.start_at) return null;
  const start = parseMeetingInstant(meeting.start_at);
  if (meeting.end_at) return parseMeetingInstant(meeting.end_at);
  return new Date(start.getTime() + 60 * 60 * 1000);
};

export const isUpcomingMeeting = (meeting) => {
  const end = meetingEndTime(meeting);
  return end ? end > new Date() : false;
};

export const isMeetingLive = (meeting, now = new Date()) => {
  if (!meeting?.start_at) return false;
  const start = parseMeetingInstant(meeting.start_at);
  const end = meetingEndTime(meeting);
  if (!end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return false;
  return now >= start && now <= end;
};

export const sortMeetingsByStart = (list) =>
  [...(list || [])].sort((a, b) => parseMeetingInstant(a.start_at) - parseMeetingInstant(b.start_at));

export function calendarRange(date, view) {
  if (view === "month") {
    return { from: startOfWeek(startOfMonth(date)), to: endOfWeek(endOfMonth(date)) };
  }
  if (view === "week") {
    return { from: startOfWeek(date), to: endOfWeek(date) };
  }
  if (view === "day") {
    const from = new Date(date);
    from.setHours(0, 0, 0, 0);
    const to = new Date(date);
    to.setHours(23, 59, 59, 999);
    return { from, to };
  }
  return { from: subMonths(date, 1), to: addMonths(date, 3) };
}

export function expandRecurringMeetings(meetings, { from, to } = {}) {
  const rangeStart = from || new Date();
  const rangeEnd = to || addMonths(rangeStart, 12);
  const events = [];

  for (const m of meetings || []) {
    const recurring = m.recurring || "none";
    const start = m.start_at ? parseMeetingInstant(m.start_at) : null;
    if (!start || Number.isNaN(start.getTime())) continue;

    const end = m.end_at ? parseMeetingInstant(m.end_at) : new Date(start.getTime() + 60 * 60 * 1000);
    const duration = Math.max(end.getTime() - start.getTime(), 15 * 60 * 1000);

    if (!recurring || recurring === "none") {
      events.push({ meeting: m, start, end, occurrenceIndex: 0 });
      continue;
    }

    let cursor = new Date(start);
    let idx = 0;

    while (cursor <= rangeEnd && idx < MAX_OCCURRENCES) {
      const occEnd = new Date(cursor.getTime() + duration);
      if (occEnd >= rangeStart) {
        events.push({
          meeting: m,
          start: new Date(cursor),
          end: occEnd,
          occurrenceIndex: idx,
        });
      }
      idx += 1;
      if (recurring === "daily") {
        cursor.setDate(cursor.getDate() + 1);
      } else if (recurring === "weekly") {
        cursor.setDate(cursor.getDate() + 7);
      } else if (recurring === "monthly") {
        cursor.setMonth(cursor.getMonth() + 1);
      } else {
        break;
      }
    }
  }

  return events;
}

export const upcomingMeetings = (list, limit) => {
  const now = new Date();
  const expanded = expandRecurringMeetings(list, { from: now, to: addMonths(now, 6) });
  const sorted = expanded
    .filter((e) => e.end > now)
    .sort((a, b) => a.start - b.start)
    .map((e) => ({
      ...e.meeting,
      start_at: e.start.toISOString(),
      end_at: e.end.toISOString(),
      _occurrenceIndex: e.occurrenceIndex,
    }));
  return limit ? sorted.slice(0, limit) : sorted;
};
