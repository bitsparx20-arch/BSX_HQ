import React, { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { useAttendance } from "@/contexts/AttendanceContext";
import { PageHeader, KpiCard, Section, StatusBadge, formatDate } from "@/components/Shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Clock, SignIn, SignOut, Plus, CheckCircle, XCircle } from "@phosphor-icons/react";
import { toast } from "sonner";

export default function Attendance() {
  const { user } = useAuth();
  const { refresh: refreshAttendanceGate } = useAttendance();
  const [today, setToday] = useState({});
  const [records, setRecords] = useState([]);
  const [leaves, setLeaves] = useState([]);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [leaveForm, setLeaveForm] = useState({ start_date: "", end_date: "", reason: "", type: "casual" });

  const load = async () => {
    const [t, r, l] = await Promise.all([
      api.get("/attendance/today").then(r => r.data),
      api.get("/attendance").then(r => r.data),
      api.get("/leaves").then(r => r.data),
    ]);
    setToday(t || {}); setRecords(r); setLeaves(l);
  };
  useEffect(() => { load(); }, []);

  const checkIn = async () => {
    try {
      await api.post("/attendance/check-in", { note: "Web check-in", location: "Office" });
      toast.success("Checked in");
      await refreshAttendanceGate();
      load();
    } catch (e) { toast.error(e.response?.data?.detail || "Failed"); }
  };
  const checkOut = async () => {
    try {
      await api.post("/attendance/check-out", { note: "Web check-out" });
      toast.success("Checked out");
      load();
    } catch (e) { toast.error(e.response?.data?.detail || "Failed"); }
  };

  const applyLeave = async () => {
    try {
      await api.post("/leaves", leaveForm);
      toast.success("Leave request submitted");
      setLeaveOpen(false);
      setLeaveForm({ start_date: "", end_date: "", reason: "", type: "casual" });
      load();
    } catch (e) { toast.error(e.response?.data?.detail || "Failed"); }
  };

  const decide = async (id, action) => {
    try {
      await api.put(`/leaves/${id}/${action}`);
      toast.success(`Leave ${action}d`);
      load();
    } catch (e) { toast.error(e.response?.data?.detail || "Failed"); }
  };

  const canApprove = user?.role === "admin" || user?.role === "manager";

  return (
    <div>
      <PageHeader
        eyebrow="Module · 01"
        title="Attendance."
        description="Check-in / check-out, leave requests, work hours and approvals — wired to WhatsApp."
      />

      {/* Today widget */}
      <Section title="Today" className="mb-6">
        <div className="p-5 flex items-center gap-6 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-md bg-[#EFF6FF] grid place-items-center"><Clock size={22} className="text-[#003EDB]" /></div>
            <div>
              <div className="bx-mono text-[10px] uppercase tracking-widest text-slate-500">Status</div>
              <div className="bx-heading text-lg">
                {today.check_out ? "Checked Out" : today.check_in ? "Working" : "Not Checked In"}
              </div>
            </div>
          </div>
          <div className="flex-1 grid grid-cols-2 md:grid-cols-3 gap-4">
            <div>
              <div className="bx-mono text-[10px] uppercase tracking-widest text-slate-500">Check-in</div>
              <div className="text-sm font-semibold bx-mono">{today.check_in ? new Date(today.check_in).toLocaleTimeString() : "—"}</div>
            </div>
            <div>
              <div className="bx-mono text-[10px] uppercase tracking-widest text-slate-500">Check-out</div>
              <div className="text-sm font-semibold bx-mono">{today.check_out ? new Date(today.check_out).toLocaleTimeString() : "—"}</div>
            </div>
            <div>
              <div className="bx-mono text-[10px] uppercase tracking-widest text-slate-500">Work hours</div>
              <div className="text-sm font-semibold bx-mono">{today.work_hours ? `${today.work_hours}h` : "—"}</div>
            </div>
          </div>
          <div className="flex gap-2">
            <Button onClick={checkIn} disabled={!!today.check_in} className="bg-[#003EDB] hover:bg-[#002EB3]" data-testid="check-in-btn">
              <SignIn size={16} className="mr-2" weight="bold" /> Check in
            </Button>
            <Button onClick={checkOut} disabled={!today.check_in || !!today.check_out} variant="outline" data-testid="check-out-btn">
              <SignOut size={16} className="mr-2" weight="bold" /> Check out
            </Button>
          </div>
        </div>
      </Section>

      <Tabs defaultValue="attendance">
        <TabsList className="mb-4">
          <TabsTrigger value="attendance" data-testid="tab-attendance">Attendance log</TabsTrigger>
          <TabsTrigger value="leaves" data-testid="tab-leaves">Leaves</TabsTrigger>
        </TabsList>

        <TabsContent value="attendance">
          <Section title={`Attendance Records · ${records.length}`}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50">
                  <tr className="text-left text-[10px] uppercase tracking-widest bx-mono text-slate-500">
                    <th className="px-5 py-3">Date</th>
                    <th className="px-5 py-3">{canApprove && "Employee"}</th>
                    <th className="px-5 py-3">In</th>
                    <th className="px-5 py-3">Out</th>
                    <th className="px-5 py-3 text-right">Hours</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {records.map((r) => (
                    <tr key={r.id} className="hover:bg-slate-50">
                      <td className="px-5 py-3 bx-mono">{r.date}</td>
                      <td className="px-5 py-3">{canApprove ? r.user_name : ""}</td>
                      <td className="px-5 py-3 bx-mono">{r.check_in ? new Date(r.check_in).toLocaleTimeString() : "—"}</td>
                      <td className="px-5 py-3 bx-mono">{r.check_out ? new Date(r.check_out).toLocaleTimeString() : "—"}</td>
                      <td className="px-5 py-3 text-right bx-mono">{r.work_hours || "—"}</td>
                    </tr>
                  ))}
                  {records.length === 0 && (
                    <tr><td colSpan={5} className="px-5 py-10 text-center text-slate-500">No records</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </Section>
        </TabsContent>

        <TabsContent value="leaves">
          <Section title={`Leave Requests · ${leaves.length}`}
            action={
              <Dialog open={leaveOpen} onOpenChange={setLeaveOpen}>
                <DialogTrigger asChild>
                  <Button size="sm" className="bg-[#003EDB] hover:bg-[#002EB3]" data-testid="apply-leave-btn">
                    <Plus size={14} className="mr-1.5" /> Apply leave
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader><DialogTitle>Apply for leave</DialogTitle></DialogHeader>
                  <div className="space-y-3">
                    <div><Label>Type</Label>
                      <Select value={leaveForm.type} onValueChange={(v) => setLeaveForm({ ...leaveForm, type: v })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="casual">Casual</SelectItem>
                          <SelectItem value="sick">Sick</SelectItem>
                          <SelectItem value="earned">Earned</SelectItem>
                          <SelectItem value="unpaid">Unpaid</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div><Label>From</Label><Input type="date" value={leaveForm.start_date} onChange={(e) => setLeaveForm({ ...leaveForm, start_date: e.target.value })} /></div>
                      <div><Label>To</Label><Input type="date" value={leaveForm.end_date} onChange={(e) => setLeaveForm({ ...leaveForm, end_date: e.target.value })} /></div>
                    </div>
                    <div><Label>Reason</Label><Textarea value={leaveForm.reason} onChange={(e) => setLeaveForm({ ...leaveForm, reason: e.target.value })} /></div>
                  </div>
                  <DialogFooter>
                    <Button onClick={applyLeave} className="bg-[#003EDB] hover:bg-[#002EB3]">Submit</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            }
          >
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50">
                  <tr className="text-left text-[10px] uppercase tracking-widest bx-mono text-slate-500">
                    <th className="px-5 py-3">Employee</th>
                    <th className="px-5 py-3">Type</th>
                    <th className="px-5 py-3">From</th>
                    <th className="px-5 py-3">To</th>
                    <th className="px-5 py-3">Reason</th>
                    <th className="px-5 py-3">Status</th>
                    <th className="px-5 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {leaves.map((l) => (
                    <tr key={l.id} className="hover:bg-slate-50">
                      <td className="px-5 py-3">{l.user_name}</td>
                      <td className="px-5 py-3 bx-mono uppercase text-[10px] tracking-widest">{l.type}</td>
                      <td className="px-5 py-3 bx-mono">{l.start_date}</td>
                      <td className="px-5 py-3 bx-mono">{l.end_date}</td>
                      <td className="px-5 py-3 text-slate-600 max-w-xs truncate">{l.reason}</td>
                      <td className="px-5 py-3"><StatusBadge status={l.status} /></td>
                      <td className="px-5 py-3 text-right">
                        {canApprove && l.status === "pending" && (
                          <div className="flex gap-1.5 justify-end">
                            <Button size="sm" variant="outline" onClick={() => decide(l.id, "approve")} data-testid={`approve-${l.id}`}>
                              <CheckCircle size={14} className="mr-1 text-emerald-600" /> Approve
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => decide(l.id, "reject")} data-testid={`reject-${l.id}`}>
                              <XCircle size={14} className="mr-1 text-rose-600" /> Reject
                            </Button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                  {leaves.length === 0 && (
                    <tr><td colSpan={7} className="px-5 py-10 text-center text-slate-500">No leave requests</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </Section>
        </TabsContent>
      </Tabs>
    </div>
  );
}
