import React from "react";

export default function NoteContentView({ html, className = "" }) {
  const empty = !html || html === "<p></p>" || !html.replace(/<[^>]+>/g, "").trim();
  return (
    <div
      className={`bx-rich-editor-shell bx-note-view border border-[var(--bx-border)] rounded-lg overflow-hidden bg-[var(--bx-card)] flex-1 ${className}`}
      data-testid="note-view"
    >
      <div className="flex-1 overflow-y-auto min-h-[20rem] px-4 py-3">
        {empty ? (
          <p className="text-sm text-[var(--bx-text-3)] italic">This note is empty.</p>
        ) : (
          <div
            className="bx-rich-editor ProseMirror bx-note-view-body"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        )}
      </div>
    </div>
  );
}
