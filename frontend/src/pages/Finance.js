import React, { useEffect, useState } from "react";
import { api } from "@/lib/api";
import ModuleTable from "@/components/ModuleTable";
import { PageHeader, KpiCard, Section, formatCurrency, formatDate } from "@/components/Shared";
import { useAuth } from "@/contexts/AuthContext";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FilePdf } from "@phosphor-icons/react";
import { toast } from "sonner";

function InvoicePdfButton({ row, isAdmin }) {
  const canDownload = isAdmin && (row.amount_set || row.amount);

  const download = async (e) => {
    e.stopPropagation();
    if (!isAdmin) {
      toast.info("Only CEO can download invoice");
      return;
    }
    if (!row.amount_set && !row.amount) {
      toast.error("Add invoice amount before downloading");
      return;
    }
    try {
      const res = await api.get(`/invoices/${row.id}/pdf`, { responseType: "blob" });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${row.invoice_no || "invoice"}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Download failed");
    }
  };

  return (
    <button
      type="button"
      onClick={download}
      title={isAdmin ? (canDownload ? "Download invoice PDF" : "Add amount to download") : "Only CEO can download invoice"}
      className={`inline-flex flex-col items-center gap-0.5 ${canDownload ? "text-[var(--bx-brand)] hover:opacity-80" : "text-[var(--bx-text-3)]"}`}
      data-testid={`invoice-pdf-${row.id}`}
    >
      <FilePdf size={20} weight={canDownload ? "fill" : "regular"} />
      {!isAdmin && <span className="text-[9px] leading-none">CEO only</span>}
    </button>
  );
}

