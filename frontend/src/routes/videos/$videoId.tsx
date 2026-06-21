import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Clock, Edit2, Plus, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
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
  title: string;
  body: string;
  kind: string;
  color: string;
  custom_data: Record<string, unknown>;
};

function VideoDetailPage() {
  const { videoId } = Route.useParams();
  const navigate = useNavigate();
  const videoElement = useRef<HTMLVideoElement | null>(null);
  const { data: video, isLoading, isError } = useVideo(videoId);
  const { data: annotations = [] } = useAnnotations(videoId);
  const deleteVideo = useDeleteVideo();
  const [videoDuration, setVideoDuration] = useState(0);
  const [currentVideoTime, setCurrentVideoTime] = useState(0);
  const [editingAnnotation, setEditingAnnotation] = useState<Annotation | null>(
    null,
  );
  const activeAnnotations = annotations.filter((annotation) =>
    isAnnotationActive(annotation, currentVideoTime),
  );

  if (isLoading) return <p className="text-[var(--muted)]">Loading...</p>;
  if (isError || !video)
    return <p className="text-[var(--danger)]">Video not found.</p>;

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

  const currentTimestamp = () => videoElement.current?.currentTime ?? 0;
  const updateVideoTiming = () => {
    const element = videoElement.current;
    if (!element) return;
    setVideoDuration(toFiniteTime(element.duration));
    setCurrentVideoTime(toFiniteTime(element.currentTime));
  };

  return (
    <div className="mx-auto max-w-7xl space-y-8">
      <Link
        to="/videos"
        className="inline-flex items-center gap-1 text-sm text-[var(--muted)] hover:text-[var(--ink)]"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to videos
      </Link>

      <div className="flex flex-wrap items-end justify-between gap-6 border-b border-[var(--ink)] pb-8">
        <div>
          <p className="vi-kicker">Watching edition</p>
          <h1 className="vi-display mt-3 max-w-4xl text-5xl">{video.title}</h1>
          <p className="mt-4 max-w-3xl text-sm text-[var(--muted)]">
            {video.description ?? "No description"}
          </p>
        </div>
        <button
          type="button"
          onClick={handleDeleteVideo}
          disabled={deleteVideo.isPending}
          className="vi-button-danger disabled:opacity-60"
        >
          <Trash2 className="h-4 w-4" />
          Delete Video
        </button>
      </div>

      <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_400px]">
        <section className="space-y-5">
          <div className="relative overflow-hidden rounded-lg border border-[var(--rule)] bg-[#0f0e0c]">
            {video.playback_url ? (
              <>
                <video
                  ref={videoElement}
                  src={video.playback_url}
                  controls
                  onDurationChange={updateVideoTiming}
                  onLoadedMetadata={updateVideoTiming}
                  onTimeUpdate={updateVideoTiming}
                  className="aspect-video w-full bg-[#0f0e0c]"
                />
                <AnnotationOverlay annotations={activeAnnotations} />
              </>
            ) : (
              <div className="flex aspect-video items-center justify-center text-sm text-[var(--paper)]">
                Video URL unavailable.
              </div>
            )}
          </div>

          <dl className="vi-panel grid gap-0 overflow-hidden text-sm sm:grid-cols-3">
            <div>
              <div className="border-b border-[var(--rule)] p-4 sm:border-r sm:border-b-0">
                <dt className="vi-kicker">File</dt>
                <dd className="mt-2 font-medium">{video.original_filename}</dd>
              </div>
            </div>
            <div>
              <div className="border-b border-[var(--rule)] p-4 sm:border-r sm:border-b-0">
                <dt className="vi-kicker">Size</dt>
                <dd className="vi-mono mt-2 text-xs">{formatBytes(video.size_bytes)}</dd>
              </div>
            </div>
            <div>
              <div className="p-4">
                <dt className="vi-kicker">Created</dt>
                <dd className="vi-mono mt-2 text-xs">{formatDate(video.created_at)}</dd>
              </div>
            </div>
          </dl>

          <AnnotationForm
            key={editingAnnotation?.id ?? "new"}
            videoId={videoId}
            editing={editingAnnotation}
            currentTimestamp={currentTimestamp}
            currentVideoTime={currentVideoTime}
            videoDuration={videoDuration}
            onDone={() => setEditingAnnotation(null)}
          />
        </section>

        <aside className="space-y-4 xl:sticky xl:top-6 xl:self-start">
          <div className="flex items-baseline justify-between border-b border-[var(--ink)] pb-3">
            <h2 className="vi-display text-2xl">Annotations</h2>
            <span className="vi-mono text-xs text-[var(--muted)]">{annotations.length}</span>
          </div>
          <div className="space-y-3">
            {annotations.map((annotation) => (
              <article
                key={annotation.id}
                className="vi-panel vi-soft-shadow p-4"
                style={{ borderLeft: `3px solid ${annotation.color}` }}
              >
                <div className="flex items-start justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => seekTo(annotation.timestamp_seconds)}
                    className="inline-flex items-center gap-2 rounded-md border border-[var(--rule)] bg-[var(--paper)] px-2 py-1 text-sm font-semibold text-[var(--ink)] hover:border-[var(--ink)]"
                  >
                    <Clock className="h-4 w-4" />
                    {formatDuration(annotation.timestamp_seconds)}
                  </button>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setEditingAnnotation(annotation)}
                      className="vi-icon-button h-8 min-h-8 w-8"
                      aria-label="Edit annotation"
                      title="Edit annotation"
                    >
                      <Edit2 className="h-4 w-4" />
                    </button>
                    <DeleteAnnotationButton
                      videoId={videoId}
                      annotationId={annotation.id}
                    />
                  </div>
                </div>
                <div className="mt-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="vi-display text-lg">{annotation.title}</h3>
                    <span className="vi-kicker rounded border border-[var(--rule)] px-2 py-0.5">
                      {annotation.kind}
                    </span>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-sm text-[var(--ink)]">
                    {annotation.body}
                  </p>
                </div>
              </article>
            ))}
            {annotations.length === 0 && (
              <p className="rounded-lg border border-dashed border-[var(--rule-strong)] bg-[var(--surface)] p-6 text-center text-sm text-[var(--muted)]">
                No annotations yet.
              </p>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

function AnnotationOverlay({ annotations }: { annotations: Annotation[] }) {
  if (annotations.length === 0) return null;

  return (
    <div className="pointer-events-none absolute inset-x-4 bottom-16 z-10 space-y-2">
      {annotations.slice(0, 3).map((annotation) => (
        <div
          key={annotation.id}
          className="max-w-2xl rounded-lg border bg-[#1c1a17]/90 p-3 text-[var(--paper)]"
          style={{ borderColor: annotation.color }}
        >
          <div className="flex flex-wrap items-center gap-2">
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: annotation.color }}
            />
            <span className="vi-kicker text-[rgba(250,247,242,0.72)]">
              {annotation.kind}
            </span>
            <span className="vi-mono text-xs text-[rgba(250,247,242,0.62)]">
              {formatDuration(annotation.timestamp_seconds)}
            </span>
          </div>
          <h3 className="vi-display mt-1 text-lg leading-tight">
            {annotation.title}
          </h3>
          <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-sm leading-relaxed text-[rgba(250,247,242,0.88)]">
            {annotation.body}
          </p>
        </div>
      ))}
    </div>
  );
}

