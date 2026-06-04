import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { PageHeader, KpiCard, Section, StatusBadge, formatCurrency, formatDate } from "@/components/Shared";
import { useAuth } from "@/contexts/AuthContext";
import {
  Briefcase, ChartLineUp, Clock, CalendarBlank, Headset,
} from "@phosphor-icons/react";
import {
  ResponsiveContainer, LineChart, Line, CartesianGrid, XAxis, YAxis, Tooltip, Legend,
} from "recharts";

export default function Dashboard() {
  const { user } = useAuth();
  const isEmployee = user?.role === "employee";

  if (isEmployee) return <EmployeeDashboard user={user} />;
  return <AdminDashboard user={user} />;
}

function AdminDashboard({ user }) {
  const [stats, setStats] = useState({});
  const [trend, setTrend] = useState([]);
  const [recent, setRecent] = useState({ projects: [], tickets: [], notifications: [] });

  useEffect(() => {
    (async () => {
      const [s, t, p, tk, n] = await Promise.all([
        api.get("/reports/dashboard").then(r => r.data),
        api.get("/reports/finance-trend").then(r => r.data),
        api.get("/projects").then(r => r.data).catch(() => []),
        api.get("/tickets").then(r => r.data).catch(() => []),
        api.get("/notifications").then(r => r.data).catch(() => []),
      ]);
      setStats(s); setTrend(t);
      setRecent({ projects: p.slice(0, 5), tickets: tk.slice(0, 5), notifications: n.slice(0, 5) });
    })();
  }, []);

  return (
    <div data-testid="dashboard-page">
      <PageHeader
        eyebrow={`Welcome back, ${user?.name?.split(" ")[0] || "team"}`}
        title="Command center"
        description="A live snapshot across all modules — attendance, finance, projects, clients, assets, AMC, helpdesk and WhatsApp notifications."
      />

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 mb-6">
        <div className="lg:col-span-4 bg-gradient-to-br from-[#2453E5] to-[#1A45CC] text-white border border-[#2453E5] rounded-xl p-5 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <div className="text-[10px] uppercase tracking-[0.14em] text-white/80 font-semibold">North Star · Net P&amp;L</div>
            <ChartLineUp size={20} weight="bold" />
          </div>
          <div className="text-4xl font-bold tracking-tight">{formatCurrency(stats.pnl)}</div>
          <div className="text-xs text-white/85 mt-2">
            Revenue {formatCurrency(stats.total_invoiced)} − Expenses {formatCurrency(stats.total_expenses)}
          </div>
        </div>

        <div className="lg:col-span-8 grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiCard label="Employees" value={stats.employees ?? "—"} sub={`${stats.users ?? 0} platform users`} />
          <KpiCard label="Active Projects" value={stats.active_projects ?? "—"} sub={`${stats.projects ?? 0} total`} />
          <KpiCard label="Open Tickets" value={stats.open_tickets ?? "—"} sub="SLA monitored" />
          <KpiCard label="Clients" value={stats.clients ?? "—"} sub="CRM pipeline" />
          <KpiCard label="Today Attendance" value={stats.today_attendance ?? "—"} sub="Checked in today" />
          <KpiCard label="Pending Leaves" value={stats.pending_leaves ?? "—"} sub="Awaiting approval" />
          <KpiCard label="Assets" value={stats.assets ?? "—"} sub="Under management" />
          <KpiCard label="WhatsApp Sent" value={stats.notifications ?? "—"} sub="via SpringEdge" />
        </div>
      </div>

      <Section title="Revenue · Expenses · 6-Month Trend" className="mb-6">
        <div className="p-5">
          {trend.length === 0 ? (
            <div className="text-sm text-slate-500 py-8 text-center">Awaiting transaction history…</div>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={trend} margin={{ left: 0, right: 16, top: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                <XAxis dataKey="month" stroke="#94A3B8" fontSize={11} tickLine={false} axisLine={{ stroke: "#E5E7EB" }} />
                <YAxis stroke="#94A3B8" fontSize={11} tickLine={false} axisLine={{ stroke: "#E5E7EB" }} tickFormatter={(v) => `${(v/1000).toFixed(0)}K`} />
                <Tooltip contentStyle={{ borderRadius: 8, border: "1px solid #E5E7EB", fontSize: 12 }} formatter={(v) => formatCurrency(v)} />
                <Legend iconType="rect" wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="revenue" stroke="#2453E5" strokeWidth={2.5} dot={{ r: 4, fill: "#2453E5" }} />
                <Line type="monotone" dataKey="expense" stroke="#FF3B30" strokeWidth={2.5} dot={{ r: 4, fill: "#FF3B30" }} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </Section>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Section title="Recent Projects">
          <ul className="divide-y divide-slate-100">
            {recent.projects.map((p) => (
              <li key={p.id} className="px-5 py-3 flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold text-slate-900">{p.name}</div>
                  <div className="text-xs text-slate-500">{p.client}</div>
                </div>
                <StatusBadge status={p.status} />
              </li>
            ))}
            {recent.projects.length === 0 && <li className="px-5 py-8 text-center text-sm text-slate-500">No projects</li>}
          </ul>
        </Section>

        <Section title="Open Tickets">
          <ul className="divide-y divide-slate-100">
            {recent.tickets.map((t) => (
              <li key={t.id} className="px-5 py-3 flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold text-slate-900 line-clamp-1">{t.subject}</div>
                  <div className="text-xs text-slate-500">{t.client}</div>
                </div>
                <StatusBadge status={t.status} />
              </li>
            ))}
            {recent.tickets.length === 0 && <li className="px-5 py-8 text-center text-sm text-slate-500">No tickets</li>}
          </ul>
        </Section>

        <Section title="WhatsApp · SpringEdge">
          <ul className="divide-y divide-slate-100">
            {recent.notifications.map((n) => (
              <li key={n.id} className="px-5 py-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold">{n.event}</span>
                  <StatusBadge status={n.status === "logged_only" ? "pending" : n.status === "sent" ? "active" : "rejected"} />
                </div>
                <div className="text-xs text-slate-700 line-clamp-2">{n.message}</div>
              </li>
            ))}
            {recent.notifications.length === 0 && <li className="px-5 py-8 text-center text-sm text-slate-500">No notifications</li>}
          </ul>
        </Section>
      </div>
    </div>
  );
}

function EmployeeDashboard({ user }) {
  const [s, setS] = useState({});
  const [tasks, setTasks] = useState([]);
  const [meetings, setMeetings] = useState([]);
  const [tickets, setTickets] = useState([]);

  useEffect(() => {
    (async () => {
      const [d, t, m, ti] = await Promise.all([
        api.get("/me/dashboard").then(r => r.data),
        api.get("/me/tasks").then(r => r.data).catch(() => []),
        api.get("/me/meetings").then(r => r.data).catch(() => []),
        api.get("/me/tickets").then(r => r.data).catch(() => []),
      ]);
      setS(d); setTasks(t); setMeetings(m); setTickets(ti);
    })();
  }, []);

  return (
    <div data-testid="dashboard-page">
      <PageHeader
        eyebrow={`Good day, ${user?.name?.split(" ")[0] || "there"}`}
        title="Your day at a glance"
        description={`Here's what's on your plate today — ${user?.designation || "team member"} · ${user?.department || ""}`}
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <KpiCard label="My Open Tasks" value={s.my_open_tasks ?? 0} sub={`${s.my_tasks ?? 0} total assigned`} />
        <KpiCard label="My Meetings" value={s.my_meetings ?? 0} sub="In your calendar" />
        <KpiCard label="My Tickets" value={s.my_tickets ?? 0} sub="Assigned to me" />
        <KpiCard label="Attendance" value={s.my_attendance_days ?? 0} sub={`${s.my_leaves_pending ?? 0} leave pending`} />
      </div>

      {/* Today widget */}
      <div className="bg-gradient-to-br from-[#2453E5] to-[#1A45CC] text-white rounded-xl p-5 mb-6 flex items-center justify-between flex-wrap gap-4">
        <div>
          <div className="text-[10px] uppercase tracking-[0.14em] text-white/80 font-semibold mb-1">Today</div>
          <div className="text-2xl font-bold">
            {s.today_attendance?.check_out ? "Checked out" : s.today_attendance?.check_in ? "You are checked in" : "Not checked in yet"}
          </div>
          <div className="text-sm text-white/85 mt-1">
            {s.today_attendance?.check_in && <span>In · <span className="bx-mono">{new Date(s.today_attendance.check_in).toLocaleTimeString()}</span></span>}
            {s.today_attendance?.check_out && <span> · Out · <span className="bx-mono">{new Date(s.today_attendance.check_out).toLocaleTimeString()}</span></span>}
            {s.today_attendance?.work_hours != null && <span> · {s.today_attendance.work_hours}h</span>}
          </div>
        </div>
        <Link to="/attendance" className="bg-white text-[#2453E5] px-4 py-2 rounded-lg text-sm font-semibold hover:shadow-md transition">
          Go to attendance →
        </Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Section title="My Tasks">
          <ul className="divide-y divide-slate-100">
            {tasks.slice(0, 6).map((t) => (
              <li key={t.id} className="px-5 py-3 flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-slate-900 line-clamp-1">{t.title}</div>
                  <div className="text-xs text-slate-500">{t.project} · due {formatDate(t.due_date)}</div>
                </div>
                <StatusBadge status={t.status} />
              </li>
            ))}
            {tasks.length === 0 && <li className="px-5 py-8 text-center text-sm text-slate-500">All clear — no tasks assigned</li>}
          </ul>
        </Section>

        <Section title="My Meetings">
          <ul className="divide-y divide-slate-100">
            {meetings.slice(0, 6).map((m) => (
              <li key={m.id} className="px-5 py-3">
                <div className="text-sm font-semibold text-slate-900 line-clamp-1">{m.title}</div>
                <div className="text-xs text-slate-500 mt-0.5 bx-mono">
                  {m.start_at ? new Date(m.start_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "—"}
                </div>
                {m.location && <div className="text-xs text-slate-500 mt-0.5">{m.location}</div>}
              </li>
            ))}
            {meetings.length === 0 && <li className="px-5 py-8 text-center text-sm text-slate-500">No meetings scheduled</li>}
          </ul>
        </Section>

        <Section title="My Tickets">
          <ul className="divide-y divide-slate-100">
            {tickets.slice(0, 6).map((t) => (
              <li key={t.id} className="px-5 py-3 flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold text-slate-900 line-clamp-1">{t.subject}</div>
                  <div className="text-xs text-slate-500">{t.client}</div>
                </div>
                <StatusBadge status={t.status} />
              </li>
            ))}
            {tickets.length === 0 && <li className="px-5 py-8 text-center text-sm text-slate-500">No tickets assigned</li>}
          </ul>
        </Section>
      </div>
    </div>
  );
}
