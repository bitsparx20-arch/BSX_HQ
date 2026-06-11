import { api } from "@/lib/api";

const NOTE_IMAGE_ID_RE = /\/notes\/images\/([a-f0-9-]{36})/i;

export function extractNoteImageId(url) {
  const match = String(url || "").match(NOTE_IMAGE_ID_RE);
  return match?.[1] || null;
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
