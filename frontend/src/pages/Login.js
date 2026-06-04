import React, { useState } from "react";
import { useNavigate, Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowRight } from "@phosphor-icons/react";
import { toast } from "sonner";

export default function Login() {
  const { user, login, loading } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  if (!loading && user) return <Navigate to="/" replace />;

  const onSubmit = async (e) => {
    e.preventDefault();
    setBusy(true);
    const res = await login(email, password);
    setBusy(false);
    if (res.ok) {
      toast.success("Welcome to Bitsparx HQ");
      navigate("/");
    } else {
      toast.error(res.error || "Login failed");
    }
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-2 bg-white">
      {/* Left — brand panel */}
      <div className="hidden lg:flex relative flex-col p-12 bg-[#0F172A] text-white overflow-hidden">
        <div className="absolute inset-0 opacity-30"
          style={{
            backgroundImage: `radial-gradient(circle at 20% 30%, rgba(36, 83, 229, 0.55), transparent 50%), radial-gradient(circle at 80% 70%, rgba(99, 102, 241, 0.35), transparent 50%)`,
          }}
        />
        <div className="absolute inset-0" style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='40' viewBox='0 0 40 40'%3E%3Cg fill='%23ffffff' fill-opacity='0.04'%3E%3Cpath d='M0 0h1v40H0zM40 0v1H0V0z'/%3E%3C/g%3E%3C/svg%3E")`,
        }} />

        <div className="relative z-10 flex flex-col h-full">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-[#2453E5] to-[#1A45CC] grid place-items-center font-bold text-xl shadow-lg">B</div>
            <div>
              <div className="font-bold text-xl tracking-tight">Bitsparx HQ</div>
              <div className="text-[10px] uppercase tracking-[0.18em] text-slate-400 font-medium">Control Room</div>
            </div>
          </div>

          <div className="mt-auto space-y-6">
            <div className="text-[10px] uppercase tracking-[0.18em] text-slate-400 font-semibold">
              Enterprise Operating System · v1.1
            </div>
            <h1 className="bx-heading !text-white text-4xl xl:text-5xl leading-[1.1] max-w-md font-bold tracking-tight">
              The single console for everything your company runs on.
            </h1>
            <p className="text-slate-300 max-w-md text-sm leading-relaxed">
              Attendance, projects, finance, CRM, assets, AMC, helpdesk — wired to WhatsApp via SpringEdge and powered by an AI assistant.
            </p>

            <div className="grid grid-cols-3 gap-4 pt-4 border-t border-white/10 max-w-md">
              <div>
                <div className="bx-heading !text-white text-2xl font-bold">12</div>
                <div className="text-[10px] uppercase tracking-widest text-slate-400 mt-1">Modules</div>
              </div>
              <div>
                <div className="bx-heading !text-white text-2xl font-bold">RBAC</div>
                <div className="text-[10px] uppercase tracking-widest text-slate-400 mt-1">3 Roles</div>
              </div>
              <div>
                <div className="bx-heading !text-white text-2xl font-bold">AI</div>
                <div className="text-[10px] uppercase tracking-widest text-slate-400 mt-1">Assistant</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Right — form */}
      <div className="flex items-center justify-center p-8">
        <div className="w-full max-w-sm">
          <div className="lg:hidden flex items-center gap-2.5 mb-8">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#2453E5] to-[#1A45CC] grid place-items-center text-white font-bold text-xl">B</div>
            <div>
              <div className="font-bold text-base">Bitsparx HQ</div>
              <div className="text-[10px] uppercase tracking-widest text-slate-500">Control Room</div>
            </div>
          </div>

          <div className="text-[10px] uppercase tracking-[0.14em] text-slate-500 mb-2 font-semibold">Sign in</div>
          <h2 className="bx-heading text-3xl mb-2 tracking-tight font-bold text-slate-900">Welcome back.</h2>
          <p className="text-sm text-slate-500 mb-8">Sign in to your workspace to continue.</p>

          <form onSubmit={onSubmit} className="space-y-4" data-testid="login-form">
            <div>
              <Label className="text-xs font-semibold text-slate-700 mb-1.5 block">Work email</Label>
              <Input
                type="email" required value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@bitsparx.com"
                className="h-11 rounded-lg border-slate-300 focus:border-[#2453E5] focus:ring-2 focus:ring-[#2453E5]/20"
                data-testid="login-email"
              />
            </div>
            <div>
              <Label className="text-xs font-semibold text-slate-700 mb-1.5 block">Password</Label>
              <Input
                type="password" required value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="h-11 rounded-lg border-slate-300 focus:border-[#2453E5] focus:ring-2 focus:ring-[#2453E5]/20"
                data-testid="login-password"
              />
            </div>

            <Button
              type="submit" disabled={busy}
              className="w-full h-11 bg-[#2453E5] hover:bg-[#1A45CC] text-white rounded-lg font-semibold tracking-tight shadow-sm"
              data-testid="login-submit"
            >
              {busy ? "Signing in…" : (<>Sign in <ArrowRight size={16} className="ml-2" weight="bold" /></>)}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
