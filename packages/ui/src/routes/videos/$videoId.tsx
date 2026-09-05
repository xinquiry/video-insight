import { Link, createRoute, useNavigate } from "@tanstack/react-router";
import { rootRoute } from "../__root";
import {
  ArrowLeft,
  Check,
  Clock,
  Download,
  Edit2,
  HardDriveDownload,
  MessageSquare,
  Plus,
  Send,
  Trash2,
} from "lucide-react";
import { motion } from "motion/react";
import {
  type FormEvent,
  type RefObject,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import {
  useAnnotationComments,
  useAnnotations,
  useCreateAnnotation,
  useCreateAnnotationComment,
  useDeleteAnnotation,
  useDeleteVideo,
  useUpdateAnnotation,
  useVideo,
  useVideoExport,
} from "@/features/videos/hooks";
import { isRichTextEmpty, RichTextContent, RichTextEditor } from "@/components/RichTextEditor";
import {
  type PlaybackAnnotation,
  type PlaybackRate,
  VideoControls,
} from "@/components/player/VideoControls";
import { getErrorMessage } from "@/lib/errors";
import { cn, formatBytes, formatDate, formatDuration } from "@/lib/utils";
import { useHost, type CacheState, type PlayerAnnotation } from "@/platform/host";
import type { Annotation, RichTextDocument, RichTextNode } from "@/types";

export const videoDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/videos/$videoId",
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
  content: RichTextDocument;
  kind: string;
  color: string;
  custom_data: Record<string, unknown>;
};

type AnnotationEditorValues = {
  timestamp_seconds: number;
  duration_seconds: string;
  content: RichTextDocument;
  kind: string;
  color: string;
  custom_data: string;
};

type FullscreenTab = "preview" | "edit";

const surfaceMotion = {
  initial: { opacity: 0, y: 14 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.28, ease: "easeOut" },
} as const;

const KEYBOARD_SEEK_STEP_SECONDS = 5;
const ANNOTATION_COLORS = [
  { value: "#C0512F", labelKey: "terracotta" },
  { value: "#C28A2C", labelKey: "amber" },
  { value: "#2F5B4F", labelKey: "forest" },
  { value: "#3E6B89", labelKey: "ocean" },
  { value: "#735A8D", labelKey: "violet" },
  { value: "#A64D68", labelKey: "rose" },
] as const;

