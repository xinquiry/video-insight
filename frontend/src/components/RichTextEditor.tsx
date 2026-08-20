import { Image } from "@tiptap/extension-image";
import { Placeholder } from "@tiptap/extension-placeholder";
import { EditorContent, useEditor } from "@tiptap/react";
import { StarterKit } from "@tiptap/starter-kit";
import {
  Bold,
  Code2,
  ImagePlus,
  Italic,
  List,
  ListOrdered,
  Quote,
  Redo2,
  Strikethrough,
  Undo2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { RichTextDocument } from "@/types";

const MAX_IMAGE_BYTES = 2.5 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

const contentExtensions = [
  StarterKit,
  Image.configure({ allowBase64: true, resize: { enabled: true } }),
];

export function RichTextEditor({
  labelledBy,
  value,
  onChange,
}: {
  labelledBy: string;
  value: RichTextDocument;
  onChange: (value: RichTextDocument) => void;
}) {
  const { t } = useTranslation();
  const imageInput = useRef<HTMLInputElement | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const editorExtensions = useMemo(
    () => [
      ...contentExtensions,
      Placeholder.configure({ placeholder: t("videoDetail.form.contentPlaceholder") }),
    ],
    [t],
  );
  const editor = useEditor({
    extensions: editorExtensions,
    content: value,
    editorProps: {
      attributes: {
        "aria-labelledby": labelledBy,
        "aria-multiline": "true",
        role: "textbox",
      },
    },
    onUpdate: ({ editor: instance }) => onChange(instance.getJSON() as RichTextDocument),
  });

  useEffect(() => {
    if (!editor) return;
    if (JSON.stringify(editor.getJSON()) !== JSON.stringify(value)) {
      editor.commands.setContent(value, { emitUpdate: false });
    }
  }, [editor, value]);

  const addImage = (file: File | undefined) => {
    if (!file || !editor) return;
    if (!ALLOWED_IMAGE_TYPES.has(file.type) || file.size > MAX_IMAGE_BYTES) {
      setImageError(t("videoDetail.form.imageError"));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") return;
      editor.chain().focus().setImage({ src: reader.result, alt: file.name }).run();
      setImageError(null);
    };
    reader.readAsDataURL(file);
  };

  if (!editor) return null;

  const tools = [
    {
      label: t("videoDetail.form.bold"),
      icon: Bold,
      run: () => editor.chain().focus().toggleBold().run(),
      active: editor.isActive("bold"),
    },
    {
      label: t("videoDetail.form.italic"),
      icon: Italic,
      run: () => editor.chain().focus().toggleItalic().run(),
      active: editor.isActive("italic"),
    },
    {
      label: t("videoDetail.form.strike"),
      icon: Strikethrough,
      run: () => editor.chain().focus().toggleStrike().run(),
      active: editor.isActive("strike"),
    },
    {
      label: t("videoDetail.form.bulletList"),
      icon: List,
      run: () => editor.chain().focus().toggleBulletList().run(),
      active: editor.isActive("bulletList"),
    },
    {
      label: t("videoDetail.form.orderedList"),
      icon: ListOrdered,
      run: () => editor.chain().focus().toggleOrderedList().run(),
      active: editor.isActive("orderedList"),
    },
    {
      label: t("videoDetail.form.quote"),
      icon: Quote,
      run: () => editor.chain().focus().toggleBlockquote().run(),
      active: editor.isActive("blockquote"),
    },
    {
      label: t("videoDetail.form.code"),
      icon: Code2,
      run: () => editor.chain().focus().toggleCodeBlock().run(),
      active: editor.isActive("codeBlock"),
    },
  ];

  return (
    <div>
      <div className="overflow-hidden rounded-lg border border-[var(--rule-strong)] bg-[var(--surface)]">
        <div className="flex flex-wrap gap-1 border-b border-[var(--rule)] p-2">
          {tools.map(({ active, icon: Icon, label, run }) => (
            <button
              key={label}
              type="button"
              onClick={run}
              className={
                active ? "vi-rich-tool bg-[var(--ink)] text-[var(--paper)]" : "vi-rich-tool"
              }
              aria-pressed={active}
              aria-label={label}
              title={label}
            >
              <Icon className="h-4 w-4" />
            </button>
          ))}
          <button
            type="button"
            onClick={() => imageInput.current?.click()}
            className="vi-rich-tool"
            aria-label={t("videoDetail.form.image")}
            title={t("videoDetail.form.image")}
          >
            <ImagePlus className="h-4 w-4" />
          </button>
          <span className="mx-1 w-px bg-[var(--rule)]" />
          <button
            type="button"
            onClick={() => editor.chain().focus().undo().run()}
            className="vi-rich-tool"
            aria-label={t("videoDetail.form.undo")}
            title={t("videoDetail.form.undo")}
          >
            <Undo2 className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => editor.chain().focus().redo().run()}
            className="vi-rich-tool"
            aria-label={t("videoDetail.form.redo")}
            title={t("videoDetail.form.redo")}
          >
            <Redo2 className="h-4 w-4" />
          </button>
          <input
            ref={imageInput}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            className="hidden"
            onChange={(event) => {
              addImage(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
        </div>
        <EditorContent editor={editor} className="vi-rich-text vi-rich-editor" />
      </div>
      {imageError && <p className="mt-2 text-sm text-[var(--danger)]">{imageError}</p>}
      <p className="mt-2 text-xs text-[var(--muted)]">{t("videoDetail.form.imageHint")}</p>
    </div>
  );
}

export function RichTextContent({
  content,
  compact = false,
}: {
  content: RichTextDocument;
  compact?: boolean;
}) {
  const editor = useEditor({ extensions: contentExtensions, content, editable: false });

  useEffect(() => {
    if (editor) editor.commands.setContent(content, { emitUpdate: false });
  }, [content, editor]);

  return (
    <EditorContent
      editor={editor}
      className={compact ? "vi-rich-text vi-rich-compact" : "vi-rich-text"}
    />
  );
}

export function isRichTextEmpty(content: RichTextDocument): boolean {
  const visit = (nodes: RichTextDocument["content"] = []): boolean =>
    nodes.every((node) => node.type !== "image" && !node.text?.trim() && visit(node.content));
  return visit(content.content);
}
