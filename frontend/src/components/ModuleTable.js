import React, { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Plus, PencilSimple, Trash, MagnifyingGlass } from "@phosphor-icons/react";
import { Section, StatusBadge, formatCurrency, formatDate, EmptyState } from "@/components/Shared";
import PasswordInput from "@/components/PasswordInput";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export default function ModuleTable({ endpoint, columns, fields, title, testId, canWrite, canCreate, onRowClick, transformPayload, prepareFormForEdit, formExtra }) {
  const { user } = useAuth();
  const writable = canWrite ?? (user?.role === "admin" || user?.role === "manager");
  const creatable = canCreate ?? writable;
  const [rows, setRows] = useState([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({});
  const [q, setQ] = useState("");

  const load = async () => {
    try {
      const { data } = await api.get(endpoint);
      setRows(data);
    } catch { toast.error("Failed to load"); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [endpoint]);

  const presetValues = (field) =>
    (field.options || []).map((o) => o.value).filter((v) => v !== (field.customOptionValue || "__custom__"));

  const openCreate = () => {
    setEditing(null);
    const initial = { team_member_ids: [] };
    fields.forEach((f) => {
      initial[f.key] = f.default ?? "";
      if (f.allowCustom && f.customKey) initial[f.customKey] = "";
    });
    setForm(initial);
    setOpen(true);
  };

  const openEdit = (row) => {
    setEditing(row);
    const nextForm = { ...row };
    fields.forEach((f) => {
      if (f.allowCustom && row[f.key] && !presetValues(f).includes(row[f.key])) {
        nextForm[f.customKey || `${f.key}_custom`] = row[f.key];
        nextForm[f.key] = f.customOptionValue || "__custom__";
      }
    });
    nextForm.password = "";
    if (prepareFormForEdit) Object.assign(nextForm, prepareFormForEdit(row));
    setForm(nextForm);
    setOpen(true);
  };

  const fieldContext = { editing: !!editing };
  const isFieldVisible = (field, values) => !field.visible || field.visible(values, fieldContext);
  const isFieldRequired = (field) => {
    if (field.requiredOnCreate) return !editing;
    return !!field.required;
  };

  const save = async () => {
    try {
      const payload = { ...form };
      for (const f of fields) {
        if (!isFieldVisible(f, payload)) continue;
        const value = payload[f.key];
        if (isFieldRequired(f) && (value == null || String(value).trim() === "")) {
          toast.error(`${f.label} is required`);
          return;
        }
        if (f.validate) {
          const error = f.validate(value, payload, fieldContext);
          if (error) {
            toast.error(error);
            return;
          }
        }
      }
      fields.forEach(f => {
        if (f.type === "number" && payload[f.key] !== "" && payload[f.key] != null) {
          payload[f.key] = Number(payload[f.key]);
        }
        if (f.allowCustom && payload[f.key] === (f.customOptionValue || "__custom__")) {
          payload[f.key] = (payload[f.customKey || `${f.key}_custom`] || "").trim();
          delete payload[f.customKey || `${f.key}_custom`];
        }
        if (!isFieldVisible(f, payload)) {
          payload[f.key] = null;
        }
        if (f.type === "password" && editing && !payload[f.key]) {
          delete payload[f.key];
        }
        if (f.normalize && payload[f.key] != null && payload[f.key] !== "") {
          payload[f.key] = f.normalize(payload[f.key]);
        }
        if (f.key === "email" && payload[f.key]) {
          payload[f.key] = String(payload[f.key]).trim().toLowerCase();
        }
      });
      const allowed = new Set(fields.flatMap((f) => [f.key, f.customKey].filter(Boolean)));
      allowed.add("team_member_ids");
      Object.keys(payload).forEach((k) => {
        if (!allowed.has(k)) delete payload[k];
      });
      if (transformPayload) {
        payload = transformPayload(payload, { editing: !!editing });
      }
      if (editing) await api.put(`${endpoint}/${editing.id}`, payload);
      else await api.post(endpoint, payload);
      toast.success(editing ? "Updated" : "Created");
      setOpen(false);
      load();
    } catch (e) { toast.error(e.response?.data?.detail || "Failed"); }
  };

  const remove = async (row) => {
    if (!window.confirm(`Delete this entry?`)) return;
    try {
      await api.delete(`${endpoint}/${row.id}`);
      toast.success("Deleted");
      load();
    } catch { toast.error("Failed"); }
  };

  const filtered = rows.filter(r => !q || JSON.stringify(r).toLowerCase().includes(q.toLowerCase()));

  return (
    <Section
      title={`${title} · ${filtered.length}`}
      action={
        <div className="flex items-center gap-2">
          <div className="relative">
            <MagnifyingGlass size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--bx-text-3)]" />
            <Input
              value={q} onChange={(e) => setQ(e.target.value)}
              placeholder="Search…"
              className="h-8 pl-7 text-xs w-32 sm:w-48"
              data-testid={`${testId}-search`}
            />
          </div>
          {creatable && (
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button size="sm" className="bg-[var(--bx-brand)] hover:opacity-90 text-white" onClick={openCreate} data-testid={`${testId}-add`}>
                  <Plus size={14} className="mr-1.5" weight="bold" /> Add
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg min-h-[min(85vh,640px)] flex flex-col py-8">
                <DialogHeader className="pb-2"><DialogTitle>{editing ? "Edit" : "Add"} {title}</DialogTitle></DialogHeader>
                <div className="grid flex-1 grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-5 min-h-[420px] max-h-[65vh] overflow-y-auto pr-1 py-2 content-start">
                  {fields.filter((f) => isFieldVisible(f, form)).map((f) => (
                    <div key={f.key} className={`space-y-2 ${f.full ? "sm:col-span-2" : ""}`}>
                      <Label className="text-xs">
                        {(editing && f.editLabel) ? f.editLabel : f.label}{isFieldRequired(f) && " *"}
                      </Label>
                      {f.type === "textarea" ? (
                        <Textarea value={form[f.key] || ""} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} />
                      ) : f.type === "password" ? (
                        <PasswordInput
                          value={form[f.key] ?? ""}
                          placeholder={(editing && f.editPlaceholder) ? f.editPlaceholder : f.placeholder}
                          onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                          data-testid={f.testId || `${testId}-${f.key}`}
                        />
                      ) : f.type === "select" ? (
                        <div className="space-y-2">
                          <Select value={form[f.key] || ""} onValueChange={(v) => setForm({ ...form, [f.key]: v })}>
                            <SelectTrigger><SelectValue placeholder={`Select ${f.label}`} /></SelectTrigger>
                            <SelectContent>
                              {f.options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                            </SelectContent>
                          </Select>
                          {f.allowCustom && form[f.key] === (f.customOptionValue || "__custom__") && (
                            <Input
                              value={form[f.customKey || `${f.key}_custom`] || ""}
                              placeholder={f.customPlaceholder || `Enter ${f.label.toLowerCase()}`}
                              onChange={(e) => setForm({ ...form, [f.customKey || `${f.key}_custom`]: e.target.value })}
                            />
                          )}
                        </div>
                      ) : (
                        <Input
                          type={f.type || "text"}
                          value={form[f.key] ?? ""}
                          placeholder={f.placeholder}
                          pattern={f.pattern}
                          maxLength={f.maxLength}
                          minLength={f.minLength}
                          inputMode={f.inputMode}
                          onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                        />
                      )}
                    </div>
                  ))}
                  {formExtra && (
                    <div className="sm:col-span-2">{formExtra({ form, setForm, editing: !!editing })}</div>
                  )}
                </div>
                <DialogFooter className="pt-4 mt-auto">
                  <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                  <Button onClick={save} className="bg-[var(--bx-brand)] hover:opacity-90 text-white" data-testid={`${testId}-save`}>
                    {editing ? "Update" : "Create"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
        </div>
      }
    >
      <div className="overflow-x-auto">
        <table className="w-full text-sm" data-testid={`${testId}-table`}>
          <thead className="bg-[var(--bx-bg-3)]">
            <tr className="text-left text-[10px] uppercase tracking-widest bx-mono text-[var(--bx-text-3)]">
              {columns.map((c) => <th key={c.key} className={`px-4 sm:px-5 py-3 ${c.align === "right" ? "text-right" : ""}`}>{c.label}</th>)}
              {writable && <th className="px-4 sm:px-5 py-3 text-right">Actions</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--bx-border)]">
            {filtered.map((r) => (
              <tr
                key={r.id}
                className={`hover:bg-[var(--bx-bg-3)] ${onRowClick ? "cursor-pointer" : ""}`}
                onClick={() => onRowClick?.(r)}
              >
                {columns.map((c) => {
                  const v = r[c.key];
                  let cell = v;
                  if (c.render) cell = c.render(r);
                  else if (c.type === "currency") cell = <span className="bx-mono">{formatCurrency(v)}</span>;
                  else if (c.type === "date") cell = <span className="bx-mono">{formatDate(v)}</span>;
                  else if (c.type === "status") cell = <StatusBadge status={v} />;
                  else if (c.type === "bold") cell = <span className="font-semibold text-[var(--bx-text)]">{v}</span>;
                  else cell = v ?? "—";
                  return <td key={c.key} className={`px-4 sm:px-5 py-3 text-[var(--bx-text-2)] ${c.align === "right" ? "text-right" : ""}`}>{cell}</td>;
                })}
                {writable && (
                  <td className="px-4 sm:px-5 py-3 text-right">
                    <div className="flex gap-1 justify-end">
                      <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); openEdit(r); }} data-testid={`${testId}-edit-${r.id}`}>
                        <PencilSimple size={14} />
                      </Button>
                      <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); remove(r); }} data-testid={`${testId}-delete-${r.id}`}>
                        <Trash size={14} className="text-rose-500" />
                      </Button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={columns.length + (writable ? 1 : 0)}><EmptyState /></td></tr>
            )}
          </tbody>
        </table>
      </div>
    </Section>
  );
}