function VideoDetailPage() {
  const { t } = useTranslation();
  const { videoId } = videoDetailRoute.useParams();
  const navigate = useNavigate();
  const playerFrame = useRef<HTMLDivElement | null>(null);
  const fullscreenContainer = useRef<HTMLDivElement | null>(null);
  const videoElement = useRef<HTMLVideoElement | null>(null);
  const annotationForm = useRef<HTMLFormElement | null>(null);
  const lastPlaybackTimeRef = useRef(0);
  const currentVideoTimeRef = useRef(0);
  const durationSecondsRef = useRef(0);
  const shouldResumePlaybackRef = useRef(false);
  const { data: video, isLoading, isError } = useVideo(videoId);
  const { data: annotations = [] } = useAnnotations(videoId);
  const host = useHost();
  const canCache = Boolean(host.capabilities.cache && host.capabilities.auth);
  const [cacheState, setCacheState] = useState<CacheState | null>(null);
  const [caching, setCaching] = useState(false);
  const [cacheError, setCacheError] = useState<string | null>(null);

  useEffect(() => {
    if (!canCache || !video || video.processing_status !== "ready") return;
    let cancelled = false;
    void host.media?.cacheStatus(videoId).then((state) => {
      if (!cancelled) setCacheState(state);
    });
    return () => {
      cancelled = true;
    };
  }, [canCache, host, video, videoId]);

  const handleCache = async () => {
    if (!video?.playback_url) return;
    setCaching(true);
    setCacheError(null);
    try {
      await host.media?.cacheVideo(videoId, {
        downloadUrl: video.playback_url,
        displayName: video.title,
        annotations: annotations.map(toPlayerAnnotation),
      });
      setCacheState((await host.media?.cacheStatus(videoId)) ?? null);
    } catch (cause) {
      setCacheError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setCaching(false);
    }
  };
  const deleteVideo = useDeleteVideo();
  const exportVideo = useVideoExport();
  const [currentVideoTime, setCurrentVideoTime] = useState(0);
  const [durationSeconds, setDurationSeconds] = useState(0);
  const [hoveredAnnotationId, setHoveredAnnotationId] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackRate, setPlaybackRate] = useState<PlaybackRate>(1);
  const [editingAnnotation, setEditingAnnotation] = useState<Annotation | null>(null);
  const [editorValues, setEditorValues] = useState<AnnotationEditorValues | null>(null);
  const [isPlaybackExpanded, setIsPlaybackExpanded] = useState(false);
  const [fullscreenTab, setFullscreenTab] = useState<FullscreenTab>("preview");

  const sortedAnnotations = useMemo(
    () =>
      [...annotations].sort(
        (first, second) =>
          first.timestamp_seconds - second.timestamp_seconds ||
          first.created_at.localeCompare(second.created_at),
      ),
    [annotations],
  );

  const scrubberAnnotations = useMemo<PlaybackAnnotation[]>(
    () =>
      sortedAnnotations.map((annotation) => ({
        id: annotation.id,
        timestamp_seconds: annotation.timestamp_seconds,
        duration_seconds: toPositiveDuration(annotation.duration_seconds),
        color: annotation.color,
        preview: getRichTextPreview(annotation.content),
      })),
    [sortedAnnotations],
  );

  const activeAnnotationId =
    hoveredAnnotationId ??
    sortedAnnotations.find((annotation) => isAnnotationActive(annotation, currentVideoTime))?.id ??
    null;

  const currentPlaybackAnnotation = useMemo(() => {
    const currentThreshold = currentVideoTime + 0.12;
    for (let index = sortedAnnotations.length - 1; index >= 0; index -= 1) {
      const annotation = sortedAnnotations[index];
      if (!annotation) continue;
      if (annotation.timestamp_seconds <= currentThreshold) {
        return { annotation, index };
      }
    }
    return { annotation: null, index: -1 };
  }, [currentVideoTime, sortedAnnotations]);

  useEffect(() => {
    if (!isPlaybackExpanded) return undefined;

    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (isFullscreenActive()) void exitFullscreen();
      setIsPlaybackExpanded(false);
    };

    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", closeOnEscape);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [isPlaybackExpanded]);

  useEffect(() => {
    const syncFullscreenState = () => {
      if (isFullscreenActive()) return;
      setIsPlaybackExpanded(false);
      setFullscreenTab("preview");
    };

    document.addEventListener("fullscreenchange", syncFullscreenState);
    document.addEventListener("webkitfullscreenchange", syncFullscreenState);

    return () => {
      document.removeEventListener("fullscreenchange", syncFullscreenState);
      document.removeEventListener("webkitfullscreenchange", syncFullscreenState);
    };
  }, []);

  const handleDeleteVideo = () => {
    deleteVideo.mutate(videoId, {
      onSuccess: () => navigate({ to: "/videos" }),
    });
  };

  useEffect(() => {
    currentVideoTimeRef.current = currentVideoTime;
  }, [currentVideoTime]);

  useEffect(() => {
    durationSecondsRef.current = durationSeconds;
  }, [durationSeconds]);

  const seekTo = (seconds: number, shouldPlay = true) => {
    const element = videoElement.current;
    if (!element) return;
    element.currentTime = seconds;
    currentVideoTimeRef.current = seconds;
    setCurrentVideoTime(seconds);
    if (shouldPlay) requestVideoPlayback(element);
  };

  const seekByKeyboard = (deltaSeconds: number) => {
    const element = videoElement.current;
    if (!element) return;
    const fallbackDuration = toFiniteTime(element.duration);
    const maxTime = durationSecondsRef.current > 0 ? durationSecondsRef.current : fallbackDuration;
    const currentTime = getCurrentPlayerTime(element, currentVideoTimeRef.current);
    const nextTime =
      maxTime > 0
        ? clampRange(currentTime + deltaSeconds, 0, maxTime)
        : Math.max(currentTime + deltaSeconds, 0);
    element.currentTime = nextTime;
    lastPlaybackTimeRef.current = nextTime;
    currentVideoTimeRef.current = nextTime;
    setCurrentVideoTime(nextTime);
  };

  const clearAnnotationComposer = () => {
    setEditingAnnotation(null);
    setEditorValues(null);
  };

  const beginAnnotationAtCurrentTime = () => {
    const timestamp = getCurrentPlayerTime(videoElement.current, currentVideoTime);
    videoElement.current?.pause();
    currentVideoTimeRef.current = timestamp;
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
      requestVideoPlayback(element);
      return;
    }
    element.pause();
  };

  const changePlaybackRate = (rate: PlaybackRate) => {
    const element = videoElement.current;
    if (element) element.playbackRate = rate;
    setPlaybackRate(rate);
  };

  const toggleExpandedPlayback = () => {
    if (isPlaybackExpanded || isFullscreenActive()) {
      if (isFullscreenActive()) void exitFullscreen();
      setIsPlaybackExpanded(false);
      return;
    }

    const element = videoElement.current;
    const timestamp = getCurrentPlayerTime(element, currentVideoTime);
    lastPlaybackTimeRef.current = timestamp;
    shouldResumePlaybackRef.current = Boolean(element && !element.paused && !element.ended);
    currentVideoTimeRef.current = timestamp;
    setCurrentVideoTime(timestamp);
    setFullscreenTab("preview");

    // Fullscreen must be requested synchronously within the user gesture, so we
    // target the always-mounted page root rather than the not-yet-rendered overlay.
    // If the browser rejects the request, the in-page overlay still opens as a fallback.
    const root = fullscreenContainer.current;
    if (root) requestFullscreen(root).catch(() => undefined);
    setIsPlaybackExpanded(true);
  };

  const updateVideoTiming = () => {
    const element = videoElement.current;
    if (!element) return;
    const time = toFiniteTime(element.currentTime);
    if (time > 0) lastPlaybackTimeRef.current = time;
    currentVideoTimeRef.current = time;
    setCurrentVideoTime(time);
  };

  const syncVideoMetadata = () => {
    const element = videoElement.current;
    if (!element) return;
    const duration = toFiniteTime(element.duration);
    const time = toFiniteTime(element.currentTime);
    durationSecondsRef.current = duration;
    currentVideoTimeRef.current = time;
    setDurationSeconds(duration);
    setCurrentVideoTime(time);
  };

  const restoreVideoTime = () => {
    const element = videoElement.current;
    if (!element) return;
    element.playbackRate = playbackRate;
    const duration = toFiniteTime(element.duration);
    durationSecondsRef.current = duration;
    setDurationSeconds(duration);
    if (lastPlaybackTimeRef.current > 0) {
      element.currentTime = lastPlaybackTimeRef.current;
      currentVideoTimeRef.current = lastPlaybackTimeRef.current;
      setCurrentVideoTime(lastPlaybackTimeRef.current);
    } else {
      const time = toFiniteTime(element.currentTime);
      currentVideoTimeRef.current = time;
      setCurrentVideoTime(time);
    }

    if (shouldResumePlaybackRef.current) {
      shouldResumePlaybackRef.current = false;
      requestVideoPlayback(element);
    }
  };

  useEffect(() => {
    const handlePlayerKeyboardShortcut = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        isEditableKeyboardTarget(event.target)
      ) {
        return;
      }

      const isSpaceKey = event.key === " " || event.key === "Spacebar" || event.code === "Space";
      const isSeekKey = event.key === "ArrowLeft" || event.key === "ArrowRight";
      if (!isSeekKey && !isSpaceKey) return;
      if (isSpaceKey && isInteractiveKeyboardTarget(event.target)) return;
      if (!videoElement.current) return;

      event.preventDefault();
      if (isSpaceKey) {
        togglePlayback();
        return;
      }

      seekByKeyboard(
        event.key === "ArrowRight" ? KEYBOARD_SEEK_STEP_SECONDS : -KEYBOARD_SEEK_STEP_SECONDS,
      );
    };

    document.addEventListener("keydown", handlePlayerKeyboardShortcut, { capture: true });
    return () =>
      document.removeEventListener("keydown", handlePlayerKeyboardShortcut, { capture: true });
  }, []);

  if (isLoading) return <p className="text-[var(--muted)]">{t("common.loading")}</p>;
  if (isError || !video) return <p className="text-[var(--danger)]">{t("videoDetail.notFound")}</p>;

  const renderVideoPlayer = (isExpandedLayout = false) => (
    <motion.div
      ref={playerFrame}
      className={cn(
        "group relative overflow-hidden rounded-lg border border-[var(--rule)] bg-[#0f0e0c]",
        !isExpandedLayout && "flex h-full min-h-0 items-center justify-center",
        isExpandedLayout && "flex min-h-[22rem] items-center justify-center",
        isPlaybackExpanded && "h-full min-h-0 rounded-md border-white/10",
      )}
      {...surfaceMotion}
      transition={{ ...surfaceMotion.transition, delay: 0.04 }}
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
            className={cn(
              "aspect-video w-full cursor-pointer bg-[#0f0e0c]",
              !isExpandedLayout && "max-h-full object-contain",
              isExpandedLayout && "max-h-full object-contain",
              isPlaybackExpanded && "h-full min-h-0",
            )}
          />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/42 to-transparent px-4 pt-16 pb-4 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100">
            <VideoControls
              annotations={scrubberAnnotations}
              currentTime={currentVideoTime}
              duration={durationSeconds}
              hoveredAnnotationId={hoveredAnnotationId}
              isExpanded={isPlaybackExpanded}
              isPlaying={isPlaying}
              onExpand={toggleExpandedPlayback}
              onHoverAnnotation={setHoveredAnnotationId}
              onPlaybackRateChange={changePlaybackRate}
              onSeek={seekTo}
              onTogglePlayback={togglePlayback}
              playbackRate={playbackRate}
              showAnnotationPreview={!isPlaybackExpanded}
            />
          </div>
        </>
      ) : (
        <div
          className={cn(
            "flex aspect-video w-full items-center justify-center text-sm text-[var(--paper)]",
            !isExpandedLayout && "h-full min-h-0",
            isExpandedLayout && "h-full min-h-[22rem]",
          )}
        >
          {video.processing_status === "failed"
            ? t("videoDetail.processing.failed", {
                message: video.processing_error ?? t("videoDetail.processing.unknownError"),
              })
            : video.processing_status === "pending" || video.processing_status === "processing"
              ? t("videoDetail.processing.inProgress")
              : t("videoDetail.videoUnavailable")}
        </div>
      )}
    </motion.div>
  );

  return (
    <motion.div
      ref={fullscreenContainer}
      className="mx-auto flex h-full min-h-0 max-w-[96rem] flex-col gap-3 overflow-hidden"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.24 }}
    >
      <div className="vi-panel flex shrink-0 items-center justify-between gap-4 px-3 py-2">
        <div className="flex min-w-0 items-center gap-3">
          <Link
            to="/videos"
            className="vi-icon-button shrink-0"
            aria-label={t("videoDetail.back")}
            title={t("videoDetail.back")}
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="min-w-0">
            <p className="vi-kicker">{t("videoDetail.kicker")}</p>
            <h1 className="vi-display mt-0.5 truncate text-2xl">{video.title}</h1>
          </div>
          <p className="hidden max-w-xl truncate text-sm text-[var(--muted)] 2xl:block">
            {video.description ?? t("common.noDescription")}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {exportVideo.isSuccess && (
            <span className="hidden text-xs text-[var(--muted)] lg:inline">
              {t("videoDetail.export.started")}
            </span>
          )}
          {exportVideo.isError && (
            <span className="hidden text-xs text-[var(--danger)] lg:inline">
              {getErrorMessage(exportVideo.error, t, "videoDetail.export.failed")}
            </span>
          )}
          {canCache && (
            <button
              type="button"
              onClick={() => void handleCache()}
              disabled={video.processing_status !== "ready" || caching || !video.playback_url}
              className="vi-button-secondary disabled:opacity-60"
              title={t("videoDetail.cache.hint")}
            >
              <HardDriveDownload className="h-4 w-4" />
              {caching
                ? t("videoDetail.cache.caching")
                : cacheState === "cached"
                  ? t("videoDetail.cache.cached")
                  : t("videoDetail.cache.action")}
            </button>
          )}
          {cacheError && (
            <span className="hidden text-xs text-[var(--danger)] lg:inline">{cacheError}</span>
          )}
          <button
            type="button"
            onClick={() => exportVideo.mutate({ id: videoId, filename: video.original_filename })}
            disabled={video.processing_status !== "ready" || exportVideo.isPending}
            className="vi-button-secondary disabled:opacity-60"
            title={t("videoDetail.export.hint")}
          >
            <Download className="h-4 w-4" />
            {exportVideo.isPending
              ? t("videoDetail.export.preparing")
              : t("videoDetail.export.action")}
          </button>
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
      </div>

      <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_minmax(12rem,34vh)] gap-4 2xl:grid-cols-[minmax(0,1fr)_380px] xl:grid-cols-[minmax(0,1fr)_360px] xl:grid-rows-none">
        <section className="flex min-h-0 flex-col gap-3">
          <motion.dl
            className="vi-panel grid shrink-0 gap-0 overflow-hidden text-sm sm:grid-cols-3"
            {...surfaceMotion}
          >
            <div>
              <div className="border-b border-[var(--rule)] px-3 py-2 sm:border-r sm:border-b-0">
                <dt className="vi-kicker">{t("videoDetail.file")}</dt>
                <dd className="mt-1 truncate font-medium" title={video.original_filename}>
                  {video.original_filename}
                </dd>
              </div>
            </div>
            <div>
              <div className="border-b border-[var(--rule)] px-3 py-2 sm:border-r sm:border-b-0">
                <dt className="vi-kicker">{t("videoDetail.size")}</dt>
                <dd className="vi-mono mt-1 text-xs">{formatBytes(video.size_bytes)}</dd>
              </div>
            </div>
            <div>
              <div className="px-3 py-2">
                <dt className="vi-kicker">{t("videoDetail.created")}</dt>
                <dd className="vi-mono mt-1 text-xs">{formatDate(video.created_at)}</dd>
              </div>
            </div>
          </motion.dl>

          <div className="min-h-0 flex-1">{!isPlaybackExpanded && renderVideoPlayer()}</div>

          <AnnotationListPanel
            activeAnnotationId={activeAnnotationId}
            annotations={sortedAnnotations}
            onEdit={startEditingAnnotation}
            onSeek={seekTo}
            videoId={videoId}
          />
        </section>

        <aside className="min-h-0 xl:self-stretch">
          {!isPlaybackExpanded && (
            <AnnotationEditorPanel
              currentTime={currentVideoTime}
              editing={editingAnnotation}
              formRef={annotationForm}
              onAdd={beginAnnotationAtCurrentTime}
              onCancel={clearAnnotationComposer}
              setEditorValues={setEditorValues}
              values={editorValues}
              videoId={videoId}
            />
          )}
        </aside>
      </div>

      {isPlaybackExpanded && (
        <section className="fixed inset-0 z-50 grid h-screen grid-rows-[minmax(0,1fr)_minmax(14rem,38vh)] gap-4 bg-[#11100e] p-3 md:p-4 lg:grid-cols-[minmax(0,1fr)_360px] lg:grid-rows-none xl:grid-cols-[minmax(0,1fr)_400px]">
          <div className="h-full min-h-0">{renderVideoPlayer(true)}</div>
          <FullscreenSidePanel
            activeTab={fullscreenTab}
            annotation={currentPlaybackAnnotation.annotation}
            annotationIndex={currentPlaybackAnnotation.index}
            currentTime={currentVideoTime}
            editing={editingAnnotation}
            formRef={annotationForm}
            onAdd={beginAnnotationAtCurrentTime}
            onCancel={clearAnnotationComposer}
            onEdit={startEditingAnnotation}
            onSeek={seekTo}
            onTabChange={setFullscreenTab}
            setEditorValues={setEditorValues}
            totalCount={sortedAnnotations.length}
            values={editorValues}
            videoId={videoId}
          />
        </section>
      )}
    </motion.div>
  );
}

