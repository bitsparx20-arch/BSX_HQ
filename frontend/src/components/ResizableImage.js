import Image from "@tiptap/extension-image";

function parseWidthPercent(width) {
  const match = String(width || "100%").match(/(\d+)/);
  return Math.min(100, Math.max(1, Number(match?.[1]) || 100));
}

function applyImageWrapStyles(wrap, img, attrs) {
  const width = attrs.width || "100%";
  const pct = parseWidthPercent(width);
  img.src = attrs.src || "";
  img.alt = attrs.alt || "";
  img.setAttribute("data-width", width);
  img.className = "bx-editor-image";
  img.style.width = "100%";
  img.style.height = "auto";
  img.style.maxWidth = "100%";
  img.style.display = "block";
  wrap.style.width = width;
  wrap.style.maxWidth = "100%";
  wrap.style.display = pct < 100 ? "block" : "inline-block";
  wrap.style.verticalAlign = "top";
}

export const ResizableImage = Image.extend({
  name: "image",
  addOptions() {
    return {
      ...this.parent?.(),
      inline: true,
      allowBase64: false,
    };
  },
  parseHTML() {
    return [
      { tag: "span.bx-editor-image-wrap img" },
      { tag: 'img[src]:not([src^="data:"])' },
    ];
  },
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: "100%",
        parseHTML: (element) => {
          const host = element.closest?.("[data-width]") || element;
          return host.getAttribute("data-width") || element.style.width || "100%";
        },
        renderHTML: (attributes) => {
          const width = attributes.width || "100%";
          return { "data-width": width };
        },
      },
    };
  },
  renderHTML({ HTMLAttributes }) {
    const width = HTMLAttributes["data-width"] || HTMLAttributes.width || "100%";
    const pct = parseWidthPercent(width);
    return [
      "span",
      {
        class: "bx-editor-image-wrap",
        "data-width": width,
        style: `width: ${width}; max-width: 100%; display: ${pct < 100 ? "block" : "inline-block"}; vertical-align: top;`,
      },
      [
        "img",
        {
          ...HTMLAttributes,
          class: "bx-editor-image",
          style: "width: 100%; height: auto; max-width: 100%; display: block;",
        },
      ],
    ];
  },
  addNodeView() {
    return ({ node }) => {
      const wrap = document.createElement("span");
      wrap.className = "bx-editor-image-wrap";
      wrap.contentEditable = "false";
      const img = document.createElement("img");
      wrap.appendChild(img);
      applyImageWrapStyles(wrap, img, node.attrs);

      return {
        dom: wrap,
        update: (updated) => {
          if (updated.type.name !== "image") return false;
          applyImageWrapStyles(wrap, img, updated.attrs);
          return true;
        },
      };
    };
  },
});
