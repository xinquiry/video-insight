import { apiClient } from "@/lib/api-client";
import type { Annotation, PaginatedResponse, Video } from "@/types";

export function fetchVideos(page = 1, pageSize = 20) {
  return apiClient.get<PaginatedResponse<Video>>(
    `/api/videos?page=${page}&page_size=${pageSize}`,
  );
}

export function fetchVideo(id: string) {
  return apiClient.get<Video>(`/api/videos/${id}`);
}

export type UploadInitResponse = {
  object_key: string;
  upload_id: string;
  part_size: number;
  parts: { part_number: number; url: string }[];
  expires_in: number;
};

export type CompletedPart = { part_number: number; etag: string };

export function initUpload(payload: {
  filename: string;
  content_type: string;
  size_bytes: number;
}) {
  return apiClient.post<UploadInitResponse>("/api/videos/uploads", payload);
}

export function abortUpload(payload: { object_key: string; upload_id: string }) {
  return apiClient.post<void>("/api/videos/uploads/abort", payload);
}

export function completeUpload(payload: {
  object_key: string;
  upload_id: string;
  title: string;
  description?: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  parts: CompletedPart[];
}) {
  return apiClient.post<Video>("/api/videos", payload);
}

export type UploadProgress = {
  uploaded: number;
  total: number;
  partsCompleted: number;
  partsTotal: number;
};

export async function uploadVideo(
  data: { title: string; description?: string; file: File },
  options: {
    concurrency?: number;
    signal?: AbortSignal;
    onProgress?: (progress: UploadProgress) => void;
  } = {},
): Promise<Video> {
  const { file } = data;
  const concurrency = options.concurrency ?? 4;
  const contentType = file.type || "application/octet-stream";

  const init = await initUpload({
    filename: file.name,
    content_type: contentType,
    size_bytes: file.size,
  });

  const total = file.size;
  const partSize = init.part_size;
  const partProgress = new Map<number, number>();
  let completedParts = 0;

  const emit = () => {
    if (!options.onProgress) return;
    let uploaded = 0;
    for (const value of partProgress.values()) uploaded += value;
    options.onProgress({
      uploaded: Math.min(uploaded, total),
      total,
      partsCompleted: completedParts,
      partsTotal: init.parts.length,
    });
  };

  emit();

  const completed: CompletedPart[] = new Array(init.parts.length);
  let cursor = 0;
  let aborted = false;

  const abortServerSide = () => {
    abortUpload({ object_key: init.object_key, upload_id: init.upload_id }).catch(
      () => {},
    );
  };

  const onAbort = () => {
    aborted = true;
    abortServerSide();
  };
  options.signal?.addEventListener("abort", onAbort, { once: true });

  const uploadPart = (entry: { part_number: number; url: string }) =>
    new Promise<CompletedPart>((resolve, reject) => {
      const start = (entry.part_number - 1) * partSize;
      const end = Math.min(start + partSize, total);
      const blob = file.slice(start, end);

      const xhr = new XMLHttpRequest();
      xhr.open("PUT", entry.url, true);
      xhr.setRequestHeader("Content-Type", contentType);

      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          partProgress.set(entry.part_number, event.loaded);
          emit();
        }
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          const etag = xhr.getResponseHeader("ETag") ?? xhr.getResponseHeader("etag");
          if (!etag) {
            reject(new Error(`Part ${entry.part_number}: missing ETag`));
            return;
          }
          partProgress.set(entry.part_number, blob.size);
          completedParts += 1;
          emit();
          resolve({ part_number: entry.part_number, etag: etag.replaceAll('"', "") });
        } else {
          reject(
            new Error(
              `Part ${entry.part_number} failed: ${xhr.status} ${xhr.statusText}`,
            ),
          );
        }
      };
      xhr.onerror = () =>
        reject(new Error(`Part ${entry.part_number}: network error`));
      xhr.onabort = () => reject(new Error(`Part ${entry.part_number}: aborted`));

      if (options.signal) {
        const handler = () => xhr.abort();
        if (options.signal.aborted) {
          xhr.abort();
        } else {
          options.signal.addEventListener("abort", handler, { once: true });
        }
      }

      xhr.send(blob);
    });

  const worker = async () => {
    while (!aborted) {
      const index = cursor++;
      const part = init.parts[index];
      if (!part) return;
      // oxlint-disable-next-line no-await-in-loop -- workers consume parts serially
      const result = await uploadPart(part);
      completed[index] = result;
    }
  };

  try {
    await Promise.all(
      Array.from({ length: Math.min(concurrency, init.parts.length) }, worker),
    );
  } catch (error) {
    options.signal?.removeEventListener("abort", onAbort);
    if (!aborted) abortServerSide();
    throw error;
  }
  options.signal?.removeEventListener("abort", onAbort);

  if (aborted) {
    throw new Error("Upload aborted");
  }

  return completeUpload({
    object_key: init.object_key,
    upload_id: init.upload_id,
    title: data.title,
    description: data.description,
    filename: file.name,
    content_type: contentType,
    size_bytes: file.size,
    parts: completed,
  });
}

export function updateVideo(
  id: string,
  data: { title?: string; description?: string | null },
) {
  return apiClient.patch<Video>(`/api/videos/${id}`, data);
}

export function deleteVideo(id: string) {
  return apiClient.delete<void>(`/api/videos/${id}`);
}

export function fetchAnnotations(videoId: string) {
  return apiClient.get<Annotation[]>(`/api/videos/${videoId}/annotations`);
}

export function createAnnotation(
  videoId: string,
  data: {
    timestamp_seconds: number;
    title: string;
    body: string;
    kind: string;
    color: string;
    custom_data: Record<string, unknown>;
  },
) {
  return apiClient.post<Annotation>(`/api/videos/${videoId}/annotations`, data);
}

export function updateAnnotation(
  id: string,
  data: Partial<{
    timestamp_seconds: number;
    title: string;
    body: string;
    kind: string;
    color: string;
    custom_data: Record<string, unknown>;
  }>,
) {
  return apiClient.patch<Annotation>(`/api/annotations/${id}`, data);
}

export function deleteAnnotation(id: string) {
  return apiClient.delete<void>(`/api/annotations/${id}`);
}
