import React from "react";
import ModuleTable from "@/components/ModuleTable";
import { PageHeader, formatCurrency } from "@/components/Shared";

const assetTotal = (form) => (Number(form.qty) || 0) * (Number(form.unit_cost) || 0);

const prepareFormForEdit = (row) => ({
  qty: row.qty ?? 1,
  unit_cost: row.unit_cost ?? row.value ?? 0,
});

const transformPayload = (payload) => {
  const qty = Number(payload.qty) || 0;
  const unit_cost = Number(payload.unit_cost) || 0;
  const next = { ...payload, qty, unit_cost, value: qty * unit_cost };
  delete next.depreciation;
  delete next.assigned_to;
  return next;
};

export default function Assets() {
  return (
    <div>
      <PageHeader eyebrow="Module · 07" title="Asset Master." description="Inventory, quantity and unit cost — total value is calculated automatically." />
      <ModuleTable
        endpoint="/assets"
        title="Assets"
        testId="assets"
        prepareFormForEdit={prepareFormForEdit}
        transformPayload={transformPayload}
        formExtra={(form) => (
          <div className="rounded-lg border border-[var(--bx-border)] bg-[var(--bx-bg-3)] px-3 py-2.5 flex items-center justify-between">
            <span className="text-xs text-[var(--bx-text-3)]">Total value (Qty × Cost per unit)</span>
            <span className="text-sm font-semibold bx-mono text-[var(--bx-text)]">{formatCurrency(assetTotal(form))}</span>
          </div>
        )}
        columns={[
          { key: "name", label: "Asset", type: "bold" },
          { key: "category", label: "Category" },
          { key: "serial", label: "Serial", render: (r) => <span className="bx-mono text-xs">{r.serial}</span> },
          { key: "purchase_date", label: "Purchased", type: "date" },
          { key: "qty", label: "Qty", align: "right", render: (r) => <span className="bx-mono">{r.qty ?? 1}</span> },
          {
            key: "unit_cost",
            label: "Unit cost",
            align: "right",
            render: (r) => (
              <span className="bx-mono">
                {formatCurrency(r.unit_cost ?? (r.qty ? (r.value || 0) / r.qty : r.value))}
              </span>
            ),
          },
          { key: "value", label: "Total", type: "currency", align: "right" },
          { key: "status", label: "Status", type: "status" },
        ]}
        fields={[
          { key: "name", label: "Asset name", required: true, full: true },
          { key: "category", label: "Category" },
          { key: "serial", label: "Serial / ID" },
          { key: "purchase_date", label: "Purchase date", type: "date" },
          { key: "qty", label: "Qty", type: "number", default: 1 },
          { key: "unit_cost", label: "Cost per unit (₹)", type: "number" },
          {
            key: "status",
            label: "Status",
            type: "select",
            default: "assigned",
            options: [
              { value: "assigned", label: "Assigned" },
              { value: "in_storage", label: "In storage" },
              { value: "retired", label: "Retired" },
              { value: "lost", label: "Lost" },
            ],
          },
        ]}
      />
    </div>
  );
}
