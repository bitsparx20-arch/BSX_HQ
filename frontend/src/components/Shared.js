import React from "react";

export const PageHeader = ({ eyebrow, title, description, actions }) => (
  <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between mb-6 sm:mb-8 pb-5 sm:pb-6 border-b border-[var(--bx-border)] gap-3">
    <div className="min-w-0">
      {eyebrow && (
        <div className="text-[10px] uppercase tracking-[0.14em] text-[var(--bx-text-3)] mb-2 font-semibold">
          {eyebrow}
        </div>
      )}
      <h1 className="bx-heading text-2xl lg:text-3xl tracking-tight">{title}</h1>
      {description && <p className="mt-2 text-sm text-[var(--bx-text-2)] max-w-2xl">{description}</p>}
    </div>
    {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
  </div>
);

export const KpiCard = ({ label, value, sub, accent }) => (
  <div className="bx-kpi" data-testid={`kpi-${label.toLowerCase().replace(/\s+/g, "-")}`}>
    <div className="text-[10px] uppercase tracking-[0.14em] text-[var(--bx-text-3)] mb-2 font-semibold">{label}</div>
    <div className={`bx-heading text-2xl tracking-tight ${accent || ""}`}>{value}</div>
    {sub && <div className="text-xs text-[var(--bx-text-3)] mt-1.5">{sub}</div>}
  </div>
);

export const StatusBadge = ({ status }) => {
  const map = {
    active: "bg-emerald-50 text-emerald-700 border-emerald-200",
    in_progress: "bg-blue-50 text-blue-700 border-blue-200",
    planning: "bg-slate-100 text-slate-700 border-slate-200",
    completed: "bg-violet-50 text-violet-700 border-violet-200",
    done: "bg-emerald-50 text-emerald-700 border-emerald-200",
    todo: "bg-slate-100 text-slate-700 border-slate-200",
    pending: "bg-amber-50 text-amber-700 border-amber-200",
    approved: "bg-emerald-50 text-emerald-700 border-emerald-200",
    rejected: "bg-rose-50 text-rose-700 border-rose-200",
    open: "bg-rose-50 text-rose-700 border-rose-200",
    closed: "bg-slate-100 text-slate-600 border-slate-200",
    paid: "bg-emerald-50 text-emerald-700 border-emerald-200",
    sent: "bg-blue-50 text-blue-700 border-blue-200",
    draft: "bg-slate-100 text-slate-700 border-slate-200",
    assigned: "bg-blue-50 text-blue-700 border-blue-200",
    in_storage: "bg-slate-100 text-slate-700 border-slate-200",
    renewal_due: "bg-amber-50 text-amber-700 border-amber-200",
    high: "bg-rose-50 text-rose-700 border-rose-200",
    medium: "bg-amber-50 text-amber-700 border-amber-200",
    low: "bg-slate-100 text-slate-600 border-slate-200",
    lead: "bg-slate-100 text-slate-700 border-slate-200",
    qualified: "bg-blue-50 text-blue-700 border-blue-200",
    negotiation: "bg-amber-50 text-amber-700 border-amber-200",
    won: "bg-emerald-50 text-emerald-700 border-emerald-200",
    lost: "bg-rose-50 text-rose-700 border-rose-200",
  };
  const cls = map[status] || "bg-slate-100 text-slate-700 border-slate-200";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-sm border text-[10px] bx-mono uppercase tracking-widest font-semibold ${cls}`}>
      {(status || "—").replace(/_/g, " ")}
    </span>
  );
};

export const Section = ({ title, children, action, className = "" }) => (
  <section className={`bg-[var(--bx-card)] border border-[var(--bx-border)] rounded-lg ${className}`}>
    <div className="px-4 sm:px-5 py-3.5 border-b border-[var(--bx-border)] flex items-center justify-between gap-2">
      <div className="text-[11px] uppercase tracking-[0.14em] text-[var(--bx-text-2)] font-semibold">
        {title}
      </div>
      {action}
    </div>
    {children}
  </section>
);

export const formatCurrency = (n) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n || 0);

export const formatDate = (s) => {
  if (!s) return "—";
  try {
    const d = new Date(s);
    if (isNaN(d.getTime())) return s;
    return d.toLocaleDateString("en-IN", { year: "numeric", month: "short", day: "2-digit" });
  } catch {
    return s;
  }
};

export const EmptyState = ({ message = "No records yet" }) => (
  <div className="py-12 text-center text-sm text-[var(--bx-text-3)]">{message}</div>
);
