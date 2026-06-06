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

export const upcomingMeetings = (list, limit) => {
  const sorted = sortMeetingsByStart(list).filter(isUpcomingMeeting);
  return limit ? sorted.slice(0, limit) : sorted;
};
