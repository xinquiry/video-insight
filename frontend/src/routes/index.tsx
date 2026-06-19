import { createFileRoute } from "@tanstack/react-router";
import { Link } from "@tanstack/react-router";
import { Clock, Film, Plus, Tags } from "lucide-react";
import { useVideos } from "@/features/videos/hooks";
import { formatBytes, formatDate } from "@/lib/utils";

export const Route = createFileRoute("/")({
  component: DashboardPage,
});

function DashboardPage() {
  const { data } = useVideos(1, 5);
  const videos = data?.items ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Learning Video Library</h1>
          <p className="mt-1 text-sm text-gray-500">
            Shared videos and timestamped annotations for students.
          </p>
        </div>
        <Link
          to="/videos"
          className="inline-flex items-center gap-2 rounded-md bg-[var(--color-primary)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--color-primary-hover)]"
        >
          <Plus className="h-4 w-4" />
          Add Video
        </Link>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-lg border border-gray-200 bg-white p-5">
          <Film className="h-5 w-5 text-[var(--color-primary)]" />
          <p className="mt-3 text-sm text-gray-500">Total videos</p>
          <p className="mt-1 text-3xl font-semibold">{data?.total ?? "..."}</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-5">
          <Clock className="h-5 w-5 text-[var(--color-primary)]" />
          <p className="mt-3 text-sm text-gray-500">Recent uploads</p>
          <p className="mt-1 text-3xl font-semibold">{videos.length}</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-5">
          <Tags className="h-5 w-5 text-[var(--color-primary)]" />
          <p className="mt-3 text-sm text-gray-500">Annotation model</p>
          <p className="mt-1 text-lg font-semibold">Shared</p>
        </div>
      </div>

      {videos.length > 0 && (
        <div>
          <h2 className="mb-3 text-lg font-semibold">Recent Videos</h2>
          <ul className="divide-y divide-gray-200 overflow-hidden rounded-lg border border-gray-200 bg-white">
            {videos.map((video) => (
              <li
                key={video.id}
                className="flex items-center justify-between gap-4 px-4 py-3"
              >
                <div>
                  <Link
                    to="/videos/$videoId"
                    params={{ videoId: video.id }}
                    className="font-medium text-[var(--color-primary)] hover:underline"
                  >
                    {video.title}
                  </Link>
                  <p className="mt-1 text-sm text-gray-500">
                    {video.description ?? video.original_filename}
                  </p>
                </div>
                <div className="text-right text-sm text-gray-500">
                  <p>{formatBytes(video.size_bytes)}</p>
                  <p>{formatDate(video.created_at)}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
