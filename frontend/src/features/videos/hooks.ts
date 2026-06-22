import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";
import {
  type UploadProgress,
  createAnnotation,
  deleteAnnotation,
  deleteVideo,
  fetchAnnotations,
  fetchVideo,
  fetchVideos,
  updateAnnotation,
  updateVideo,
  uploadVideo,
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

export function useUploadVideo() {
  const queryClient = useQueryClient();
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    setProgress(null);
    setError(null);
    setIsUploading(false);
    controllerRef.current = null;
  }, []);

  const cancel = useCallback(() => {
    controllerRef.current?.abort();
  }, []);

  const upload = useCallback(
    async (data: { title: string; description?: string; file: File }) => {
      const controller = new AbortController();
      controllerRef.current = controller;
      setError(null);
      setIsUploading(true);
      setProgress({
        uploaded: 0,
        total: data.file.size,
        partsCompleted: 0,
        partsTotal: 1,
      });
      try {
        const video = await uploadVideo(data, {
          signal: controller.signal,
          onProgress: setProgress,
        });
        await queryClient.invalidateQueries({ queryKey: ["videos"] });
        return video;
      } catch (err) {
        const wrapped = err instanceof Error ? err : new Error(String(err));
        setError(wrapped);
        throw wrapped;
      } finally {
        setIsUploading(false);
        controllerRef.current = null;
      }
    },
    [queryClient],
  );

  return { upload, cancel, reset, progress, isUploading, error };
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
