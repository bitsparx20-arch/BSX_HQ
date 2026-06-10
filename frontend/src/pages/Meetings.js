import React, { useEffect, useState, useMemo } from "react";
import { Calendar, dateFnsLocalizer } from "react-big-calendar";
import { format, parse, startOfWeek, getDay } from "date-fns";
import enUS from "date-fns/locale/en-US";
import { api } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { PageHeader, Section } from "@/components/Shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Plus, VideoCamera, MapPin, Clock } from "@phosphor-icons/react";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { getMeetingLink, isMeetingLive, upcomingMeetings, expandRecurringMeetings, calendarRange } from "@/lib/meetings";

const locales = { "en-US": enUS };
const localizer = dateFnsLocalizer({ format, parse, startOfWeek, getDay, locales });

const blank = { title: "", start_at: "", end_at: "", location: "", meeting_link: "", attendee_ids: [], recurring: "none", description: "" };

function resolveAttendeeIds(attendees, people) {
  const names = Array.isArray(attendees) ? attendees : (attendees ? [attendees] : []);
  return people.filter((p) => names.some((n) => {
    const key = String(n || "").toLowerCase();
    return key === (p.name || "").toLowerCase() || key === (p.email || "").toLowerCase();
  })).map((p) => p.id);
}

function attendeeNames(ids, people) {
  return (ids || []).map((id) => {
    const p = people.find((x) => x.id === id);
    return p?.name || p?.email;
  }).filter(Boolean);
}

