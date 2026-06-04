import React, { useEffect, useState } from "react";
import { api } from "@/lib/api";
import ModuleTable from "@/components/ModuleTable";
import { PageHeader, KpiCard, Section, formatCurrency } from "@/components/Shared";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";

export default function Finance() {
  const [stats, setStats] = useState({});
  const [trend, setTrend] = useState([]);
  useEffect(() => {
    api.get("/reports/dashboard").then(({data}) => setStats(data));
    api.get("/reports/finance-trend").then(({data}) => setTrend(data));
  }, []);

  return (
    <div>
      <PageHeader eyebrow="Module · 02" title="Project Finance & Expenses." description="Budgets, daily spends, invoices and Profit & Loss across all engagements." />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <KpiCard label="Revenue" value={formatCurrency(stats.total_invoiced)} accent="text-emerald-600" />
        <KpiCard label="Expenses" value={formatCurrency(stats.total_expenses)} accent="text-rose-600" />
        <KpiCard label="Net P&L" value={formatCurrency(stats.pnl)} accent={stats.pnl >= 0 ? "text-emerald-600" : "text-rose-600"} />
        <KpiCard label="Projects" value={stats.projects ?? "—"} />
      </div>

      <Section title="Revenue vs Expense" className="mb-6">
        <div className="p-5">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={trend}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
              <XAxis dataKey="month" stroke="#94A3B8" fontSize={11} tickLine={false} />
              <YAxis stroke="#94A3B8" fontSize={11} tickLine={false} tickFormatter={(v) => `${(v/1000).toFixed(0)}K`} />
              <Tooltip contentStyle={{ borderRadius: 6, border: "1px solid #E2E8F0", fontSize: 12 }} formatter={(v) => formatCurrency(v)} />
              <Bar dataKey="revenue" fill="#003EDB" radius={[3, 3, 0, 0]} />
              <Bar dataKey="expense" fill="#FF3B30" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Section>

      <div className="space-y-6">
        <ModuleTable
          endpoint="/expenses" title="Expenses" testId="expenses"
          columns={[
            { key: "title", label: "Expense", type: "bold" },
            { key: "category", label: "Category" },
            { key: "project", label: "Project" },
            { key: "vendor", label: "Vendor" },
            { key: "date", label: "Date", type: "date" },
            { key: "amount", label: "Amount", type: "currency", align: "right" },
          ]}
          fields={[
            { key: "title", label: "Title", required: true, full: true },
            { key: "category", label: "Category" },
            { key: "project", label: "Project" },
            { key: "vendor", label: "Vendor" },
            { key: "date", label: "Date", type: "date" },
            { key: "amount", label: "Amount (₹)", type: "number" },
          ]}
        />

        <ModuleTable
          endpoint="/invoices" title="Invoices" testId="invoices"
          columns={[
            { key: "invoice_no", label: "Invoice #", type: "bold" },
            { key: "client", label: "Client" },
            { key: "date", label: "Issued", type: "date" },
            { key: "due_date", label: "Due", type: "date" },
            { key: "status", label: "Status", type: "status" },
            { key: "amount", label: "Amount", type: "currency", align: "right" },
          ]}
          fields={[
            { key: "invoice_no", label: "Invoice number", required: true },
            { key: "client", label: "Client" },
            { key: "date", label: "Issue date", type: "date" },
            { key: "due_date", label: "Due date", type: "date" },
            { key: "amount", label: "Amount (₹)", type: "number" },
            { key: "status", label: "Status", type: "select", default: "draft", options: [
              { value: "draft", label: "Draft" }, { value: "sent", label: "Sent" }, { value: "paid", label: "Paid" }
            ]},
          ]}
        />
      </div>
    </div>
  );
}
