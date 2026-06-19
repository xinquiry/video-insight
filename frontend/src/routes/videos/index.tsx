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
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Videos</h1>
          <p className="mt-1 text-sm text-gray-500">
            Upload source videos for shared student learning materials.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowForm((value) => !value)}
          className="inline-flex items-center gap-2 rounded-md bg-[var(--color-primary)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--color-primary-hover)]"
        >
          <Plus className="h-4 w-4" />
          New Video
        </button>
      </div>

      {showForm && <CreateVideoForm onDone={() => setShowForm(false)} />}
      {editing && (
        <EditVideoForm video={editing} onDone={() => setEditing(null)} />
      )}

      {isLoading && <p className="text-gray-500">Loading...</p>}

      {data && (
        <>
          <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    Title
                  </th>
                  <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    File
                  </th>
                  <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    Created
                  </th>
                  <th className="px-5 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {data.items.map((video) => (
                  <tr key={video.id} className="hover:bg-gray-50">
                    <td className="px-5 py-4">
                      <Link
                        to="/videos/$videoId"
                        params={{ videoId: video.id }}
                        className="font-medium text-[var(--color-primary)] hover:underline"
                      >
                        {video.title}
                      </Link>
                      <p className="mt-1 max-w-xl text-sm text-gray-500">
                        {video.description ?? "No description"}
                      </p>
                    </td>
                    <td className="px-5 py-4 text-sm text-gray-500">
                      <div className="flex items-center gap-2">
                        <VideoIcon className="h-4 w-4" />
                        <span>{video.original_filename}</span>
                      </div>
                      <p className="mt-1">{formatBytes(video.size_bytes)}</p>
                    </td>
                    <td className="px-5 py-4 text-sm text-gray-500">
                      {formatDate(video.created_at)}
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setEditing(video)}
                          className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-gray-300 text-gray-600 hover:bg-gray-50"
                          aria-label="Edit video"
                          title="Edit video"
                        >
                          <Edit2 className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteVideo.mutate(video.id)}
                          disabled={deleteVideo.isPending}
                          className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-red-300 text-red-600 hover:bg-red-50 disabled:opacity-60"
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
                    <td className="px-5 py-8 text-center text-sm text-gray-500" colSpan={4}>
                      No videos yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-500">
              {data.total} video{data.total !== 1 && "s"} total
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((value) => value - 1)}
                className="rounded-md border border-gray-300 px-3 py-1 text-sm disabled:opacity-50"
              >
                Previous
              </button>
              <button
                type="button"
                disabled={page * 20 >= data.total}
                onClick={() => setPage((value) => value + 1)}
                className="rounded-md border border-gray-300 px-3 py-1 text-sm disabled:opacity-50"
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
      className="space-y-4 rounded-lg border border-gray-200 bg-white p-5"
    >
      <div className="grid gap-4 md:grid-cols-2">
        <label className="block text-sm font-medium text-gray-700">
          Title
          <input
            type="text"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            required
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-[var(--color-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]"
          />
        </label>
        <label className="block text-sm font-medium text-gray-700">
          Video file
          <input
            type="file"
            accept="video/*"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            required
            className="mt-1 block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-gray-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-gray-700 hover:file:bg-gray-200"
          />
        </label>
      </div>
      <label className="block text-sm font-medium text-gray-700">
        Description
        <textarea
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          rows={3}
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-[var(--color-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]"
        />
      </label>
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={!title || !file || createVideo.isPending}
          className="inline-flex items-center gap-2 rounded-md bg-[var(--color-primary)] px-4 py-2 text-sm text-white hover:bg-[var(--color-primary-hover)] disabled:opacity-50"
        >
          <Upload className="h-4 w-4" />
          {createVideo.isPending ? "Uploading..." : "Upload"}
        </button>
        <button
          type="button"
          onClick={onDone}
          className="rounded-md border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50"
        >
          Cancel
        </button>
      </div>
      {createVideo.isError && (
        <p className="text-sm text-red-600">Upload failed. Please try again.</p>
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
      className="space-y-4 rounded-lg border border-gray-200 bg-white p-5"
    >
      <div className="grid gap-4 md:grid-cols-2">
        <label className="block text-sm font-medium text-gray-700">
          Title
          <input
            type="text"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            required
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-[var(--color-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]"
          />
        </label>
        <div className="text-sm text-gray-500">
          <p className="font-medium text-gray-700">File</p>
          <p className="mt-2">{video.original_filename}</p>
          <p>{formatBytes(video.size_bytes)}</p>
        </div>
      </div>
      <label className="block text-sm font-medium text-gray-700">
        Description
        <textarea
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          rows={3}
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-[var(--color-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]"
        />
      </label>
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={!title || updateVideo.isPending}
          className="rounded-md bg-[var(--color-primary)] px-4 py-2 text-sm text-white hover:bg-[var(--color-primary-hover)] disabled:opacity-50"
        >
          {updateVideo.isPending ? "Saving..." : "Save"}
        </button>
        <button
          type="button"
          onClick={onDone}
          className="rounded-md border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
