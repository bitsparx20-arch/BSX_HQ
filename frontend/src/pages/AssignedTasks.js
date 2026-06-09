import React, { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { useSidebarAlerts } from "@/contexts/SidebarAlertsContext";
import { PageHeader, KpiCard, Section } from "@/components/Shared";
import KanbanBoard, { assignedTaskCard } from "@/components/KanbanBoard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import { CaretLeft, CaretRight, Plus } from "@phosphor-icons/react";
import { toast } from "sonner";

const TASK_STAGES = [
  { key: "todo", label: "To do", color: "#94A3B8" },
  { key: "in_progress", label: "In progress", color: "#2453E5" },
  { key: "review", label: "Review", color: "#F59E0B" },
  { key: "done", label: "Done", color: "#10B981" },
];

const todayStr = () => new Date().toISOString().slice(0, 10);

const shiftDate = (dateStr, days) => {
  const d = new Date(`${dateStr}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};

const formatDayLabel = (dateStr) => {
  const d = new Date(`${dateStr}T12:00:00`);
  const today = todayStr();
  if (dateStr === today) return "Today";
  const yesterday = shiftDate(today, -1);
  if (dateStr === yesterday) return "Yesterday";
  const tomorrow = shiftDate(today, 1);
  if (dateStr === tomorrow) return "Tomorrow";
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
};

export default function AssignedTasks() {
  const { user } = useAuth();
  const { refresh: refreshAlerts } = useSidebarAlerts();
  const isAdmin = user?.role === "admin";
  const isEmployee = user?.role === "employee";
  const [taskDate, setTaskDate] = useState(todayStr());
  const [tasks, setTasks] = useState([]);
  const [users, setUsers] = useState([]);
  const [assignOpen, setAssignOpen] = useState(false);
  const [form, setForm] = useState({
    title: "", description: "", assignee_id: "", task_date: todayStr(), priority: "medium",
  });

  const load = async () => {
    const { data } = await api.get(`/assigned-tasks?task_date=${taskDate}`);
    setTasks(data || []);
  };

  useEffect(() => { load(); }, [taskDate]);

  useEffect(() => {
    api.post("/assigned-tasks/mark-seen")
      .then(() => refreshAlerts())
      .catch(() => {});
  }, [refreshAlerts]);

  useEffect(() => {
    if (!isAdmin) return;
    api.get("/users").then(({ data }) => setUsers(data || [])).catch(() => {});
  }, [isAdmin]);

  const stats = useMemo(() => {
    const done = tasks.filter((t) => t.status === "done").length;
    return { total: tasks.length, done, pending: tasks.length - done };
  }, [tasks]);

  const onStatusChange = async (task, newStatus) => {
    await api.put(`/assigned-tasks/${task.id}`, { status: newStatus });
    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, status: newStatus } : t)));
  };

  const assignTask = async () => {
    if (!form.title.trim()) {
      toast.error("Title is required");
      return;
    }
    if (isAdmin && !form.assignee_id) {
      toast.error("Assignee is required");
      return;
    }
    try {
      const payload = isEmployee
        ? { title: form.title, description: form.description, task_date: form.task_date, priority: form.priority }
        : form;
      await api.post("/assigned-tasks", payload);
      toast.success(isEmployee ? "Task added" : "Task assigned");
      setAssignOpen(false);
      setForm({ title: "", description: "", assignee_id: "", task_date: taskDate, priority: "medium" });
      if (form.task_date === taskDate) load();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to assign");
    }
  };

  const removeTask = async (id) => {
    try {
      await api.delete(`/assigned-tasks/${id}`);
      toast.success("Task removed");
      setTasks((prev) => prev.filter((t) => t.id !== id));
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to delete");
    }
  };

  return (
    <div>
      <PageHeader
        eyebrow="Module · Workspace"
        title="Assigned Tasks."
        description={
          isEmployee
            ? "Your daily tasks — add your own or complete ones from leadership. Drag cards to update progress."
            : undefined
        }
        actions={
          (isAdmin || isEmployee) ? (
            <Button onClick={() => { setForm((f) => ({ ...f, task_date: taskDate })); setAssignOpen(true); }} data-testid="assign-task-btn">
              <Plus size={16} className="mr-1.5" /> {isEmployee ? "Add task" : "Assign task"}
            </Button>
          ) : null
        }
      />

      <div className="grid grid-cols-3 gap-3 sm:gap-4 mb-6">
        <KpiCard label="Total" value={stats.total} />
        <KpiCard label="Done" value={stats.done} accent="text-emerald-600" />
        <KpiCard label="Pending" value={stats.pending} accent="text-amber-600" />
      </div>

      <Section
        title={`Tasks — ${formatDayLabel(taskDate)}`}
        action={
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setTaskDate((d) => shiftDate(d, -1))} aria-label="Previous day">
              <CaretLeft size={16} />
            </Button>
            <Input
              type="date"
              value={taskDate}
              onChange={(e) => setTaskDate(e.target.value)}
              className="h-8 w-[9.5rem] text-xs bx-mono"
              data-testid="task-date-picker"
            />
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setTaskDate((d) => shiftDate(d, 1))} aria-label="Next day">
              <CaretRight size={16} />
            </Button>
            {taskDate !== todayStr() && (
              <Button variant="outline" size="sm" className="h-8 text-xs ml-1" onClick={() => setTaskDate(todayStr())}>
                Today
              </Button>
            )}
          </div>
        }
      >
        <KanbanBoard
          items={tasks}
          onStatusChange={onStatusChange}
          stages={TASK_STAGES}
          render={(t) => assignedTaskCard(t, {
            showAssignee: isAdmin,
            onDelete: isAdmin ? removeTask : undefined,
          })}
          readOnly={false}
        />
      </Section>

      <Dialog open={assignOpen} onOpenChange={setAssignOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{isEmployee ? "Add your task" : "Assign daily task"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>Title</Label>
              <Input
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="What needs to be done?"
                data-testid="assign-title"
              />
            </div>
            <div>
              <Label>Details (optional)</Label>
              <Textarea
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="Extra context or links…"
                rows={3}
              />
            </div>
            {isAdmin && (
            <div>
              <Label>Assign to</Label>
              <Select value={form.assignee_id} onValueChange={(v) => setForm((f) => ({ ...f, assignee_id: v }))}>
                <SelectTrigger data-testid="assignee-select">
                  <SelectValue placeholder="Select team member" />
                </SelectTrigger>
                <SelectContent>
                  {users.filter((u) => u.id !== user?.id).map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.name || u.email} ({u.role})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            )}
            <div>
              <Label>Priority</Label>
              <Select value={form.priority} onValueChange={(v) => setForm((f) => ({ ...f, priority: v }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Date</Label>
              <Input
                type="date"
                value={form.task_date}
                onChange={(e) => setForm((f) => ({ ...f, task_date: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignOpen(false)}>Cancel</Button>
            <Button onClick={assignTask} data-testid="assign-submit">{isEmployee ? "Add" : "Assign"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
