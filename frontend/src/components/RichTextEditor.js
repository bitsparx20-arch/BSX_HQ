import React, { useCallback, useEffect } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import TextAlign from "@tiptap/extension-text-align";
import Placeholder from "@tiptap/extension-placeholder";
import Highlight from "@tiptap/extension-highlight";
import TextStyle from "@tiptap/extension-text-style";
import Color from "@tiptap/extension-color";
import {
  TextB, TextItalic, TextUnderline, TextStrikethrough,
  TextHOne, TextHTwo, TextHThree, ListBullets, ListNumbers,
  Quotes, Code, Link as LinkIcon, Image as ImageIcon,
  TextAlignLeft, TextAlignCenter, TextAlignRight,
  Highlighter, ArrowCounterClockwise, ArrowClockwise,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";

const COLORS = [
  { label: "Default", value: "" },
  { label: "Red", value: "#ef4444" },
  { label: "Orange", value: "#f97316" },
  { label: "Green", value: "#22c55e" },
  { label: "Blue", value: "#3b82f6" },
  { label: "Purple", value: "#a855f7" },
];

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

function EditorToolbar({ editor }) {
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
      if (!file) return;
      if (file.size > 4 * 1024 * 1024) {
        window.alert("Image must be under 4 MB");
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        editor.chain().focus().setImage({ src: reader.result }).run();
      };
      reader.readAsDataURL(file);
    };
    input.click();
  }, [editor]);

  if (!editor) return null;

  return (
    <div className="flex flex-wrap items-center gap-0.5 p-2 border-b border-[var(--bx-border)] bg-[var(--bx-bg-3)]/50" data-testid="editor-toolbar">
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

      <Select
        value={editor.isActive("paragraph") ? "paragraph" : editor.isActive("heading", { level: 1 }) ? "h1" : editor.isActive("heading", { level: 2 }) ? "h2" : editor.isActive("heading", { level: 3 }) ? "h3" : "paragraph"}
        onValueChange={(v) => {
          if (v === "paragraph") editor.chain().focus().setParagraph().run();
          else if (v === "h1") editor.chain().focus().toggleHeading({ level: 1 }).run();
          else if (v === "h2") editor.chain().focus().toggleHeading({ level: 2 }).run();
          else if (v === "h3") editor.chain().focus().toggleHeading({ level: 3 }).run();
        }}
      >
        <SelectTrigger className="h-8 w-[7.5rem] text-xs ml-1 hidden sm:flex">
          <SelectValue placeholder="Style" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="paragraph">Paragraph</SelectItem>
          <SelectItem value="h1">Heading 1</SelectItem>
          <SelectItem value="h2">Heading 2</SelectItem>
          <SelectItem value="h3">Heading 3</SelectItem>
        </SelectContent>
      </Select>

      <Separator orientation="vertical" className="h-6 mx-1" />

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

      <Select
        value={editor.getAttributes("textStyle").color || "default"}
        onValueChange={(v) => {
          if (v === "default") editor.chain().focus().unsetColor().run();
          else editor.chain().focus().setColor(v).run();
        }}
      >
        <SelectTrigger className="h-8 w-[5.5rem] text-xs ml-1">
          <SelectValue placeholder="Color" />
        </SelectTrigger>
        <SelectContent>
          {COLORS.map((c) => (
            <SelectItem key={c.label} value={c.value || "default"}>
              <span className="flex items-center gap-2">
                {c.value ? <span className="w-3 h-3 rounded-full" style={{ background: c.value }} /> : null}
                {c.label}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Separator orientation="vertical" className="h-6 mx-1" />

      <ToolbarButton onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()} title="Undo">
        <ArrowCounterClockwise size={16} />
      </ToolbarButton>
      <ToolbarButton onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()} title="Redo">
        <ArrowClockwise size={16} />
      </ToolbarButton>
    </div>
  );
}

export default function RichTextEditor({ value, onChange, placeholder = "Start writing…", editorKey }) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Underline,
      Link.configure({ openOnClick: false, HTMLAttributes: { class: "bx-editor-link" } }),
      Image.configure({ HTMLAttributes: { class: "bx-editor-image" } }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Placeholder.configure({ placeholder }),
      Highlight.configure({ multicolor: false }),
      TextStyle,
      Color,
    ],
    content: value || "",
    onUpdate: ({ editor: ed }) => onChange(ed.getHTML()),
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
        if (file.size > 4 * 1024 * 1024) return true;
        const reader = new FileReader();
        reader.onload = () => {
          const { schema } = view.state;
          const node = schema.nodes.image?.create({ src: reader.result });
          if (node) {
            const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
            if (pos != null) {
              const tr = view.state.tr.insert(pos, node);
              view.dispatch(tr);
            }
          }
        };
        reader.readAsDataURL(file);
        return true;
      },
      handlePaste: (view, event) => {
        const items = event.clipboardData?.items;
        if (!items) return false;
        for (const item of items) {
          if (item.type.startsWith("image/")) {
            event.preventDefault();
            const file = item.getAsFile();
            if (!file || file.size > 4 * 1024 * 1024) return true;
            const reader = new FileReader();
            reader.onload = () => {
              const { schema } = view.state;
              const node = schema.nodes.image?.create({ src: reader.result });
              if (node) {
                const tr = view.state.tr.replaceSelectionWith(node);
                view.dispatch(tr);
              }
            };
            reader.readAsDataURL(file);
            return true;
          }
        }
        return false;
      },
    },
  }, [editorKey]);

  useEffect(() => {
    if (!editor) return;
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
      <EditorToolbar editor={editor} />
      <div className="flex-1 overflow-y-auto">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