function isAnnotationActive(annotation: Annotation, currentTime: number) {
  const startsAt = annotation.timestamp_seconds;
  const endsAt = startsAt + getAnnotationDuration(annotation);
  return currentTime >= startsAt && currentTime <= endsAt;
}

function getAnnotationDuration(annotation: Annotation) {
  const customDuration = annotation.custom_data.duration_seconds;
  return typeof customDuration === "number" && customDuration > 0
    ? customDuration
    : 6;
}

function AnnotationForm({
  videoId,
  editing,
  currentTimestamp,
  currentVideoTime,
  videoDuration,
  onDone,
}: {
  videoId: string;
  editing: Annotation | null;
  currentTimestamp: () => number;
  currentVideoTime: number;
  videoDuration: number;
  onDone: () => void;
}) {
  const createAnnotation = useCreateAnnotation(videoId);
  const updateAnnotation = useUpdateAnnotation(videoId);
  const [timestamp, setTimestamp] = useState(
    editing?.timestamp_seconds.toString() ?? "0",
  );
  const [title, setTitle] = useState(editing?.title ?? "");
  const [body, setBody] = useState(editing?.body ?? "");
  const [kind, setKind] = useState(editing?.kind ?? "note");
  const [color, setColor] = useState(editing?.color ?? "#C0512F");
  const [customData, setCustomData] = useState(
    editing ? JSON.stringify(editing.custom_data, null, 2) : "{}",
  );
  const [jsonError, setJsonError] = useState<string | null>(null);
  const hasDuration = videoDuration > 0;
  const timestampNumber = toFiniteTime(Number(timestamp));
  const boundedTimestamp = clampTime(timestampNumber, videoDuration);

  const setBoundedTimestamp = (value: number) => {
    setTimestamp(clampTime(value, videoDuration).toFixed(1));
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(customData) as Record<string, unknown>;
      if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
        setJsonError("Custom data must be a JSON object.");
        return;
      }
      setJsonError(null);
    } catch {
      setJsonError("Custom data must be valid JSON.");
      return;
    }

    const values: AnnotationFormValues = {
      timestamp_seconds: boundedTimestamp,
      title,
      body,
      kind,
      color,
      custom_data: parsed,
    };

    if (editing) {
      updateAnnotation.mutate(
        { id: editing.id, values },
        { onSuccess: () => onDone() },
      );
      return;
    }
    createAnnotation.mutate(values, {
      onSuccess: () => {
        setTimestamp("0");
        setTitle("");
        setBody("");
        setKind("note");
        setColor("#C0512F");
        setCustomData("{}");
      },
    });
  };

  const isPending = createAnnotation.isPending || updateAnnotation.isPending;

  return (
    <form
      onSubmit={submit}
      className="vi-panel space-y-5 p-5"
    >
      <div className="flex items-center justify-between">
        <div>
          <p className="vi-kicker">Studio note</p>
          <h2 className="vi-display mt-1 text-2xl">
            {editing ? "Edit Annotation" : "New Annotation"}
          </h2>
          <p className="vi-mono mt-1 text-xs text-[var(--muted)]">
            Current {formatDuration(currentVideoTime)}
          </p>
        </div>
        {!editing && (
          <button
            type="button"
            onClick={() => setBoundedTimestamp(currentTimestamp())}
            className="vi-button-secondary min-h-0 px-3 py-1.5 text-sm"
          >
            <Clock className="h-4 w-4" />
            Use Current Time
          </button>
        )}
      </div>

      <div className="vi-panel-paper space-y-2 p-3">
        <div className="vi-mono flex items-center justify-between text-xs text-[var(--muted)]">
          <span>{formatDuration(boundedTimestamp)}</span>
          <span>{hasDuration ? formatDuration(videoDuration) : "--:--"}</span>
        </div>
        <input
          type="range"
          min="0"
          max={hasDuration ? videoDuration : 0}
          step="0.1"
          value={hasDuration ? boundedTimestamp : 0}
          onChange={(event) => setBoundedTimestamp(Number(event.target.value))}
          disabled={!hasDuration}
          className="block w-full accent-[var(--accent)] disabled:opacity-50"
          aria-label="Annotation timestamp"
        />
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <label className="vi-label">
          Time in seconds
          <input
            type="number"
            min="0"
            max={hasDuration ? videoDuration : undefined}
            step="0.1"
            value={timestamp}
            onChange={(event) => setTimestamp(event.target.value)}
            onBlur={() => setBoundedTimestamp(Number(timestamp))}
            required
            className="vi-input vi-mono mt-1 text-sm normal-case"
          />
        </label>
        <label className="vi-label md:col-span-2">
          Title
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            required
            className="vi-input mt-1 text-base normal-case"
          />
        </label>
        <label className="vi-label">
          Color
          <input
            type="color"
            value={color}
            onChange={(event) => setColor(event.target.value)}
            className="mt-3 h-10 w-full rounded-lg border border-[var(--rule-strong)] bg-[var(--surface)] p-1"
          />
        </label>
      </div>

      <div className="grid gap-4 md:grid-cols-[180px_minmax(0,1fr)]">
        <label className="vi-label">
          Type
          <select
            value={kind}
            onChange={(event) => setKind(event.target.value)}
            className="vi-select mt-1 text-sm normal-case"
          >
            <option value="note">Note</option>
            <option value="question">Question</option>
            <option value="resource">Resource</option>
            <option value="highlight">Highlight</option>
          </select>
        </label>
        <label className="vi-label">
          Body
          <textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            rows={3}
            required
            className="vi-textarea mt-1 text-base normal-case"
          />
        </label>
      </div>

      <label className="vi-label">
        Custom JSON
        <textarea
          value={customData}
          onChange={(event) => setCustomData(event.target.value)}
          rows={4}
          className="vi-textarea vi-mono mt-1 text-xs normal-case"
        />
      </label>

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={!title || !body || isPending}
          className="vi-button-primary disabled:opacity-50"
        >
          <Plus className="h-4 w-4" />
          {isPending ? "Saving..." : editing ? "Save" : "Add Annotation"}
        </button>
        {editing && (
          <button
            type="button"
            onClick={onDone}
            className="vi-button-secondary"
          >
            Cancel
          </button>
        )}
      </div>
      {jsonError && <p className="text-sm text-[var(--danger)]">{jsonError}</p>}
      {!hasDuration && (
        <p className="text-sm text-[var(--muted)]">
          Video duration is still loading.
        </p>
      )}
      {(createAnnotation.isError || updateAnnotation.isError) && (
        <p className="text-sm text-[var(--danger)]">Could not save annotation.</p>
      )}
    </form>
  );
}

function toFiniteTime(value: number) {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function clampTime(value: number, duration: number) {
  const safeValue = toFiniteTime(value);
  if (duration <= 0) return safeValue;
  return Math.min(safeValue, duration);
}

function DeleteAnnotationButton({
  videoId,
  annotationId,
}: {
  videoId: string;
  annotationId: string;
}) {
  const deleteAnnotation = useDeleteAnnotation(videoId);
  return (
    <button
      type="button"
      onClick={() => deleteAnnotation.mutate(annotationId)}
      disabled={deleteAnnotation.isPending}
      className="vi-icon-button h-8 min-h-8 w-8 border-[rgba(159,47,36,0.35)] text-[var(--danger)] hover:bg-[rgba(159,47,36,0.07)] disabled:opacity-60"
      aria-label="Delete annotation"
      title="Delete annotation"
    >
      <Trash2 className="h-4 w-4" />
    </button>
  );
}
