import React, { useEffect, useMemo, useState } from "react";
import {
  DndContext, PointerSensor, TouchSensor, useSensor, useSensors, closestCorners, DragOverlay,
} from "@dnd-kit/core";
import { useDroppable, useDraggable } from "@dnd-kit/core";
import { api } from "@/lib/api";
import { StatusBadge, formatCurrency, formatDate } from "@/components/Shared";
import { toast } from "sonner";
import { Plus } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";

function KanbanCard({ item, render, isOverlay, readOnly, onItemClick }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: item.id, disabled: readOnly });
  return (
    <div
      ref={setNodeRef}
      {...(readOnly ? {} : { ...attributes, ...listeners })}
      onClick={() => { if (!isDragging && onItemClick) onItemClick(item); }}
      className={`kanban-card group/kcard mb-2 ${isDragging ? "dragging" : ""} ${isOverlay ? "rotate-1 shadow-2xl" : ""} ${readOnly ? "cursor-default" : onItemClick ? "cursor-pointer" : ""}`}
      data-testid={`kanban-card-${item.id}`}
    >
      {render(item)}
    </div>
  );
}

function KanbanColumn({ stage, items, render, color, readOnly, onItemClick }) {
  const { isOver, setNodeRef } = useDroppable({ id: stage.key, disabled: readOnly });
  return (
    <div ref={setNodeRef} className={`kanban-col ${isOver ? "drop-over" : ""}`} data-testid={`kanban-col-${stage.key}`}>
      <div className="px-3 py-3 border-b border-[var(--bx-border)] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full" style={{ background: color }}></span>
          <span className="text-[11px] uppercase tracking-[0.14em] text-[var(--bx-text-2)] font-semibold">{stage.label}</span>
        </div>
        <span className="text-[11px] bx-mono text-[var(--bx-text-3)] font-medium">{items.length}</span>
      </div>
      <div className="p-2 flex-1 overflow-y-auto">
        {items.map((it) => <KanbanCard key={it.id} item={it} render={render} readOnly={readOnly} onItemClick={onItemClick} />)}
        {items.length === 0 && (
          <div className="text-center text-xs text-[var(--bx-text-3)] py-6">Drop here</div>
        )}
      </div>
    </div>
  );
}