function FullscreenSidePanel({
  activeTab,
  annotation,
  annotationIndex,
  currentTime,
  editing,
  formRef,
  onAdd,
  onCancel,
  onEdit,
  onSeek,
  onTabChange,
  setEditorValues,
  totalCount,
  values,
  videoId,
}: {
  activeTab: FullscreenTab;
  annotation: Annotation | null;
  annotationIndex: number;
  currentTime: number;
  editing: Annotation | null;
  formRef: RefObject<HTMLFormElement | null>;
  onAdd: () => void;
  onCancel: () => void;
  onEdit: (annotation: Annotation) => void;
  onSeek: (seconds: number) => void;
  onTabChange: (tab: FullscreenTab) => void;
  setEditorValues: (values: AnnotationEditorValues | null) => void;
  totalCount: number;
  values: AnnotationEditorValues | null;
  videoId: string;
}) {
  const { t } = useTranslation();
  const hasAnnotation = annotation !== null;

  const handleEditAnnotation = (target: Annotation) => {
    onEdit(target);
    onTabChange("edit");
  };

  const handleAddAnnotation = () => {
    onAdd();
    onTabChange("edit");
  };

  return (
    <motion.aside
      className="vi-panel flex h-full min-h-0 flex-col overflow-hidden border-white/10 bg-[#faf7f2]"
      {...surfaceMotion}
    >
      <div className="flex items-center justify-between gap-3 border-b border-[var(--rule)] p-4">
        <div>
          <p className="vi-kicker">{t("videoDetail.preview.kicker")}</p>
          <h2 className="vi-display mt-1 text-2xl">{t("videoDetail.preview.title")}</h2>
        </div>
        <span className="vi-mono text-xs text-[var(--muted)]">
          {hasAnnotation ? annotationIndex + 1 : 0}/{totalCount}
        </span>
      </div>

      <div className="flex shrink-0 gap-1 border-b border-[var(--rule)] p-2">
        {(["preview", "edit"] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => onTabChange(tab)}
            className={cn(
              "flex-1 rounded-md px-3 py-2 text-sm font-semibold transition-colors",
              activeTab === tab
                ? "bg-[var(--ink)] text-[var(--paper)]"
                : "text-[var(--muted)] hover:bg-[var(--rule-soft)]",
            )}
            aria-pressed={activeTab === tab}
          >
            {t(`videoDetail.player.tabs.${tab}`)}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {activeTab === "preview" ? (
          !annotation ? (
            <div className="flex h-full flex-col items-center justify-center rounded-lg border border-dashed border-[var(--rule-strong)] bg-[var(--paper)] p-6 text-center text-sm text-[var(--muted)]">
              <MessageSquare className="mb-3 h-5 w-5" />
              {t("videoDetail.preview.empty")}
            </div>
          ) : (
            <PlaybackAnnotationDetail
              key={annotation.id}
              annotation={annotation}
              currentTime={currentTime}
              onEdit={handleEditAnnotation}
              onSeek={onSeek}
            />
          )
        ) : (
          <FullscreenEditTab
            currentTime={currentTime}
            editing={editing}
            formRef={formRef}
            onAdd={handleAddAnnotation}
            onCancel={onCancel}
            setEditorValues={setEditorValues}
            values={values}
            videoId={videoId}
          />
        )}
      </div>
    </motion.aside>
  );
}

function FullscreenEditTab({
  currentTime,
  editing,
  formRef,
  onAdd,
  onCancel,
  setEditorValues,
  values,
  videoId,
}: {
  currentTime: number;
  editing: Annotation | null;
  formRef: RefObject<HTMLFormElement | null>;
  onAdd: () => void;
  onCancel: () => void;
  setEditorValues: (values: AnnotationEditorValues | null) => void;
  values: AnnotationEditorValues | null;
  videoId: string;
}) {
  const { t } = useTranslation();

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <button type="button" onClick={onAdd} className="vi-button-primary shrink-0 px-3 py-2">
        <Plus className="h-4 w-4" />
        {t("videoDetail.annotations.addAtCurrentTime")}
      </button>
      {values ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-[var(--rule)]">
          <AnnotationComposer
            currentTime={currentTime}
            editing={editing}
            formRef={formRef}
            onCancel={onCancel}
            onChange={setEditorValues}
            values={values}
            videoId={videoId}
          />
        </div>
      ) : (
        <p className="text-sm text-[var(--muted)]">{t("videoDetail.annotations.clickToEdit")}</p>
      )}
    </div>
  );
}

