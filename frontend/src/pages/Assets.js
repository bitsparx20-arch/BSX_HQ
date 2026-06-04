import React from "react";
import ModuleTable from "@/components/ModuleTable";
import { PageHeader } from "@/components/Shared";

export default function Assets() {
  return (
    <div>
      <PageHeader eyebrow="Module · 07" title="Asset Master." description="Inventory, assignments and depreciation tracking." />
      <ModuleTable
        endpoint="/assets" title="Assets" testId="assets"
        columns={[
          { key: "name", label: "Asset", type: "bold" },
          { key: "category", label: "Category" },
          { key: "serial", label: "Serial", render: (r) => <span className="bx-mono text-xs">{r.serial}</span> },
          { key: "assigned_to", label: "Assigned to" },
          { key: "purchase_date", label: "Purchased", type: "date" },
          { key: "value", label: "Value", type: "currency", align: "right" },
          { key: "depreciation", label: "Dep %", render: (r) => <span className="bx-mono">{r.depreciation ?? 0}%</span> },
          { key: "status", label: "Status", type: "status" },
        ]}
        fields={[
          { key: "name", label: "Asset name", required: true, full: true },
          { key: "category", label: "Category" },
          { key: "serial", label: "Serial / ID" },
          { key: "assigned_to", label: "Assigned to" },
          { key: "purchase_date", label: "Purchase date", type: "date" },
          { key: "value", label: "Value (₹)", type: "number" },
          { key: "depreciation", label: "Depreciation %", type: "number" },
          { key: "status", label: "Status", type: "select", default: "assigned", options: [
            { value: "assigned", label: "Assigned" }, { value: "in_storage", label: "In storage" },
            { value: "retired", label: "Retired" }, { value: "lost", label: "Lost" }
          ]},
        ]}
      />
    </div>
  );
}
