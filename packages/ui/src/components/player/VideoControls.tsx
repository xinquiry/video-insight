import { Maximize2, Minimize2, Pause, Play } from "lucide-react";
import { type MouseEvent as ReactMouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { AnimatePresence, motion } from "motion/react";
import { cn, formatDuration } from "@/lib/utils";

/** 后端无关的播放批注;Web 的 Annotation 与课堂 PlayerAnnotation 都可映射进来。 */
export type PlaybackAnnotation = {
  id: string;
  timestamp_seconds: number;
  duration_seconds: number;
  color: string;
  preview: string;
};

const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;
export type PlaybackRate = (typeof PLAYBACK_RATES)[number];

export function isPlaybackRate(value: number): value is PlaybackRate {
  return PLAYBACK_RATES.some((rate) => rate === value);
}

export function VideoControls({
  annotations,
  currentTime,
  duration,
  hoveredAnnotationId,
  isExpanded,
  isPlaying,
  onExpand,
  onHoverAnnotation,
  onPlaybackRateChange,
  onSeek,
  onTogglePlayback,
  playbackRate,
  showAnnotationPreview,
}: {
  annotations: PlaybackAnnotation[];
  currentTime: number;
  duration: number;
  hoveredAnnotationId: string | null;
  isExpanded: boolean;
  isPlaying: boolean;
  onExpand: () => void;
  onHoverAnnotation: (annotationId: string | null) => void;
  onPlaybackRateChange: (rate: PlaybackRate) => void;
  onSeek: (seconds: number) => void;
  onTogglePlayback: () => void;
  playbackRate: PlaybackRate;
  showAnnotationPreview: boolean;
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
        showAnnotationPreview={showAnnotationPreview}
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
          <select
            value={playbackRate}
            onChange={(event) => {
              const rate = Number(event.target.value);
              if (isPlaybackRate(rate)) onPlaybackRateChange(rate);
            }}
            className="vi-mono h-9 cursor-pointer rounded-full border border-white/12 bg-white/12 px-2 text-xs text-[var(--paper)] outline-none transition-colors hover:bg-white/22 focus:border-white/40"
            aria-label={t("videoDetail.player.playbackSpeed")}
            title={t("videoDetail.player.playbackSpeed")}
          >
            {PLAYBACK_RATES.map((rate) => (
              <option key={rate} value={rate} className="bg-[#171411] text-[var(--paper)]">
                {rate}×
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={onExpand}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-white/12 text-[var(--paper)] transition-colors hover:bg-white/22"
            aria-label={
              isExpanded
                ? t("videoDetail.player.exitFullscreen")
                : t("videoDetail.player.fullscreen")
            }
            title={
              isExpanded
                ? t("videoDetail.player.exitFullscreen")
                : t("videoDetail.player.fullscreen")
            }
          >
            {isExpanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
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
  showAnnotationPreview,
}: {
  annotations: PlaybackAnnotation[];
  currentTime: number;
  duration: number;
  hoveredAnnotationId: string | null;
  onHoverAnnotation: (annotationId: string | null) => void;
  onSeek: (seconds: number) => void;
  showAnnotationPreview: boolean;
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
      className="relative block h-[1.4rem] w-full cursor-pointer rounded-full py-[0.45rem] disabled:cursor-not-allowed"
      data-video-scrubber="true"
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
          const width = Math.max((annotation.duration_seconds / duration) * 100, 0.45);
          const previewPositionClass =
            left > 78 ? "right-0" : left < 22 ? "left-0" : "left-1/2 -translate-x-1/2";
          return (
            <motion.span
              key={annotation.id}
              className="absolute top-1/2 h-[0.7rem] origin-center -translate-y-1/2 rounded-full opacity-95 ring-2 ring-black/30"
              animate={{ scaleY: hoveredAnnotationId === annotation.id ? 1.25 : 1 }}
              transition={{ duration: 0.14, ease: "easeOut" }}
              style={{
                left: `${left}%`,
                width: `${Math.min(width, 100 - left)}%`,
                backgroundColor: annotation.color,
              }}
              onMouseEnter={() => onHoverAnnotation(annotation.id)}
              onMouseLeave={() => onHoverAnnotation(null)}
              onFocus={() => onHoverAnnotation(annotation.id)}
              onBlur={() => onHoverAnnotation(null)}
              title={`${formatDuration(annotation.timestamp_seconds)} ${annotation.preview}`}
            >
              <AnimatePresence>
                {showAnnotationPreview && hoveredAnnotationId === annotation.id && (
                  <motion.span
                    className={cn(
                      "pointer-events-none absolute bottom-4 z-20 w-56 rounded-md border border-white/12 bg-[#171411]/95 px-2.5 py-2 text-left text-[var(--paper)] shadow-xl",
                      previewPositionClass,
                    )}
                    initial={{ opacity: 0, y: 5, scale: 0.96 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 4, scale: 0.98 }}
                    transition={{ duration: 0.12, ease: "easeOut" }}
                  >
                    <span className="vi-mono block text-[0.68rem] leading-none text-white/58">
                      {formatDuration(annotation.timestamp_seconds)}
                    </span>
                    <span className="mt-1 line-clamp-2 block text-sm font-semibold leading-tight">
                      {annotation.preview}
                    </span>
                  </motion.span>
                )}
              </AnimatePresence>
            </motion.span>
          );
        })}
      <motion.span
        className="absolute top-1/2 h-[0.8rem] w-[0.8rem] -translate-x-1/2 -translate-y-1/2 rounded-full border border-black/25 bg-[var(--paper)] shadow"
        animate={{ left: `${progressPercent}%` }}
        transition={{ duration: 0.16, ease: "easeOut" }}
      />
    </button>
  );
}

function clampRange(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}