function PlaybackAnnotationDetail({
  annotation,
  currentTime,
  onEdit,
  onSeek,
}: {
  annotation: Annotation;
  currentTime: number;
  onEdit: (annotation: Annotation) => void;
  onSeek: (seconds: number) => void;
}) {
  const { t } = useTranslation();
  const isActive = isAnnotationActive(annotation, currentTime);
  const customDataJson = JSON.stringify(annotation.custom_data, null, 2);
  const hasCustomData = Object.keys(annotation.custom_data).length > 0;

  return (
    <motion.div
      className="h-full"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
    >
      <div className="flex items-start justify-between gap-3 border-b border-[var(--rule)] pb-4">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onSeek(annotation.timestamp_seconds)}
            className="inline-flex min-h-9 items-center gap-2 rounded-md border border-[var(--rule)] bg-[var(--paper)] px-3 text-sm font-semibold text-[var(--ink)] hover:border-[var(--ink)]"
          >
            <Clock className="h-4 w-4" />
            {formatDuration(annotation.timestamp_seconds)}
          </button>
          <button
            type="button"
            onClick={() => onEdit(annotation)}
            className="vi-icon-button h-9 min-h-9 w-9"
            aria-label={t("videoDetail.player.editThis")}
            title={t("videoDetail.player.editThis")}
          >
            <Edit2 className="h-4 w-4" />
          </button>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <span className="vi-kicker rounded border border-[var(--rule)] px-2 py-1">
            {translateKind(t, annotation.kind)}
          </span>
          {isActive && (
            <span className="vi-kicker rounded bg-[rgba(192,81,47,0.12)] px-2 py-1 text-[var(--accent)]">
              {t("videoDetail.annotations.activeNow")}
            </span>
          )}
        </div>
      </div>

      <div className="py-5" style={{ borderLeft: `4px solid ${annotation.color}` }}>
        <div className="pl-4">
          <RichTextContent content={annotation.content} />
        </div>
      </div>

      {hasCustomData && (
        <div className="mt-4 border-t border-[var(--rule)] pt-4">
          <p className="vi-kicker">{t("videoDetail.form.customJson")}</p>
          <pre className="vi-mono mt-2 max-h-40 overflow-auto rounded-lg bg-[var(--paper)] p-3 text-xs leading-relaxed text-[var(--ink)]">
            {customDataJson}
          </pre>
        </div>
      )}
      <AnnotationComments annotationId={annotation.id} />
    </motion.div>
  );
}

