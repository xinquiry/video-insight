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

  if (isLoading) return <p className="text-gray-500">Loading...</p>;
  if (isError || !video)
    return <p className="text-red-600">Video not found.</p>;

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
    <div className="space-y-6">
      <Link
        to="/videos"
        className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to videos
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{video.title}</h1>
          <p className="mt-1 max-w-3xl text-sm text-gray-500">
            {video.description ?? "No description"}
          </p>
        </div>
        <button
          type="button"
          onClick={handleDeleteVideo}
          disabled={deleteVideo.isPending}
          className="inline-flex items-center gap-2 rounded-md border border-red-300 px-3 py-2 text-sm text-red-600 hover:bg-red-50 disabled:opacity-60"
        >
          <Trash2 className="h-4 w-4" />
          Delete Video
        </button>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        <section className="space-y-4">
          <div className="relative overflow-hidden rounded-lg border border-gray-200 bg-black">
            {video.playback_url ? (
              <>
                <video
                  ref={videoElement}
                  src={video.playback_url}
                  controls
                  onDurationChange={updateVideoTiming}
                  onLoadedMetadata={updateVideoTiming}
                  onTimeUpdate={updateVideoTiming}
                  className="aspect-video w-full bg-black"
                />
                <AnnotationOverlay annotations={activeAnnotations} />
              </>
            ) : (
              <div className="flex aspect-video items-center justify-center text-sm text-white">
                Video URL unavailable.
              </div>
            )}
          </div>

          <dl className="grid gap-4 rounded-lg border border-gray-200 bg-white p-4 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-gray-500">File</dt>
              <dd className="mt-1 font-medium">{video.original_filename}</dd>
            </div>
            <div>
              <dt className="text-gray-500">Size</dt>
              <dd className="mt-1 font-medium">{formatBytes(video.size_bytes)}</dd>
            </div>
            <div>
              <dt className="text-gray-500">Created</dt>
              <dd className="mt-1 font-medium">{formatDate(video.created_at)}</dd>
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

        <aside className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Annotations</h2>
            <span className="text-sm text-gray-500">{annotations.length}</span>
          </div>
          <div className="space-y-3">
            {annotations.map((annotation) => (
              <article
                key={annotation.id}
                className="rounded-lg border border-gray-200 bg-white p-4"
                style={{ borderLeft: `4px solid ${annotation.color}` }}
              >
                <div className="flex items-start justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => seekTo(annotation.timestamp_seconds)}
                    className="inline-flex items-center gap-2 rounded-md bg-gray-100 px-2 py-1 text-sm font-medium text-gray-800 hover:bg-gray-200"
                  >
                    <Clock className="h-4 w-4" />
                    {formatDuration(annotation.timestamp_seconds)}
                  </button>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setEditingAnnotation(annotation)}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-gray-300 text-gray-600 hover:bg-gray-50"
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
                    <h3 className="font-semibold">{annotation.title}</h3>
                    <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                      {annotation.kind}
                    </span>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-sm text-gray-700">
                    {annotation.body}
                  </p>
                </div>
              </article>
            ))}
            {annotations.length === 0 && (
              <p className="rounded-lg border border-dashed border-gray-300 bg-white p-6 text-center text-sm text-gray-500">
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
          className="max-w-2xl rounded-md border bg-black/78 p-3 text-white shadow-lg backdrop-blur"
          style={{ borderColor: annotation.color }}
        >
          <div className="flex flex-wrap items-center gap-2">
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: annotation.color }}
            />
            <span className="text-xs font-medium uppercase text-white/70">
              {annotation.kind}
            </span>
            <span className="text-xs text-white/60">
              {formatDuration(annotation.timestamp_seconds)}
            </span>
          </div>
          <h3 className="mt-1 text-base font-semibold leading-tight">
            {annotation.title}
          </h3>
          <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-sm leading-relaxed text-white/88">
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
  const [color, setColor] = useState(editing?.color ?? "#0f766e");
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
        setColor("#0f766e");
        setCustomData("{}");
      },
    });
  };

  const isPending = createAnnotation.isPending || updateAnnotation.isPending;

  return (
    <form
      onSubmit={submit}
      className="space-y-4 rounded-lg border border-gray-200 bg-white p-5"
    >
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">
            {editing ? "Edit Annotation" : "New Annotation"}
          </h2>
          <p className="mt-1 text-sm text-gray-500">
            Current {formatDuration(currentVideoTime)}
          </p>
        </div>
        {!editing && (
          <button
            type="button"
            onClick={() => setBoundedTimestamp(currentTimestamp())}
            className="inline-flex items-center gap-2 rounded-md border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50"
          >
            <Clock className="h-4 w-4" />
            Use Current Time
          </button>
        )}
      </div>

      <div className="space-y-2 rounded-md border border-gray-200 bg-gray-50 p-3">
        <div className="flex items-center justify-between text-sm text-gray-600">
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
          className="block w-full accent-[var(--color-primary)] disabled:opacity-50"
          aria-label="Annotation timestamp"
        />
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <label className="block text-sm font-medium text-gray-700">
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
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-[var(--color-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]"
          />
        </label>
        <label className="block text-sm font-medium text-gray-700 md:col-span-2">
          Title
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            required
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-[var(--color-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]"
          />
        </label>
        <label className="block text-sm font-medium text-gray-700">
          Color
          <input
            type="color"
            value={color}
            onChange={(event) => setColor(event.target.value)}
            className="mt-1 h-10 w-full rounded-md border border-gray-300 bg-white p-1"
          />
        </label>
      </div>

      <div className="grid gap-4 md:grid-cols-[180px_minmax(0,1fr)]">
        <label className="block text-sm font-medium text-gray-700">
          Type
          <select
            value={kind}
            onChange={(event) => setKind(event.target.value)}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-[var(--color-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]"
          >
            <option value="note">Note</option>
            <option value="question">Question</option>
            <option value="resource">Resource</option>
            <option value="highlight">Highlight</option>
          </select>
        </label>
        <label className="block text-sm font-medium text-gray-700">
          Body
          <textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            rows={3}
            required
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-[var(--color-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]"
          />
        </label>
      </div>

      <label className="block text-sm font-medium text-gray-700">
        Custom JSON
        <textarea
          value={customData}
          onChange={(event) => setCustomData(event.target.value)}
          rows={4}
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 font-mono text-xs focus:border-[var(--color-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]"
        />
      </label>

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={!title || !body || isPending}
          className="inline-flex items-center gap-2 rounded-md bg-[var(--color-primary)] px-4 py-2 text-sm text-white hover:bg-[var(--color-primary-hover)] disabled:opacity-50"
        >
          <Plus className="h-4 w-4" />
          {isPending ? "Saving..." : editing ? "Save" : "Add Annotation"}
        </button>
        {editing && (
          <button
            type="button"
            onClick={onDone}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50"
          >
            Cancel
          </button>
        )}
      </div>
      {jsonError && <p className="text-sm text-red-600">{jsonError}</p>}
      {!hasDuration && (
        <p className="text-sm text-amber-700">
          Video duration is still loading.
        </p>
      )}
      {(createAnnotation.isError || updateAnnotation.isError) && (
        <p className="text-sm text-red-600">Could not save annotation.</p>
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
      className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-red-300 text-red-600 hover:bg-red-50 disabled:opacity-60"
      aria-label="Delete annotation"
      title="Delete annotation"
    >
      <Trash2 className="h-4 w-4" />
    </button>
  );
}
