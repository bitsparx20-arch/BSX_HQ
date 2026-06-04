import React, { useEffect, useState, useMemo } from "react";
import { Calendar, dateFnsLocalizer } from "react-big-calendar";
import { format, parse, startOfWeek, getDay } from "date-fns";
import enUS from "date-fns/locale/en-US";
import { api } from "@/lib/api";
import { PageHeader, Section } from "@/components/Shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Plus, VideoCamera, MapPin, Clock } from "@phosphor-icons/react";
import { toast } from "sonner";

const locales = { "en-US": enUS };
const localizer = dateFnsLocalizer({ format, parse, startOfWeek, getDay, locales });

const blank = { title: "", start_at: "", end_at: "", location: "", attendees: "", recurring: "none", description: "" };

export default function Meetings() {
  const [meetings, setMeetings] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(blank);
  const [selected, setSelected] = useState(null);
  const [date, setDate] = useState(new Date());
  const [view, setView] = useState("month");

  const load = async () => {
    const { data } = await api.get("/meetings");
    setMeetings(data);
    // Jump to the month of the first meeting if not in current view
    if (data.length > 0 && data[0].start_at) {
      const firstDate = new Date(data[0].start_at);
      if (!isNaN(firstDate.getTime())) setDate(firstDate);
    }
  };
  useEffect(() => { load(); }, []);

  const events = useMemo(() => meetings.map((m) => {
    const start = m.start_at ? new Date(m.start_at) : new Date();
    const end = m.end_at ? new Date(m.end_at) : new Date(start.getTime() + 60 * 60 * 1000);
    return {
      id: m.id,
      title: m.title,
      start, end,
      resource: m,
    };
  }), [meetings]);

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
    setSelected(ev.resource);
    setForm({
      ...ev.resource,
      start_at: ev.resource.start_at ? toLocalInput(new Date(ev.resource.start_at)) : "",
      end_at: ev.resource.end_at ? toLocalInput(new Date(ev.resource.end_at)) : "",
      attendees: Array.isArray(ev.resource.attendees) ? ev.resource.attendees.join(", ") : ev.resource.attendees || "",
    });
    setOpen(true);
  };

  const save = async () => {
    try {
      const payload = {
        ...form,
        attendees: form.attendees ? form.attendees.split(",").map((s) => s.trim()).filter(Boolean) : [],
      };
      if (selected) await api.put(`/meetings/${selected.id}`, payload);
      else await api.post("/meetings", payload);
      toast.success(selected ? "Meeting updated" : "Meeting scheduled");
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

  const upcoming = meetings
    .filter((m) => m.start_at && new Date(m.start_at) > new Date())
    .sort((a, b) => new Date(a.start_at) - new Date(b.start_at))
    .slice(0, 5);

  return (
    <div>
      <PageHeader
        eyebrow="Module · 05"
        title="Meetings & Calendar"
        description="Schedule meetings, set recurrences, manage attendees — WhatsApp reminders fire automatically."
        actions={
          <Button onClick={() => openCreate()} className="bg-[var(--bx-brand)] hover:opacity-90 text-white" data-testid="new-meeting-btn">
            <Plus size={14} weight="bold" className="mr-1.5" /> New meeting
          </Button>
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
            selectable
            onSelectSlot={openCreate}
            onSelectEvent={openEvent}
            views={["month", "week", "day", "agenda"]}
            view={view}
            onView={setView}
            date={date}
            onNavigate={setDate}
            popup
          />
        </div>

        <Section title="Upcoming">
          <div className="divide-y divide-slate-100">
            {upcoming.length === 0 && <div className="px-5 py-8 text-center text-sm text-slate-500">No upcoming meetings</div>}
            {upcoming.map((m) => (
              <button key={m.id} onClick={() => openEvent({ resource: m })} className="w-full text-left px-5 py-3 hover:bg-slate-50 transition">
                <div className="font-semibold text-sm text-slate-900 line-clamp-1">{m.title}</div>
                <div className="flex items-center gap-1.5 text-xs text-slate-500 mt-1">
                  <Clock size={11} />
                  <span className="bx-mono">{new Date(m.start_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</span>
                </div>
                {m.location && (
                  <div className="flex items-center gap-1.5 text-xs text-slate-500 mt-0.5">
                    {m.location?.includes("oom") || m.location?.includes("ttp") ? <VideoCamera size={11} /> : <MapPin size={11} />}
                    <span className="truncate">{m.location}</span>
                  </div>
                )}
              </button>
            ))}
          </div>
        </Section>
      </div>

      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setSelected(null); setForm(blank); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{selected ? "Edit meeting" : "New meeting"}</DialogTitle>
            <DialogDescription>Schedule a meeting and notify attendees via WhatsApp.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <Label className="text-xs">Title *</Label>
              <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Project sync" data-testid="meeting-title" />
            </div>
            <div>
              <Label className="text-xs">Start</Label>
              <Input type="datetime-local" value={form.start_at} onChange={(e) => setForm({ ...form, start_at: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs">End</Label>
              <Input type="datetime-local" value={form.end_at} onChange={(e) => setForm({ ...form, end_at: e.target.value })} />
            </div>
            <div className="col-span-2">
              <Label className="text-xs">Location or link</Label>
              <Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="Zoom link or room name" />
            </div>
            <div className="col-span-2">
              <Label className="text-xs">Attendees (comma separated)</Label>
              <Input value={form.attendees} onChange={(e) => setForm({ ...form, attendees: e.target.value })} placeholder="Riya Sharma, Vikram Iyer" />
            </div>
            <div className="col-span-2">
              <Label className="text-xs">Recurring</Label>
              <Select value={form.recurring} onValueChange={(v) => setForm({ ...form, recurring: v })}>
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
              <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} />
            </div>
          </div>
          <DialogFooter>
            {selected && <Button variant="outline" onClick={remove} className="mr-auto text-rose-600 border-rose-200 hover:bg-rose-50">Delete</Button>}
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={save} className="bg-[var(--bx-brand)] hover:opacity-90 text-white" data-testid="meeting-save">
              {selected ? "Update" : "Schedule"}
            </Button>
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
