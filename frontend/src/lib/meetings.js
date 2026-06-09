import {
  startOfWeek, endOfWeek, startOfMonth, endOfMonth, addMonths, subMonths,
} from "date-fns";

const MAX_OCCURRENCES = 366;

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

export const isUpcomingMeeting = (meeting) => {
  if (!meeting?.start_at) return false;
  const end = meeting.end_at ? new Date(meeting.end_at) : new Date(meeting.start_at);
  return end > new Date();
};

export const sortMeetingsByStart = (list) =>
  [...(list || [])].sort((a, b) => new Date(a.start_at) - new Date(b.start_at));

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
    const start = m.start_at ? new Date(m.start_at) : null;
    if (!start || Number.isNaN(start.getTime())) continue;

    const end = m.end_at ? new Date(m.end_at) : new Date(start.getTime() + 60 * 60 * 1000);
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
