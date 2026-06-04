import React, { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { PageHeader, Section, formatCurrency, StatusBadge } from "@/components/Shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Plus, PencilSimple } from "@phosphor-icons/react";
import { toast } from "sonner";

const STAGES = [
  { key: "lead", label: "Lead" },
  { key: "qualified", label: "Qualified" },
  { key: "negotiation", label: "Negotiation" },
  { key: "won", label: "Won" },
  { key: "lost", label: "Lost" },
];

export default function CRM() {
  const [clients, setClients] = useState([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ stage: "lead" });

  const load = async () => {
    const { data } = await api.get("/clients");
    setClients(data);
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    try {
      const payload = { ...form };
      if (payload.deal_value) payload.deal_value = Number(payload.deal_value);
      if (editing) await api.put(`/clients/${editing.id}`, payload);
      else await api.post("/clients", payload);
      toast.success(editing ? "Updated" : "Added");
      setOpen(false); setEditing(null); setForm({ stage: "lead" });
      load();
    } catch (e) { toast.error(e.response?.data?.detail || "Failed"); }
  };

  const moveStage = async (client, stage) => {
    try {
      await api.put(`/clients/${client.id}`, { ...client, stage });
      load();
    } catch (e) { toast.error("Failed"); }
  };

  const byStage = STAGES.reduce((acc, s) => {
    acc[s.key] = clients.filter((c) => (c.stage || "lead") === s.key);
    return acc;
  }, {});

  const totalPipeline = clients.filter(c => !["won", "lost"].includes(c.stage)).reduce((s, c) => s + (c.deal_value || 0), 0);
  const wonValue = clients.filter(c => c.stage === "won").reduce((s, c) => s + (c.deal_value || 0), 0);

  return (
    <div>
      <PageHeader
        eyebrow="Module · 12"
        title="Client CRM."
        description="Client profiles, deal pipeline and contact history."
        actions={
          <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setEditing(null); setForm({ stage: "lead" }); } }}>
            <DialogTrigger asChild>
              <Button className="bg-[#003EDB] hover:bg-[#002EB3]" data-testid="add-client-btn">
                <Plus size={14} className="mr-1.5" weight="bold" /> Add client
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader><DialogTitle>{editing ? "Edit" : "Add"} Client</DialogTitle></DialogHeader>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2"><Label className="text-xs">Company name *</Label><Input value={form.name || ""} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
                <div><Label className="text-xs">Contact person</Label><Input value={form.contact_person || ""} onChange={(e) => setForm({ ...form, contact_person: e.target.value })} /></div>
                <div><Label className="text-xs">Email</Label><Input type="email" value={form.email || ""} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
                <div><Label className="text-xs">Phone</Label><Input value={form.contact_phone || ""} onChange={(e) => setForm({ ...form, contact_phone: e.target.value })} /></div>
                <div><Label className="text-xs">Industry</Label><Input value={form.industry || ""} onChange={(e) => setForm({ ...form, industry: e.target.value })} /></div>
                <div><Label className="text-xs">Deal value (₹)</Label><Input type="number" value={form.deal_value || ""} onChange={(e) => setForm({ ...form, deal_value: e.target.value })} /></div>
                <div><Label className="text-xs">Stage</Label>
                  <Select value={form.stage || "lead"} onValueChange={(v) => setForm({ ...form, stage: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{STAGES.map((s) => <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="col-span-2"><Label className="text-xs">Address</Label><Textarea value={form.address || ""} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
              </div>
              <DialogFooter>
                <Button onClick={save} className="bg-[#003EDB] hover:bg-[#002EB3]" data-testid="save-client-btn">{editing ? "Update" : "Create"}</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <div className="bx-kpi"><div className="bx-mono text-[10px] uppercase tracking-widest text-slate-500 mb-2">Total Clients</div><div className="bx-heading text-3xl">{clients.length}</div></div>
        <div className="bx-kpi"><div className="bx-mono text-[10px] uppercase tracking-widest text-slate-500 mb-2">Active Pipeline</div><div className="bx-heading text-3xl">{formatCurrency(totalPipeline)}</div></div>
        <div className="bx-kpi"><div className="bx-mono text-[10px] uppercase tracking-widest text-slate-500 mb-2">Won Deals</div><div className="bx-heading text-3xl text-emerald-600">{formatCurrency(wonValue)}</div></div>
        <div className="bx-kpi"><div className="bx-mono text-[10px] uppercase tracking-widest text-slate-500 mb-2">In Negotiation</div><div className="bx-heading text-3xl">{byStage.negotiation?.length || 0}</div></div>
      </div>

      {/* Kanban */}
      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-3" data-testid="crm-kanban">
        {STAGES.map((s) => (
          <div key={s.key} className="bg-white border border-slate-200 rounded-md min-h-[400px]">
            <div className="px-3 py-2.5 border-b border-slate-200 flex items-center justify-between">
              <span className="bx-mono text-[10px] uppercase tracking-widest text-slate-600 font-semibold">{s.label}</span>
              <span className="bx-mono text-[10px] text-slate-400">{byStage[s.key].length}</span>
            </div>
            <div className="p-2 space-y-2">
              {byStage[s.key].map((c) => (
                <div key={c.id} className="border border-slate-200 rounded-md p-3 hover:border-[#003EDB] transition group">
                  <div className="flex items-start justify-between mb-1.5">
                    <div className="font-semibold text-sm text-slate-900 line-clamp-1">{c.name}</div>
                    <button onClick={() => { setEditing(c); setForm(c); setOpen(true); }} className="opacity-0 group-hover:opacity-100 transition">
                      <PencilSimple size={12} className="text-slate-400" />
                    </button>
                  </div>
                  <div className="text-xs text-slate-500 mb-2">{c.contact_person || c.industry}</div>
                  {c.deal_value > 0 && <div className="bx-mono text-xs font-semibold text-[#003EDB] mb-2">{formatCurrency(c.deal_value)}</div>}
                  <Select value={c.stage || "lead"} onValueChange={(v) => moveStage(c, v)}>
                    <SelectTrigger className="h-7 text-[10px] bx-mono uppercase"><SelectValue /></SelectTrigger>
                    <SelectContent>{STAGES.map((st) => <SelectItem key={st.key} value={st.key}>{st.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              ))}
              {byStage[s.key].length === 0 && <div className="text-center text-xs text-slate-400 py-6">Empty</div>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
