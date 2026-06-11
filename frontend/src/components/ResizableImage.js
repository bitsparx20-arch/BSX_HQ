import Image from "@tiptap/extension-image";

export const ResizableImage = Image.extend({
  name: "image",
  addOptions() {
    return {
      ...this.parent?.(),
      inline: true,
      allowBase64: false,
    };
  },
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: "100%",
        parseHTML: (element) => element.getAttribute("data-width") || element.style.width || "100%",
        renderHTML: (attributes) => {
          const width = attributes.width || "100%";
          return {
            "data-width": width,
            style: `width: ${width}; height: auto; max-width: 100%;`,
            class: "bx-editor-image",
          };
        },
      },
    };
  },
});
