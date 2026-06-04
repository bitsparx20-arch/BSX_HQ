import React, { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { Sparkle, PaperPlaneTilt, X, ChatCircleDots } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";

const SUGGESTIONS = [
  "How many open tickets do we have?",
  "What is our current P&L?",
  "Which projects are in progress?",
  "Top clients by deal value?",
];

export default function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([
    { role: "assistant", content: "Hi! I'm BitsBot — ask me about projects, finance, clients, tickets, or anything in Bitsparx HQ." },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [sessionId, setSessionId] = useState(null);
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, open]);

  const send = async (text) => {
    const msg = (text ?? input).trim();
    if (!msg || busy) return;
    setMessages((m) => [...m, { role: "user", content: msg }]);
    setInput("");
    setBusy(true);
    try {
      const { data } = await api.post("/chat", { message: msg, session_id: sessionId });
      setSessionId(data.session_id);
      setMessages((m) => [...m, { role: "assistant", content: data.reply }]);
    } catch (e) {
      setMessages((m) => [...m, { role: "assistant", content: "Sorry — I hit an error. Please try again." }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {/* Floating launcher */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="fixed bottom-6 right-6 h-14 w-14 rounded-full bg-gradient-to-br from-[#2453E5] to-[#1A45CC] text-white shadow-lg hover:shadow-xl flex items-center justify-center z-50 transition-all hover:scale-105"
        data-testid="chat-toggle"
        aria-label="Open AI assistant"
      >
        {open ? <X size={22} weight="bold" /> : <ChatCircleDots size={22} weight="fill" />}
      </button>

      {/* Panel */}
      {open && (
        <div className="fixed bottom-24 right-4 sm:right-6 w-[calc(100vw-2rem)] sm:w-[400px] max-w-[400px] h-[560px] max-h-[calc(100vh-7rem)] bg-[var(--bx-card)] border border-[var(--bx-border)] rounded-2xl shadow-2xl flex flex-col z-40 overflow-hidden" data-testid="chat-panel">
          <div className="px-5 py-3.5 border-b border-slate-200 bg-gradient-to-br from-[#2453E5] to-[#1A45CC] text-white">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-lg bg-white/15 grid place-items-center">
                <Sparkle size={18} weight="fill" />
              </div>
              <div>
                <div className="font-semibold text-sm">BitsBot · AI Assistant</div>
                <div className="text-[11px] text-white/75">Claude Sonnet · Bitsparx HQ data</div>
              </div>
            </div>
          </div>

          <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3 bg-[var(--bx-bg-2)]">
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
                  m.role === "user"
                    ? "bg-[var(--bx-brand)] text-white rounded-br-sm"
                    : "bg-[var(--bx-card)] border border-[var(--bx-border)] text-[var(--bx-text)] rounded-bl-sm"
                }`}>
                  {m.content}
                </div>
              </div>
            ))}
            {busy && (
              <div className="flex justify-start">
                <div className="bg-[var(--bx-card)] border border-[var(--bx-border)] rounded-2xl rounded-bl-sm px-3.5 py-2.5 text-sm text-[var(--bx-text-3)]">
                  <span className="inline-flex gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-[var(--bx-text-3)] animate-bounce" style={{ animationDelay: "0ms" }}></span>
                    <span className="w-1.5 h-1.5 rounded-full bg-[var(--bx-text-3)] animate-bounce" style={{ animationDelay: "150ms" }}></span>
                    <span className="w-1.5 h-1.5 rounded-full bg-[var(--bx-text-3)] animate-bounce" style={{ animationDelay: "300ms" }}></span>
                  </span>
                </div>
              </div>
            )}

            {messages.length <= 1 && (
              <div className="pt-2">
                <div className="text-[10px] uppercase tracking-widest text-[var(--bx-text-3)] font-semibold mb-2">Try asking</div>
                <div className="space-y-1.5">
                  {SUGGESTIONS.map((s) => (
                    <button key={s} onClick={() => send(s)} className="w-full text-left text-xs text-[var(--bx-text-2)] bg-[var(--bx-card)] border border-[var(--bx-border)] hover:border-[var(--bx-brand)] hover:text-[var(--bx-brand)] rounded-lg px-3 py-2 transition">
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="border-t border-[var(--bx-border)] p-3 bg-[var(--bx-card)]">
            <form
              onSubmit={(e) => { e.preventDefault(); send(); }}
              className="flex items-center gap-2"
            >
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask BitsBot anything…"
                className="flex-1 bg-[var(--bx-bg-3)] border border-[var(--bx-border)] rounded-lg px-3 h-10 text-sm text-[var(--bx-text)] focus:bg-[var(--bx-card)] focus:border-[var(--bx-brand)] focus:ring-2 focus:ring-[var(--bx-brand)]/30 outline-none transition"
                data-testid="chat-input"
              />
              <Button
                type="submit" disabled={busy || !input.trim()}
                size="icon" className="h-10 w-10 bg-[var(--bx-brand)] hover:opacity-90 text-white rounded-lg"
                data-testid="chat-send"
              >
                <PaperPlaneTilt size={16} weight="fill" />
              </Button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
