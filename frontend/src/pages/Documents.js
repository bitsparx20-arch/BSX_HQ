import React from "react";
import ModuleTable from "@/components/ModuleTable";
import { PageHeader } from "@/components/Shared";

export default function Documents() {
  return (
    <div>
      <PageHeader eyebrow="Module · 10" title="Document Manager." description="Contracts, quotations, signed docs and version history." />
      <ModuleTable
        endpoint="/documents" title="Documents" testId="documents"
        columns={[
          { key: "name", label: "File", type: "bold" },
          { key: "category", label: "Category" },
          { key: "client", label: "Client" },
          { key: "version", label: "Version", render: (r) => <span className="bx-mono text-xs">{r.version}</span> },
          { key: "size_kb", label: "Size", render: (r) => <span className="bx-mono text-xs">{r.size_kb ? `${r.size_kb} KB` : "—"}</span> },
          { key: "uploaded_by", label: "Uploaded by" },
        ]}
        fields={[
          { key: "name", label: "File name", required: true, full: true },
          { key: "category", label: "Category", type: "select", default: "Contract", options: [
            { value: "Contract", label: "Contract" }, { value: "Quotation", label: "Quotation" },
            { value: "NDA", label: "NDA" }, { value: "HR", label: "HR" }, { value: "Other", label: "Other" }
          ]},
          { key: "client", label: "Client" },
          { key: "version", label: "Version", placeholder: "v1.0" },
          { key: "size_kb", label: "Size (KB)", type: "number" },
          { key: "uploaded_by", label: "Uploaded by" },
        ]}
      />
    </div>
  );
}
