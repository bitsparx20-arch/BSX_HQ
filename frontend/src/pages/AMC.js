import React from "react";
import ModuleTable from "@/components/ModuleTable";
import { PageHeader } from "@/components/Shared";
import { useAuth } from "@/contexts/AuthContext";

const amcColumns = [
  { key: "title", label: "Contract", type: "bold" },
  { key: "vendor", label: "Vendor" },
  { key: "contact_phone", label: "Contact", render: (r) => <span className="bx-mono text-xs">{r.contact_phone}</span> },
  { key: "start_date", label: "Start", type: "date" },
  { key: "renewal_date", label: "Renewal", type: "date" },
  { key: "value", label: "Value", type: "currency", align: "right" },
  { key: "status", label: "Status", type: "status" },
];

const amcFields = [
  { key: "title", label: "Title", required: true, full: true },
  { key: "vendor", label: "Vendor" },
  { key: "contact_phone", label: "Vendor phone" },
  { key: "start_date", label: "Start date", type: "date" },
  { key: "renewal_date", label: "Renewal date", type: "date" },
  { key: "value", label: "Annual value (₹)", type: "number" },
  {
    key: "status",
    label: "Status",
    type: "select",
    default: "active",
    options: [
      { value: "active", label: "Active" },
      { value: "renewal_due", label: "Renewal due" },
      { value: "expired", label: "Expired" },
    ],
  },
];

export default function AMC() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  return (
    <div>
      <PageHeader eyebrow="Module · 08" title="AMC & Maintenance." />
      <ModuleTable
        endpoint="/amc"
        title="Contracts"
        testId="amc"
        columns={isAdmin ? amcColumns : amcColumns.filter((c) => c.key !== "value")}
        fields={isAdmin ? amcFields : amcFields.filter((f) => f.key !== "value")}
      />
    </div>
  );
}