function AnnotationEditorPanel({
  currentTime,
  editing,
  formRef,
  onAdd,
  onCancel,
  setEditorValues,
  values,
  videoId,
}: {
  currentTime: number;
  editing: Annotation | null;
  formRef: RefObject<HTMLFormElement | null>;
  onAdd: () => void;
  onCancel: () => void;
  setEditorValues: (values: AnnotationEditorValues | null) => void;
  values: AnnotationEditorValues | null;
  videoId: string;
}) {
  const { t } = useTranslation();

  return (
    <motion.section
      className="vi-panel flex h-full min-h-0 flex-col overflow-hidden"
      {...surfaceMotion}
    >
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--rule)] p-3">
        <div className="min-w-0">
          <p className="vi-kicker">{t("videoDetail.form.kicker")}</p>
          <h2 className="vi-display mt-1 truncate text-xl">{t("videoDetail.form.editorTitle")}</h2>
        </div>
        <button type="button" onClick={onAdd} className="vi-button-primary shrink-0 px-3 py-2">
          <Plus className="h-4 w-4" />
          {t("videoDetail.annotations.addAtCurrentTime")}
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

      {!values && (
        <div className="min-h-0 flex-1 p-4">
          <p className="text-sm text-[var(--muted)]">{t("videoDetail.annotations.clickToEdit")}</p>
        </div>
      )}
    </motion.section>
  );
}

