import React from "react";
import ModuleTable from "@/components/ModuleTable";
import { PageHeader } from "@/components/Shared";
import { validateEmail, validatePhone, normalizePhone } from "@/lib/validation";

export default function Employees() {
  return (
    <div>
      <PageHeader eyebrow="Module · 04" title="Employees." description="Employee profiles and directory." />
      <ModuleTable
        endpoint="/employees" title="Directory" testId="employees"
        columns={[
          { key: "name", label: "Name", type: "bold" },
          { key: "designation", label: "Designation" },
          { key: "department", label: "Department" },
          { key: "email", label: "Email" },
          { key: "phone", label: "Phone" },
          { key: "status", label: "Status", type: "status" },
        ]}
        fields={[
          { key: "name", label: "Full name", required: true },
          {
            key: "email",
            label: "Email",
            type: "email",
            required: true,
            placeholder: "name@company.com",
            validate: validateEmail,
          },
          {
            key: "password",
            label: "Password",
            type: "password",
            requiredOnCreate: true,
            placeholder: "Set login password",
            editPlaceholder: "Leave blank to keep unchanged",
            editLabel: "New password",
            testId: "employees-password",
          },
          {
            key: "phone",
            label: "Phone",
            type: "tel",
            required: true,
            placeholder: "9876543210",
            inputMode: "numeric",
            maxLength: 15,
            validate: validatePhone,
            normalize: normalizePhone,
          },
          {
            key: "designation",
            label: "Designation",
            type: "select",
            allowCustom: true,
            customOptionValue: "__custom__",
            customKey: "designation_custom",
            options: [
              { value: "CEO", label: "CEO" },
              { value: "Manager", label: "Manager" },
              { value: "Employees", label: "Employees" },
              { value: "__custom__", label: "Custom" },
            ],
          },
          {
            key: "department",
            label: "Department",
            visible: (values) => {
              const designation = values.designation === "__custom__"
                ? values.designation_custom
                : values.designation;
              return designation !== "CEO";
            },
          },
          { key: "join_date", label: "Join date", type: "date" },
          { key: "status", label: "Status", type: "select", default: "active", options: [
            { value: "active", label: "Active" }, { value: "on_leave", label: "On leave" }, { value: "terminated", label: "Terminated" }
          ]},
        ]}
      />
    </div>
  );
}
