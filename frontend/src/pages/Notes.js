import React, { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { PageHeader, Section } from "@/components/Shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import RichTextEditor from "@/components/RichTextEditor";
import NoteContentView from "@/components/NoteContentView";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Plus, Trash, FloppyDisk, NotePencil, PencilSimple, ShareNetwork, Users } from "@phosphor-icons/react";
import { toast } from "sonner";
import { formatApiError } from "@/lib/api";
import { useSidebarAlerts } from "@/contexts/SidebarAlertsContext";
import { useNotesDraft } from "@/contexts/NotesDraftContext";

const stripHtml = (html) => (html || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

const preview = (html, max = 60) => {
  const line = stripHtml(html);
  if (!line) return "Empty note";
  return line.length > max ? `${line.slice(0, max)}…` : line;
};

const applyDraftOrNote = (note, draft) => ({
  title: draft?.title ?? note.title ?? "",
  content: draft?.content ?? note.content ?? "",
  editing: draft?.editing ?? false,
});

export default function Notes() {
  const { refresh: refreshAlerts } = useSidebarAlerts();
  const { setDraft, getDraft, clearDraft, setActiveNoteId, getActiveNoteId } = useNotesDraft();
  const [notes, setNotes] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareTargets, setShareTargets] = useState([]);
  const [shareNoteId, setShareNoteId] = useState(null);
  const [selectedShareIds, setSelectedShareIds] = useState([]);

  const active = notes.find((n) => n.id === activeId);
  const isOwner = active?.is_owner !== false;
  const myNotes = notes.filter((n) => n.is_owner !== false);
  const sharedNotes = notes.filter((n) => n.is_owner === false);

  const markNoteSeen = async (note) => {
    if (!note || note.is_owner !== false || !note.is_unread) return;
    try {
      await api.post(`/notes/${note.id}/mark-seen`);
      setNotes((prev) => prev.map((n) => (n.id === note.id ? { ...n, is_unread: false } : n)));
      refreshAlerts();
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await api.get("/notes");
      if (cancelled) return;
      const list = data || [];
      setNotes(list);
      if (!list.length) {
        setActiveId(null);
        setTitle("");
        setContent("");
        setEditing(false);
        return;
      }
      const savedActiveId = getActiveNoteId();
      const note = list.find((n) => n.id === savedActiveId) || list[0];
      const draft = getDraft(note.id);
      const next = applyDraftOrNote(note, draft);
      setActiveId(note.id);
      setActiveNoteId(note.id);
      setTitle(next.title);
      setContent(next.content);
      setEditing(next.editing && note.is_owner !== false);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!activeId || !active) return;
    if (active.is_owner === false && active.is_unread) {
      markNoteSeen(active);
    }
  }, [activeId, active]);

  useEffect(() => {
    if (!activeId || !isOwner) return;
    setDraft(activeId, { title, content, editing });
  }, [activeId, title, content, editing, isOwner, setDraft]);

  useEffect(() => {
    if (activeId) setActiveNoteId(activeId);
  }, [activeId, setActiveNoteId]);

  const selectNote = (note, startEditing = false) => {
    if (activeId && isOwner && editing) {
      setDraft(activeId, { title, content, editing: true });
    }
    const draft = getDraft(note.id);
    const next = applyDraftOrNote(note, draft);
    setActiveId(note.id);
    setActiveNoteId(note.id);
    setTitle(next.title);
    setContent(next.content);
    setEditing(startEditing && note.is_owner !== false ? true : next.editing && note.is_owner !== false);
  };

  const createNote = async () => {
    try {
      const { data } = await api.post("/notes", { title: "Untitled", content: "" });
      setNotes((prev) => [data, ...prev]);
      setActiveId(data.id);
      setActiveNoteId(data.id);
      setTitle(data.title);
      setContent("");
      setEditing(true);
      setDraft(data.id, { title: data.title, content: "", editing: true });
      toast.success("New note created");
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to create note");
    }
  };

  const saveNote = async () => {
    if (!activeId || !isOwner) return;
    setSaving(true);
    try {
      const { data } = await api.put(`/notes/${activeId}`, { title, content });
      setNotes((prev) => prev.map((n) => (n.id === activeId ? data : n)));
      clearDraft(activeId);
      setEditing(false);
      toast.success("Saved");
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const deleteNote = async () => {
    if (!activeId || !isOwner) return;
    try {
      await api.delete(`/notes/${activeId}`);
      clearDraft(activeId);
      const remaining = notes.filter((n) => n.id !== activeId);
      setNotes(remaining);
      if (remaining.length) {
        selectNote(remaining[0]);
      } else {
        setActiveId(null);
        setActiveNoteId(null);
        setTitle("");
        setContent("");
        setEditing(false);
      }
      toast.success("Note deleted");
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to delete");
    }
  };

  const openShare = async (noteId) => {
    const note = notes.find((n) => n.id === noteId);
    if (!note?.is_owner) return;
    try {
      const { data } = await api.get("/notes/share-targets");
      setShareTargets(data || []);
      setShareNoteId(noteId);
      setSelectedShareIds(note.shared_with || []);
      setShareOpen(true);
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail, e) || "Failed to load team members");
    }
  };

  const toggleShareUser = (userId) => {
    setSelectedShareIds((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
    );
  };

  const submitShare = async () => {
    if (!shareNoteId) return;
    try {
      const { data } = await api.post(`/notes/${shareNoteId}/share`, { user_ids: selectedShareIds });
      setNotes((prev) => prev.map((n) => (n.id === shareNoteId ? data : n)));
      setShareOpen(false);
      toast.success(selectedShareIds.length ? "Note shared" : "Sharing removed");
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to share");
    }
  };

  const listPreview = (note) => {
    const draft = getDraft(note.id);
    if (draft && (draft.title || stripHtml(draft.content))) {
      return preview(draft.content) || draft.title || "Empty note";
    }
    return preview(note.content);
  };

  const listTitle = (note) => {
    const draft = getDraft(note.id);
    return (draft?.title || note.title || "Untitled");
  };

  const renderNoteItem = (note) => (
    <li key={note.id} className="group flex items-stretch">
      <button
        type="button"
        onClick={() => selectNote(note)}
        className={`flex-1 text-left px-4 py-3 hover:bg-[var(--bx-bg-3)] transition min-w-0 ${activeId === note.id ? "bg-[var(--bx-bg-3)] border-l-2 border-[var(--bx-brand)]" : ""}`}
        data-testid={`note-item-${note.id}`}
      >
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-semibold text-[var(--bx-text)] truncate">{listTitle(note)}</span>
          {getDraft(note.id)?.editing && note.is_owner !== false && (
            <span className="shrink-0 text-[9px] uppercase tracking-widest bx-mono px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-semibold">
              Draft
            </span>
          )}
          {note.is_owner === false && (
            <span className="shrink-0 text-[9px] uppercase tracking-widest bx-mono px-1.5 py-0.5 rounded bg-[var(--bx-brand-soft)] text-[var(--bx-brand)] font-semibold">
              Shared
            </span>
          )}
          {note.is_unread && (
            <span className="bx-nav-alert-dot shrink-0" title="Not viewed yet" />
          )}
        </div>
        <div className="text-xs text-[var(--bx-text-3)] mt-0.5 truncate">
          {note.is_owner === false ? `From ${note.owner_name} · ` : ""}
          {listPreview(note)}
        </div>
        {note.is_owner && note.shared_with_users?.length > 0 && (
          <div className="text-[10px] text-[var(--bx-text-3)] mt-1 flex items-center gap-1">
            <Users size={11} />
            Shared with {note.shared_with_users.length}
          </div>
        )}
      </button>
      {note.is_owner && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); openShare(note.id); }}
          className="shrink-0 w-10 grid place-items-center text-[var(--bx-text-3)] hover:text-[var(--bx-brand)] hover:bg-[var(--bx-bg-3)] opacity-0 group-hover:opacity-100 transition"
          title="Share note"
          data-testid={`share-note-${note.id}`}
        >
          <ShareNetwork size={16} />
        </button>
      )}
    </li>
  );

  return (
    <div>
      <PageHeader
        eyebrow="Module · Workspace"
        title="Notes."
        actions={
          <Button onClick={createNote} data-testid="new-note-btn">
            <Plus size={16} className="mr-1.5" /> New note
          </Button>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-4 min-h-[32rem]">
        <Section title={`Notes — ${notes.length}`} className="flex flex-col">
          {notes.length === 0 ? (
            <div className="p-8 text-center text-sm text-[var(--bx-text-3)] flex-1 flex flex-col items-center justify-center">
              <NotePencil size={28} className="mb-2 opacity-40" />
              No notes yet. Create one to get started.
            </div>
          ) : (
            <div className="overflow-y-auto max-h-[36rem]" data-testid="notes-list">
              {myNotes.length > 0 && (
                <>
                  <div className="px-4 py-2 text-[10px] uppercase tracking-widest text-[var(--bx-text-3)] font-semibold bx-mono border-b border-[var(--bx-border)]">
                    My notes — {myNotes.length}
                  </div>
                  <ul className="divide-y divide-[var(--bx-border)]">
                    {myNotes.map(renderNoteItem)}
                  </ul>
                </>
              )}
              {sharedNotes.length > 0 && (
                <>
                  <div className="px-4 py-2 text-[10px] uppercase tracking-widest text-[var(--bx-text-3)] font-semibold bx-mono border-b border-t border-[var(--bx-border)]">
                    Shared with me — {sharedNotes.length}
                  </div>
                  <ul className="divide-y divide-[var(--bx-border)]">
                    {sharedNotes.map(renderNoteItem)}
                  </ul>
                </>
              )}
            </div>
          )}
        </Section>

        <Section
          title={editing ? "Editor" : "View"}
          action={
            activeId ? (
              <div className="flex items-center gap-1">
                {isOwner && !editing && (
                  <>
                    <Button variant="outline" size="sm" onClick={() => openShare(activeId)} data-testid="share-note-btn">
                      <ShareNetwork size={14} className="mr-1" /> Share
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setEditing(true)} data-testid="edit-note-btn">
                      <PencilSimple size={14} className="mr-1" /> Edit
                    </Button>
                  </>
                )}
                {isOwner && editing && (
                  <Button size="sm" onClick={saveNote} disabled={saving} data-testid="save-note-btn">
                    <FloppyDisk size={14} className="mr-1" /> {saving ? "Saving…" : "Save"}
                  </Button>
                )}
                {isOwner && (
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-rose-500 hover:text-rose-600" onClick={deleteNote} aria-label="Delete note">
                    <Trash size={16} />
                  </Button>
                )}
              </div>
            ) : null
          }
          className="flex flex-col min-h-[32rem]"
        >
          {!activeId ? (
            <div className="p-10 text-center text-sm text-[var(--bx-text-3)] flex-1 flex items-center justify-center">
              Select a note or create a new one.
            </div>
          ) : editing && isOwner ? (
            <div className="p-4 sm:p-5 flex flex-col flex-1 gap-3">
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Note title"
                className="font-semibold text-base border-0 border-b border-[var(--bx-border)] rounded-none px-0 focus-visible:ring-0"
                data-testid="note-title"
              />
              <RichTextEditor
                key={`edit-${activeId}`}
                editorKey={activeId}
                noteId={activeId}
                value={content}
                onChange={setContent}
                placeholder="Start writing… Use the toolbar for bold, headings, lists, links, and images."
              />
              <p className="text-[10px] text-[var(--bx-text-3)] bx-mono uppercase tracking-widest">
                Draft saved automatically · click Save when finished
              </p>
            </div>
          ) : (
            <div className="p-4 sm:p-5 flex flex-col flex-1 gap-3">
              <h2 className="font-bold text-xl text-[var(--bx-text)] border-b border-[var(--bx-border)] pb-3" data-testid="note-title-view">
                {title || "Untitled"}
              </h2>
              {active?.is_owner === false && (
                <p className="text-xs text-[var(--bx-text-3)] flex items-center gap-1.5">
                  <ShareNetwork size={14} />
                  Shared by <span className="font-semibold text-[var(--bx-text-2)]">{active.owner_name}</span>
                  <span className="text-[var(--bx-text-3)]">· view only</span>
                </p>
              )}
              {isOwner && active?.shared_with_users?.length > 0 && (
                <p className="text-xs text-[var(--bx-text-3)] flex items-center gap-1.5 flex-wrap">
                  <Users size={14} />
                  Shared with{" "}
                  {active.shared_with_users.map((u) => u.name).join(", ")}
                </p>
              )}
              <NoteContentView html={content} />
            </div>
          )}
        </Section>
      </div>

      <Dialog open={shareOpen} onOpenChange={setShareOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Share note</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-[var(--bx-text-2)]">
            Select team members who can view this note. Only you can edit it.
          </p>
          <div className="max-h-64 overflow-y-auto space-y-2 py-2" data-testid="share-user-list">
            {shareTargets.length === 0 && (
              <p className="text-sm text-[var(--bx-text-3)] text-center py-4">No other team members found.</p>
            )}
            {shareTargets.map((u) => (
              <label
                key={u.id}
                className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-[var(--bx-bg-3)] cursor-pointer"
              >
                <Checkbox
                  checked={selectedShareIds.includes(u.id)}
                  onCheckedChange={() => toggleShareUser(u.id)}
                />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-[var(--bx-text)] truncate">{u.name || u.email}</div>
                  <div className="text-[10px] uppercase tracking-widest text-[var(--bx-text-3)] bx-mono">{u.role}</div>
                </div>
              </label>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShareOpen(false)}>Cancel</Button>
            <Button onClick={submitShare} data-testid="share-submit">Share</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
