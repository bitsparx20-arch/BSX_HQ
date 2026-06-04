import React from "react";
import ModuleTable from "@/components/ModuleTable";
import { PageHeader } from "@/components/Shared";

export default function Employees() {
  return (
    <div>
      <PageHeader eyebrow="Module · 04" title="Employees." description="Profiles, performance, salary, and appraisals." />
      <ModuleTable
        endpoint="/employees" title="Directory" testId="employees"
        columns={[
          { key: "name", label: "Name", type: "bold" },
          { key: "designation", label: "Designation" },
          { key: "department", label: "Department" },
          { key: "email", label: "Email" },
          { key: "phone", label: "Phone" },
          { key: "performance", label: "Rating", render: (r) => <span className="bx-mono">{r.performance ? `${r.performance}/5` : "—"}</span> },
          { key: "salary", label: "Salary", type: "currency", align: "right" },
          { key: "status", label: "Status", type: "status" },
        ]}
        fields={[
          { key: "name", label: "Full name", required: true },
          { key: "email", label: "Email", type: "email" },
          { key: "phone", label: "Phone" },
          { key: "designation", label: "Designation" },
          { key: "department", label: "Department" },
          { key: "salary", label: "Salary (₹/mo)", type: "number" },
          { key: "performance", label: "Performance (out of 5)", type: "number" },
          { key: "join_date", label: "Join date", type: "date" },
          { key: "status", label: "Status", type: "select", default: "active", options: [
            { value: "active", label: "Active" }, { value: "on_leave", label: "On leave" }, { value: "terminated", label: "Terminated" }
          ]},
        ]}
      />
    </div>
  );
}
