import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  ArrowLeft,
  Check,
  Clock,
  Edit2,
  GripHorizontal,
  Maximize2,
  Settings2,
  Trash2,
} from "lucide-react";
import {
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useEffect,
  useCallback,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import {
  useAnnotations,
  useCreateAnnotation,
  useDeleteAnnotation,
  useDeleteVideo,
  useUpdateAnnotation,
  useVideo,
} from "@/features/videos/hooks";
import { formatBytes, formatDate, formatDuration } from "@/lib/utils";
import type { Annotation } from "@/types";

export const Route = createFileRoute("/videos/$videoId")({
  component: VideoDetailPage,
});

type AnnotationFormValues = {
  timestamp_seconds: number;
  duration_seconds: number;
  position_x: number | null;
  position_y: number | null;
  region_x: number | null;
  region_y: number | null;
  region_width: number | null;
  region_height: number | null;
  shape: string;
  display_mode: string;
  interactive: boolean;
  title: string;
  body: string;
  kind: string;
  color: string;
  custom_data: Record<string, unknown>;
};

type AnnotationDraft = {
  timestamp_seconds: number;
  duration_seconds: number;
  position_x: number;
  position_y: number;
  region_width: number;
  region_height: number;
  shape: string;
  display_mode: string;
  interactive: boolean;
};

type AnnotationEditorValues = {
  timestamp_seconds: number;
  duration_seconds: string;
  position: EditorPosition;
  size: EditorSize;
  title: string;
  body: string;
  kind: string;
  color: string;
  shape: string;
  display_mode: string;
  interactive: boolean;
  animation: string;
  custom_data: string;
};

type AnnotationOverlayItem = {
  id: string;
  timestamp_seconds: number;
  duration_seconds: number;
  position_x: number | null;
  position_y: number | null;
  region_x: number | null;
  region_y: number | null;
  region_width: number | null;
  region_height: number | null;
  title: string;
  body: string;
  kind: string;
  color: string;
  shape: string;
  display_mode: string;
  interactive: boolean;
  isPreview?: boolean;
};

type AnnotationVisualItem = {
  timestamp_seconds: number;
  position: EditorPosition;
  size: EditorSize;
  title: string;
  body: string;
  kind: string;
  color: string;
  shape: string;
  display_mode: string;
  interactive: boolean;
};

function VideoDetailPage() {
  const { t } = useTranslation();
  const { videoId } = Route.useParams();
  const navigate = useNavigate();
  const playerFrame = useRef<HTMLDivElement | null>(null);
  const videoElement = useRef<HTMLVideoElement | null>(null);
  const annotationForm = useRef<HTMLFormElement | null>(null);
  const lastPlaybackTimeRef = useRef(0);
  const { data: video, isLoading, isError } = useVideo(videoId);
  const { data: annotations = [] } = useAnnotations(videoId);
  const deleteVideo = useDeleteVideo();
  const updateAnnotation = useUpdateAnnotation(videoId);
  const [currentVideoTime, setCurrentVideoTime] = useState(0);
  const [draftAnnotation, setDraftAnnotation] = useState<AnnotationDraft | null>(
    null,
  );
  const [editingAnnotation, setEditingAnnotation] = useState<Annotation | null>(
    null,
  );
  const [editorValues, setEditorValues] = useState<AnnotationEditorValues | null>(
    null,
  );
  const activeAnnotations = annotations.filter((annotation) =>
    isAnnotationActive(annotation, currentVideoTime),
  );
  const overlayAnnotations = activeAnnotations.filter(
    (annotation) => annotation.id !== editingAnnotation?.id,
  );

  const handleDeleteVideo = () => {
    deleteVideo.mutate(videoId, {
      onSuccess: () => navigate({ to: "/videos" }),
    });
  };

  const seekTo = (seconds: number) => {
    if (!videoElement.current) return;
    videoElement.current.currentTime = seconds;
    videoElement.current.play();
  };

  const clearAnnotationComposer = useCallback(() => {
    setDraftAnnotation(null);
    setEditingAnnotation(null);
    setEditorValues(null);
  }, []);

  const startEditingAnnotation = (annotation: Annotation) => {
    const element = videoElement.current;
    if (element) {
      element.currentTime = annotation.timestamp_seconds;
      element.pause();
    }
    setCurrentVideoTime(annotation.timestamp_seconds);
    setDraftAnnotation(null);
    setEditingAnnotation(annotation);
    setEditorValues(getEditorValuesFromAnnotation(annotation));
  };

  const selectOverlayAnnotation = (annotation: AnnotationOverlayItem) => {
    if (annotation.isPreview) return;
    const savedAnnotation = annotations.find((item) => item.id === annotation.id);
    if (savedAnnotation) startEditingAnnotation(savedAnnotation);
  };

  const moveOverlayAnnotation = (annotation: AnnotationOverlayItem, position: EditorPosition) => {
    if (annotation.isPreview) return;
    const savedAnnotation = annotations.find((item) => item.id === annotation.id);
    if (!savedAnnotation) return;
    updateAnnotation.mutate({
      id: savedAnnotation.id,
      values: {
        position_x: position.x,
        position_y: position.y,
        region_x: position.x,
        region_y: position.y,
      },
    });
  };

  const beginAnnotationAtPoint = (event: ReactMouseEvent<HTMLButtonElement>) => {
    const element = videoElement.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    const positionX = clampUnit((event.clientX - rect.left) / rect.width);
    const positionY = clampUnit((event.clientY - rect.top) / rect.height);
    const timestamp = toFiniteTime(element.currentTime);
    element.pause();
    setCurrentVideoTime(timestamp);
    setEditingAnnotation(null);
    const draft = {
      timestamp_seconds: timestamp,
      duration_seconds: 6,
      position_x: positionX,
      position_y: positionY,
      region_width: 0.34,
      region_height: 0.28,
      shape: "marker",
      display_mode: "card",
      interactive: true,
    };
    setDraftAnnotation(draft);
    setEditorValues(getEditorValuesFromDraft(draft));
  };

  const updateVideoTiming = () => {
    const element = videoElement.current;
    if (!element) return;
    const time = toFiniteTime(element.currentTime);
    lastPlaybackTimeRef.current = time;
    setCurrentVideoTime(time);
  };

  const restoreVideoTime = () => {
    const element = videoElement.current;
    if (!element) return;
    if (lastPlaybackTimeRef.current > 0) {
      element.currentTime = lastPlaybackTimeRef.current;
      setCurrentVideoTime(lastPlaybackTimeRef.current);
    } else {
      setCurrentVideoTime(toFiniteTime(element.currentTime));
    }
  };

  if (isLoading) return <p className="text-[var(--muted)]">{t("common.loading")}</p>;
  if (isError || !video)
    return <p className="text-[var(--danger)]">{t("videoDetail.notFound")}</p>;

  return (
    <div className="mx-auto max-w-7xl space-y-8">
      <Link
        to="/videos"
        className="inline-flex items-center gap-1 text-sm text-[var(--muted)] hover:text-[var(--ink)]"
      >
        <ArrowLeft className="h-4 w-4" />
        {t("videoDetail.back")}
      </Link>

      <div className="flex flex-wrap items-end justify-between gap-6 border-b border-[var(--ink)] pb-8">
        <div>
          <p className="vi-kicker">{t("videoDetail.kicker")}</p>
          <h1 className="vi-display mt-3 max-w-4xl text-5xl">{video.title}</h1>
          <p className="mt-4 max-w-3xl text-sm text-[var(--muted)]">
            {video.description ?? t("common.noDescription")}
          </p>
        </div>
        <button
          type="button"
          onClick={handleDeleteVideo}
          disabled={deleteVideo.isPending}
          className="vi-button-danger disabled:opacity-60"
        >
          <Trash2 className="h-4 w-4" />
          {t("videoDetail.deleteVideo")}
        </button>
      </div>

      <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_400px]">
        <section className="space-y-5">
          <div
            ref={playerFrame}
            className="relative overflow-hidden rounded-lg border border-[var(--rule)] bg-[#0f0e0c]"
          >
            {video.playback_url ? (
              <>
                <video
                  ref={videoElement}
                  src={video.playback_url}
                  controls
                  onDurationChange={restoreVideoTime}
                  onLoadedMetadata={restoreVideoTime}
                  onTimeUpdate={updateVideoTiming}
                  className="aspect-video w-full bg-[#0f0e0c]"
                />
                {!draftAnnotation && !editingAnnotation && (
                  <button
                    type="button"
                    onClick={beginAnnotationAtPoint}
                    className="absolute inset-x-0 top-0 bottom-14 z-[9] cursor-crosshair bg-transparent"
                    aria-label={t("videoDetail.annotations.addAtPoint")}
                    title={t("videoDetail.annotations.addAtPoint")}
                  />
                )}
                {editorValues && (
                  <button
                    type="button"
                    onPointerDown={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      videoElement.current?.pause();
                    }}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      annotationForm.current?.requestSubmit();
                    }}
                    className="absolute inset-0 z-20 cursor-default bg-transparent"
                    aria-label={t("videoDetail.form.submitEdit")}
                  />
                )}
                <AnnotationOverlay
                  containerRef={playerFrame}
                  videoRef={videoElement}
                  annotations={overlayAnnotations}
                  onSelect={selectOverlayAnnotation}
                  onMove={moveOverlayAnnotation}
                />
                {editorValues && (
                  <VisualAnnotationEditor
                    key={editingAnnotation?.id ?? getDraftKey(draftAnnotation)}
                    containerRef={playerFrame}
                    videoRef={videoElement}
                    values={editorValues}
                    onChange={setEditorValues}
                  />
                )}
              </>
            ) : (
              <div className="flex aspect-video items-center justify-center text-sm text-[var(--paper)]">
                {t("videoDetail.videoUnavailable")}
              </div>
            )}
          </div>

          <dl className="vi-panel grid gap-0 overflow-hidden text-sm sm:grid-cols-3">
            <div>
              <div className="border-b border-[var(--rule)] p-4 sm:border-r sm:border-b-0">
                <dt className="vi-kicker">{t("videoDetail.file")}</dt>
                <dd className="mt-2 font-medium">{video.original_filename}</dd>
              </div>
            </div>
            <div>
              <div className="border-b border-[var(--rule)] p-4 sm:border-r sm:border-b-0">
                <dt className="vi-kicker">{t("videoDetail.size")}</dt>
                <dd className="vi-mono mt-2 text-xs">{formatBytes(video.size_bytes)}</dd>
              </div>
            </div>
            <div>
              <div className="p-4">
                <dt className="vi-kicker">{t("videoDetail.created")}</dt>
                <dd className="vi-mono mt-2 text-xs">{formatDate(video.created_at)}</dd>
              </div>
            </div>
          </dl>

          <AnnotationTimeline
            videoId={videoId}
            annotations={annotations}
            onSeek={seekTo}
            onEdit={startEditingAnnotation}
          />
        </section>

        <aside className="space-y-4 xl:sticky xl:top-6 xl:self-start">
          <AnnotationInspector
            formRef={annotationForm}
            videoId={videoId}
            editing={editingAnnotation}
            values={editorValues}
            onChange={setEditorValues}
            onDone={clearAnnotationComposer}
          />
        </aside>
      </div>
    </div>
  );
}