export default function KanbanBoard({
  endpoint,
  items: controlledItems,
  onStatusChange,
  statusField = "status",
  stages,
  render,
  onAdd,
  addLabel = "Add",
  readOnly = false,
  onItemClick,
}) {
  const [items, setItems] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const isControlled = Array.isArray(controlledItems);
  const displayItems = isControlled ? controlledItems : items;
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } }),
  );

  const load = async () => {
    try {
      const { data } = await api.get(endpoint);
      setItems(data);
    } catch (e) { toast.error("Failed to load"); }
  };
  useEffect(() => {
    if (!isControlled && endpoint) load();
    /* eslint-disable-next-line */
  }, [endpoint, isControlled]);

  const grouped = useMemo(() => {
    const g = Object.fromEntries(stages.map((s) => [s.key, []]));
    const stageKeys = new Set(stages.map((s) => s.key));
    displayItems.forEach((it) => {
      let k = it[statusField] || stages[0].key;
      if (!stageKeys.has(k)) k = stages[0].key;
      (g[k] = g[k] || []).push(it);
    });
    return g;
  }, [displayItems, stages, statusField]);

  const onDragStart = (e) => setActiveId(e.active.id);

  const onDragEnd = async (e) => {
    setActiveId(null);
    if (readOnly) return;
    const { active, over } = e;
    if (!over) return;
    const item = displayItems.find((i) => i.id === active.id);
    if (!item) return;
    const newStage = over.id;
    if (!stages.find((s) => s.key === newStage)) return;
    if (item[statusField] === newStage) return;

    if (isControlled && onStatusChange) {
      try {
        await onStatusChange(item, newStage);
        toast.success(`Moved to ${stages.find((s) => s.key === newStage)?.label}`);
      } catch {
        toast.error("Move failed");
      }
      return;
    }

    const optimistic = items.map((i) => (i.id === item.id ? { ...i, [statusField]: newStage } : i));
    setItems(optimistic);
    try {
      await api.put(`${endpoint}/${item.id}`, { ...item, [statusField]: newStage });
      toast.success(`Moved to ${stages.find((s) => s.key === newStage)?.label}`);
    } catch {
      toast.error("Move failed");
      setItems(items);
    }
  };

  const activeItem = displayItems.find((i) => i.id === activeId);

  return (
    <div className="kanban-board-shell">
      {onAdd && (
        <div className="flex justify-end mb-3">
          <Button onClick={onAdd} className="bg-[var(--bx-brand)] hover:opacity-90 text-white" size="sm" data-testid="kanban-add-btn">
            <Plus size={14} className="mr-1.5" weight="bold" /> {addLabel}
          </Button>
        </div>
      )}
      <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={onDragStart} onDragEnd={onDragEnd}>
        <div className="kanban-board grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 items-stretch" data-testid="kanban-board">
          {stages.map((s) => (
            <KanbanColumn key={s.key} stage={s} items={grouped[s.key] || []} render={render} color={s.color || "#94A3B8"} readOnly={readOnly} onItemClick={onItemClick} />
          ))}
        </div>
        <DragOverlay>
          {activeItem ? <KanbanCard item={activeItem} render={render} isOverlay /> : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}

// Helpers for default card renderers
export const projectCard = (p, { showBudget = true } = {}) => (
  <div>
    <div className="font-semibold text-sm mb-1 line-clamp-2" style={{ color: "var(--bx-text)" }}>{p.name}</div>
    {p.client && <div className="text-xs text-[var(--bx-text-3)] mb-2">{p.client}</div>}
    <div className="flex items-center gap-2 mb-2">
      <div className="flex-1 h-1 bg-[var(--bx-bg-3)] rounded-full overflow-hidden">
        <div className="h-full bg-[var(--bx-brand)]" style={{ width: `${p.progress || 0}%` }} />
      </div>
      <span className="bx-mono text-[10px] text-[var(--bx-text-2)]">{p.progress || 0}%</span>
    </div>
    <div className={`flex items-center text-[11px] text-[var(--bx-text-2)] ${showBudget ? "justify-between" : "justify-end"}`}>
      {showBudget && (
        <span className={`bx-mono ${!p.budget_set && p.created_by_role === "manager" ? "text-amber-600 italic" : ""}`}>
          {!p.budget_set && p.created_by_role === "manager" ? "Budget not added" : formatCurrency(p.budget)}
        </span>
      )}
      <span>{p.deadline ? formatDate(p.deadline) : "—"}</span>
    </div>
  </div>
);

export const taskCard = (t) => (
  <div>
    <div className="font-semibold text-sm mb-1 line-clamp-2" style={{ color: "var(--bx-text)" }}>{t.title}</div>
    {t.project && <div className="text-xs text-[var(--bx-text-3)] mb-2">{t.project}</div>}
    <div className="flex items-center justify-between">
      <StatusBadge status={t.priority} />
      {t.assignee && <span className="text-[11px] text-[var(--bx-text-2)]">{t.assignee.split(" ")[0]}</span>}
    </div>
    {t.due_date && <div className="text-[10px] text-[var(--bx-text-3)] mt-2 bx-mono">Due {formatDate(t.due_date)}</div>}
  </div>
);

export const assignedTaskCard = (t, { showAssignee = false, onDelete } = {}) => (
  <div>
    <div className="font-semibold text-sm mb-1 line-clamp-2" style={{ color: "var(--bx-text)" }}>{t.title}</div>
    {t.description && <div className="text-xs text-[var(--bx-text-3)] mb-2 line-clamp-2">{t.description}</div>}
    <div className="flex items-center justify-between gap-2">
      <StatusBadge status={t.priority || "medium"} />
      {showAssignee && t.assignee_name && (
        <span className="text-[11px] text-[var(--bx-text-2)] truncate">{t.assignee_name.split(" ")[0]}</span>
      )}
    </div>
    {onDelete && (
      <button
        type="button"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); onDelete(t.id); }}
        className="mt-2 text-[10px] text-rose-500 hover:text-rose-600 font-semibold opacity-0 group-hover/kcard:opacity-100 transition"
      >
        Remove
      </button>
    )}
  </div>
);
