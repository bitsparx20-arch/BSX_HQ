import React, { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { PageHeader, Section, StatusBadge } from "@/components/Shared";
import { formatDateTimeIST } from "@/lib/datetime";
import { Button } from "@/components/ui/button";
import { Trash, WhatsappLogo } from "@phosphor-icons/react";
import { toast } from "sonner";

export default function Notifications() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [items, setItems] = useState([]);
  const [clearing, setClearing] = useState(false);

  const load = useCallback(async () => {
    const { data } = await api.get("/notifications");
    setItems(data);
  }, []);

  useEffect(() => { load(); }, [load]);

  const clearAll = async () => {
    if (!window.confirm("Clear all WhatsApp notification logs? This cannot be undone.")) return;
    setClearing(true);
    try {
      const { data } = await api.delete("/notifications");
      toast.success(`Cleared ${data.deleted} log${data.deleted === 1 ? "" : "s"}`);
      load();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to clear logs");
    } finally {
      setClearing(false);
    }
  };

  const grouped = items.reduce((acc, n) => {
    (acc[n.event || "generic"] = acc[n.event || "generic"] || 0);
    acc[n.event || "generic"] += 1;
    return acc;
  }, {});

  return (
    <div>
      <PageHeader
        title="Notification"
        actions={
          isAdmin ? (
            <Button
              variant="outline"
              size="sm"
              onClick={clearAll}
              disabled={clearing || items.length === 0}
              className="text-red-600 border-red-200 hover:bg-red-50"
            >
              <Trash size={14} className="mr-1.5" />
              {clearing ? "Clearing…" : "Clear all logs"}
            </Button>
          ) : null
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
                  <td className="px-5 py-3"><span className="bx-mono text-xs uppercase">{n.event}</span></td>
                  <td className="px-5 py-3 bx-mono text-xs">{n.to}</td>
                  <td className="px-5 py-3 text-slate-600 max-w-xs truncate">{n.message}</td>
                  <td className="px-5 py-3"><StatusBadge status={n.status} /></td>
                  <td className="px-5 py-3 bx-mono text-xs text-slate-500">{formatDateTimeIST(n.sent_at)}</td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr><td colSpan={5} className="px-5 py-10 text-center text-slate-500">
                  <WhatsappLogo size={24} className="mx-auto mb-2 opacity-30" />No notifications yet
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}
