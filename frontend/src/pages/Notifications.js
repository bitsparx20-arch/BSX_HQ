import React, { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { PageHeader, Section, StatusBadge } from "@/components/Shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/contexts/AuthContext";
import { WhatsappLogo, PaperPlaneRight } from "@phosphor-icons/react";
import { toast } from "sonner";

export default function Notifications() {
  const { user } = useAuth();
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ to: "", message: "" });

  const load = async () => {
    const { data } = await api.get("/notifications");
    setItems(data);
  };
  useEffect(() => { load(); }, []);

  const sendTest = async () => {
    try {
      await api.post("/notifications/test", form);
      toast.success("Notification queued");
      setOpen(false);
      setForm({ to: "", message: "" });
      load();
    } catch (e) { toast.error(e.response?.data?.detail || "Failed"); }
  };

  const grouped = items.reduce((acc, n) => {
    (acc[n.event || "generic"] = acc[n.event || "generic"] || 0) ;
    acc[n.event || "generic"] += 1;
    return acc;
  }, {});

  return (
    <div>
      <PageHeader
        eyebrow="Integration · WhatsApp"
        title="SpringEdge Notifications."
        description="All system-triggered WhatsApp messages flow through SpringEdge. Configure SPRINGEDGE_API_KEY in backend .env to send live."
        actions={
          user?.role === "admin" && (
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button className="bg-[#003EDB] hover:bg-[#002EB3]" data-testid="send-test-btn">
                  <PaperPlaneRight size={14} className="mr-1.5" weight="bold" /> Send test
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Send test WhatsApp</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  <div><Label>Phone (with country code)</Label><Input value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })} placeholder="919999999999" /></div>
                  <div><Label>Message</Label><Textarea value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} placeholder="Hello from Bitsparx HQ" /></div>
                </div>
                <DialogFooter><Button onClick={sendTest} className="bg-[#003EDB] hover:bg-[#002EB3]">Send</Button></DialogFooter>
              </DialogContent>
            </Dialog>
          )
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-6">
        <div className="bx-kpi"><div className="bx-mono text-[10px] uppercase tracking-widest text-slate-500 mb-2">Total Sent</div><div className="bx-heading text-3xl">{items.length}</div></div>
        {Object.entries(grouped).slice(0, 4).map(([k, v]) => (
          <div key={k} className="bx-kpi">
            <div className="bx-mono text-[10px] uppercase tracking-widest text-slate-500 mb-2">{k}</div>
            <div className="bx-heading text-3xl">{v}</div>
          </div>
        ))}
      </div>

      <Section title="Notification Log">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr className="text-left text-[10px] uppercase tracking-widest bx-mono text-slate-500">
                <th className="px-5 py-3">Event</th>
                <th className="px-5 py-3">To</th>
                <th className="px-5 py-3">Message</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3">Sent</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((n) => (
                <tr key={n.id} className="hover:bg-slate-50">
                  <td className="px-5 py-3"><span className="bx-mono text-[10px] uppercase tracking-widest font-semibold text-slate-700">{n.event}</span></td>
                  <td className="px-5 py-3 bx-mono">{n.to}</td>
                  <td className="px-5 py-3 max-w-md truncate text-slate-700">{n.message}</td>
                  <td className="px-5 py-3">
                    {n.status === "sent" && <StatusBadge status="active" />}
                    {n.status === "logged_only" && <span className="inline-flex items-center px-2 py-0.5 rounded-sm border bg-amber-50 text-amber-700 border-amber-200 text-[10px] bx-mono uppercase tracking-widest font-semibold">logged · key missing</span>}
                    {n.status === "failed" && <StatusBadge status="rejected" />}
                    {n.status === "queued" && <StatusBadge status="pending" />}
                  </td>
                  <td className="px-5 py-3 bx-mono text-xs text-slate-500">{n.created_at ? new Date(n.created_at).toLocaleString() : "—"}</td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr><td colSpan={5} className="px-5 py-12 text-center text-slate-500">
                  <WhatsappLogo size={32} className="mx-auto mb-3 text-slate-300" />
                  No notifications yet. Trigger actions across modules to see them here.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}
