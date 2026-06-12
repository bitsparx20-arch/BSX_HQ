import React, { useCallback, useEffect, useRef, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import Link from "@tiptap/extension-link";
import TextAlign from "@tiptap/extension-text-align";
import Placeholder from "@tiptap/extension-placeholder";
import Highlight from "@tiptap/extension-highlight";
import TextStyle from "@tiptap/extension-text-style";
import Color from "@tiptap/extension-color";
import { ResizableImage } from "@/components/ResizableImage";
import { uploadNoteImage, deleteNoteImage, extractNoteImageId } from "@/lib/noteImages";
import {
  FontSize, FontFamily, FONT_SIZES, FONT_FAMILIES, TEXT_COLORS, nextFontSize,
} from "@/lib/editorTypography";
import {
  TextB, TextItalic, TextUnderline, TextStrikethrough,
  TextHOne, TextHTwo, TextHThree, ListBullets, ListNumbers,
  Quotes, Code, Link as LinkIcon, Image as ImageIcon,
  TextAlignLeft, TextAlignCenter, TextAlignRight,
  Highlighter, ArrowCounterClockwise, ArrowClockwise, Trash,
  TextAa, Plus, Minus,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

const BLOCK_STYLES = [
  { value: "paragraph", label: "Paragraph" },
  { value: "h1", label: "Heading 1" },
  { value: "h2", label: "Heading 2" },
  { value: "h3", label: "Heading 3" },
  { value: "blockquote", label: "Quote" },
];

function currentBlockStyle(editor) {
  if (editor.isActive("heading", { level: 1 })) return "h1";
  if (editor.isActive("heading", { level: 2 })) return "h2";
  if (editor.isActive("heading", { level: 3 })) return "h3";
  if (editor.isActive("blockquote")) return "blockquote";
  return "paragraph";
}

function applyBlockStyle(editor, value) {
  const chain = editor.chain().focus();
  if (value === "paragraph") chain.setParagraph().run();
  else if (value === "h1") chain.toggleHeading({ level: 1 }).run();
  else if (value === "h2") chain.toggleHeading({ level: 2 }).run();
  else if (value === "h3") chain.toggleHeading({ level: 3 }).run();
  else if (value === "blockquote") chain.toggleBlockquote().run();
}

function currentFontFamilyValue(editor) {
  const raw = (editor.getAttributes("textStyle").fontFamily || "").toLowerCase();
  if (!raw) return "default";
  const match = FONT_FAMILIES.find((f) => {
    if (!f.value) return false;
    const key = f.value.toLowerCase().split(",")[0].replace(/'/g, "").trim();
    return raw.includes(key);
  });
  return match?.value || "default";
}

function currentFontSizeValue(editor) {
  return editor.getAttributes("textStyle").fontSize || "14px";
}

function parseWidthPercent(width) {
  const match = String(width || "100%").match(/(\d+)/);
  return Math.min(100, Math.max(20, Number(match?.[1]) || 100));
}

function getSelectedImageTarget(editor) {
  if (!editor) return null;
  const { state } = editor;
  const { selection } = state;
  if (selection instanceof NodeSelection && selection.node?.type.name === "image") {
    return { pos: selection.from, attrs: { ...selection.node.attrs } };
  }
  const probe = selection.from;
  let found = null;
  state.doc.descendants((node, pos) => {
    if (node.type.name !== "image") return undefined;
    if (probe >= pos && probe < pos + node.nodeSize) {
      found = { pos, attrs: { ...node.attrs } };
      return false;
    }
    return undefined;
  });
  return found;
}

function updateImageAtPos(editor, pos, attrsPatch) {
  const node = editor.state.doc.nodeAt(pos);
  if (node?.type.name !== "image") return false;
  const tr = editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...attrsPatch });
  editor.view.dispatch(tr);
  return true;
}

async function insertImageFile(editor, file, noteId) {
  if (!file?.type?.startsWith("image/")) return false;
  if (file.size > MAX_IMAGE_BYTES) {
    toast.error("Image must be under 8 MB");
    return true;
  }
  try {
    const url = await uploadNoteImage(file, noteId);
    editor.chain().focus().setImage({ src: url, width: "100%" }).insertContent(" ").run();
  } catch {
    toast.error("Failed to upload image");
  }
  return true;
}

function insertImageAtView(view, file, noteId, coords) {
  if (!file?.type?.startsWith("image/")) return;
  if (file.size > MAX_IMAGE_BYTES) {
    toast.error("Image must be under 8 MB");
    return;
  }
  uploadNoteImage(file, noteId)
    .then((url) => {
      const { schema } = view.state;
      const node = schema.nodes.image?.create({ src: url, width: "100%" });
      if (!node) return;
      const pos = coords ?? view.state.selection.from;
      const tr = view.state.tr.insert(pos, node);
      const after = Math.min(pos + node.nodeSize, tr.doc.content.size);
      view.dispatch(tr.setSelection(TextSelection.near(tr.doc.resolve(after))));
    })
    .catch(() => toast.error("Failed to upload image"));
}

function focusEditorAtPoint(editor, clientX, clientY) {
  if (!editor?.view) return;
  const { view } = editor;
  const coords = view.posAtCoords({ left: clientX, top: clientY });
  if (coords) {
    editor.chain().focus().setTextSelection(coords.pos).run();
    return;
  }
  const end = editor.state.doc.content.size;
  if (end === 0 || editor.state.doc.lastChild?.type.name !== "paragraph") {
    editor.chain().focus("end").insertContent("<p></p>").focus("end").run();
  } else {
    editor.chain().focus("end").run();
  }
}

function ToolbarButton({ active, onClick, title, children, disabled }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={`h-8 w-8 shrink-0 ${active ? "bg-[var(--bx-brand-soft)] text-[var(--bx-brand)]" : ""}`}
      onClick={onClick}
      title={title}
      disabled={disabled}
    >
      {children}
    </Button>
  );
}