function InvoiceDetailDialog({ invoice, open, onOpenChange, isAdmin, onAmountSaved }) {
  const [amountInput, setAmountInput] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !invoice) return;
    setAmountInput(invoice.amount ? String(invoice.amount) : "");
  }, [open, invoice]);

  const saveAmount = async () => {
    const amount = Number(amountInput);
    if (!amount || amount <= 0) {
      toast.error("Enter a valid amount");
      return;
    }
    setSaving(true);
    try {
      await api.put(`/invoices/${invoice.id}/amount`, { amount });
      toast.success("Invoice amount saved");
      onAmountSaved?.();
      onOpenChange(false);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to save amount");
    } finally {
      setSaving(false);
    }
  };

  if (!invoice) return null;

  const needsAmount = !(invoice.amount_set || invoice.amount);
  const managerCreated = invoice.created_by_role === "manager";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="invoice-detail-dialog">
        <DialogHeader>
          <DialogTitle>{invoice.invoice_no}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-1 text-sm">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-[10px] uppercase tracking-widest text-[var(--bx-text-3)] bx-mono">Client</div>
              <div className="font-medium">{invoice.client || "—"}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-widest text-[var(--bx-text-3)] bx-mono">Status</div>
              <div className="font-medium capitalize">{invoice.status || "—"}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-widest text-[var(--bx-text-3)] bx-mono">Issued</div>
              <div className="bx-mono">{formatDate(invoice.date)}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-widest text-[var(--bx-text-3)] bx-mono">Due</div>
              <div className="bx-mono">{formatDate(invoice.due_date)}</div>
            </div>
          </div>

          {isAdmin && needsAmount && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 p-4" data-testid="amount-not-added">
              <p className="text-sm text-amber-800 dark:text-amber-200">
                {managerCreated
                  ? `Amount not added — this invoice was created by ${invoice.created_by_name || "a manager"}. Add the amount below.`
                  : "Amount not added. Add the invoice amount below."}
              </p>
              <div className="mt-3">
                <Label className="text-xs">Invoice amount (₹)</Label>
                <Input
                  type="number"
                  min="1"
                  value={amountInput}
                  onChange={(e) => setAmountInput(e.target.value)}
                  placeholder="e.g. 150000"
                  data-testid="invoice-amount-input"
                />
              </div>
            </div>
          )}

          {!isAdmin && needsAmount && (
            <div className="rounded-lg border border-[var(--bx-border)] bg-[var(--bx-bg-3)] p-4 text-sm text-[var(--bx-text-2)]">
              Amount not added — CEO will set the invoice amount.
            </div>
          )}

          {(invoice.amount_set || invoice.amount) && (
            <div className="rounded-lg border border-[var(--bx-border)] bg-[var(--bx-bg-3)] p-4">
              <div className="text-[10px] uppercase tracking-widest text-[var(--bx-text-3)] bx-mono">Amount</div>
              <div className="bx-mono text-lg font-semibold text-[var(--bx-text)]">{formatCurrency(invoice.amount)}</div>
              {isAdmin && (
                <div className="mt-3">
                  <Label className="text-xs">Update amount (₹)</Label>
                  <Input
                    type="number"
                    min="1"
                    value={amountInput}
                    onChange={(e) => setAmountInput(e.target.value)}
                  />
                </div>
              )}
            </div>
          )}
        </div>

        {isAdmin && (
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
            <Button onClick={saveAmount} disabled={saving} data-testid="save-invoice-amount">
              {saving ? "Saving…" : invoice.amount_set ? "Update amount" : "Add amount"}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function Finance() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [stats, setStats] = useState({});
  const [trend, setTrend] = useState([]);
  const [invoiceRefresh, setInvoiceRefresh] = useState(0);
  const [detailInvoice, setDetailInvoice] = useState(null);
  const [detailOpen, setDetailOpen] = useState(false);

  useEffect(() => {
    api.get("/reports/dashboard").then(({ data }) => setStats(data));
    if (isAdmin) {
      api.get("/reports/finance-trend").then(({ data }) => setTrend(data));
    } else {
      setTrend([]);
    }
  }, [isAdmin, invoiceRefresh]);

  const openInvoice = (row) => {
    setDetailInvoice(row);
    setDetailOpen(true);
  };

  const expenseColumns = [
    { key: "title", label: "Expense", type: "bold" },
    { key: "category", label: "Category" },
    { key: "project", label: "Project" },
    { key: "vendor", label: "Vendor" },
    { key: "date", label: "Date", type: "date" },
    { key: "amount", label: "Amount", type: "currency", align: "right" },
  ];
  const expenseFields = [
    { key: "title", label: "Title", required: true, full: true },
    { key: "category", label: "Category" },
    { key: "project", label: "Project" },
    { key: "vendor", label: "Vendor" },
    { key: "date", label: "Date", type: "date" },
    { key: "amount", label: "Amount (₹)", type: "number" },
  ];

  const invoiceColumns = [
    {
      key: "pdf",
      label: "PDF",
      render: (r) => (
        <span onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
          <InvoicePdfButton row={r} isAdmin={isAdmin} />
        </span>
      ),
    },
    { key: "invoice_no", label: "Invoice #", type: "bold" },
    { key: "client", label: "Client" },
    { key: "date", label: "Issued", type: "date" },
    { key: "due_date", label: "Due", type: "date" },
    { key: "status", label: "Status", type: "status" },
    ...(isAdmin ? [{
      key: "amount",
      label: "Amount",
      align: "right",
      render: (r) => (
        (r.amount_set || r.amount)
          ? <span className="bx-mono">{formatCurrency(r.amount)}</span>
          : <span className="text-amber-600 italic text-xs">Amount not added</span>
      ),
    }] : []),
  ];

  const invoiceFields = [
    { key: "invoice_no", label: "Invoice number", required: true },
    { key: "client", label: "Client" },
    { key: "date", label: "Issue date", type: "date" },
    { key: "due_date", label: "Due date", type: "date" },
    ...(isAdmin ? [{ key: "amount", label: "Amount (₹)", type: "number" }] : []),
    {
      key: "status",
      label: "Status",
      type: "select",
      default: "draft",
      options: [
        { value: "draft", label: "Draft" },
        { value: "sent", label: "Sent" },
        { value: "paid", label: "Paid" },
      ],
    },
  ];

  const managerExpenseColumns = expenseColumns.filter((c) => c.key !== "amount");
  const managerExpenseFields = expenseFields.filter((f) => f.key !== "amount");

  return (
    <div>
      <PageHeader
        eyebrow="Module · 02"
        title="Project Finance & Expenses."
        description={
          isAdmin
            ? "Budgets, daily spends, invoices and Profit & Loss. Click an invoice to add amount; PDF download is CEO-only."
            : "Track daily spends and create invoices. CEO sets amounts and downloads invoice PDFs."
        }
      />

      <div className={`grid gap-3 mb-6 ${isAdmin ? "grid-cols-2 lg:grid-cols-4" : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-2"}`}>
        {isAdmin && (
          <>
            <KpiCard label="Revenue" value={formatCurrency(stats.total_invoiced)} accent="text-emerald-600" />
            <KpiCard label="Net P&L" value={formatCurrency(stats.pnl)} accent={stats.pnl >= 0 ? "text-emerald-600" : "text-rose-600"} />
            <KpiCard label="Projects" value={stats.projects ?? "—"} />
          </>
        )}
        <KpiCard label="Expenses" value={formatCurrency(stats.total_expenses)} accent="text-rose-600" />
      </div>

      {isAdmin && (
        <Section title="Revenue vs Expense" className="mb-6">
          <div className="p-5">
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={trend}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                <XAxis dataKey="month" stroke="#94A3B8" fontSize={11} tickLine={false} />
                <YAxis stroke="#94A3B8" fontSize={11} tickLine={false} tickFormatter={(v) => `${(v / 1000).toFixed(0)}K`} />
                <Tooltip contentStyle={{ borderRadius: 6, border: "1px solid #E2E8F0", fontSize: 12 }} formatter={(v) => formatCurrency(v)} />
                <Bar dataKey="revenue" fill="#003EDB" radius={[3, 3, 0, 0]} />
                <Bar dataKey="expense" fill="#FF3B30" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Section>
      )}

      <div className="space-y-6">
        <ModuleTable
          endpoint="/expenses"
          title="Expenses"
          testId="expenses"
          columns={isAdmin ? expenseColumns : managerExpenseColumns}
          fields={isAdmin ? expenseFields : managerExpenseFields}
        />

        <ModuleTable
          key={`inv-${invoiceRefresh}`}
          endpoint="/invoices"
          title="Invoices"
          testId="invoices"
          columns={invoiceColumns}
          fields={invoiceFields}
          onRowClick={openInvoice}
        />
      </div>

      <InvoiceDetailDialog
        invoice={detailInvoice}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        isAdmin={isAdmin}
        onAmountSaved={() => setInvoiceRefresh((k) => k + 1)}
      />
    </div>
  );
}