function AnnotationListPanel({
  activeAnnotationId,
  annotations,
  onEdit,
  onSeek,
  videoId,
}: {
  activeAnnotationId: string | null;
  annotations: Annotation[];
  onEdit: (annotation: Annotation) => void;
  onSeek: (seconds: number) => void;
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
    <motion.section
      className="vi-panel flex h-[18rem] shrink-0 flex-col overflow-hidden"
      {...surfaceMotion}
    >
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--rule)] p-4">
        <div>
          <p className="vi-kicker">{t("videoDetail.annotations.liveKicker")}</p>
          <h2 className="vi-display mt-1 text-2xl">{t("videoDetail.annotations.title")}</h2>
        </div>
        <span className="vi-mono text-xs text-[var(--muted)]">{annotations.length}</span>
      </div>

      <div className="min-h-0 flex-1 overflow-x-auto overflow-y-hidden p-4">
        {annotations.length === 0 ? (
          <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-[var(--rule-strong)] bg-[var(--paper)] p-6 text-center text-sm text-[var(--muted)]">
            <MessageSquare className="mx-auto mb-3 h-5 w-5" />
            {t("videoDetail.annotations.empty")}
          </div>
        ) : (
          <motion.div className="flex h-full gap-3 pb-1" layout>
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
          </motion.div>
        )}
      </div>
    </motion.section>
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
    <motion.article
      layout
      ref={refCallback}
      className={cn(
        "h-full w-[20rem] shrink-0 overflow-y-auto rounded-lg border bg-[var(--paper)] p-3 transition-colors sm:w-[22rem]",
        isActive
          ? "border-[var(--ink)] shadow-[0_0_0_3px_rgba(192,81,47,0.12)]"
          : "border-[var(--rule)]",
      )}
      style={{ borderLeft: `4px solid ${annotation.color}` }}
      whileHover={{ y: -2 }}
      transition={{ duration: 0.16, ease: "easeOut" }}
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
          <span className="vi-kicker rounded border border-[var(--rule)] px-2 py-0.5">
            {translateKind(t, annotation.kind)}
          </span>
          {isActive && (
            <span className="vi-kicker rounded bg-[rgba(192,81,47,0.12)] px-2 py-0.5 text-[var(--accent)]">
              {t("videoDetail.annotations.activeNow")}
            </span>
          )}
        </div>
        <div className="mt-2">
          <RichTextContent content={annotation.content} compact />
        </div>
      </div>
      <AnnotationComments annotationId={annotation.id} />
    </motion.article>
  );
}

