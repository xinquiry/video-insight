import { Link, createFileRoute } from "@tanstack/react-router";
import { Edit2, Plus, Trash2, Upload, Video as VideoIcon } from "lucide-react";
import { useState } from "react";
import {
  useCreateVideo,
  useDeleteVideo,
  useUpdateVideo,
  useVideos,
} from "@/features/videos/hooks";
import { formatBytes, formatDate } from "@/lib/utils";
import type { Video } from "@/types";

export const Route = createFileRoute("/videos/")({
  component: VideosPage,
});

function VideosPage() {
  const [page, setPage] = useState(1);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Video | null>(null);
  const { data, isLoading } = useVideos(page, 20);
  const deleteVideo = useDeleteVideo();

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-6 border-b border-[var(--ink)] pb-8">
        <div>
          <p className="vi-kicker">Archive</p>
          <h1 className="vi-display mt-3 text-5xl">Videos</h1>
          <p className="mt-3 max-w-2xl text-sm text-[var(--muted)]">
            Upload source videos for shared student learning materials.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowForm((value) => !value)}
          className="vi-button-primary"
        >
          <Plus className="h-4 w-4" />
          New Video
        </button>
      </div>

      {showForm && <CreateVideoForm onDone={() => setShowForm(false)} />}
      {editing && (
        <EditVideoForm video={editing} onDone={() => setEditing(null)} />
      )}

      {isLoading && <p className="text-[var(--muted)]">Loading...</p>}

      {data && (
        <>
          <div className="vi-panel overflow-hidden">
            <table className="min-w-full divide-y divide-[var(--rule)]">
              <thead className="bg-[var(--paper)]">
                <tr>
                  <th className="vi-kicker px-5 py-3 text-left">
                    Title
                  </th>
                  <th className="vi-kicker px-5 py-3 text-left">
                    File
                  </th>
                  <th className="vi-kicker px-5 py-3 text-left">
                    Created
                  </th>
                  <th className="vi-kicker px-5 py-3 text-right">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--rule)]">
                {data.items.map((video) => (
                  <tr key={video.id} className="hover:bg-[rgba(192,81,47,0.04)]">
                    <td className="px-5 py-4">
                      <Link
                        to="/videos/$videoId"
                        params={{ videoId: video.id }}
                        className="vi-display vi-link text-lg"
                      >
                        {video.title}
                      </Link>
                      <p className="mt-1 max-w-xl text-sm text-[var(--muted)]">
                        {video.description ?? "No description"}
                      </p>
                    </td>
                    <td className="px-5 py-4 text-sm text-[var(--muted)]">
                      <div className="flex items-center gap-2">
                        <VideoIcon className="h-4 w-4" />
                        <span>{video.original_filename}</span>
                      </div>
                      <p className="vi-mono mt-1 text-xs">{formatBytes(video.size_bytes)}</p>
                    </td>
                    <td className="vi-mono px-5 py-4 text-xs text-[var(--muted)]">
                      {formatDate(video.created_at)}
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setEditing(video)}
                          className="vi-icon-button"
                          aria-label="Edit video"
                          title="Edit video"
                        >
                          <Edit2 className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteVideo.mutate(video.id)}
                          disabled={deleteVideo.isPending}
                          className="vi-icon-button border-[rgba(159,47,36,0.35)] text-[var(--danger)] hover:bg-[rgba(159,47,36,0.07)] disabled:opacity-60"
                          aria-label="Delete video"
                          title="Delete video"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {data.items.length === 0 && (
                  <tr>
                    <td className="px-5 py-12 text-center text-sm text-[var(--muted)]" colSpan={4}>
                      No videos yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between">
            <p className="vi-mono text-xs text-[var(--muted)]">
              {data.total} video{data.total !== 1 && "s"} total
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((value) => value - 1)}
                className="vi-button-secondary min-h-0 px-3 py-1 text-sm disabled:opacity-50"
              >
                Previous
              </button>
              <button
                type="button"
                disabled={page * 20 >= data.total}
                onClick={() => setPage((value) => value + 1)}
                className="vi-button-secondary min-h-0 px-3 py-1 text-sm disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function CreateVideoForm({ onDone }: { onDone: () => void }) {
  const createVideo = useCreateVideo();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!file) return;
    createVideo.mutate(
      { title, description: description || undefined, file },
      { onSuccess: () => onDone() },
    );
  };

  return (
    <form
      onSubmit={submit}
      className="vi-panel space-y-5 p-5"
    >
      <div className="grid gap-4 md:grid-cols-2">
        <label className="vi-label">
          Title
          <input
            type="text"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            required
            className="vi-input mt-1 text-base normal-case"
          />
        </label>
        <label className="vi-label">
          Video file
          <input
            type="file"
            accept="video/*"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            required
            className="mt-3 block w-full text-sm normal-case text-[var(--muted)] file:mr-3 file:rounded-lg file:border file:border-[var(--ink)] file:bg-transparent file:px-3 file:py-2 file:text-sm file:font-semibold file:text-[var(--ink)] hover:file:bg-[var(--ink)] hover:file:text-[var(--paper)]"
          />
        </label>
      </div>
      <label className="vi-label">
        Description
        <textarea
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          rows={3}
          className="vi-textarea mt-1 text-base normal-case"
        />
      </label>
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={!title || !file || createVideo.isPending}
          className="vi-button-primary disabled:opacity-50"
        >
          <Upload className="h-4 w-4" />
          {createVideo.isPending ? "Uploading..." : "Upload"}
        </button>
        <button
          type="button"
          onClick={onDone}
          className="vi-button-secondary"
        >
          Cancel
        </button>
      </div>
      {createVideo.isError && (
        <p className="text-sm text-[var(--danger)]">Upload failed. Please try again.</p>
      )}
    </form>
  );
}

function EditVideoForm({
  video,
  onDone,
}: {
  video: Video;
  onDone: () => void;
}) {
  const updateVideo = useUpdateVideo(video.id);
  const [title, setTitle] = useState(video.title);
  const [description, setDescription] = useState(video.description ?? "");

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    updateVideo.mutate(
      { title, description },
      { onSuccess: () => onDone() },
    );
  };

  return (
    <form
      onSubmit={submit}
      className="vi-panel space-y-5 p-5"
    >
      <div className="grid gap-4 md:grid-cols-2">
        <label className="vi-label">
          Title
          <input
            type="text"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            required
            className="vi-input mt-1 text-base normal-case"
          />
        </label>
        <div className="text-sm text-[var(--muted)]">
          <p className="vi-label">File</p>
          <p className="mt-2 text-[var(--ink)]">{video.original_filename}</p>
          <p className="vi-mono text-xs">{formatBytes(video.size_bytes)}</p>
        </div>
      </div>
      <label className="vi-label">
        Description
        <textarea
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          rows={3}
          className="vi-textarea mt-1 text-base normal-case"
        />
      </label>
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={!title || updateVideo.isPending}
          className="vi-button-primary disabled:opacity-50"
        >
          {updateVideo.isPending ? "Saving..." : "Save"}
        </button>
        <button
          type="button"
          onClick={onDone}
          className="vi-button-secondary"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
