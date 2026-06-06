import React, { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import ModuleTable from "@/components/ModuleTable";
import KanbanBoard, { projectCard } from "@/components/KanbanBoard";
import { PageHeader, KpiCard, formatCurrency, formatDate } from "@/components/Shared";
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

function QuickAdd({ endpoint, label, fields, onAdded, defaults = {} }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(defaults);
  useEffect(() => { if (!open) setForm(defaults); /* eslint-disable-next-line */ }, [open]);

  const save = async () => {
    try {
      const payload = {};
      fields.forEach((f) => {
        let val = form[f.key];
        if (val === "" || val == null) return;
        if (f.type === "number") val = Number(val);
        payload[f.key] = val;
      });
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

function ProjectDetailDialog({ project, open, onOpenChange, isAdmin, onBudgetSaved }) {
  const [finance, setFinance] = useState(null);
  const [budgetInput, setBudgetInput] = useState("");
  const [saving, setSaving] = useState(false);

  const loadFinance = async () => {
    if (!project?.id) return;
    const { data } = await api.get(`/projects/${project.id}/finance`);
    setFinance(data);
    setBudgetInput(data.budget ? String(data.budget) : "");
  };

  useEffect(() => {
    if (!open || !project?.id) return;
    loadFinance().catch(() => toast.error("Failed to load project finance"));
    /* eslint-disable-next-line */
  }, [open, project?.id]);

  const saveBudget = async () => {
    const amount = Number(budgetInput);
    if (!amount || amount <= 0) {
      toast.error("Enter a valid budget amount");
      return;
    }
    setSaving(true);
    try {
      await api.put(`/projects/${project.id}/budget`, { budget: amount });
      toast.success("Budget saved");
      await loadFinance();
      onBudgetSaved?.();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to save budget");
    } finally {
      setSaving(false);
    }
  };

  if (!project) return null;

  const needsBudget = finance && !finance.budget_set;
  const managerCreated = finance?.created_by_role === "manager";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" data-testid="project-detail-dialog">
        <DialogHeader>
          <DialogTitle>{project.name}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div className="grid grid-cols-2 gap-3 text-sm">
            {project.client && (
              <div>
                <div className="text-[10px] uppercase tracking-widest text-[var(--bx-text-3)] bx-mono">Client</div>
                <div className="font-medium text-[var(--bx-text)]">{project.client}</div>
              </div>
            )}
            {project.manager && (
              <div>
                <div className="text-[10px] uppercase tracking-widest text-[var(--bx-text-3)] bx-mono">Manager</div>
                <div className="font-medium text-[var(--bx-text)]">{project.manager}</div>
              </div>
            )}
            {project.deadline && (
              <div>
                <div className="text-[10px] uppercase tracking-widest text-[var(--bx-text-3)] bx-mono">Deadline</div>
                <div className="bx-mono text-[var(--bx-text)]">{formatDate(project.deadline)}</div>
              </div>
            )}
            <div>
              <div className="text-[10px] uppercase tracking-widest text-[var(--bx-text-3)] bx-mono">Progress</div>
              <div className="bx-mono text-[var(--bx-text)]">{project.progress || 0}%</div>
            </div>
          </div>

          {isAdmin && needsBudget && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 p-4" data-testid="budget-not-added">
              <p className="text-sm text-amber-800 dark:text-amber-200">
                {managerCreated
                  ? `Budget not added — this project was created by ${finance.created_by_name || "a manager"}. Add the project budget below.`
                  : "Budget not added. Add the project budget below."}
              </p>
              <div className="mt-3 flex gap-2 items-end">
                <div className="flex-1">
                  <Label className="text-xs">Project budget (₹)</Label>
                  <Input
                    type="number"
                    min="1"
                    value={budgetInput}
                    onChange={(e) => setBudgetInput(e.target.value)}
                    placeholder="e.g. 500000"
                    data-testid="project-budget-input"
                  />
                </div>
                <Button onClick={saveBudget} disabled={saving} data-testid="save-project-budget">
                  {saving ? "Saving…" : "Add budget"}
                </Button>
              </div>
            </div>
          )}

          {!isAdmin && needsBudget && (
            <div className="rounded-lg border border-[var(--bx-border)] bg-[var(--bx-bg-3)] p-4 text-sm text-[var(--bx-text-2)]">
              Budget not added — CEO will set the project budget.
            </div>
          )}

          {finance?.budget_set && (
            <div className="rounded-lg border border-[var(--bx-border)] bg-[var(--bx-bg-3)] p-4 space-y-3">
              <div className="grid grid-cols-3 gap-3 text-sm">
                <div>
                  <div className="text-[10px] uppercase tracking-widest text-[var(--bx-text-3)] bx-mono">Budget</div>
                  <div className="bx-mono font-medium text-[var(--bx-text)]">{formatCurrency(finance.budget)}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-widest text-[var(--bx-text-3)] bx-mono">Spent</div>
                  <div className="bx-mono font-medium text-rose-600">{formatCurrency(finance.spent)}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-widest text-[var(--bx-text-3)] bx-mono">Remaining</div>
                  <div className="bx-mono font-medium text-emerald-600">{formatCurrency(Math.max(finance.remaining ?? 0, 0))}</div>
                </div>
              </div>

              {isAdmin && (
                <div className="flex gap-2 items-end border-t border-[var(--bx-border)] pt-3">
                  <div className="flex-1">
                    <Label className="text-xs">Update budget (₹)</Label>
                    <Input
                      type="number"
                      min="1"
                      value={budgetInput}
                      onChange={(e) => setBudgetInput(e.target.value)}
                    />
                  </div>
                  <Button variant="outline" onClick={saveBudget} disabled={saving}>
                    Update
                  </Button>
                </div>
              )}
            </div>
          )}

          {!finance?.budget_set && finance && (
            <div className="text-sm text-[var(--bx-text-2)]">
              Expenses logged so far: <span className="bx-mono font-medium">{formatCurrency(finance.spent)}</span>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function Projects() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const canWrite = isAdmin || user?.role === "manager";
  const [stats, setStats] = useState({});
  const [refreshKey, setRefreshKey] = useState(0);
  const [activeTab, setActiveTab] = useState("projects-kanban");
  const [detailProject, setDetailProject] = useState(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const refresh = () => setRefreshKey(k => k + 1);

  useEffect(() => {
    api.get("/reports/dashboard").then(({ data }) => setStats(data));
  }, [refreshKey]);

  const openProject = (p) => {
    setDetailProject(p);
    setDetailOpen(true);
  };

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
    {
      key: "budget",
      label: "Budget",
      align: "right",
      render: (r) => (
        !r.budget_set && r.created_by_role === "manager"
          ? <span className="text-amber-600 italic text-xs">Budget not added</span>
          : <span className="bx-mono">{formatCurrency(r.budget)}</span>
      ),
    },
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

  const projectFieldsForUser = isAdmin ? projectFields : projectFields.filter((f) => f.key !== "budget");
  const projectColumnsForUser = isAdmin ? projectColumns : projectColumns.filter((c) => c.key !== "budget");
  const renderProjectCard = (p) => projectCard(p, { showBudget: isAdmin });

  return (
    <div>
      <PageHeader eyebrow="Module · 03" title="Projects" description="Plan and track projects — click a card to view budget & spend. Drag to update status." />

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mb-6">
        <KpiCard label="Total" value={stats.projects ?? "—"} />
        <KpiCard label="Active" value={stats.active_projects ?? "—"} />
        {isAdmin && <KpiCard label="Clients" value={stats.clients ?? "—"} />}
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 mb-4">
          <TabsList className="mb-0 flex w-full sm:w-auto sm:inline-flex overflow-x-auto h-auto">
            <TabsTrigger value="projects-kanban" data-testid="tab-projects-kanban" className="shrink-0"><Kanban size={14} className="mr-1.5" /> Board</TabsTrigger>
            <TabsTrigger value="projects-list" data-testid="tab-projects-list" className="shrink-0"><ListBullets size={14} className="mr-1.5" /> List</TabsTrigger>
          </TabsList>
          {canWrite && activeTab === "projects-kanban" && (
            <QuickAdd endpoint="/projects" label="project" fields={projectFieldsForUser} onAdded={refresh} defaults={{ status: "planning" }} />
          )}
        </div>

        <TabsContent value="projects-kanban" className="mt-0">
          <KanbanBoard
            key={`pk-${refreshKey}`}
            endpoint="/projects"
            stages={PROJECT_STAGES}
            render={renderProjectCard}
            readOnly={!canWrite}
            onItemClick={openProject}
          />
        </TabsContent>

        <TabsContent value="projects-list" className="mt-0">
          <ModuleTable
            key={`pl-${refreshKey}`}
            endpoint="/projects"
            title="Projects"
            columns={projectColumnsForUser}
            fields={projectFieldsForUser}
            testId="projects"
            canWrite={canWrite}
            onRowClick={openProject}
          />
        </TabsContent>
      </Tabs>

      <ProjectDetailDialog
        project={detailProject}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        isAdmin={isAdmin}
        onBudgetSaved={refresh}
      />
    </div>
  );
}
