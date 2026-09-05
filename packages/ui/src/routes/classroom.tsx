import { createRoute } from "@tanstack/react-router";
import { Clock, FolderOpen, MessageSquare, Minimize2, Radio } from "lucide-react";
import { motion } from "motion/react";
import { type DragEvent, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { rootRoute } from "./__root";
import { type PlaybackRate, VideoControls } from "@/components/player/VideoControls";
import { useHost, type PlayerAnnotation, type ProcessedPress } from "@/platform/host";
import { cn, formatDuration } from "@/lib/utils";

export const classroomRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/classroom",
  component: ClassroomPage,
});

type OpenedMedia = {
  displayName: string;
  sourceUrl: string;
  annotationStatus: string;
  annotations: PlayerAnnotation[];
};

function ClassroomPage() {
  const { t } = useTranslation();
  const host = useHost();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const stageFrame = useRef<HTMLDivElement | null>(null);
  const [media, setMedia] = useState<OpenedMedia | null>(null);
  const [student, setStudent] = useState<ProcessedPress | null>(null);
  const [receiverOnline, setReceiverOnline] = useState(false);
  const [receiverPort, setReceiverPort] = useState<string | undefined>(undefined);
  const [fullscreen, setFullscreen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentSeconds, setCurrentSeconds] = useState(0);
  const [durationSeconds, setDurationSeconds] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackRate, setPlaybackRate] = useState<PlaybackRate>(1);
  const [hoveredAnnotationId, setHoveredAnnotationId] = useState<string | null>(null);

  const annotations = useMemo(() => media?.annotations ?? [], [media]);
  const scrubberAnnotations = useMemo(
    () =>
      annotations.map((a, index) => ({
        id: `${a.timestamp_seconds}-${index}`,
        timestamp_seconds: a.timestamp_seconds,
        duration_seconds: a.duration_seconds,
        color: a.color,
        preview: a.text,
      })),
    [annotations],
  );

  const currentIndex = useMemo(() => {
    const threshold = currentSeconds + 0.12;
    for (let index = annotations.length - 1; index >= 0; index -= 1) {
      const a = annotations[index];
      if (a && a.timestamp_seconds <= threshold) return index;
    }
    return -1;
  }, [annotations, currentSeconds]);
  const currentAnnotation = currentIndex >= 0 ? annotations[currentIndex] : undefined;

  // 订阅按钮与接收器状态。按钮按下:先同步暂停视频,再弹学生覆盖层。
  useEffect(() => {
    const offPress = host.classroom?.onPress((press) => {
      videoRef.current?.pause();
      setStudent(press);
    });
    const offStatus = host.classroom?.onReceiverStatus((online, port) => {
      setReceiverOnline(online);
      setReceiverPort(port);
    });
    return () => {
      offPress?.();
      offStatus?.();
    };
  }, [host]);

  // 宿主在打开文件后通过自定义事件把媒体交给本页(desktop host 触发)。
  useEffect(() => {
    const onOpened = (event: Event) => {
      const detail = (event as CustomEvent<OpenedMedia>).detail;
      if (detail) setMedia(detail);
    };
    window.addEventListener("vinsight:media-opened", onOpened);
    return () => window.removeEventListener("vinsight:media-opened", onOpened);
  }, []);

  useEffect(() => {
    if (!media || !videoRef.current) return;
    videoRef.current.load();
    videoRef.current.playbackRate = playbackRate;
    void videoRef.current.play().catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [media]);

  const seekTo = (seconds: number) => {
    const element = videoRef.current;
    if (!element) return;
    element.currentTime = Math.max(0, seconds);
    setCurrentSeconds(element.currentTime);
  };

  const togglePlayback = () => {
    const element = videoRef.current;
    if (!element) return;
    if (element.paused) void element.play().catch(() => undefined);
    else element.pause();
  };

  const changePlaybackRate = (rate: PlaybackRate) => {
    if (videoRef.current) videoRef.current.playbackRate = rate;
    setPlaybackRate(rate);
  };

  const openFile = async () => {
    setError(null);
    try {
      await host.media?.openFile();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const handleDrop = async (event: DragEvent) => {
    event.preventDefault();
    const file = event.dataTransfer.files.item(0);
    if (!file) return;
    setError(null);
    try {
      await host.media?.openDroppedFile(file);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const toggleFullscreen = async () => {
    const next = !fullscreen;
    await host.media?.setFullscreen(next);
    setFullscreen(next);
  };

  // Esc 退出全屏,作为空态/异常时的兜底退出途径。
  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") void toggleFullscreen();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullscreen]);

  const syncMetadata = () => {
    const element = videoRef.current;
    if (!element) return;
    element.playbackRate = playbackRate;
    setDurationSeconds(Number.isFinite(element.duration) ? element.duration : 0);
    setCurrentSeconds(element.currentTime);
  };

  // 视频舞台全程单实例挂载;全屏只是给舞台容器换成 fixed 占满类,
  // 视频 DOM 位置不变,因此画面/播放/进度在全屏切换时不中断。
  const stage = (
    <div
      ref={stageFrame}
      className={cn(
        "group relative flex min-h-0 items-center justify-center overflow-hidden bg-[#0f0e0c]",
        fullscreen
          ? "h-full w-full border border-white/10"
          : "h-full rounded-lg border border-[var(--rule)]",
      )}
    >
      {media ? (
        <>
          <video
            ref={videoRef}
            src={media.sourceUrl}
            controls={false}
            className="aspect-video h-full max-h-full w-full cursor-pointer bg-[#0f0e0c] object-contain"
            onClick={togglePlayback}
            onDurationChange={syncMetadata}
            onLoadedMetadata={syncMetadata}
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
            onEnded={() => setIsPlaying(false)}
            onTimeUpdate={(event) => setCurrentSeconds(event.currentTarget.currentTime)}
            onError={() => setError(t("classroom.unsupported"))}
          />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/42 to-transparent px-4 pt-16 pb-4 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100">
            <VideoControls
              annotations={scrubberAnnotations}
              currentTime={currentSeconds}
              duration={durationSeconds}
              hoveredAnnotationId={hoveredAnnotationId}
              isExpanded={fullscreen}
              isPlaying={isPlaying}
              onExpand={() => void toggleFullscreen()}
              onHoverAnnotation={setHoveredAnnotationId}
              onPlaybackRateChange={changePlaybackRate}
              onSeek={seekTo}
              onTogglePlayback={togglePlayback}
              playbackRate={playbackRate}
              showAnnotationPreview={!fullscreen}
            />
          </div>
        </>
      ) : (
        <div className="flex aspect-video w-full flex-col items-center justify-center gap-3 text-sm text-[var(--paper)]">
          <span className="text-3xl">▶</span>
          <p>{t("classroom.empty")}</p>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => void openFile()} className="vi-button-primary">
              <FolderOpen className="h-4 w-4" />
              {t("classroom.selectVideo")}
            </button>
            {fullscreen && (
              <button
                type="button"
                onClick={() => void toggleFullscreen()}
                className="vi-button-secondary"
              >
                <Minimize2 className="h-4 w-4" />
                {t("classroom.exitFullscreen")}
              </button>
            )}
          </div>
        </div>
      )}

      {student && (
        <div
          role="alert"
          aria-live="assertive"
          className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 bg-black/72 text-center text-[var(--paper)]"
        >
          <p className="vi-kicker text-[var(--accent)]">{t("classroom.student.request")}</p>
          <strong className="vi-display text-5xl">{student.student}</strong>
          <span className="vi-mono text-sm text-white/70">
            {student.seat
              ? t("classroom.student.seat", { seat: student.seat })
              : t("classroom.student.device", { id: student.device_id })}
          </span>
          <button
            type="button"
            onClick={() => setStudent(null)}
            className="vi-button-primary mt-2"
          >
            {t("classroom.student.handled")}
          </button>
        </div>
      )}
    </div>
  );

  return (
    <main
      className="mx-auto flex h-full min-h-0 max-w-[110rem] flex-col gap-4"
      onDragEnter={(event) => event.preventDefault()}
      onDragOver={(event) => event.preventDefault()}
      onDrop={handleDrop}
    >
      <header className="vi-panel flex shrink-0 items-center justify-between gap-4 px-4 py-3">
        <div className="min-w-0">
          <p className="vi-kicker">{t("classroom.kicker")}</p>
          <h1 className="vi-display mt-1 truncate text-2xl">
            {media?.displayName ?? t("classroom.title")}
          </h1>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span
            className={cn(
              "vi-mono flex items-center gap-2 rounded border px-2.5 py-1.5 text-xs",
              receiverOnline
                ? "border-[var(--forest)] text-[var(--forest)]"
                : "border-[var(--rule)] text-[var(--muted)]",
            )}
          >
            <Radio className="h-3.5 w-3.5" />
            {receiverOnline
              ? t("classroom.hub.online", { port: receiverPort ?? "" })
              : t("classroom.hub.searching")}
          </span>
          <button type="button" onClick={() => void openFile()} className="vi-button-secondary">
            <FolderOpen className="h-4 w-4" />
            {t("classroom.open")}
          </button>
        </div>
      </header>

      {/* 外层容器在全屏时切为 fixed 沉浸网格,普通时为页面网格;
          舞台 stage 始终在 JSX 同一位置,React 保留 <video> 单实例,全屏切换不重建。 */}
      <div
        className={cn(
          fullscreen
            ? "fixed inset-0 z-50 grid h-screen grid-cols-[minmax(0,1fr)_380px] gap-4 bg-[#11100e] p-4"
            : "grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_360px]",
        )}
      >
        <section className="min-h-0">{stage}</section>
        <AnnotationPanel
          annotationStatus={media?.annotationStatus}
          annotations={annotations}
          currentAnnotation={currentAnnotation}
          currentIndex={currentIndex}
          onSeek={seekTo}
          t={t}
        />
      </div>

      {error && (
        <button
          type="button"
          onClick={() => setError(null)}
          className="shrink-0 rounded-lg border border-[rgba(159,47,36,0.4)] bg-[rgba(159,47,36,0.08)] px-4 py-2 text-left text-sm text-[var(--danger)]"
        >
          {error}
        </button>
      )}
    </main>
  );
}

function AnnotationPanel({
  annotationStatus,
  annotations,
  currentAnnotation,
  currentIndex,
  onSeek,
  t,
}: {
  annotationStatus: string | undefined;
  annotations: PlayerAnnotation[];
  currentAnnotation: PlayerAnnotation | undefined;
  currentIndex: number;
  onSeek: (seconds: number) => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  return (
    <motion.aside
      className="vi-panel flex min-h-0 flex-col overflow-hidden"
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: "easeOut" }}
    >
      <div className="flex items-center justify-between gap-3 border-b border-[var(--rule)] p-4">
        <div>
          <p className="vi-kicker">{t("classroom.annotations.kicker")}</p>
          <h2 className="vi-display mt-1 text-2xl">{t("classroom.annotations.title")}</h2>
        </div>
        <span className="vi-mono text-xs text-[var(--muted)]">
          {currentIndex >= 0 ? currentIndex + 1 : 0}/{annotations.length}
        </span>
      </div>
      <p className="border-b border-[var(--rule)] px-4 py-2 text-xs text-[var(--muted)]">
        {annotationStatus ?? t("classroom.annotations.hint")}
      </p>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {!currentAnnotation ? (
          <div className="flex h-full flex-col items-center justify-center rounded-lg border border-dashed border-[var(--rule-strong)] bg-[var(--paper)] p-6 text-center text-sm text-[var(--muted)]">
            <MessageSquare className="mb-3 h-5 w-5" />
            {t("classroom.annotations.empty")}
          </div>
        ) : (
          <div>
            <div className="flex items-center justify-between gap-3 border-b border-[var(--rule)] pb-3">
              <button
                type="button"
                onClick={() => onSeek(currentAnnotation.timestamp_seconds)}
                className="inline-flex min-h-9 items-center gap-2 rounded-md border border-[var(--rule)] bg-[var(--paper)] px-3 text-sm font-semibold text-[var(--ink)] hover:border-[var(--ink)]"
              >
                <Clock className="h-4 w-4" />
                {formatDuration(currentAnnotation.timestamp_seconds)}
              </button>
              <span className="vi-kicker rounded border border-[var(--rule)] px-2 py-1">
                {currentAnnotation.kind.toUpperCase()}
              </span>
            </div>
            <div className="py-4" style={{ borderLeft: `4px solid ${currentAnnotation.color}` }}>
              <div className="space-y-2 pl-4">
                {currentAnnotation.blocks.map((block, index) =>
                  block.type === "text" ? (
                    <p key={index} className="text-sm leading-relaxed text-[var(--ink)]">
                      {block.text}
                    </p>
                  ) : (
                    <img
                      key={index}
                      src={block.src}
                      alt={block.alt}
                      className="max-h-48 rounded object-contain"
                    />
                  ),
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </motion.aside>
  );
}
