import React, { useEffect, useRef } from "react";
import { extractNoteImageId, fetchNoteImageBlobUrl, noteHtmlHasVisibleContent } from "@/lib/noteImages";

export default function NoteContentView({ html, className = "" }) {
  const bodyRef = useRef(null);
  const blobUrlsRef = useRef([]);

  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return undefined;

    blobUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    blobUrlsRef.current = [];

    const imgs = el.querySelectorAll("img");
    imgs.forEach((img) => {
      const imageId = extractNoteImageId(img.getAttribute("src"));
      if (!imageId) return;
      fetchNoteImageBlobUrl(imageId)
        .then((url) => {
          blobUrlsRef.current.push(url);
          img.src = url;
          img.removeAttribute("data-bx-load-error");
        })
        .catch(() => {
          img.alt = "Image unavailable";
          img.setAttribute("data-bx-load-error", "true");
        });
    });

    return () => {
      blobUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      blobUrlsRef.current = [];
    };
  }, [html]);

  const empty = !noteHtmlHasVisibleContent(html);

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
            ref={bodyRef}
            className="bx-rich-editor ProseMirror bx-note-view-body"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        )}
      </div>
    </div>
  );
}