function translateKind(t: (key: string) => string, kind: string): string {
  const known = ["note", "question", "resource", "highlight"];
  if (known.includes(kind)) {
    return t(`videoDetail.form.kinds.${kind}`);
  }
  return kind;
}

function AnnotationTimeline({
  videoId,
  annotations,
  onSeek,
  onEdit,
}: {
  videoId: string;
  annotations: Annotation[];
  onSeek: (seconds: number) => void;
  onEdit: (annotation: Annotation) => void;
}) {
  const { t } = useTranslation();

  return (
    <section className="vi-panel p-4">
      <div className="flex items-baseline justify-between border-b border-[var(--rule)] pb-3">
        <h2 className="vi-display text-2xl">{t("videoDetail.annotations.title")}</h2>
        <span className="vi-mono text-xs text-[var(--muted)]">{annotations.length}</span>
      </div>
      {annotations.length === 0 ? (
        <p className="mt-4 rounded-lg border border-dashed border-[var(--rule-strong)] bg-[var(--surface)] p-6 text-center text-sm text-[var(--muted)]">
          {t("videoDetail.annotations.empty")}
        </p>
      ) : (
        <div className="mt-4 flex gap-3 overflow-x-auto pb-2">
          {annotations.map((annotation) => (
            <article
              key={annotation.id}
              className="min-w-[17rem] max-w-[22rem] rounded-lg border border-[var(--rule)] bg-[var(--paper)] p-3"
              style={{ borderTop: `3px solid ${annotation.color}` }}
            >
              <div className="flex items-start justify-between gap-2">
                <button
                  type="button"
                  onClick={() => onSeek(annotation.timestamp_seconds)}
                  className="inline-flex items-center gap-2 rounded-md border border-[var(--rule)] bg-[var(--surface)] px-2 py-1 text-sm font-semibold text-[var(--ink)] hover:border-[var(--ink)]"
                >
                  <Clock className="h-4 w-4" />
                  {formatDuration(annotation.timestamp_seconds)}
                </button>
                <button
                  type="button"
                  onClick={() => onEdit(annotation)}
                  className="vi-icon-button h-8 min-h-8 w-8"
                  aria-label={t("videoDetail.annotations.edit")}
                  title={t("videoDetail.annotations.edit")}
                >
                  <Edit2 className="h-4 w-4" />
                </button>
                <DeleteAnnotationButton
                  videoId={videoId}
                  annotationId={annotation.id}
                />
              </div>
              <div className="mt-3">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="vi-display text-lg">{annotation.title}</h3>
                  <span className="vi-kicker rounded border border-[var(--rule)] px-2 py-0.5">
                    {translateKind(t, annotation.kind)}
                  </span>
                </div>
                <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-sm text-[var(--ink)]">
                  {annotation.body}
                </p>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function AnnotationOverlay({
  containerRef,
  videoRef,
  annotations,
  onSelect,
  onMove,
}: {
  containerRef: RefObject<HTMLDivElement | null>;
  videoRef: RefObject<HTMLVideoElement | null>;
  annotations: AnnotationOverlayItem[];
  onSelect: (annotation: AnnotationOverlayItem) => void;
  onMove: (annotation: AnnotationOverlayItem, position: EditorPosition) => void;
}) {
  const { t } = useTranslation();
  if (annotations.length === 0) return null;
  const positionedAnnotations = annotations.filter(hasOverlayPosition);
  const stackedAnnotations = annotations.filter(
    (annotation) => !hasOverlayPosition(annotation),
  );

  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      {positionedAnnotations.map((annotation) => (
        <AnnotationVisualSurface
          key={annotation.id}
          item={getVisualItemFromOverlay(annotation)}
          draggable={annotation.interactive && !annotation.isPreview}
          onPointerDown={(event) =>
            startSavedAnnotationPointerAction({
              annotation,
              containerRef,
              event,
              initialPosition: {
                x: annotation.position_x,
                y: annotation.position_y,
              },
              onClick: onSelect,
              onMove,
              videoRef,
            })
          }
          t={t}
        />
      ))}

      {stackedAnnotations.length > 0 && (
        <div className="absolute inset-x-4 bottom-16 space-y-2">
          {stackedAnnotations.slice(0, 3).map((annotation) => (
            <AnnotationOverlayCard
              key={annotation.id}
              annotation={annotation}
              onSelect={onSelect}
              t={t}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function AnnotationOverlayCard({
  annotation,
  onSelect,
  t,
}: {
  annotation: AnnotationOverlayItem;
  onSelect: (annotation: AnnotationOverlayItem) => void;
  t: (key: string) => string;
}) {
  const className = [
    "max-w-2xl rounded-lg border bg-[#1c1a17]/90 p-3 text-left text-[var(--paper)] shadow-lg",
    annotation.isPreview ? "border-dashed" : "",
    annotation.interactive && !annotation.isPreview
      ? "pointer-events-auto cursor-pointer hover:bg-[#25211d]/95"
      : "",
  ].join(" ");
  const content = (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <span
          className="h-2.5 w-2.5 rounded-full"
          style={{ backgroundColor: annotation.color }}
        />
        <span className="vi-kicker text-[rgba(250,247,242,0.72)]">
          {translateKind(t, annotation.kind)}
        </span>
        <span className="vi-mono text-xs text-[rgba(250,247,242,0.62)]">
          {formatDuration(annotation.timestamp_seconds)}
        </span>
      </div>
      <h3 className="vi-display mt-1 text-lg leading-tight">
        {annotation.title || t("videoDetail.form.newTitle")}
      </h3>
      {annotation.body && (
        <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-sm leading-relaxed text-[rgba(250,247,242,0.88)]">
          {annotation.body}
        </p>
      )}
    </>
  );

  if (annotation.interactive && !annotation.isPreview) {
    return (
      <button
        type="button"
        onClick={() => onSelect(annotation)}
        className={className}
        style={{ borderColor: annotation.color }}
      >
        {content}
      </button>
    );
  }

  return (
    <div
      className={className}
      style={{ borderColor: annotation.color }}
    >
      {content}
    </div>
  );
}

function AnnotationVisualSurface({
  item,
  draggable,
  editable = false,
  onBodyChange,
  onPointerDown,
  onResizePointerDown,
  onTitleChange,
  t,
}: {
  item: AnnotationVisualItem;
  draggable: boolean;
  editable?: boolean;
  onBodyChange?: (body: string) => void;
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  onResizePointerDown?: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onTitleChange?: (title: string) => void;
  t: (key: string) => string;
}) {
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (!editable) return;
    titleInputRef.current?.focus();
  }, [editable]);

  const className = [
    "group pointer-events-auto absolute rounded-lg border bg-[#1c1a17]/90 p-3 text-left text-[var(--paper)] shadow-2xl",
    editable ? "z-30" : "z-10",
    draggable ? "cursor-move hover:bg-[#25211d]/95" : "",
  ].join(" ");
  const content = (
    <>
      <div className="mb-1 flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <GripHorizontal className="h-4 w-4 shrink-0 text-[rgba(250,247,242,0.62)]" />
            <span
              className={getInlineMarkerClassName(item.shape)}
              style={{ backgroundColor: item.color }}
            />
            <span className="vi-kicker text-[rgba(250,247,242,0.72)]">
              {translateKind(t, item.kind)}
            </span>
            <span className="vi-mono text-xs text-[rgba(250,247,242,0.62)]">
              {formatDuration(item.timestamp_seconds)}
            </span>
          </div>
          {editable ? (
            <input
              ref={titleInputRef}
              value={item.title}
              onPointerDown={(event) => event.stopPropagation()}
              onChange={(event) => onTitleChange?.(event.target.value)}
              placeholder={t("videoDetail.form.title")}
              className="vi-display mt-1 w-full bg-transparent text-lg leading-tight text-[var(--paper)] outline-none placeholder:text-[rgba(250,247,242,0.45)]"
            />
          ) : (
            <h3 className="vi-display mt-1 text-lg leading-tight">
              {item.title || t("videoDetail.form.newTitle")}
            </h3>
          )}
        </div>
      </div>

      {editable ? (
        <textarea
          value={item.body}
          onPointerDown={(event) => event.stopPropagation()}
          onChange={(event) => onBodyChange?.(event.target.value)}
          rows={getBodyRows(item.body)}
          placeholder={t("videoDetail.form.body")}
          className="mt-1 line-clamp-3 w-full resize-none overflow-hidden border-0 bg-transparent p-0 text-sm leading-relaxed text-[rgba(250,247,242,0.88)] outline-none placeholder:text-[rgba(250,247,242,0.45)]"
        />
      ) : (
        item.body &&
        item.display_mode !== "marker" && (
          <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-sm leading-relaxed text-[rgba(250,247,242,0.88)]">
            {item.body}
          </p>
        )
      )}

      {editable && onResizePointerDown && (
        <button
          type="button"
          onPointerDown={onResizePointerDown}
          className="absolute right-1 bottom-1 rounded bg-white/10 p-1 text-[var(--paper)] opacity-0 transition-opacity hover:bg-white/20 focus:opacity-100 group-hover:opacity-100"
          aria-label={t("videoDetail.form.resize")}
          title={t("videoDetail.form.resize")}
        >
          <Maximize2 className="h-3.5 w-3.5" />
        </button>
      )}
    </>
  );

  if (editable) {
    return (
      <div
        className={className}
        onPointerDown={onPointerDown}
        style={getVisualSurfaceStyle(item)}
      >
        {content}
      </div>
    );
  }

  return (
    <button
      type="button"
      className={className}
      onPointerDown={onPointerDown}
      style={getVisualSurfaceStyle(item)}
    >
      {content}
    </button>
  );
}

function hasOverlayPosition(
  annotation: AnnotationOverlayItem,
): annotation is AnnotationOverlayItem & { position_x: number; position_y: number } {
  return typeof annotation.position_x === "number" && typeof annotation.position_y === "number";
}

function getInlineMarkerClassName(shape: string) {
  if (shape === "spotlight") return "h-4 w-4 rounded-full ring-4 ring-white/35";
  if (shape === "region") return "h-3 w-3 rounded-sm";
  return "h-2.5 w-2.5 rounded-full";
}

function getBodyRows(body: string) {
  if (!body) return 1;
  return clampInteger(body.split("\n").length, 1, 3);
}

function clampInteger(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function isAnnotationActive(annotation: Annotation, currentTime: number) {
  const startsAt = annotation.timestamp_seconds;
  const endsAt = startsAt + getAnnotationDuration(annotation);
  return currentTime >= startsAt && currentTime <= endsAt;
}

function getAnnotationDuration(annotation: Annotation) {
  const customDuration = annotation.duration_seconds;
  return typeof customDuration === "number" && customDuration > 0
    ? customDuration
    : 6;
}

function getVisualItemFromOverlay(annotation: AnnotationOverlayItem): AnnotationVisualItem {
  return {
    timestamp_seconds: annotation.timestamp_seconds,
    position: {
      x: annotation.position_x ?? 0.5,
      y: annotation.position_y ?? 0.5,
    },
    size: {
      width: annotation.region_width ?? 0.34,
      height: annotation.region_height ?? 0.28,
    },
    title: annotation.title,
    body: annotation.body,
    kind: annotation.kind,
    color: annotation.color,
    shape: annotation.shape,
    display_mode: annotation.display_mode,
    interactive: annotation.interactive,
  };
}

function getVisualItemFromEditor(values: AnnotationEditorValues): AnnotationVisualItem {
  return {
    timestamp_seconds: values.timestamp_seconds,
    position: values.position,
    size: values.size,
    title: values.title,
    body: values.body,
    kind: values.kind,
    color: values.color,
    shape: values.shape,
    display_mode: values.display_mode,
    interactive: values.interactive,
  };
}

function VisualAnnotationEditor({
  containerRef,
  videoRef,
  values,
  onChange,
}: {
  containerRef: RefObject<HTMLDivElement | null>;
  videoRef: RefObject<HTMLVideoElement | null>;
  values: AnnotationEditorValues;
  onChange: (values: AnnotationEditorValues) => void;
}) {
  const { t } = useTranslation();
  const updateValues = (patch: Partial<AnnotationEditorValues>) => {
    onChange({ ...values, ...patch });
  };

  return (
    <AnnotationVisualSurface
      item={getVisualItemFromEditor(values)}
      draggable
      editable
      onPointerDown={(event) =>
        startEditorDrag(event, containerRef, videoRef, values.position, (position) =>
          updateValues({ position }),
        )
      }
      onTitleChange={(title) => updateValues({ title })}
      onBodyChange={(body) => updateValues({ body })}
      onResizePointerDown={(event) =>
        startEditorResize(event, containerRef, values.size, (size) =>
          updateValues({ size }),
        )
      }
      t={t}
    />
  );
}

function AnnotationInspector({
  formRef,
  videoId,
  editing,
  values,
  onChange,
  onDone,
}: {
  formRef: RefObject<HTMLFormElement | null>;
  videoId: string;
  editing: Annotation | null;
  values: AnnotationEditorValues | null;
  onChange: (values: AnnotationEditorValues | null) => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const createAnnotation = useCreateAnnotation(videoId);
  const updateAnnotation = useUpdateAnnotation(videoId);
  const [jsonError, setJsonError] = useState<string | null>(null);
  const isPending = createAnnotation.isPending || updateAnnotation.isPending;

  const updateValues = (patch: Partial<AnnotationEditorValues>) => {
    if (!values) return;
    onChange({ ...values, ...patch });
  };

  if (!values) {
    return (
      <div className="vi-panel p-5">
        <p className="vi-kicker">{t("videoDetail.form.kicker")}</p>
        <h2 className="vi-display mt-2 text-2xl">
          {t("videoDetail.annotations.title")}
        </h2>
        <p className="mt-3 text-sm text-[var(--muted)]">
          {t("videoDetail.annotations.clickToEdit")}
        </p>
      </div>
    );
  }

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!values.title.trim() || !values.body.trim()) return;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(values.custom_data) as Record<string, unknown>;
      if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
        setJsonError(t("videoDetail.form.errorJsonObject"));
        return;
      }
      setJsonError(null);
    } catch {
      setJsonError(t("videoDetail.form.errorJsonInvalid"));
      return;
    }
    const customDataPayload =
      values.animation === "none" ? parsed : { ...parsed, animation: values.animation };

    const payload: AnnotationFormValues = {
      timestamp_seconds: values.timestamp_seconds,
      duration_seconds: toPositiveDuration(Number(values.duration_seconds)),
      position_x: values.position.x,
      position_y: values.position.y,
      region_x: values.position.x,
      region_y: values.position.y,
      region_width: values.size.width,
      region_height: values.size.height,
      shape: values.shape,
      display_mode: values.display_mode,
      interactive: values.interactive,
      title: values.title,
      body: values.body,
      kind: values.kind,
      color: values.color,
      custom_data: customDataPayload,
    };

    if (editing) {
      updateAnnotation.mutate(
        { id: editing.id, values: payload },
        { onSuccess: () => onDone() },
      );
      return;
    }
    createAnnotation.mutate(payload, {
      onSuccess: () => onDone(),
    });
  };

  return (
    <form
      ref={formRef}
      onSubmit={submit}
      className="vi-panel space-y-4 p-5"
    >
      <div>
        <p className="vi-kicker">{t("videoDetail.form.kicker")}</p>
        <h2 className="vi-display mt-1 text-2xl">
          {editing ? t("videoDetail.form.editTitle") : t("videoDetail.form.newTitle")}
        </h2>
        <p className="vi-mono mt-1 text-xs text-[var(--muted)]">
          {formatDuration(values.timestamp_seconds)}
        </p>
      </div>

      <div className="grid gap-3">
        <label className="vi-label">
          {t("videoDetail.form.type")}
          <select
            value={values.kind}
            onChange={(event) => updateValues({ kind: event.target.value })}
            className="vi-select mt-1 text-sm normal-case"
          >
            <option value="note">{t("videoDetail.form.kinds.note")}</option>
            <option value="question">{t("videoDetail.form.kinds.question")}</option>
            <option value="resource">{t("videoDetail.form.kinds.resource")}</option>
            <option value="highlight">{t("videoDetail.form.kinds.highlight")}</option>
          </select>
        </label>
        <label className="vi-label">
          {t("videoDetail.form.durationSeconds")}
          <input
            type="number"
            min="0.1"
            step="0.1"
            value={values.duration_seconds}
            onChange={(event) => updateValues({ duration_seconds: event.target.value })}
            onBlur={() =>
              updateValues({
                duration_seconds: toPositiveDuration(Number(values.duration_seconds)).toFixed(1),
              })
            }
            className="vi-input vi-mono mt-1 text-sm normal-case"
          />
        </label>
        <label className="vi-label">
          {t("videoDetail.form.color")}
          <input
            type="color"
            value={values.color}
            onChange={(event) => updateValues({ color: event.target.value })}
            className="mt-2 h-10 w-full rounded-lg border border-[var(--rule-strong)] bg-[var(--surface)] p-1"
          />
        </label>
      </div>

      <div className="border-t border-[var(--rule)] pt-4">
        <div className="flex items-center gap-2">
          <Settings2 className="h-4 w-4" />
          <p className="vi-kicker">{t("videoDetail.form.advanced")}</p>
        </div>
        <div className="mt-3 grid gap-3">
          <label className="vi-label">
            {t("videoDetail.form.shape")}
            <select
              value={values.shape}
              onChange={(event) => updateValues({ shape: event.target.value })}
              className="vi-select mt-1 text-sm normal-case"
            >
              <option value="marker">{t("videoDetail.form.shapes.marker")}</option>
              <option value="spotlight">{t("videoDetail.form.shapes.spotlight")}</option>
              <option value="region">{t("videoDetail.form.shapes.region")}</option>
            </select>
          </label>
          <label className="vi-label">
            {t("videoDetail.form.displayMode")}
            <select
              value={values.display_mode}
              onChange={(event) => updateValues({ display_mode: event.target.value })}
              className="vi-select mt-1 text-sm normal-case"
            >
              <option value="card">{t("videoDetail.form.displayModes.card")}</option>
              <option value="marker">{t("videoDetail.form.displayModes.marker")}</option>
            </select>
          </label>
          <label className="vi-label">
            {t("videoDetail.form.animation")}
            <select
              value={values.animation}
              onChange={(event) => updateValues({ animation: event.target.value })}
              className="vi-select mt-1 text-sm normal-case"
            >
              <option value="none">{t("videoDetail.form.animations.none")}</option>
              <option value="fade">{t("videoDetail.form.animations.fade")}</option>
              <option value="slide">{t("videoDetail.form.animations.slide")}</option>
              <option value="pulse">{t("videoDetail.form.animations.pulse")}</option>
            </select>
          </label>
          <label className="vi-label flex flex-row items-center gap-2">
            <input
              type="checkbox"
              checked={values.interactive}
              onChange={(event) => updateValues({ interactive: event.target.checked })}
              className="h-4 w-4 accent-[var(--accent)]"
            />
            {t("videoDetail.form.interactive")}
          </label>
        </div>

        <label className="vi-label mt-3 block">
          {t("videoDetail.form.customJson")}
          <textarea
            value={values.custom_data}
            onChange={(event) => updateValues({ custom_data: event.target.value })}
            rows={3}
            className="vi-textarea vi-mono mt-1 text-xs normal-case"
          />
        </label>
      </div>

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={!values.title || !values.body || isPending}
          className="vi-button-primary disabled:opacity-50"
        >
          <Check className="h-4 w-4" />
          {isPending
            ? t("common.saving")
            : editing
              ? t("videoDetail.form.submitEdit")
              : t("videoDetail.form.submitNew")}
        </button>
        <button
          type="button"
          onClick={onDone}
          className="vi-button-secondary"
        >
          {t("common.cancel")}
        </button>
      </div>
      {jsonError && <p className="text-sm text-[var(--danger)]">{jsonError}</p>}
      {(createAnnotation.isError || updateAnnotation.isError) && (
        <p className="text-sm text-[var(--danger)]">{t("videoDetail.form.errorSave")}</p>
      )}
    </form>
  );
}

function toFiniteTime(value: number) {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function toPositiveDuration(value: number) {
  return Number.isFinite(value) && value > 0 ? value : 6;
}

function getEditorValuesFromAnnotation(annotation: Annotation): AnnotationEditorValues {
  return {
    timestamp_seconds: annotation.timestamp_seconds,
    duration_seconds: annotation.duration_seconds.toString(),
    position: {
      x: annotation.position_x ?? 0.5,
      y: annotation.position_y ?? 0.5,
    },
    size: getInitialEditorSize(annotation, null),
    title: annotation.title,
    body: annotation.body,
    kind: annotation.kind,
    color: annotation.color,
    shape: annotation.shape,
    display_mode: annotation.display_mode,
    interactive: annotation.interactive,
    animation: getCustomString(annotation.custom_data.animation, "none"),
    custom_data: JSON.stringify(annotation.custom_data, null, 2),
  };
}

function getEditorValuesFromDraft(draft: AnnotationDraft): AnnotationEditorValues {
  return {
    timestamp_seconds: draft.timestamp_seconds,
    duration_seconds: draft.duration_seconds.toString(),
    position: {
      x: draft.position_x,
      y: draft.position_y,
    },
    size: getInitialEditorSize(null, draft),
    title: "",
    body: "",
    kind: "note",
    color: "#C0512F",
    shape: draft.shape,
    display_mode: draft.display_mode,
    interactive: draft.interactive,
    animation: "none",
    custom_data: "{}",
  };
}

function clampUnit(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(value, 0), 1);
}

type EditorPosition = {
  x: number;
  y: number;
};

type EditorSize = {
  width: number;
  height: number;
};

function getVisualSurfaceStyle(
  item: Pick<AnnotationVisualItem, "color" | "position" | "size">,
): CSSProperties {
  return {
    left: `${item.position.x * 100}%`,
    top: `${item.position.y * 100}%`,
    width: `clamp(17rem, ${item.size.width * 100}%, 30rem)`,
    minHeight: `${Math.max(item.size.height * 100, 18)}%`,
    borderColor: item.color,
    transform: "translateX(-50%)",
  };
}

function getInitialEditorSize(
  editing: Annotation | null,
  draft: AnnotationDraft | null,
): EditorSize {
  return {
    width: clampUnit(editing?.region_width ?? draft?.region_width ?? 0.34),
    height: clampUnit(editing?.region_height ?? draft?.region_height ?? 0.28),
  };
}

function getCustomString(value: unknown, fallback: string) {
  return typeof value === "string" && value ? value : fallback;
}

function getFrameRect(containerRef: RefObject<HTMLDivElement | null>) {
  return containerRef.current?.getBoundingClientRect() ?? null;
}

function startEditorDrag(
  event: ReactPointerEvent,
  containerRef: RefObject<HTMLDivElement | null>,
  videoRef: RefObject<HTMLVideoElement | null>,
  initialPosition: EditorPosition,
  setPosition: (position: EditorPosition) => void,
) {
  if (event.button !== 0) return;
  const rect = getFrameRect(containerRef);
  if (!rect) return;
  videoRef.current?.pause();
  event.preventDefault();
  event.currentTarget.setPointerCapture(event.pointerId);
  const startX = event.clientX;
  const startY = event.clientY;

  const onPointerMove = (moveEvent: PointerEvent) => {
    setPosition({
      x: clampUnit(initialPosition.x + (moveEvent.clientX - startX) / rect.width),
      y: clampUnit(initialPosition.y + (moveEvent.clientY - startY) / rect.height),
    });
  };
  const onPointerUp = () => {
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
  };
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
}

function startSavedAnnotationPointerAction({
  annotation,
  containerRef,
  event,
  initialPosition,
  onClick,
  onMove,
  videoRef,
}: {
  annotation: AnnotationOverlayItem;
  containerRef: RefObject<HTMLDivElement | null>;
  event: ReactPointerEvent<HTMLElement>;
  initialPosition: EditorPosition;
  onClick: (annotation: AnnotationOverlayItem) => void;
  onMove: (annotation: AnnotationOverlayItem, position: EditorPosition) => void;
  videoRef: RefObject<HTMLVideoElement | null>;
}) {
  if (event.button !== 0) return;
  const rect = getFrameRect(containerRef);
  if (!rect) return;
  videoRef.current?.pause();
  event.preventDefault();
  event.currentTarget.setPointerCapture(event.pointerId);
  const element = event.currentTarget;
  const startX = event.clientX;
  const startY = event.clientY;
  let latestPosition = initialPosition;
  let moved = false;

  const onPointerMove = (moveEvent: PointerEvent) => {
    const deltaX = moveEvent.clientX - startX;
    const deltaY = moveEvent.clientY - startY;
    if (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3) moved = true;
    latestPosition = {
      x: clampUnit(initialPosition.x + deltaX / rect.width),
      y: clampUnit(initialPosition.y + deltaY / rect.height),
    };
    element.style.left = `${latestPosition.x * 100}%`;
    element.style.top = `${latestPosition.y * 100}%`;
  };
  const onPointerUp = () => {
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    if (moved) {
      onMove(annotation, latestPosition);
      return;
    }
    onClick(annotation);
  };
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
}

function startEditorResize(
  event: ReactPointerEvent,
  containerRef: RefObject<HTMLDivElement | null>,
  initialSize: EditorSize,
  setSize: (size: EditorSize) => void,
) {
  if (event.button !== 0) return;
  const rect = getFrameRect(containerRef);
  if (!rect) return;
  event.preventDefault();
  event.stopPropagation();
  event.currentTarget.setPointerCapture(event.pointerId);
  const startX = event.clientX;
  const startY = event.clientY;

  const onPointerMove = (moveEvent: PointerEvent) => {
    setSize({
      width: clampRange(initialSize.width + (moveEvent.clientX - startX) / rect.width, 0.22, 0.72),
      height: clampRange(initialSize.height + (moveEvent.clientY - startY) / rect.height, 0.16, 0.7),
    });
  };
  const onPointerUp = () => {
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
  };
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
}

function clampRange(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}

function getDraftKey(draft: AnnotationDraft | null) {
  if (!draft) return "new";
  return [
    "draft",
    draft.timestamp_seconds.toFixed(1),
    draft.position_x.toFixed(3),
    draft.position_y.toFixed(3),
  ].join("-");
}

function DeleteAnnotationButton({
  videoId,
  annotationId,
}: {
  videoId: string;
  annotationId: string;
}) {
  const { t } = useTranslation();
  const deleteAnnotation = useDeleteAnnotation(videoId);
  return (
    <button
      type="button"
      onClick={() => deleteAnnotation.mutate(annotationId)}
      disabled={deleteAnnotation.isPending}
      className="vi-icon-button h-8 min-h-8 w-8 border-[rgba(159,47,36,0.35)] text-[var(--danger)] hover:bg-[rgba(159,47,36,0.07)] disabled:opacity-60"
      aria-label={t("videoDetail.annotations.delete")}
      title={t("videoDetail.annotations.delete")}
    >
      <Trash2 className="h-4 w-4" />
    </button>
  );
}