export default function Meetings() {
  const { user } = useAuth();
  const canManage = user?.role === "admin" || user?.role === "manager";
  const canCreate = true;
  const canEditMeeting = (m) => canManage || !m || m.created_by === user?.id;
  const [meetings, setMeetings] = useState([]);
  const [companyPeople, setCompanyPeople] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(blank);
  const [selected, setSelected] = useState(null);
  const [date, setDate] = useState(() => new Date());
  const [view, setView] = useState("week");
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(id);
  }, []);

  const scrollToTime = useMemo(() => {
    const now = new Date();
    now.setMinutes(now.getMinutes() - 30, 0, 0);
    return now;
  }, []);

  const load = async () => {
    const { data } = await api.get("/meetings");
    setMeetings(data);
  };
  useEffect(() => { load(); }, []);

  useEffect(() => {
    api.get("/notes/share-targets").then(({ data }) => setCompanyPeople(data || [])).catch(() => {});
  }, []);

  useEffect(() => {
    if (!selected || companyPeople.length === 0) return;
    setForm((prev) => ({
      ...prev,
      attendee_ids: resolveAttendeeIds(selected.attendees, companyPeople),
    }));
  }, [companyPeople, selected]);

  const events = useMemo(() => {
    const { from, to } = calendarRange(date, view);
    return expandRecurringMeetings(meetings, { from, to }).map((e) => ({
      id: `${e.meeting.id}-${e.occurrenceIndex}`,
      title: e.meeting.title,
      start: e.start,
      end: e.end,
      resource: {
        ...e.meeting,
        _occurrenceStart: e.start,
        _occurrenceEnd: e.end,
        _occurrenceIndex: e.occurrenceIndex,
      },
    }));
  }, [meetings, date, view]);

  const openCreate = (slot) => {
    setSelected(null);
    setForm({
      ...blank,
      start_at: slot?.start ? toLocalInput(slot.start) : "",
      end_at: slot?.end ? toLocalInput(slot.end) : "",
    });
    setOpen(true);
  };

  const openEvent = (ev) => {
    const resource = ev.resource || ev;
    const start = resource._occurrenceStart || (resource.start_at ? new Date(resource.start_at) : null);
    const end = resource._occurrenceEnd || (resource.end_at ? new Date(resource.end_at) : null);
    setSelected(resource);
    setForm({
      ...resource,
      start_at: start ? toLocalInput(start) : "",
      end_at: end ? toLocalInput(end) : "",
      attendee_ids: resolveAttendeeIds(resource.attendees, companyPeople),
    });
    setOpen(true);
  };

  const editing = selected && canEditMeeting(selected);

  const toggleAttendee = (personId) => {
    setForm((prev) => {
      const current = prev.attendee_ids || [];
      const next = current.includes(personId)
        ? current.filter((id) => id !== personId)
        : [...current, personId];
      return { ...prev, attendee_ids: next };
    });
  };

  const save = async () => {
    try {
      const { attendee_ids, ...rest } = form;
      const payload = {
        ...rest,
        attendees: attendeeNames(attendee_ids, companyPeople),
      };
      if (selected) {
        await api.put(`/meetings/${selected.id}`, payload);
        toast.success("Meeting updated");
      } else {
        const { data } = await api.post("/meetings", payload);
        const wa = data?.whatsapp || [];
        const sent = wa.some((w) => w.status === "sent");
        toast.success(
          sent
            ? `Meeting scheduled · WhatsApp sent to ${wa.length} recipient${wa.length === 1 ? "" : "s"}`
            : wa.length
              ? "Meeting scheduled · WhatsApp queued (see Notification log)"
              : "Meeting scheduled · no attendee phones found",
        );
      }
      setOpen(false); setSelected(null); setForm(blank);
      load();
    } catch (e) { toast.error(e.response?.data?.detail || "Failed"); }
  };

  const remove = async () => {
    if (!selected || !window.confirm("Delete this meeting?")) return;
    try {
      await api.delete(`/meetings/${selected.id}`);
      toast.success("Deleted");
      setOpen(false); setSelected(null);
      load();
    } catch (e) { toast.error("Failed"); }
  };

  const upcoming = upcomingMeetings(meetings, 5);

  return (
    <div>
      <PageHeader
        eyebrow="Module · 05"
        title="Meetings & Calendar"
        
        actions={
          canCreate ? (
            <Button onClick={() => openCreate()} className="bg-[var(--bx-brand)] hover:opacity-90 text-white" data-testid="new-meeting-btn">
              <Plus size={14} weight="bold" className="mr-1.5" /> New meeting
            </Button>
          ) : null
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        <div className="lg:col-span-3 bg-[var(--bx-card)] border border-[var(--bx-border)] rounded-lg p-2 sm:p-4">
          <Calendar
            localizer={localizer}
            events={events}
            startAccessor="start"
            endAccessor="end"
            style={{ height: 640 }}
            selectable={canCreate}
            onSelectSlot={canCreate ? openCreate : undefined}
            onSelectEvent={openEvent}
            views={["month", "week", "day", "agenda"]}
            defaultView="week"
            view={view}
            onView={setView}
            date={date}
            onNavigate={setDate}
            scrollToTime={scrollToTime}
            getNow={() => new Date()}
            popup
          />
        </div>

        <Section title="Upcoming">
          <div className="divide-y divide-slate-100">
            {upcoming.length === 0 && <div className="px-5 py-8 text-center text-sm text-slate-500">No upcoming meetings</div>}
            {upcoming.map((m) => {
              const link = getMeetingLink(m);
              const live = isMeetingLive(m, now);
              return (
                <div key={`${m.id}-${m._occurrenceIndex ?? 0}`} className="px-5 py-3 hover:bg-slate-50 transition">
                  <button type="button" onClick={() => openEvent({ resource: m })} className="w-full text-left">
                    <div className="font-semibold text-sm text-slate-900 line-clamp-1">{m.title}</div>
                    <div className="flex items-center gap-1.5 text-xs text-slate-500 mt-1">
                      <Clock size={11} />
                      <span className="bx-mono">{new Date(m.start_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</span>
                    </div>
                  </button>
                  {link ? (
                    <div className="flex items-center gap-2 mt-2">
                      <Button
                        asChild={live}
                        size="sm"
                        disabled={!live}
                        className={`h-9 px-4 text-xs font-semibold shrink-0 ${
                          live
                            ? "bg-[var(--bx-brand)] hover:opacity-90 text-white"
                            : "bg-slate-100 text-slate-400 cursor-not-allowed"
                        }`}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {live ? (
                          <a href={link} target="_blank" rel="noopener noreferrer">
                            <VideoCamera size={14} weight="fill" className="mr-1.5" />
                            Join meeting
                          </a>
                        ) : (
                          <span>
                            <VideoCamera size={14} className="mr-1.5" />
                            Join meeting
                          </span>
                        )}
                      </Button>
                      <a
                        href={link}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className={`flex items-center gap-1 text-xs truncate hover:underline ${
                          live ? "text-[var(--bx-brand)]" : "text-slate-400 pointer-events-none"
                        }`}
                      >
                        <span className="truncate">{link.replace(/^https?:\/\//, "")}</span>
                      </a>
                    </div>
                  ) : m.location ? (
                    <div className="flex items-center gap-1.5 text-xs text-slate-500 mt-2">
                      <MapPin size={11} />
                      <span className="truncate">{m.location}</span>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </Section>
      </div>

      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setSelected(null); setForm(blank); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{selected ? (editing ? "Edit meeting" : "Meeting details") : "New meeting"}</DialogTitle>
            <DialogDescription>
              {selected && !editing ? "View-only — you can edit meetings you scheduled." : "Schedule a meeting and notify attendees via WhatsApp."}
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <Label className="text-xs">Title *</Label>
              <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Project sync" data-testid="meeting-title" readOnly={!editing && !!selected} />
            </div>
            <div>
              <Label className="text-xs">Start</Label>
              <Input type="datetime-local" value={form.start_at} onChange={(e) => setForm({ ...form, start_at: e.target.value })} readOnly={!editing && !!selected} />
            </div>
            <div>
              <Label className="text-xs">End</Label>
              <Input type="datetime-local" value={form.end_at} onChange={(e) => setForm({ ...form, end_at: e.target.value })} readOnly={!editing && !!selected} />
            </div>
            <div className="col-span-2">
              <Label className="text-xs">Location</Label>
              <Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="Main Auditorium, Meet Room A…" readOnly={!editing && !!selected} />
            </div>
            <div className="col-span-2">
              <Label className="text-xs">Meeting link</Label>
              <Input value={form.meeting_link} onChange={(e) => setForm({ ...form, meeting_link: e.target.value })} placeholder="https://zoom.us/j/… or Google Meet link" readOnly={!editing && !!selected} />
            </div>
            <div className="col-span-2">
              <Label className="text-xs">Attendees</Label>
              {(!editing && selected) ? (
                <div className="rounded-lg border border-[var(--bx-border)] p-3 text-sm text-[var(--bx-text-2)] min-h-[2.5rem]">
                  {attendeeNames(form.attendee_ids, companyPeople).length > 0
                    ? attendeeNames(form.attendee_ids, companyPeople).join(", ")
                    : (Array.isArray(selected?.attendees) ? selected.attendees.join(", ") : selected?.attendees) || "—"}
                </div>
              ) : (
                <div className="max-h-40 overflow-y-auto rounded-lg border border-[var(--bx-border)] p-2 space-y-1" data-testid="meeting-attendees">
                  {companyPeople.length === 0 && (
                    <p className="text-sm text-[var(--bx-text-3)] text-center py-3">No team members found.</p>
                  )}
                  {companyPeople.map((p) => (
                    <label
                      key={p.id}
                      className="flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-[var(--bx-bg-3)] cursor-pointer"
                    >
                      <Checkbox
                        checked={(form.attendee_ids || []).includes(p.id)}
                        onCheckedChange={() => toggleAttendee(p.id)}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-[var(--bx-text)] truncate">{p.name || p.email}</div>
                        <div className="text-[10px] uppercase tracking-widest text-[var(--bx-text-3)] bx-mono">{p.role}</div>
                      </div>
                    </label>
                  ))}
                </div>
              )}
            </div>
            <div className="col-span-2">
              <Label className="text-xs">Recurring</Label>
              <Select value={form.recurring} onValueChange={(v) => setForm({ ...form, recurring: v })} disabled={!editing && !!selected}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No repeat</SelectItem>
                  <SelectItem value="daily">Daily</SelectItem>
                  <SelectItem value="weekly">Weekly</SelectItem>
                  <SelectItem value="monthly">Monthly</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2">
              <Label className="text-xs">Description</Label>
              <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} readOnly={!editing && !!selected} />
            </div>
          </div>
          <DialogFooter>
            {selected && editing && <Button variant="outline" onClick={remove} className="mr-auto text-rose-600 border-rose-200 hover:bg-rose-50">Delete</Button>}
            <Button variant="outline" onClick={() => setOpen(false)}>{editing || !selected ? "Cancel" : "Close"}</Button>
            {(editing || !selected) && (
              <Button onClick={save} className="bg-[var(--bx-brand)] hover:opacity-90 text-white" data-testid="meeting-save">
                {selected ? "Update" : "Schedule"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function toLocalInput(d) {
  if (!d) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
