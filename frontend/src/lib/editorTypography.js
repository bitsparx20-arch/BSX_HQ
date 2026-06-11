import { Extension } from "@tiptap/core";

export const FONT_SIZES = [
  { label: "Small", value: "12px" },
  { label: "Normal", value: "14px" },
  { label: "Medium", value: "16px" },
  { label: "Large", value: "18px" },
  { label: "Extra large", value: "22px" },
  { label: "Huge", value: "28px" },
];

export const FONT_FAMILIES = [
  { label: "Default", value: "" },
  { label: "Sans serif", value: "'Plus Jakarta Sans', system-ui, sans-serif" },
  { label: "Serif", value: "Georgia, 'Times New Roman', serif" },
  { label: "Monospace", value: "'JetBrains Mono', ui-monospace, monospace" },
];

export const TEXT_COLORS = [
  { label: "Default", value: "" },
  { label: "Black", value: "#111827" },
  { label: "Gray", value: "#6b7280" },
  { label: "Red", value: "#ef4444" },
  { label: "Orange", value: "#f97316" },
  { label: "Amber", value: "#f59e0b" },
  { label: "Green", value: "#22c55e" },
  { label: "Teal", value: "#14b8a6" },
  { label: "Blue", value: "#3b82f6" },
  { label: "Purple", value: "#a855f7" },
  { label: "Pink", value: "#ec4899" },
];

const SIZE_VALUES = FONT_SIZES.map((s) => s.value);

export function nextFontSize(current, direction) {
  const size = current || "14px";
  const idx = SIZE_VALUES.indexOf(size);
  const base = idx === -1 ? 1 : idx;
  const next = Math.min(SIZE_VALUES.length - 1, Math.max(0, base + direction));
  return SIZE_VALUES[next];
}

function styleAttr(value, cssProp) {
  if (!value) return {};
  return { style: `${cssProp}: ${value}` };
}

export const FontSize = Extension.create({
  name: "fontSize",
  addOptions() {
    return { types: ["textStyle"] };
  },
  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          fontSize: {
            default: null,
            parseHTML: (element) => element.style.fontSize || null,
            renderHTML: (attributes) => styleAttr(attributes.fontSize, "font-size"),
          },
        },
      },
    ];
  },
  addCommands() {
    return {
      setFontSize:
        (fontSize) =>
        ({ chain }) =>
          chain().setMark("textStyle", { fontSize }).run(),
      unsetFontSize:
        () =>
        ({ chain }) =>
          chain().setMark("textStyle", { fontSize: null }).removeEmptyTextStyle().run(),
    };
  },
});

export const FontFamily = Extension.create({
  name: "fontFamily",
  addOptions() {
    return { types: ["textStyle"] };
  },
  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          fontFamily: {
            default: null,
            parseHTML: (element) => element.style.fontFamily || null,
            renderHTML: (attributes) => styleAttr(attributes.fontFamily, "font-family"),
          },
        },
      },
    ];
  },
  addCommands() {
    return {
      setFontFamily:
        (fontFamily) =>
        ({ chain }) =>
          chain().setMark("textStyle", { fontFamily }).run(),
      unsetFontFamily:
        () =>
        ({ chain }) =>
          chain().setMark("textStyle", { fontFamily: null }).removeEmptyTextStyle().run(),
    };
  },
});