function AnnotationComments({ annotationId }: { annotationId: string }) {
  const { t } = useTranslation();
  const { data: comments = [], isLoading } = useAnnotationComments(annotationId);
  const createComment = useCreateAnnotationComment(annotationId);
  const [body, setBody] = useState("");

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = body.trim();
    if (!trimmed) return;
    createComment.mutate(trimmed, { onSuccess: () => setBody("") });
  };

  return (
    <div className="mt-3 border-t border-[var(--rule)] pt-3">
      <p className="vi-kicker">
        {t("videoDetail.comments.title")} · {comments.length}
      </p>
      <div className="mt-2 space-y-2">
        {isLoading && <p className="text-xs text-[var(--muted)]">{t("common.loading")}</p>}
        {comments.map((comment) => (
          <div key={comment.id} className="rounded-md bg-[var(--surface)] p-2 text-xs">
            <div className="flex items-center justify-between gap-2 text-[var(--muted)]">
              <strong className="text-[var(--ink)]">{comment.author_username}</strong>
              <span>{formatDate(comment.created_at)}</span>
            </div>
            <p className="mt-1 whitespace-pre-wrap text-sm text-[var(--ink)]">{comment.body}</p>
          </div>
        ))}
      </div>
      <form onSubmit={submit} className="mt-2 flex items-end gap-2">
        <label className="min-w-0 flex-1">
          <span className="sr-only">{t("videoDetail.comments.add")}</span>
          <textarea
            value={body}
            maxLength={2000}
            rows={2}
            onChange={(event) => setBody(event.target.value)}
            placeholder={t("videoDetail.comments.placeholder")}
            className="vi-textarea resize-none text-sm normal-case"
          />
        </label>
        <button
          type="submit"
          disabled={!body.trim() || createComment.isPending}
          className="vi-icon-button shrink-0 disabled:opacity-50"
          aria-label={t("videoDetail.comments.add")}
          title={t("videoDetail.comments.add")}
        >
          <Send className="h-4 w-4" />
        </button>
      </form>
      {createComment.isError && (
        <p className="mt-2 text-xs text-[var(--danger)]" role="alert">
          {getErrorMessage(createComment.error, t, "videoDetail.comments.error")}
        </p>
      )}
    </div>
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
  const contentLabelId = useId();
  const colorInputName = useId();
  const [jsonError, setJsonError] = useState<string | null>(null);
  const isPending = createAnnotation.isPending || updateAnnotation.isPending;
  const saveError = createAnnotation.error ?? updateAnnotation.error;
  const selectedColor = normalizeAnnotationColor(values.color);
  const hasPresetColor = ANNOTATION_COLORS.some(
    ({ value }) => normalizeAnnotationColor(value) === selectedColor,
  );
  const colorOptions: ReadonlyArray<{ label: string; value: string }> = [
    ...(!hasPresetColor
      ? [{ label: t("videoDetail.form.colors.current"), value: values.color }]
      : []),
    ...ANNOTATION_COLORS.map(({ labelKey, value }) => ({
      label: t(`videoDetail.form.colors.${labelKey}`),
      value,
    })),
  ];

  const updateValues = (patch: Partial<AnnotationEditorValues>) => {
    onChange({ ...values, ...patch });
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (isRichTextEmpty(values.content)) return;

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
      timestamp_seconds: toRoundedTime(values.timestamp_seconds),
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
      content: values.content,
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
      className="min-h-0 flex-1 overflow-y-auto border-b border-[var(--rule)] bg-[var(--paper)] p-4"
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
        <div>
          <p id={contentLabelId} className="vi-label mb-1">
            {t("videoDetail.form.content")}
          </p>
          <RichTextEditor
            labelledBy={contentLabelId}
            value={values.content}
            onChange={(content) => updateValues({ content })}
          />
        </div>

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
                  timestamp_seconds: toRoundedTime(Number(event.target.value)),
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
              max="3600"
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
          onClick={() => updateValues({ timestamp_seconds: toRoundedTime(currentTime) })}
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
          <fieldset>
            <legend className="vi-label">{t("videoDetail.form.color")}</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {colorOptions.map((option) => {
                const isSelected = normalizeAnnotationColor(option.value) === selectedColor;
                return (
                  <label
                    key={option.value}
                    title={option.label}
                    className="relative cursor-pointer rounded-full"
                  >
                    <input
                      type="radio"
                      name={colorInputName}
                      value={option.value}
                      checked={isSelected}
                      onChange={() => updateValues({ color: option.value })}
                      className="peer sr-only"
                    />
                    <span
                      className={cn(
                        "flex h-9 w-9 items-center justify-center rounded-full border-2 transition-transform hover:scale-105 peer-focus-visible:outline-none peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--ink)] peer-focus-visible:ring-offset-2",
                        isSelected
                          ? "border-[var(--ink)] shadow-[0_0_0_2px_var(--paper),0_0_0_4px_var(--ink)]"
                          : "border-white",
                      )}
                      style={{ backgroundColor: option.value }}
                    >
                      {isSelected && (
                        <Check
                          className="h-4 w-4 text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.65)]"
                          aria-hidden="true"
                        />
                      )}
                    </span>
                    <span className="sr-only">{option.label}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        </div>
      </div>

      <div className="mt-4 flex gap-2">
        <button
          type="submit"
          disabled={isRichTextEmpty(values.content) || isPending}
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
      {saveError && (
        <p className="mt-3 text-sm text-[var(--danger)]" role="alert" aria-live="polite">
          {getErrorMessage(saveError, t, "videoDetail.form.errorSave")}
        </p>
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

function normalizeAnnotationColor(color: string) {
  return color.toUpperCase();
}

function getEditorValuesFromAnnotation(annotation: Annotation): AnnotationEditorValues {
  return {
    timestamp_seconds: toRoundedTime(annotation.timestamp_seconds),
    duration_seconds: annotation.duration_seconds.toString(),
    content: annotation.content,
    kind: annotation.kind,
    color: annotation.color,
    custom_data: JSON.stringify(annotation.custom_data, null, 2),
  };
}

function getEditorValuesFromTimestamp(timestamp: number): AnnotationEditorValues {
  return {
    timestamp_seconds: toRoundedTime(timestamp),
    duration_seconds: "6",
    content: emptyRichTextDocument(),
    kind: "note",
    color: "#C0512F",
    custom_data: "{}",
  };
}

function emptyRichTextDocument(): RichTextDocument {
  return { type: "doc", content: [{ type: "paragraph" }] };
}

function getRichTextPreview(document: RichTextDocument): string {
  const parts: string[] = [];
  const visit = (nodes = document.content ?? []) => {
    for (const node of nodes) {
      if (node.text) parts.push(node.text);
      if (node.type === "image") parts.push("[Image]");
      if (node.content) visit(node.content);
    }
  };
  visit();
  return parts.join(" ").trim();
}

// 把富文本标注拍平成课堂只读播放用的文本/图片块。
function toPlayerAnnotation(annotation: Annotation): PlayerAnnotation {
  const blocks: PlayerAnnotation["blocks"] = [];
  const visit = (nodes: RichTextNode[] | undefined) => {
    for (const node of nodes ?? []) {
      if (node.text) blocks.push({ type: "text", text: node.text });
      if (node.type === "image") {
        const src = typeof node.attrs?.src === "string" ? node.attrs.src : "";
        if (src) blocks.push({ type: "image", src, alt: "" });
      }
      if (node.content) visit(node.content);
    }
  };
  visit(annotation.content.content);
  return {
    timestamp_seconds: annotation.timestamp_seconds,
    duration_seconds: annotation.duration_seconds,
    kind: annotation.kind,
    color: annotation.color,
    blocks,
    text: getRichTextPreview(annotation.content),
  };
}

function requestVideoPlayback(element: HTMLVideoElement) {
  // The media element exposes real load/decode failures through `error`; this
  // promise can also reject during an intentional play/pause race.
  void element.play().catch(() => undefined);
}

function getCurrentPlayerTime(element: HTMLVideoElement | null, fallback: number) {
  if (!element) return fallback;
  return toFiniteTime(element.currentTime);
}

function isEditableKeyboardTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tagName = target.tagName.toLowerCase();
  return tagName === "input" || tagName === "textarea" || tagName === "select";
}

function isInteractiveKeyboardTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.closest("[data-video-scrubber='true']")) return false;
  const interactiveElement = target.closest("a,button,summary,[role='button']");
  return interactiveElement !== null;
}

function toFiniteTime(value: number) {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

// Annotation timestamps are captured from videoElement.currentTime, a float that
// can carry many decimal places (e.g. 12.3456789). Round to 0.1s — matching the
// input's step — so the field never displays a long, invalid-looking time.
function toRoundedTime(value: number) {
  return Number(toFiniteTime(value).toFixed(1));
}

function toPositiveDuration(value: number) {
  return Number.isFinite(value) && value > 0 ? value : 6;
}

function clampRange(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}

type FullscreenCapableElement = HTMLElement & {
  webkitRequestFullscreen?: () => void;
};

type FullscreenCapableDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => void;
};

function isFullscreenActive() {
  const doc = document as FullscreenCapableDocument;
  return Boolean(doc.fullscreenElement ?? doc.webkitFullscreenElement);
}

function requestFullscreen(node: HTMLElement) {
  const element = node as FullscreenCapableElement;
  if (element.requestFullscreen) return element.requestFullscreen();
  element.webkitRequestFullscreen?.();
  return Promise.resolve();
}

function exitFullscreen() {
  const doc = document as FullscreenCapableDocument;
  if (doc.exitFullscreen) return doc.exitFullscreen();
  doc.webkitExitFullscreen?.();
  return Promise.resolve();
}