function EditorToolbar({ editor, noteId, onImageResizeActive, onImageResizeCommit }) {
  const [imageWidth, setImageWidth] = useState(100);
  const [imageTarget, setImageTarget] = useState(null);
  const [isResizingImage, setIsResizingImage] = useState(false);
  const resizingRef = useRef(false);
  const imageTargetRef = useRef(null);

  const armImageResize = useCallback(() => {
    if (!editor) return;
    const target = imageTargetRef.current || getSelectedImageTarget(editor);
    if (!target) return;
    imageTargetRef.current = target;
    setImageTarget(target);
    setImageWidth(parseWidthPercent(target.attrs.width));
    resizingRef.current = true;
    setIsResizingImage(true);
    onImageResizeActive?.(true);
    try {
      const tr = editor.state.tr.setSelection(
        NodeSelection.create(editor.state.doc, target.pos),
      );
      editor.view.dispatch(tr);
    } catch {
      /* keep going */
    }
  }, [editor, onImageResizeActive]);

  const syncImageTarget = useCallback(() => {
    if (!editor || resizingRef.current) return;
    const target = getSelectedImageTarget(editor);
    if (target) {
      imageTargetRef.current = target;
      setImageTarget(target);
      setImageWidth(parseWidthPercent(target.attrs.width));
    } else {
      imageTargetRef.current = null;
      setImageTarget(null);
    }
  }, [editor]);

  useEffect(() => {
    if (!editor) return undefined;
    syncImageTarget();
    editor.on("selectionUpdate", syncImageTarget);
    return () => {
      editor.off("selectionUpdate", syncImageTarget);
    };
  }, [editor, syncImageTarget]);

  const setLink = useCallback(() => {
    const prev = editor.getAttributes("link").href;
    const url = window.prompt("Link URL", prev || "https://");
    if (url === null) return;
    if (url === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  }, [editor]);

  const addImage = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = () => {
      const file = input.files?.[0];
      if (file) insertImageFile(editor, file, noteId);
    };
    input.click();
  }, [editor, noteId]);

  const onImageWidthChange = (value) => {
    const target = imageTargetRef.current;
    if (!editor || !target) return;
    const pct = Number(value);
    setImageWidth(pct);
    const width = `${pct}%`;
    if (!updateImageAtPos(editor, target.pos, { width })) return;
    const next = { ...target, attrs: { ...target.attrs, width } };
    imageTargetRef.current = next;
    setImageTarget(next);
  };

  const onImageWidthCommit = () => {
    if (!editor) return;
    resizingRef.current = false;
    setIsResizingImage(false);
    onImageResizeActive?.(false);
    const target = imageTargetRef.current;
    if (target) {
      try {
        const tr = editor.state.tr.setSelection(
          NodeSelection.create(editor.state.doc, target.pos),
        );
        editor.view.dispatch(tr);
      } catch {
        /* image may have moved */
      }
    }
    onImageResizeCommit?.();
  };

  const removeImage = useCallback(async () => {
    const target = imageTargetRef.current;
    if (!editor || !target) return;
    const src = target.attrs.src;
    const imageId = extractNoteImageId(src);
    const node = editor.state.doc.nodeAt(target.pos);
    if (!node || node.type.name !== "image") return;
    const tr = editor.state.tr.delete(target.pos, target.pos + node.nodeSize);
    editor.view.dispatch(tr);
    imageTargetRef.current = null;
    setImageTarget(null);
    if (!imageId) return;
    try {
      await deleteNoteImage(imageId);
    } catch {
      toast.error("Image removed from note but could not delete the file");
    }
  }, [editor]);

  if (!editor) return null;

  return (
    <div className="flex flex-col gap-2 p-2 border-b border-[var(--bx-border)] bg-[var(--bx-bg-3)]/50" data-testid="editor-toolbar">
      {(imageTarget || isResizingImage) && (
        <div className="flex items-center gap-3 px-1 py-1 rounded-md bg-[var(--bx-card)] border border-[var(--bx-border)]">
          <span className="text-[10px] uppercase tracking-widest text-[var(--bx-text-3)] bx-mono shrink-0">Image width</span>
          <input
            type="range"
            min={20}
            max={100}
            step={1}
            value={imageWidth}
            onPointerDown={armImageResize}
            onChange={(e) => onImageWidthChange(e.target.value)}
            onInput={(e) => onImageWidthChange(e.target.value)}
            onPointerUp={onImageWidthCommit}
            onPointerCancel={onImageWidthCommit}
            onTouchEnd={onImageWidthCommit}
            onKeyUp={onImageWidthCommit}
            className="flex-1 min-w-[120px] accent-[var(--bx-brand)] cursor-pointer touch-none"
            data-testid="image-width-slider"
          />
          <span className="text-xs bx-mono text-[var(--bx-text-2)] w-10 text-right">{imageWidth}%</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 shrink-0 text-rose-500 hover:text-rose-600 hover:bg-rose-50"
            onClick={removeImage}
            title="Remove image"
            data-testid="delete-image-btn"
          >
            <Trash size={14} className="mr-1" />
            Remove
          </Button>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-0.5">
        <span className="hidden sm:flex items-center gap-0.5 mr-1 pr-1 border-r border-[var(--bx-border)]">
          <TextAa size={14} className="text-[var(--bx-text-3)] mx-1" aria-hidden />
          <Select
            value={currentBlockStyle(editor)}
            onValueChange={(v) => applyBlockStyle(editor, v)}
          >
            <SelectTrigger className="h-8 w-[6.5rem] text-xs" data-testid="text-style-select">
              <SelectValue placeholder="Style" />
            </SelectTrigger>
            <SelectContent>
              {BLOCK_STYLES.map((s) => (
                <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={currentFontFamilyValue(editor)}
            onValueChange={(v) => {
              if (v === "default") editor.chain().focus().unsetFontFamily().run();
              else editor.chain().focus().setFontFamily(v).run();
            }}
          >
            <SelectTrigger className="h-8 w-[6rem] text-xs" data-testid="font-family-select">
              <SelectValue placeholder="Font" />
            </SelectTrigger>
            <SelectContent>
              {FONT_FAMILIES.map((f) => (
                <SelectItem key={f.label} value={f.value || "default"}>{f.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={currentFontSizeValue(editor)}
            onValueChange={(v) => editor.chain().focus().setFontSize(v).run()}
          >
            <SelectTrigger className="h-8 w-[5.5rem] text-xs" data-testid="font-size-select">
              <SelectValue placeholder="Size" />
            </SelectTrigger>
            <SelectContent>
              {FONT_SIZES.map((s) => (
                <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <ToolbarButton
            onClick={() => {
              const next = nextFontSize(editor.getAttributes("textStyle").fontSize, -1);
              editor.chain().focus().setFontSize(next).run();
            }}
            title="Decrease text size"
            data-testid="font-size-decrease"
          >
            <Minus size={16} />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => {
              const next = nextFontSize(editor.getAttributes("textStyle").fontSize, 1);
              editor.chain().focus().setFontSize(next).run();
            }}
            title="Increase text size"
            data-testid="font-size-increase"
          >
            <Plus size={16} />
          </ToolbarButton>
          <Select
            value={editor.getAttributes("textStyle").color || "default"}
            onValueChange={(v) => {
              if (v === "default") editor.chain().focus().unsetColor().run();
              else editor.chain().focus().setColor(v).run();
            }}
          >
            <SelectTrigger className="h-8 w-[5.5rem] text-xs" data-testid="text-color-select">
              <SelectValue placeholder="Color" />
            </SelectTrigger>
            <SelectContent>
              {TEXT_COLORS.map((c) => (
                <SelectItem key={c.label} value={c.value || "default"}>
                  <span className="flex items-center gap-2">
                    {c.value ? (
                      <span className="w-3 h-3 rounded-full border border-[var(--bx-border)]" style={{ background: c.value }} />
                    ) : (
                      <span className="w-3 h-3 rounded-full border border-[var(--bx-border)] bg-[var(--bx-card)]" />
                    )}
                    {c.label}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </span>

        <Separator orientation="vertical" className="h-6 mx-1" />

        <ToolbarButton active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()} title="Bold">
          <TextB size={16} weight="bold" />
        </ToolbarButton>
        <ToolbarButton active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()} title="Italic">
          <TextItalic size={16} />
        </ToolbarButton>
        <ToolbarButton active={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()} title="Underline">
          <TextUnderline size={16} />
        </ToolbarButton>
        <ToolbarButton active={editor.isActive("strike")} onClick={() => editor.chain().focus().toggleStrike().run()} title="Strikethrough">
          <TextStrikethrough size={16} />
        </ToolbarButton>
        <ToolbarButton active={editor.isActive("highlight")} onClick={() => editor.chain().focus().toggleHighlight().run()} title="Highlight">
          <Highlighter size={16} />
        </ToolbarButton>

        <Separator orientation="vertical" className="h-6 mx-1" />

        <ToolbarButton active={editor.isActive("heading", { level: 1 })} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} title="Heading 1">
          <TextHOne size={16} />
        </ToolbarButton>
        <ToolbarButton active={editor.isActive("heading", { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} title="Heading 2">
          <TextHTwo size={16} />
        </ToolbarButton>
        <ToolbarButton active={editor.isActive("heading", { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} title="Heading 3">
          <TextHThree size={16} />
        </ToolbarButton>

        <ToolbarButton active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()} title="Bullet list">
          <ListBullets size={16} />
        </ToolbarButton>
        <ToolbarButton active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()} title="Numbered list">
          <ListNumbers size={16} />
        </ToolbarButton>
        <ToolbarButton active={editor.isActive("blockquote")} onClick={() => editor.chain().focus().toggleBlockquote().run()} title="Quote">
          <Quotes size={16} />
        </ToolbarButton>
        <ToolbarButton active={editor.isActive("codeBlock")} onClick={() => editor.chain().focus().toggleCodeBlock().run()} title="Code block">
          <Code size={16} />
        </ToolbarButton>

        <Separator orientation="vertical" className="h-6 mx-1" />

        <ToolbarButton active={editor.isActive({ textAlign: "left" })} onClick={() => editor.chain().focus().setTextAlign("left").run()} title="Align left">
          <TextAlignLeft size={16} />
        </ToolbarButton>
        <ToolbarButton active={editor.isActive({ textAlign: "center" })} onClick={() => editor.chain().focus().setTextAlign("center").run()} title="Align center">
          <TextAlignCenter size={16} />
        </ToolbarButton>
        <ToolbarButton active={editor.isActive({ textAlign: "right" })} onClick={() => editor.chain().focus().setTextAlign("right").run()} title="Align right">
          <TextAlignRight size={16} />
        </ToolbarButton>

        <Separator orientation="vertical" className="h-6 mx-1" />

        <ToolbarButton active={editor.isActive("link")} onClick={setLink} title="Insert link">
          <LinkIcon size={16} />
        </ToolbarButton>
        <ToolbarButton onClick={addImage} title="Insert image">
          <ImageIcon size={16} />
        </ToolbarButton>

        <ToolbarButton onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()} title="Undo">
          <ArrowCounterClockwise size={16} />
        </ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()} title="Redo">
          <ArrowClockwise size={16} />
        </ToolbarButton>
      </div>
    </div>
  );
}

export default function RichTextEditor({ value, onChange, placeholder = "Start writing…", editorKey, noteId }) {
  const resizingImageRef = useRef(false);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Underline,
      Link.configure({ openOnClick: false, HTMLAttributes: { class: "bx-editor-link" } }),
      ResizableImage.configure({ inline: true }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Placeholder.configure({ placeholder }),
      Highlight.configure({ multicolor: false }),
      TextStyle,
      Color,
      FontSize,
      FontFamily,
    ],
    content: value || "",
    onUpdate: ({ editor: ed }) => {
      if (resizingImageRef.current) return;
      onChange(ed.getHTML());
    },
    editorProps: {
      attributes: {
        class: "bx-rich-editor prose prose-sm max-w-none focus:outline-none min-h-[20rem] px-4 py-3",
        "data-testid": "note-content",
      },
      handleDrop: (view, event) => {
        const files = event.dataTransfer?.files;
        if (!files?.length) return false;
        const file = files[0];
        if (!file.type.startsWith("image/")) return false;
        event.preventDefault();
        const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
        insertImageAtView(view, file, noteId, pos);
        return true;
      },
      handlePaste: (view, event) => {
        const items = event.clipboardData?.items;
        if (!items) return false;
        for (const item of items) {
          if (item.type.startsWith("image/")) {
            event.preventDefault();
            const file = item.getAsFile();
            if (file) insertImageAtView(view, file, noteId);
            return true;
          }
        }
        return false;
      },
      handleDOMEvents: {
        mousedown: (view, event) => {
          if (event.button !== 0) return false;
          const coords = view.posAtCoords({ left: event.clientX, top: event.clientY });
          if (coords) return false;
          if (!view.dom.contains(event.target)) return false;
          const end = view.state.doc.content.size;
          view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(end))));
          view.focus();
          return true;
        },
      },
    },
  }, [editorKey]);

  useEffect(() => {
    if (!editor || resizingImageRef.current) return;
    const current = editor.getHTML();
    const next = value || "";
    if (current !== next && next !== "<p></p>") {
      editor.commands.setContent(next, false);
    } else if (!next && current !== "<p></p>") {
      editor.commands.setContent("", false);
    }
  }, [editor, value, editorKey]);

  useEffect(() => () => editor?.destroy(), [editor]);

  return (
    <div className="bx-rich-editor-shell border border-[var(--bx-border)] rounded-lg overflow-hidden bg-[var(--bx-card)] flex flex-col flex-1">
      <EditorToolbar
        editor={editor}
        noteId={noteId}
        onImageResizeActive={(active) => { resizingImageRef.current = active; }}
        onImageResizeCommit={() => {
          if (editor) onChange(editor.getHTML());
        }}
      />
      <div
        className="flex-1 overflow-y-auto bx-rich-editor-scroll min-h-0 cursor-text"
        onMouseDown={(e) => {
          if (!editor || e.button !== 0) return;
          const prose = editor.view.dom;
          if (prose.contains(e.target)) return;
          e.preventDefault();
          focusEditorAtPoint(editor, e.clientX, e.clientY);
        }}
      >
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
