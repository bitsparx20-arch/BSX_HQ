import { api } from "@/lib/api";

const NOTE_IMAGE_ID_RE = /\/notes\/images\/([a-f0-9-]{36})/i;

export function extractNoteImageId(url) {
  const match = String(url || "").match(NOTE_IMAGE_ID_RE);
  return match?.[1] || null;
}

/** True when HTML has visible text, images, or other non-empty content. */
export function noteHtmlHasVisibleContent(html) {
  if (!html || html === "<p></p>") return false;
  if (/<img[\s>]/i.test(html)) return true;
  if (/<(video|iframe|svg|object|embed)[\s>]/i.test(html)) return true;
  return Boolean(html.replace(/<[^>]+>/g, "").replace(/&nbsp;/gi, " ").trim());
}

export async function uploadNoteImage(file, noteId) {
  const form = new FormData();
  form.append("file", file);
  if (noteId) form.append("note_id", noteId);
  const { data } = await api.post("/notes/images", form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return data.url;
}

export async function deleteNoteImage(imageId) {
  await api.delete(`/notes/images/${imageId}`);
}

export async function fetchNoteImageBlobUrl(imageId) {
  const { data } = await api.get(`/notes/images/${imageId}`, { responseType: "blob" });
  return URL.createObjectURL(data);
}
