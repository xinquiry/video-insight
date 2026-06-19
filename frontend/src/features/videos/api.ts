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

export function createVideo(data: {
  title: string;
  description?: string;
  file: File;
}) {
  const form = new FormData();
  form.append("title", data.title);
  if (data.description) form.append("description", data.description);
  form.append("file", data.file);
  return apiClient.postForm<Video>("/api/videos", form);
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
