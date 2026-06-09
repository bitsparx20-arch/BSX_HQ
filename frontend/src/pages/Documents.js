import React, { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { PageHeader, Section, EmptyState } from "@/components/Shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import {
  FilePdf, UploadSimple, MagnifyingGlass, Eye, Trash, PencilSimple, X,
} from "@phosphor-icons/react";
import { toast } from "sonner";

const CATEGORIES = ["Contract", "Quotation", "NDA", "HR", "Other"];

export default function Documents() {
  const { user } = useAuth();
  const canWrite = user?.role === "admin" || user?.role === "manager";
  const fileInputRef = useRef(null);
  const [docs, setDocs] = useState([]);
  const [q, setQ] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [pendingFile, setPendingFile] = useState(null);
  const [meta, setMeta] = useState({ category: "Contract", client: "", version: "v1.0" });
  const [uploading, setUploading] = useState(false);
  const [viewer, setViewer] = useState(null);
  const [pdfUrl, setPdfUrl] = useState(null);
  const [editDoc, setEditDoc] = useState(null);
  const [editForm, setEditForm] = useState({});

  const load = async () => {
    try {
      const { data } = await api.get("/documents");
      setDocs(data || []);
    } catch {
      toast.error("Failed to load documents");
    }
  };

  useEffect(() => { load(); }, []);

  useEffect(() => () => {
    if (pdfUrl) URL.revokeObjectURL(pdfUrl);
  }, [pdfUrl]);

  const filtered = docs.filter((d) =>
    !q || JSON.stringify(d).toLowerCase().includes(q.toLowerCase()),
  );

  const queueFile = (file) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      toast.error("Only PDF files are allowed");
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      toast.error("PDF must be under 25 MB");
      return;
    }
    setPendingFile(file);
    setMeta((m) => ({ ...m, client: m.client }));
    setUploadOpen(true);
  };

  const onDrop = useCallback((e) => {
    e.preventDefault();
    setDragOver(false);
    if (!canWrite) return;
    const file = e.dataTransfer.files?.[0];
    queueFile(file);
  }, [canWrite]);

  const uploadPdf = async () => {
    if (!pendingFile) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", pendingFile);
      fd.append("category", meta.category);
      fd.append("client", meta.client);
      fd.append("version", meta.version);
      await api.post("/documents/upload", fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      toast.success("PDF uploaded");
      setUploadOpen(false);
      setPendingFile(null);
      setMeta({ category: "Contract", client: "", version: "v1.0" });
      load();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const openViewer = async (doc) => {
    if (!doc.has_file && !doc.blob_key) {
      toast.error("No PDF file attached — upload a new document");
      return;
    }
    try {
      const { data } = await api.get(`/documents/${doc.id}/file`, { responseType: "blob" });
      if (pdfUrl) URL.revokeObjectURL(pdfUrl);
      const url = URL.createObjectURL(data);
      setPdfUrl(url);
      setViewer(doc);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Could not open PDF");
    }
  };

  const closeViewer = () => {
    setViewer(null);
    if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    setPdfUrl(null);
  };

  const remove = async (doc) => {
    if (!window.confirm(`Delete "${doc.name}"?`)) return;
    try {
      await api.delete(`/documents/${doc.id}`);
      toast.success("Deleted");
      if (viewer?.id === doc.id) closeViewer();
      load();
    } catch {
      toast.error("Delete failed");
    }
  };

  const openEdit = (doc) => {
    setEditDoc(doc);
    setEditForm({
      name: doc.name,
      category: doc.category || "Other",
      client: doc.client || "",
      version: doc.version || "v1.0",
    });
  };

  const saveEdit = async () => {
    try {
      await api.put(`/documents/${editDoc.id}`, editForm);
      toast.success("Updated");
      setEditDoc(null);
      load();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Update failed");
    }
  };

  return (
    <div>
      <PageHeader
        eyebrow="Module · 10"
        title="Document Manager."
        description="Upload PDFs via drag-and-drop, store in blob storage, and preview in-browser."
        actions={
          canWrite ? (
            <Button
              onClick={() => fileInputRef.current?.click()}
              className="bg-[var(--bx-brand)] hover:opacity-90 text-white"
              data-testid="documents-upload-btn"
            >
              <UploadSimple size={14} className="mr-1.5" /> Upload PDF
            </Button>
          ) : null
        }
      />

      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        onChange={(e) => queueFile(e.target.files?.[0])}
      />

      {canWrite && (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`mb-6 rounded-xl border-2 border-dashed p-8 text-center cursor-pointer transition ${
            dragOver
              ? "border-[var(--bx-brand)] bg-[var(--bx-brand)]/5"
              : "border-[var(--bx-border)] bg-[var(--bx-bg-3)]/40 hover:border-[var(--bx-brand)]/50"
          }`}
          data-testid="documents-dropzone"
        >
          <FilePdf size={36} className="mx-auto mb-3 text-[var(--bx-text-3)]" />
          <p className="text-sm font-semibold text-[var(--bx-text)]">
            Drag & drop PDF here
          </p>
          <p className="text-xs text-[var(--bx-text-3)] mt-1">
            or click to browse · max 25 MB · stored in blob storage
          </p>
        </div>
      )}

      <Section
        title={`Documents · ${filtered.length}`}
        action={
          <div className="relative">
            <MagnifyingGlass size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--bx-text-3)]" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search…"
              className="h-8 pl-7 text-xs w-40 sm:w-48"
              data-testid="documents-search"
            />
          </div>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="documents-table">
            <thead className="bg-[var(--bx-bg-3)]">
              <tr className="text-left text-[10px] uppercase tracking-widest bx-mono text-[var(--bx-text-3)]">
                <th className="px-4 sm:px-5 py-3">File</th>
                <th className="px-4 sm:px-5 py-3">Category</th>
                <th className="px-4 sm:px-5 py-3">Client</th>
                <th className="px-4 sm:px-5 py-3">Version</th>
                <th className="px-4 sm:px-5 py-3 text-right">Size</th>
                <th className="px-4 sm:px-5 py-3">Uploaded by</th>
                <th className="px-4 sm:px-5 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--bx-border)]">
              {filtered.map((d) => (
                <tr key={d.id} className="hover:bg-[var(--bx-bg-3)]">
                  <td className="px-4 sm:px-5 py-3">
                    <button
                      type="button"
                      onClick={() => openViewer(d)}
                      className="font-semibold text-[var(--bx-text)] hover:text-[var(--bx-brand)] text-left flex items-center gap-2 max-w-[220px]"
                      title={d.has_file || d.blob_key ? "View PDF" : "No file attached"}
                    >
                      <FilePdf size={16} className={`shrink-0 ${d.has_file || d.blob_key ? "text-rose-500" : "text-[var(--bx-text-3)]"}`} />
                      <span className="truncate">{d.name}</span>
                    </button>
                  </td>
                  <td className="px-4 sm:px-5 py-3 text-[var(--bx-text-2)]">{d.category || "—"}</td>
                  <td className="px-4 sm:px-5 py-3 text-[var(--bx-text-2)]">{d.client || "—"}</td>
                  <td className="px-4 sm:px-5 py-3"><span className="bx-mono text-xs">{d.version || "—"}</span></td>
                  <td className="px-4 sm:px-5 py-3 text-right bx-mono text-xs">{d.size_kb ? `${d.size_kb} KB` : "—"}</td>
                  <td className="px-4 sm:px-5 py-3 text-[var(--bx-text-2)]">{d.uploaded_by || "—"}</td>
                  <td className="px-4 sm:px-5 py-3 text-right">
                    <div className="flex gap-1 justify-end">
                      <Button size="sm" variant="ghost" onClick={() => openViewer(d)} title="View PDF" data-testid={`documents-view-${d.id}`}>
                        <Eye size={14} />
                      </Button>
                      {canWrite && (
                        <>
                          <Button size="sm" variant="ghost" onClick={() => openEdit(d)} data-testid={`documents-edit-${d.id}`}>
                            <PencilSimple size={14} />
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => remove(d)} data-testid={`documents-delete-${d.id}`}>
                            <Trash size={14} className="text-rose-500" />
                          </Button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={7}><EmptyState /></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Section>

      <Dialog open={uploadOpen} onOpenChange={(v) => { setUploadOpen(v); if (!v) setPendingFile(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Upload PDF</DialogTitle>
          </DialogHeader>
          {pendingFile && (
            <div className="flex items-center gap-2 rounded-lg border border-[var(--bx-border)] bg-[var(--bx-bg-3)] px-3 py-2 text-sm">
              <FilePdf size={18} className="text-rose-500 shrink-0" />
              <span className="truncate flex-1">{pendingFile.name}</span>
              <span className="text-xs text-[var(--bx-text-3)] bx-mono shrink-0">
                {Math.round(pendingFile.size / 1024)} KB
              </span>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3 py-2">
            <div className="col-span-2">
              <Label className="text-xs">Category</Label>
              <Select value={meta.category} onValueChange={(v) => setMeta((m) => ({ ...m, category: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Client</Label>
              <Input value={meta.client} onChange={(e) => setMeta((m) => ({ ...m, client: e.target.value }))} placeholder="Optional" />
            </div>
            <div>
              <Label className="text-xs">Version</Label>
              <Input value={meta.version} onChange={(e) => setMeta((m) => ({ ...m, version: e.target.value }))} placeholder="v1.0" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUploadOpen(false)}>Cancel</Button>
            <Button onClick={uploadPdf} disabled={uploading || !pendingFile} className="bg-[var(--bx-brand)] hover:opacity-90 text-white" data-testid="documents-upload-submit">
              {uploading ? "Uploading…" : "Upload"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editDoc} onOpenChange={(v) => !v && setEditDoc(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Edit document</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3 py-2">
            <div className="col-span-2">
              <Label className="text-xs">File name</Label>
              <Input value={editForm.name || ""} onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="col-span-2">
              <Label className="text-xs">Category</Label>
              <Select value={editForm.category || "Other"} onValueChange={(v) => setEditForm((f) => ({ ...f, category: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Client</Label>
              <Input value={editForm.client || ""} onChange={(e) => setEditForm((f) => ({ ...f, client: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs">Version</Label>
              <Input value={editForm.version || ""} onChange={(e) => setEditForm((f) => ({ ...f, version: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDoc(null)}>Cancel</Button>
            <Button onClick={saveEdit} className="bg-[var(--bx-brand)] hover:opacity-90 text-white">Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!viewer} onOpenChange={(v) => !v && closeViewer()}>
        <DialogContent className="max-w-4xl w-[95vw] h-[85vh] flex flex-col p-0 gap-0" data-testid="pdf-viewer-dialog">
          <DialogHeader className="px-4 py-3 border-b border-[var(--bx-border)] flex-row items-center justify-between space-y-0">
            <DialogTitle className="text-sm truncate pr-4">{viewer?.name}</DialogTitle>
            <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={closeViewer} aria-label="Close viewer">
              <X size={16} />
            </Button>
          </DialogHeader>
          <div className="flex-1 min-h-0 bg-[var(--bx-bg-3)]">
            {pdfUrl ? (
              <iframe
                src={pdfUrl}
                title={viewer?.name}
                className="w-full h-full border-0"
                data-testid="pdf-viewer-frame"
              />
            ) : (
              <div className="h-full grid place-items-center text-sm text-[var(--bx-text-3)]">Loading PDF…</div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
