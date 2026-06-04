import React, { useEffect, useState } from "react";
import { api } from "@/lib/api";
import ModuleTable from "@/components/ModuleTable";
import KanbanBoard, { projectCard, taskCard } from "@/components/KanbanBoard";
import { PageHeader, KpiCard } from "@/components/Shared";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Plus, Kanban, ListBullets } from "@phosphor-icons/react";
import { toast } from "sonner";

const PROJECT_STAGES = [
  { key: "planning", label: "Planning", color: "#94A3B8" },
  { key: "in_progress", label: "In Progress", color: "#2453E5" },
  { key: "on_hold", label: "On Hold", color: "#F59E0B" },
  { key: "completed", label: "Completed", color: "#10B981" },
];
const TASK_STAGES = [
  { key: "todo", label: "To do", color: "#94A3B8" },
  { key: "in_progress", label: "In progress", color: "#2453E5" },
  { key: "review", label: "Review", color: "#F59E0B" },
  { key: "done", label: "Done", color: "#10B981" },
];

function QuickAdd({ endpoint, label, fields, onAdded, defaults = {} }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(defaults);
  useEffect(() => { if (!open) setForm(defaults); /* eslint-disable-next-line */ }, [open]);

  const save = async () => {
    try {
      const payload = { ...form };
      fields.forEach(f => { if (f.type === "number" && payload[f.key]) payload[f.key] = Number(payload[f.key]); });
      await api.post(endpoint, payload);
      toast.success(`${label} created`);
      setOpen(false);
      onAdded && onAdded();
    } catch (e) { toast.error(e.response?.data?.detail || "Failed"); }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="bg-[var(--bx-brand)] hover:opacity-90 text-white" size="sm">
          <Plus size={14} weight="bold" className="mr-1.5" /> New {label}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>New {label}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          {fields.map(f => (
            <div key={f.key} className={f.full ? "col-span-2" : ""}>
              <Label className="text-xs">{f.label}</Label>
              {f.type === "select" ? (
                <Select value={form[f.key] || ""} onValueChange={(v) => setForm({ ...form, [f.key]: v })}>
                  <SelectTrigger><SelectValue placeholder={`Select ${f.label}`} /></SelectTrigger>
                  <SelectContent>{f.options.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
                </Select>
              ) : (
                <Input type={f.type || "text"} value={form[f.key] || ""} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} />
              )}
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button onClick={save} className="bg-[var(--bx-brand)] hover:opacity-90 text-white">Create</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function Projects() {
  const [stats, setStats] = useState({});
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = () => setRefreshKey(k => k + 1);

  useEffect(() => {
    api.get("/reports/dashboard").then(({ data }) => setStats(data));
  }, [refreshKey]);

  const projectColumns = [
    { key: "name", label: "Project", type: "bold" },
    { key: "client", label: "Client" },
    { key: "manager", label: "Manager" },
    { key: "status", label: "Status", type: "status" },
    { key: "progress", label: "Progress", render: (r) => (
        <div className="flex items-center gap-2 min-w-[120px]">
          <div className="flex-1 h-1.5 bg-[var(--bx-bg-3)] rounded-full overflow-hidden">
            <div className="h-full bg-[var(--bx-brand)]" style={{ width: `${r.progress || 0}%` }} />
          </div>
          <span className="bx-mono text-xs text-[var(--bx-text-2)] w-8">{r.progress || 0}%</span>
        </div>
      )
    },
    { key: "budget", label: "Budget", type: "currency", align: "right" },
    { key: "deadline", label: "Deadline", type: "date" },
  ];

  const projectFields = [
    { key: "name", label: "Project name", required: true },
    { key: "client", label: "Client" },
    { key: "manager", label: "Manager" },
    { key: "status", label: "Status", type: "select", options: PROJECT_STAGES.map(s => ({ value: s.key, label: s.label })), default: "planning" },
    { key: "progress", label: "Progress %", type: "number" },
    { key: "budget", label: "Budget (₹)", type: "number" },
    { key: "start_date", label: "Start date", type: "date" },
    { key: "deadline", label: "Deadline", type: "date" },
  ];

  const taskColumns = [
    { key: "title", label: "Task", type: "bold" },
    { key: "project", label: "Project" },
    { key: "assignee", label: "Assignee" },
    { key: "priority", label: "Priority", type: "status" },
    { key: "status", label: "Status", type: "status" },
    { key: "due_date", label: "Due", type: "date" },
  ];

  const taskFields = [
    { key: "title", label: "Title", required: true, full: true },
    { key: "project", label: "Project" },
    { key: "assignee", label: "Assignee" },
    { key: "status", label: "Status", type: "select", default: "todo", options: TASK_STAGES.map(s => ({ value: s.key, label: s.label })) },
    { key: "priority", label: "Priority", type: "select", default: "medium", options: [
      { value: "low", label: "Low" }, { value: "medium", label: "Medium" }, { value: "high", label: "High" }
    ]},
    { key: "due_date", label: "Due date", type: "date" },
  ];

  return (
    <div>
      <PageHeader eyebrow="Module · 03" title="Projects & Tasks" description="Plan, track and ship — drag cards between columns to update status." />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <KpiCard label="Total" value={stats.projects ?? "—"} />
        <KpiCard label="Active" value={stats.active_projects ?? "—"} />
        <KpiCard label="Tasks" value={stats.tasks ?? "—"} />
        <KpiCard label="Clients" value={stats.clients ?? "—"} />
      </div>

      <Tabs defaultValue="projects-kanban">
        <TabsList className="mb-4 flex w-full sm:w-auto sm:inline-flex overflow-x-auto h-auto">
          <TabsTrigger value="projects-kanban" data-testid="tab-projects-kanban" className="shrink-0"><Kanban size={14} className="mr-1.5" /> Projects · Board</TabsTrigger>
          <TabsTrigger value="projects-list" data-testid="tab-projects-list" className="shrink-0"><ListBullets size={14} className="mr-1.5" /> Projects · List</TabsTrigger>
          <TabsTrigger value="tasks-kanban" data-testid="tab-tasks-kanban" className="shrink-0"><Kanban size={14} className="mr-1.5" /> Tasks · Board</TabsTrigger>
          <TabsTrigger value="tasks-list" data-testid="tab-tasks-list" className="shrink-0"><ListBullets size={14} className="mr-1.5" /> Tasks · List</TabsTrigger>
        </TabsList>

        <TabsContent value="projects-kanban">
          <div className="flex justify-end mb-3">
            <QuickAdd endpoint="/projects" label="project" fields={projectFields} onAdded={refresh} defaults={{ status: "planning" }} />
          </div>
          <KanbanBoard key={`pk-${refreshKey}`} endpoint="/projects" stages={PROJECT_STAGES} render={projectCard} />
        </TabsContent>

        <TabsContent value="projects-list">
          <ModuleTable key={`pl-${refreshKey}`} endpoint="/projects" title="Projects" columns={projectColumns} fields={projectFields} testId="projects" />
        </TabsContent>

        <TabsContent value="tasks-kanban">
          <div className="flex justify-end mb-3">
            <QuickAdd endpoint="/tasks" label="task" fields={taskFields} onAdded={refresh} defaults={{ status: "todo", priority: "medium" }} />
          </div>
          <KanbanBoard key={`tk-${refreshKey}`} endpoint="/tasks" stages={TASK_STAGES} render={taskCard} />
        </TabsContent>

        <TabsContent value="tasks-list">
          <ModuleTable key={`tl-${refreshKey}`} endpoint="/tasks" title="Tasks" columns={taskColumns} fields={taskFields} testId="tasks" />
        </TabsContent>
      </Tabs>
    </div>
  );
}
