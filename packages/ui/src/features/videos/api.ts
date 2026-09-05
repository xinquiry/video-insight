import { apiClient } from "@/platform/api-client";
import { downloadObject } from "@/platform/chunked-download";
import {
  buildVinsightPackage,
  PACKAGE_EXTENSION,
  PACKAGE_MIME,
} from "@/platform/vinsight-package";
import type {
  Annotation,
  AnnotationComment,
  PaginatedResponse,
  RichTextDocument,
  Video,
} from "@/types";

export function fetchVideos(page = 1, pageSize = 20) {
  return apiClient.get<PaginatedResponse<Video>>(`/api/videos?page=${page}&page_size=${pageSize}`);
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
  concurrency: number;
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
  const contentType = file.type || "application/octet-stream";

  const init = await initUpload({
    filename: file.name,
    content_type: contentType,
    size_bytes: file.size,
  });

  const concurrency = Math.max(1, options.concurrency ?? init.concurrency ?? 1);

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
    abortUpload({ object_key: init.object_key, upload_id: init.upload_id }).catch(() => {});
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
          reject(new Error(`Part ${entry.part_number} failed: ${xhr.status} ${xhr.statusText}`));
        }
      };
      xhr.onerror = () => reject(new Error(`Part ${entry.part_number}: network error`));
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
    await Promise.all(Array.from({ length: Math.min(concurrency, init.parts.length) }, worker));
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

export function updateVideo(id: string, data: { title?: string; description?: string | null }) {
  return apiClient.patch<Video>(`/api/videos/${id}`, data);
}

export function deleteVideo(id: string) {
  return apiClient.delete<void>(`/api/videos/${id}`);
}

/**
 * 前端导出 .vinsight。
 *
 * 不再走 /export 一次性流式 zip(生产隧道在大文件长连接下会掐断)。改为:
 * 视频经 media 通道的预签名 URL 做 Range 分块下载(每块独立重试,断流只
 * 重传当前小块),批注经 app 通道取小 JSON,前端按同一契约组 zip。进度回调
 * 传入视频已下载字节(分母即 video.size_bytes)。
 */
export async function exportVideo(input: {
  id: string;
  filename: string;
  onProgress?: (receivedBytes: number, totalBytes: number) => void;
  signal?: AbortSignal;
}): Promise<"saved" | "cancelled"> {
  const [video, annotations] = await Promise.all([fetchVideo(input.id), fetchAnnotations(input.id)]);
  if (!video.playback_url) {
    throw new Error("video has no playback URL to download from");
  }
  if (video.processing_status !== "ready") {
    throw new Error("video is not ready for export");
  }

  const media = await downloadObject(video.playback_url, {
    onProgress: input.onProgress,
    signal: input.signal,
  });
  if (media.length !== video.size_bytes) {
    throw new Error(
      `downloaded size ${media.length} does not match video size ${video.size_bytes}`,
    );
  }

  const packageBytes = await buildVinsightPackage({ video, annotations, media });
  const stem = input.filename.replace(/\.[^./\\]+$/, "") || "video";
  const blob = new Blob([packageBytes.slice().buffer as ArrayBuffer], {
    type: PACKAGE_MIME,
  });
  return apiClient.saveBlob(blob, `${stem}${PACKAGE_EXTENSION}`, PACKAGE_MIME);
}

export function fetchAnnotations(videoId: string) {
  return apiClient.get<Annotation[]>(`/api/videos/${videoId}/annotations`);
}

export function createAnnotation(
  videoId: string,
  data: {
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
  },
) {
  return apiClient.post<Annotation>(`/api/videos/${videoId}/annotations`, data);
}

export function updateAnnotation(
  id: string,
  data: Partial<{
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
  }>,
) {
  return apiClient.patch<Annotation>(`/api/annotations/${id}`, data);
}

export function deleteAnnotation(id: string) {
  return apiClient.delete<void>(`/api/annotations/${id}`);
}

export function fetchAnnotationComments(annotationId: string) {
  return apiClient.get<AnnotationComment[]>(`/api/annotations/${annotationId}/comments`);
}

export function createAnnotationComment(annotationId: string, body: string) {
  return apiClient.post<AnnotationComment>(`/api/annotations/${annotationId}/comments`, {
    body,
  });
}
