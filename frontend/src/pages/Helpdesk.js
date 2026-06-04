import React from "react";
import ModuleTable from "@/components/ModuleTable";
import { PageHeader } from "@/components/Shared";

export default function Helpdesk() {
  return (
    <div>
      <PageHeader eyebrow="Module · 09" title="Helpdesk / Tickets." description="Client issues, SLA timers and ticket ownership." />
      <ModuleTable
        endpoint="/tickets" title="Tickets" testId="tickets"
        columns={[
          { key: "subject", label: "Subject", type: "bold" },
          { key: "client", label: "Client" },
          { key: "assigned_to", label: "Owner" },
          { key: "priority", label: "Priority", type: "status" },
          { key: "sla_hours", label: "SLA", render: (r) => <span className="bx-mono text-xs">{r.sla_hours}h</span> },
          { key: "status", label: "Status", type: "status" },
        ]}
        fields={[
          { key: "subject", label: "Subject", required: true, full: true },
          { key: "client", label: "Client" },
          { key: "assigned_to", label: "Assignee" },
          { key: "priority", label: "Priority", type: "select", default: "medium", options: [
            { value: "low", label: "Low" }, { value: "medium", label: "Medium" }, { value: "high", label: "High" }
          ]},
          { key: "status", label: "Status", type: "select", default: "open", options: [
            { value: "open", label: "Open" }, { value: "in_progress", label: "In progress" }, { value: "closed", label: "Closed" }
          ]},
          { key: "sla_hours", label: "SLA hours", type: "number" },
        ]}
      />
    </div>
  );
}
