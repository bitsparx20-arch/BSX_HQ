import React from "react";
import ModuleTable from "@/components/ModuleTable";
import { PageHeader } from "@/components/Shared";
import { useAuth } from "@/contexts/AuthContext";

const ALL_FIELDS = [
  { key: "subject", label: "Subject", required: true, full: true },
  { key: "client", label: "Client" },
  { key: "assigned_to", label: "Assignee" },
  { key: "priority", label: "Priority", type: "select", default: "medium", options: [
    { value: "low", label: "Low" }, { value: "medium", label: "Medium" }, { value: "high", label: "High" },
  ]},
  { key: "status", label: "Status", type: "select", default: "open", options: [
    { value: "open", label: "Open" }, { value: "in_progress", label: "In progress" }, { value: "closed", label: "Closed" },
  ]},
  { key: "sla_hours", label: "SLA hours", type: "number" },
];

const EMPLOYEE_FIELDS = [
  { key: "subject", label: "Subject", required: true, full: true },
  { key: "client", label: "Client (optional)" },
  { key: "priority", label: "Priority", type: "select", default: "medium", options: [
    { value: "low", label: "Low" }, { value: "medium", label: "Medium" }, { value: "high", label: "High" },
  ]},
];

export default function Helpdesk() {
  const { user } = useAuth();
  const isEmployee = user?.role === "employee";

  return (
    <div>
      <PageHeader
        eyebrow="Module · 09"
        title="Helpdesk / Tickets."
        description={isEmployee
          ? "Raise a support ticket — the CEO and managers can track and resolve it."
          : "Client issues, SLA timers and ticket ownership."}
      />
      <ModuleTable
        endpoint="/tickets"
        title="Tickets"
        testId="tickets"
        canWrite={!isEmployee}
        canCreate
        columns={[
          { key: "subject", label: "Subject", type: "bold" },
          { key: "client", label: "Client" },
          { key: "assigned_to", label: "Owner" },
          { key: "priority", label: "Priority", type: "status" },
          { key: "sla_hours", label: "SLA", render: (r) => <span className="bx-mono text-xs">{r.sla_hours}h</span> },
          { key: "status", label: "Status", type: "status" },
        ]}
        fields={isEmployee ? EMPLOYEE_FIELDS : ALL_FIELDS}
      />
    </div>
  );
}
