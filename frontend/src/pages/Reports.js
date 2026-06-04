import React, { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { PageHeader, KpiCard, Section, formatCurrency } from "@/components/Shared";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
  PieChart, Pie, Cell, Legend,
} from "recharts";

const COLORS = ["#003EDB", "#FF3B30", "#FFCC00", "#00C752", "#7C3AED"];

export default function Reports() {
  const [stats, setStats] = useState({});
  const [trend, setTrend] = useState([]);
  const [projects, setProjects] = useState([]);
  const [tickets, setTickets] = useState([]);

  useEffect(() => {
    api.get("/reports/dashboard").then(({data}) => setStats(data));
    api.get("/reports/finance-trend").then(({data}) => setTrend(data));
    api.get("/projects").then(({data}) => setProjects(data));
    api.get("/tickets").then(({data}) => setTickets(data));
  }, []);

  const projectByStatus = Object.entries(
    projects.reduce((acc, p) => ({ ...acc, [p.status || "unknown"]: (acc[p.status || "unknown"] || 0) + 1 }), {})
  ).map(([name, value]) => ({ name, value }));

  const ticketByPriority = Object.entries(
    tickets.reduce((acc, t) => ({ ...acc, [t.priority || "unknown"]: (acc[t.priority || "unknown"] || 0) + 1 }), {})
  ).map(([name, value]) => ({ name, value }));

  const exportJson = () => {
    const data = { stats, trend, projects, tickets, exported_at: new Date().toISOString() };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `bitsparx-hq-report-${Date.now()}.json`; a.click();
  };

  return (
    <div>
      <PageHeader
        eyebrow="Module · 11"
        title="Reports & Analytics."
        description="Dashboards, trend charts and exports."
        actions={
          <button onClick={exportJson} className="px-3 py-1.5 text-xs font-semibold rounded-md bg-[#003EDB] text-white hover:bg-[#002EB3]" data-testid="export-btn">
            Export JSON
          </button>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <KpiCard label="Revenue" value={formatCurrency(stats.total_invoiced)} accent="text-emerald-600" />
        <KpiCard label="Expenses" value={formatCurrency(stats.total_expenses)} accent="text-rose-600" />
        <KpiCard label="P&L" value={formatCurrency(stats.pnl)} accent={stats.pnl >= 0 ? "text-emerald-600" : "text-rose-600"} />
        <KpiCard label="Employees" value={stats.employees ?? "—"} />
        <KpiCard label="Projects" value={stats.projects ?? "—"} />
        <KpiCard label="Clients" value={stats.clients ?? "—"} />
        <KpiCard label="Assets" value={stats.assets ?? "—"} />
        <KpiCard label="WhatsApp Notifications" value={stats.notifications ?? "—"} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        <Section title="Finance Trend">
          <div className="p-5">
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={trend}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                <XAxis dataKey="month" stroke="#94A3B8" fontSize={10} tickLine={false} />
                <YAxis stroke="#94A3B8" fontSize={10} tickLine={false} tickFormatter={(v) => `${(v/1000).toFixed(0)}K`} />
                <Tooltip contentStyle={{ fontSize: 11, borderRadius: 6 }} formatter={(v) => formatCurrency(v)} />
                <Bar dataKey="revenue" fill="#003EDB" radius={[3, 3, 0, 0]} />
                <Bar dataKey="expense" fill="#FF3B30" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Section>
        <Section title="Projects by Status">
          <div className="p-5">
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={projectByStatus} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} label>
                  {projectByStatus.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </Section>
        <Section title="Tickets by Priority">
          <div className="p-5">
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={ticketByPriority} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} label>
                  {ticketByPriority.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </Section>
      </div>
    </div>
  );
}
