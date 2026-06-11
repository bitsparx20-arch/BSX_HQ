import React, { createContext, useCallback, useContext, useMemo, useState } from "react";

const STORAGE_KEY = "bx_notes_drafts";
const ACTIVE_KEY = "bx_notes_active_id";

function readDrafts() {
  try {
    return JSON.parse(sessionStorage.getItem(STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

function writeDrafts(drafts) {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(drafts));
}

const NotesDraftContext = createContext(null);

export function NotesDraftProvider({ children }) {
  const [drafts, setDrafts] = useState(readDrafts);

  const setDraft = useCallback((noteId, draft) => {
    if (!noteId) return;
    setDrafts((prev) => {
      const next = {
        ...prev,
        [noteId]: {
          title: draft.title ?? "",
          content: draft.content ?? "",
          editing: !!draft.editing,
          updatedAt: Date.now(),
        },
      };
      writeDrafts(next);
      return next;
    });
  }, []);

  const getDraft = useCallback((noteId) => {
    if (!noteId) return null;
    return drafts[noteId] || readDrafts()[noteId] || null;
  }, [drafts]);

  const hasDraft = useCallback((noteId) => {
    if (!noteId) return false;
    return Boolean(drafts[noteId] || readDrafts()[noteId]);
  }, [drafts]);

  const clearDraft = useCallback((noteId) => {
    if (!noteId) return;
    setDrafts((prev) => {
      if (!prev[noteId]) return prev;
      const next = { ...prev };
      delete next[noteId];
      writeDrafts(next);
      return next;
    });
  }, []);

  const setActiveNoteId = useCallback((noteId) => {
    if (noteId) sessionStorage.setItem(ACTIVE_KEY, noteId);
    else sessionStorage.removeItem(ACTIVE_KEY);
  }, []);

  const getActiveNoteId = useCallback(() => sessionStorage.getItem(ACTIVE_KEY), []);

  const value = useMemo(
    () => ({ setDraft, getDraft, hasDraft, clearDraft, setActiveNoteId, getActiveNoteId, drafts }),
    [setDraft, getDraft, hasDraft, clearDraft, setActiveNoteId, getActiveNoteId, drafts],
  );

  return (
    <NotesDraftContext.Provider value={value}>
      {children}
    </NotesDraftContext.Provider>
  );
}

export function useNotesDraft() {
  const ctx = useContext(NotesDraftContext);
  if (!ctx) throw new Error("useNotesDraft must be used within NotesDraftProvider");
  return ctx;
}
