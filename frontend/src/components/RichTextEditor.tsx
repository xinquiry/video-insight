import { Image } from "@tiptap/extension-image";
import { Placeholder } from "@tiptap/extension-placeholder";
import { EditorContent, useEditor } from "@tiptap/react";
import { StarterKit } from "@tiptap/starter-kit";
import {
  Bold,
  Code2,
  ImagePlus,
  Italic,
  Link2,
  List,
  ListOrdered,
  Quote,
  Redo2,
  Strikethrough,
  Unlink2,
  Undo2,
} from "lucide-react";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import type { RichTextDocument } from "@/types";

const MAX_IMAGE_BYTES = 2.5 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

const contentExtensions = [
  StarterKit.configure({
    link: {
      autolink: true,
      defaultProtocol: "https",
      linkOnPaste: true,
      markdownLinks: true,
      openOnClick: false,
      HTMLAttributes: {
        rel: "noopener noreferrer",
        target: "_blank",
      },
    },
  }),
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
  const initialLinkText = useRef("");
  const [imageError, setImageError] = useState<string | null>(null);
  const [isLinkEditorOpen, setIsLinkEditorOpen] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [linkText, setLinkText] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
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

  const openLinkEditor = () => {
    if (!editor) return;
    const href = editor.getAttributes("link").href;
    const { from, to } = editor.state.selection;
    const selectedText = from === to ? "" : editor.state.doc.textBetween(from, to, " ");
    initialLinkText.current = selectedText;
    setLinkText(selectedText);
    setLinkUrl(typeof href === "string" ? href : "");
    setLinkError(null);
    setIsLinkEditorOpen(true);
  };

  const closeLinkEditor = () => {
    setIsLinkEditorOpen(false);
    setLinkError(null);
  };

  const applyLink = () => {
    if (!editor) return;
    const href = normalizeLinkUrl(linkUrl);
    if (!href) {
      setLinkError(t("videoDetail.form.linkError"));
      return;
    }

    const isUpdatingLink = editor.isActive("link");
    const hasSelection = !editor.state.selection.empty;
    const visibleText = linkText.trim();
    const shouldReplaceText =
      Boolean(visibleText) && visibleText !== initialLinkText.current.trim();
    const existingMarks = editor.state.selection.$from
      .marks()
      .filter((mark) => mark.type.name !== "link")
      .map((mark) => mark.toJSON());
    const linkedContent = {
      type: "text",
      text: visibleText || href,
      marks: [...existingMarks, { type: "link", attrs: { href } }],
    };
    if (isUpdatingLink) {
      const chain = editor.chain().focus().extendMarkRange("link");
      if (shouldReplaceText) chain.insertContent(linkedContent).run();
      else chain.setLink({ href }).run();
    } else if (hasSelection) {
      const chain = editor.chain().focus();
      if (shouldReplaceText) chain.insertContent(linkedContent).run();
      else chain.setLink({ href }).run();
    } else {
      editor.chain().focus().insertContent(linkedContent).run();
    }

    closeLinkEditor();
  };

  const removeLink = () => {
    if (!editor) return;
    editor.chain().focus().extendMarkRange("link").unsetLink().run();
    closeLinkEditor();
  };

  const applyLinkOnEnter = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    event.stopPropagation();
    applyLink();
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
          <button
            type="button"
            onClick={openLinkEditor}
            className={
              editor.isActive("link")
                ? "vi-rich-tool bg-[var(--ink)] text-[var(--paper)]"
                : "vi-rich-tool"
            }
            aria-pressed={editor.isActive("link")}
            aria-label={t("videoDetail.form.link")}
            title={t("videoDetail.form.link")}
          >
            <Link2 className="h-4 w-4" />
          </button>
          {editor.isActive("link") && (
            <button
              type="button"
              onClick={removeLink}
              className="vi-rich-tool"
              aria-label={t("videoDetail.form.unlink")}
              title={t("videoDetail.form.unlink")}
            >
              <Unlink2 className="h-4 w-4" />
            </button>
          )}
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
        {isLinkEditorOpen && (
          <div className="flex flex-wrap items-start gap-2 border-b border-[var(--rule)] bg-[var(--paper)] p-2">
            <label className="min-w-40 flex-1">
              <span className="sr-only">{t("videoDetail.form.linkText")}</span>
              <input
                type="text"
                value={linkText}
                onChange={(event) => setLinkText(event.target.value)}
                onKeyDown={applyLinkOnEnter}
                placeholder={t("videoDetail.form.linkTextPlaceholder")}
                className="vi-input py-1 text-sm"
                aria-label={t("videoDetail.form.linkText")}
              />
            </label>
            <label className="min-w-48 flex-1">
              <span className="sr-only">{t("videoDetail.form.linkUrl")}</span>
              <input
                type="text"
                inputMode="url"
                value={linkUrl}
                onChange={(event) => {
                  setLinkUrl(event.target.value);
                  setLinkError(null);
                }}
                onKeyDown={applyLinkOnEnter}
                placeholder={t("videoDetail.form.linkPlaceholder")}
                className="vi-input py-1 text-sm"
                aria-label={t("videoDetail.form.linkUrl")}
                aria-invalid={Boolean(linkError)}
              />
              {linkError && (
                <span className="mt-1 block text-xs text-[var(--danger)]">{linkError}</span>
              )}
            </label>
            <button
              type="button"
              onClick={applyLink}
              className="vi-button-primary min-h-8 px-3 py-1 text-xs"
            >
              {t("videoDetail.form.applyLink")}
            </button>
            <button
              type="button"
              onClick={closeLinkEditor}
              className="vi-button-secondary min-h-8 px-3 py-1 text-xs"
            >
              {t("common.cancel")}
            </button>
          </div>
        )}
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

function normalizeLinkUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const candidate = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)
    ? `mailto:${trimmed}`
    : /^[a-z][a-z\d+.-]*:/i.test(trimmed)
      ? trimmed
      : `https://${trimmed}`;

  try {
    const url = new URL(candidate);
    if (url.protocol !== "http:" && url.protocol !== "https:" && url.protocol !== "mailto:") {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}
