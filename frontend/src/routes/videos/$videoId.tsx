import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  ArrowLeft,
  Check,
  Clock,
  Edit2,
  Maximize2,
  MessageSquare,
  Minimize2,
  Pause,
  Play,
  Plus,
  Trash2,
} from "lucide-react";
import {
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
  useEffect,
  useMemo,
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
import { cn, formatBytes, formatDate, formatDuration } from "@/lib/utils";
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

type AnnotationEditorValues = {
  timestamp_seconds: number;
  duration_seconds: string;
  title: string;
  body: string;
  kind: string;
  color: string;
  custom_data: string;
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
  const [currentVideoTime, setCurrentVideoTime] = useState(0);
  const [durationSeconds, setDurationSeconds] = useState(0);
  const [hoveredAnnotationId, setHoveredAnnotationId] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [editingAnnotation, setEditingAnnotation] = useState<Annotation | null>(null);
  const [editorValues, setEditorValues] = useState<AnnotationEditorValues | null>(null);

  const sortedAnnotations = useMemo(
    () =>
      [...annotations].sort(
        (first, second) =>
          first.timestamp_seconds - second.timestamp_seconds ||
          first.created_at.localeCompare(second.created_at),
      ),
    [annotations],
  );

  const activeAnnotationId =
    hoveredAnnotationId ??
    sortedAnnotations.find((annotation) => isAnnotationActive(annotation, currentVideoTime))?.id ??
    null;

  useEffect(() => {
    const syncFullscreenState = () => {
      setIsFullscreen(document.fullscreenElement === playerFrame.current);
    };
    document.addEventListener("fullscreenchange", syncFullscreenState);
    return () => document.removeEventListener("fullscreenchange", syncFullscreenState);
  }, []);

  const handleDeleteVideo = () => {
    deleteVideo.mutate(videoId, {
      onSuccess: () => navigate({ to: "/videos" }),
    });
  };

  const seekTo = (seconds: number, shouldPlay = true) => {
    const element = videoElement.current;
    if (!element) return;
    element.currentTime = seconds;
    setCurrentVideoTime(seconds);
    if (shouldPlay) void element.play();
  };

  const clearAnnotationComposer = () => {
    setEditingAnnotation(null);
    setEditorValues(null);
  };

  const beginAnnotationAtCurrentTime = () => {
    const timestamp = getCurrentPlayerTime(videoElement.current, currentVideoTime);
    videoElement.current?.pause();
    setCurrentVideoTime(timestamp);
    setEditingAnnotation(null);
    setEditorValues(getEditorValuesFromTimestamp(timestamp));
  };

  const startEditingAnnotation = (annotation: Annotation) => {
    videoElement.current?.pause();
    seekTo(annotation.timestamp_seconds, false);
    setEditingAnnotation(annotation);
    setEditorValues(getEditorValuesFromAnnotation(annotation));
  };

  const togglePlayback = () => {
    const element = videoElement.current;
    if (!element) return;
    if (element.paused) {
      void element.play();
      return;
    }
    element.pause();
  };

  const toggleFullscreen = () => {
    if (document.fullscreenElement === playerFrame.current) {
      void document.exitFullscreen();
      return;
    }
    void playerFrame.current?.requestFullscreen?.();
  };

  const updateVideoTiming = () => {
    const element = videoElement.current;
    if (!element) return;
    const time = toFiniteTime(element.currentTime);
    if (time > 0) lastPlaybackTimeRef.current = time;
    setCurrentVideoTime(time);
  };

  const syncVideoMetadata = () => {
    const element = videoElement.current;
    if (!element) return;
    setDurationSeconds(toFiniteTime(element.duration));
    setCurrentVideoTime(toFiniteTime(element.currentTime));
  };

  const restoreVideoTime = () => {
    const element = videoElement.current;
    if (!element) return;
    setDurationSeconds(toFiniteTime(element.duration));
    if (lastPlaybackTimeRef.current > 0) {
      element.currentTime = lastPlaybackTimeRef.current;
      setCurrentVideoTime(lastPlaybackTimeRef.current);
      return;
    }
    setCurrentVideoTime(toFiniteTime(element.currentTime));
  };

  if (isLoading) return <p className="text-[var(--muted)]">{t("common.loading")}</p>;
  if (isError || !video) return <p className="text-[var(--danger)]">{t("videoDetail.notFound")}</p>;

  return (
    <div className="mx-auto max-w-[96rem] space-y-8">
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

      <div className="grid gap-6 2xl:grid-cols-[minmax(0,1fr)_380px] xl:grid-cols-[minmax(0,1fr)_360px]">
        <section className="space-y-5">
          <div
            ref={playerFrame}
            className="group relative overflow-hidden rounded-lg border border-[var(--rule)] bg-[#0f0e0c] fullscreen:flex fullscreen:h-screen fullscreen:w-screen fullscreen:items-center fullscreen:justify-center fullscreen:rounded-none fullscreen:border-0"
          >
            {video.playback_url ? (
              <>
                <video
                  ref={videoElement}
                  src={video.playback_url}
                  controls={false}
                  onDurationChange={syncVideoMetadata}
                  onEnded={() => setIsPlaying(false)}
                  onLoadedMetadata={restoreVideoTime}
                  onPause={() => setIsPlaying(false)}
                  onPlay={() => setIsPlaying(true)}
                  onTimeUpdate={updateVideoTiming}
                  onClick={togglePlayback}
                  className="aspect-video w-full cursor-pointer bg-[#0f0e0c] fullscreen:max-h-screen fullscreen:w-full fullscreen:object-contain"
                />
                <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/42 to-transparent px-4 pt-16 pb-4 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100">
                  <VideoControls
                    annotations={sortedAnnotations}
                    currentTime={currentVideoTime}
                    duration={durationSeconds}
                    hoveredAnnotationId={hoveredAnnotationId}
                    isFullscreen={isFullscreen}
                    isPlaying={isPlaying}
                    onFullscreen={toggleFullscreen}
                    onHoverAnnotation={setHoveredAnnotationId}
                    onSeek={seekTo}
                    onTogglePlayback={togglePlayback}
                  />
                </div>
              </>
            ) : (
              <div className="flex aspect-video items-center justify-center text-sm text-[var(--paper)]">
                {t("videoDetail.videoUnavailable")}
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="vi-mono text-xs text-[var(--muted)]">
              {formatDuration(currentVideoTime)} /{" "}
              {durationSeconds > 0 ? formatDuration(durationSeconds) : "--:--"}
            </div>
            <button
              type="button"
              onClick={beginAnnotationAtCurrentTime}
              disabled={!video.playback_url}
              className="vi-button-primary disabled:opacity-50"
            >
              <Plus className="h-4 w-4" />
              {t("videoDetail.annotations.addAtCurrentTime")}
            </button>
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
        </section>

        <aside className="xl:sticky xl:top-6 xl:self-start">
          <AnnotationLivePanel
            activeAnnotationId={activeAnnotationId}
            annotations={sortedAnnotations}
            currentTime={currentVideoTime}
            editing={editingAnnotation}
            formRef={annotationForm}
            onAdd={beginAnnotationAtCurrentTime}
            onCancel={clearAnnotationComposer}
            onEdit={startEditingAnnotation}
            onSeek={seekTo}
            setEditorValues={setEditorValues}
            values={editorValues}
            videoId={videoId}
          />
        </aside>
      </div>
    </div>
  );
}

function VideoControls({
  annotations,
  currentTime,
  duration,
  hoveredAnnotationId,
  isFullscreen,
  isPlaying,
  onFullscreen,
  onHoverAnnotation,
  onSeek,
  onTogglePlayback,
}: {
  annotations: Annotation[];
  currentTime: number;
  duration: number;
  hoveredAnnotationId: string | null;
  isFullscreen: boolean;
  isPlaying: boolean;
  onFullscreen: () => void;
  onHoverAnnotation: (annotationId: string | null) => void;
  onSeek: (seconds: number) => void;
  onTogglePlayback: () => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="pointer-events-auto space-y-3 text-[var(--paper)]">
      <AnnotationScrubber
        annotations={annotations}
        currentTime={currentTime}
        duration={duration}
        hoveredAnnotationId={hoveredAnnotationId}
        onHoverAnnotation={onHoverAnnotation}
        onSeek={onSeek}
      />
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={onTogglePlayback}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/16 text-[var(--paper)] transition-colors hover:bg-white/24"
            aria-label={isPlaying ? t("videoDetail.player.pause") : t("videoDetail.player.play")}
            title={isPlaying ? t("videoDetail.player.pause") : t("videoDetail.player.play")}
          >
            {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="ml-0.5 h-4 w-4" />}
          </button>
          <span className="vi-mono truncate text-xs text-white/78">
            {formatDuration(currentTime)} / {duration > 0 ? formatDuration(duration) : "--:--"}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <span className="vi-mono hidden text-xs text-white/62 sm:inline">
            {annotations.length} {t("videoDetail.annotations.title")}
          </span>
          <button
            type="button"
            onClick={onFullscreen}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-white/12 text-[var(--paper)] transition-colors hover:bg-white/22"
            aria-label={
              isFullscreen
                ? t("videoDetail.player.exitFullscreen")
                : t("videoDetail.player.fullscreen")
            }
            title={
              isFullscreen
                ? t("videoDetail.player.exitFullscreen")
                : t("videoDetail.player.fullscreen")
            }
          >
            {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}

function AnnotationScrubber({
  annotations,
  currentTime,
  duration,
  hoveredAnnotationId,
  onHoverAnnotation,
  onSeek,
}: {
  annotations: Annotation[];
  currentTime: number;
  duration: number;
  hoveredAnnotationId: string | null;
  onHoverAnnotation: (annotationId: string | null) => void;
  onSeek: (seconds: number) => void;
}) {
  const { t } = useTranslation();
  const hasDuration = duration > 0;
  const progressPercent = hasDuration ? clampRange((currentTime / duration) * 100, 0, 100) : 0;

  const handleSeek = (event: ReactMouseEvent<HTMLButtonElement>) => {
    if (!hasDuration) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = clampRange((event.clientX - rect.left) / rect.width, 0, 1);
    onSeek(ratio * duration);
  };

  return (
    <button
      type="button"
      onClick={handleSeek}
      disabled={!hasDuration}
      className="relative block h-7 w-full cursor-pointer rounded-full py-2 disabled:cursor-not-allowed"
      aria-label={t("videoDetail.annotations.timelineMask")}
    >
      <span className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-white/22" />
      <span
        className="absolute top-1/2 left-0 h-1 -translate-y-1/2 rounded-full bg-[var(--paper)]"
        style={{ width: `${progressPercent}%` }}
      />
      {hasDuration &&
        annotations.map((annotation) => {
          const left = clampRange((annotation.timestamp_seconds / duration) * 100, 0, 100);
          const width = Math.max((getAnnotationDuration(annotation) / duration) * 100, 0.45);
          const previewPositionClass =
            left > 78 ? "right-0" : left < 22 ? "left-0" : "left-1/2 -translate-x-1/2";
          return (
            <span
              key={annotation.id}
              className={cn(
                "group/marker absolute top-1/2 h-3.5 -translate-y-1/2 rounded-full opacity-95 ring-2 ring-black/30 transition-transform hover:scale-y-125",
                hoveredAnnotationId === annotation.id ? "scale-y-125" : "",
              )}
              style={{
                left: `${left}%`,
                width: `${Math.min(width, 100 - left)}%`,
                backgroundColor: annotation.color,
              }}
              onMouseEnter={() => onHoverAnnotation(annotation.id)}
              onMouseLeave={() => onHoverAnnotation(null)}
              onFocus={() => onHoverAnnotation(annotation.id)}
              onBlur={() => onHoverAnnotation(null)}
              title={`${formatDuration(annotation.timestamp_seconds)} ${annotation.title}`}
            >
              <span
                className={cn(
                  "pointer-events-none absolute bottom-6 z-20 hidden w-64 rounded-md border border-white/12 bg-[#171411]/95 p-3 text-left text-[var(--paper)] shadow-xl group-hover/marker:block",
                  hoveredAnnotationId === annotation.id ? "block" : "",
                  previewPositionClass,
                )}
              >
                <span className="vi-mono block text-xs text-white/58">
                  {formatDuration(annotation.timestamp_seconds)}
                </span>
                <span className="vi-display mt-1 block truncate text-lg">{annotation.title}</span>
                <span className="mt-1 line-clamp-2 block text-xs leading-relaxed text-white/78">
                  {annotation.body}
                </span>
              </span>
            </span>
          );
        })}
      <span
        className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border border-black/25 bg-[var(--paper)] shadow"
        style={{ left: `${progressPercent}%` }}
      />
    </button>
  );
}

function AnnotationLivePanel({
  activeAnnotationId,
  annotations,
  currentTime,
  editing,
  formRef,
  onAdd,
  onCancel,
  onEdit,
  onSeek,
  setEditorValues,
  values,
  videoId,
}: {
  activeAnnotationId: string | null;
  annotations: Annotation[];
  currentTime: number;
  editing: Annotation | null;
  formRef: RefObject<HTMLFormElement | null>;
  onAdd: () => void;
  onCancel: () => void;
  onEdit: (annotation: Annotation) => void;
  onSeek: (seconds: number) => void;
  setEditorValues: (values: AnnotationEditorValues | null) => void;
  values: AnnotationEditorValues | null;
  videoId: string;
}) {
  const { t } = useTranslation();
  const activeItemRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!activeAnnotationId) return;
    activeItemRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
    });
  }, [activeAnnotationId]);

  return (
    <section className="vi-panel flex h-[min(74vh,44rem)] min-h-[34rem] flex-col overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--rule)] p-4">
        <div>
          <p className="vi-kicker">{t("videoDetail.annotations.liveKicker")}</p>
          <h2 className="vi-display mt-1 text-2xl">{t("videoDetail.annotations.title")}</h2>
        </div>
        <button
          type="button"
          onClick={onAdd}
          className="vi-icon-button"
          aria-label={t("videoDetail.annotations.addAtCurrentTime")}
          title={t("videoDetail.annotations.addAtCurrentTime")}
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>

      {values && (
        <AnnotationComposer
          currentTime={currentTime}
          editing={editing}
          formRef={formRef}
          onCancel={onCancel}
          onChange={setEditorValues}
          values={values}
          videoId={videoId}
        />
      )}

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {annotations.length === 0 ? (
          <div className="rounded-lg border border-dashed border-[var(--rule-strong)] bg-[var(--paper)] p-6 text-center text-sm text-[var(--muted)]">
            <MessageSquare className="mx-auto mb-3 h-5 w-5" />
            {t("videoDetail.annotations.empty")}
          </div>
        ) : (
          <div className="space-y-3">
            {annotations.map((annotation) => (
              <AnnotationMessage
                key={annotation.id}
                refCallback={
                  annotation.id === activeAnnotationId
                    ? (element) => {
                        activeItemRef.current = element;
                      }
                    : undefined
                }
                annotation={annotation}
                isActive={annotation.id === activeAnnotationId}
                onEdit={onEdit}
                onSeek={onSeek}
                videoId={videoId}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function AnnotationMessage({
  annotation,
  isActive,
  onEdit,
  onSeek,
  refCallback,
  videoId,
}: {
  annotation: Annotation;
  isActive: boolean;
  onEdit: (annotation: Annotation) => void;
  onSeek: (seconds: number) => void;
  refCallback?: (element: HTMLElement | null) => void;
  videoId: string;
}) {
  const { t } = useTranslation();

  return (
    <article
      ref={refCallback}
      className={cn(
        "rounded-lg border bg-[var(--paper)] p-3 transition-colors",
        isActive
          ? "border-[var(--ink)] shadow-[0_0_0_3px_rgba(192,81,47,0.12)]"
          : "border-[var(--rule)]",
      )}
      style={{ borderLeft: `4px solid ${annotation.color}` }}
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
        <div className="flex shrink-0 gap-1">
          <button
            type="button"
            onClick={() => onEdit(annotation)}
            className="vi-icon-button h-8 min-h-8 w-8"
            aria-label={t("videoDetail.annotations.edit")}
            title={t("videoDetail.annotations.edit")}
          >
            <Edit2 className="h-4 w-4" />
          </button>
          <DeleteAnnotationButton annotationId={annotation.id} videoId={videoId} />
        </div>
      </div>
      <div className="mt-3">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="vi-display text-lg">
            {annotation.title || t("videoDetail.form.newTitle")}
          </h3>
          <span className="vi-kicker rounded border border-[var(--rule)] px-2 py-0.5">
            {translateKind(t, annotation.kind)}
          </span>
          {isActive && (
            <span className="vi-kicker rounded bg-[rgba(192,81,47,0.12)] px-2 py-0.5 text-[var(--accent)]">
              {t("videoDetail.annotations.activeNow")}
            </span>
          )}
        </div>
        <p className="mt-2 whitespace-pre-wrap text-sm text-[var(--ink)]">{annotation.body}</p>
      </div>
    </article>
  );
}

function AnnotationComposer({
  currentTime,
  editing,
  formRef,
  onCancel,
  onChange,
  values,
  videoId,
}: {
  currentTime: number;
  editing: Annotation | null;
  formRef: RefObject<HTMLFormElement | null>;
  onCancel: () => void;
  onChange: (values: AnnotationEditorValues | null) => void;
  values: AnnotationEditorValues;
  videoId: string;
}) {
  const { t } = useTranslation();
  const createAnnotation = useCreateAnnotation(videoId);
  const updateAnnotation = useUpdateAnnotation(videoId);
  const [jsonError, setJsonError] = useState<string | null>(null);
  const isPending = createAnnotation.isPending || updateAnnotation.isPending;

  const updateValues = (patch: Partial<AnnotationEditorValues>) => {
    onChange({ ...values, ...patch });
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!values.title.trim() || !values.body.trim()) return;

    let customData: Record<string, unknown>;
    try {
      customData = JSON.parse(values.custom_data) as Record<string, unknown>;
      if (!customData || Array.isArray(customData) || typeof customData !== "object") {
        setJsonError(t("videoDetail.form.errorJsonObject"));
        return;
      }
      setJsonError(null);
    } catch {
      setJsonError(t("videoDetail.form.errorJsonInvalid"));
      return;
    }

    const payload: AnnotationFormValues = {
      timestamp_seconds: toFiniteTime(values.timestamp_seconds),
      duration_seconds: toPositiveDuration(Number(values.duration_seconds)),
      position_x: null,
      position_y: null,
      region_x: null,
      region_y: null,
      region_width: null,
      region_height: null,
      shape: "marker",
      display_mode: "side-panel",
      interactive: true,
      title: values.title.trim(),
      body: values.body.trim(),
      kind: values.kind,
      color: values.color,
      custom_data: customData,
    };

    if (editing) {
      updateAnnotation.mutate({ id: editing.id, values: payload }, { onSuccess: onCancel });
      return;
    }
    createAnnotation.mutate(payload, { onSuccess: onCancel });
  };

  return (
    <form
      ref={formRef}
      onSubmit={submit}
      className="border-b border-[var(--rule)] bg-[var(--paper)] p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="vi-kicker">{t("videoDetail.form.kicker")}</p>
          <h3 className="vi-display mt-1 text-xl">
            {editing ? t("videoDetail.form.editTitle") : t("videoDetail.form.newTitle")}
          </h3>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="vi-button-secondary min-h-8 px-3 py-1 text-xs"
        >
          {t("common.cancel")}
        </button>
      </div>

      <div className="mt-4 grid gap-3">
        <label className="vi-label">
          {t("videoDetail.form.title")}
          <input
            value={values.title}
            onChange={(event) => updateValues({ title: event.target.value })}
            className="vi-input mt-1 text-sm normal-case"
          />
        </label>

        <label className="vi-label">
          {t("videoDetail.form.body")}
          <textarea
            value={values.body}
            onChange={(event) => updateValues({ body: event.target.value })}
            rows={4}
            className="vi-textarea mt-1 text-sm normal-case"
          />
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="vi-label">
            {t("videoDetail.form.timeSeconds")}
            <input
              type="number"
              min="0"
              step="0.1"
              value={values.timestamp_seconds}
              onChange={(event) =>
                updateValues({
                  timestamp_seconds: toFiniteTime(Number(event.target.value)),
                })
              }
              className="vi-input vi-mono mt-1 text-sm normal-case"
            />
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
        </div>

        <button
          type="button"
          onClick={() => updateValues({ timestamp_seconds: currentTime })}
          className="vi-button-secondary min-h-8 px-3 py-1 text-xs"
        >
          <Clock className="h-3.5 w-3.5" />
          {t("videoDetail.form.useCurrentTime", {
            time: formatDuration(currentTime),
          })}
        </button>

        <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
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
            {t("videoDetail.form.color")}
            <input
              type="color"
              value={values.color}
              onChange={(event) => updateValues({ color: event.target.value })}
              className="mt-2 h-10 w-14 rounded-lg border border-[var(--rule-strong)] bg-[var(--surface)] p-1"
            />
          </label>
        </div>
      </div>

      <div className="mt-4 flex gap-2">
        <button
          type="submit"
          disabled={!values.title.trim() || !values.body.trim() || isPending}
          className="vi-button-primary disabled:opacity-50"
        >
          <Check className="h-4 w-4" />
          {isPending
            ? t("common.saving")
            : editing
              ? t("videoDetail.form.submitEdit")
              : t("videoDetail.form.submitNew")}
        </button>
      </div>
      {jsonError && <p className="mt-3 text-sm text-[var(--danger)]">{jsonError}</p>}
      {(createAnnotation.isError || updateAnnotation.isError) && (
        <p className="mt-3 text-sm text-[var(--danger)]">{t("videoDetail.form.errorSave")}</p>
      )}
    </form>
  );
}

function DeleteAnnotationButton({
  annotationId,
  videoId,
}: {
  annotationId: string;
  videoId: string;
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

function translateKind(t: (key: string) => string, kind: string): string {
  const known = ["note", "question", "resource", "highlight"];
  if (known.includes(kind)) return t(`videoDetail.form.kinds.${kind}`);
  return kind;
}

function isAnnotationActive(annotation: Annotation, currentTime: number) {
  const startsAt = annotation.timestamp_seconds;
  const endsAt = startsAt + getAnnotationDuration(annotation);
  return currentTime >= startsAt && currentTime <= endsAt;
}

function getAnnotationDuration(annotation: Annotation) {
  return toPositiveDuration(annotation.duration_seconds);
}

function getEditorValuesFromAnnotation(annotation: Annotation): AnnotationEditorValues {
  return {
    timestamp_seconds: annotation.timestamp_seconds,
    duration_seconds: annotation.duration_seconds.toString(),
    title: annotation.title,
    body: annotation.body,
    kind: annotation.kind,
    color: annotation.color,
    custom_data: JSON.stringify(annotation.custom_data, null, 2),
  };
}

function getEditorValuesFromTimestamp(timestamp: number): AnnotationEditorValues {
  return {
    timestamp_seconds: timestamp,
    duration_seconds: "6",
    title: "",
    body: "",
    kind: "note",
    color: "#C0512F",
    custom_data: "{}",
  };
}

function getCurrentPlayerTime(element: HTMLVideoElement | null, fallback: number) {
  if (!element) return fallback;
  return toFiniteTime(element.currentTime);
}

function toFiniteTime(value: number) {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function toPositiveDuration(value: number) {
  return Number.isFinite(value) && value > 0 ? value : 6;
}

function clampRange(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}
