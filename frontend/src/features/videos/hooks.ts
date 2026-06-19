import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createAnnotation,
  createVideo,
  deleteAnnotation,
  deleteVideo,
  fetchAnnotations,
  fetchVideo,
  fetchVideos,
  updateAnnotation,
  updateVideo,
} from "./api";

export function useVideos(page = 1, pageSize = 20) {
  return useQuery({
    queryKey: ["videos", page, pageSize],
    queryFn: () => fetchVideos(page, pageSize),
  });
}

export function useVideo(id: string) {
  return useQuery({
    queryKey: ["videos", id],
    queryFn: () => fetchVideo(id),
  });
}

export function useCreateVideo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createVideo,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["videos"] }),
  });
}

export function useUpdateVideo(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { title?: string; description?: string | null }) =>
      updateVideo(id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["videos"] }),
  });
}

export function useDeleteVideo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteVideo,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["videos"] }),
  });
}

export function useAnnotations(videoId: string) {
  return useQuery({
    queryKey: ["annotations", videoId],
    queryFn: () => fetchAnnotations(videoId),
  });
}

export function useCreateAnnotation(videoId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: Parameters<typeof createAnnotation>[1]) =>
      createAnnotation(videoId, data),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["annotations", videoId] }),
  });
}

export function useUpdateAnnotation(videoId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { id: string; values: Parameters<typeof updateAnnotation>[1] }) =>
      updateAnnotation(data.id, data.values),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["annotations", videoId] }),
  });
}

export function useDeleteAnnotation(videoId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteAnnotation,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["annotations", videoId] }),
  });
}
