import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";
import {
  type UploadProgress,
  createAnnotation,
  createAnnotationComment,
  deleteAnnotation,
  deleteVideo,
  fetchAnnotations,
  fetchAnnotationComments,
  fetchDriveExport,
  fetchPackageManifest,
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
    refetchInterval: (query) => {
      const data = query.state.data;
      const videos = Array.isArray(data) ? data : (data?.items ?? []);
      return videos.some(
        (video) =>
          video.processing_status === "pending" || video.processing_status === "processing",
      )
        ? 3_000
        : false;
    },
  });
}

export function useVideo(id: string) {
  return useQuery({
    queryKey: ["videos", id],
    queryFn: () => fetchVideo(id),
    refetchOnWindowFocus: false,
    refetchInterval: (query) => {
      const status = query.state.data?.processing_status;
      return status === "pending" || status === "processing" ? 3_000 : false;
    },
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
    mutationFn: (data: { title?: string; description?: string | null }) => updateVideo(id, data),
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

export function useDriveExport(videoId: string) {
  // Publish state only drives the button label (publishing in progress).
  const status = useQuery({
    queryKey: ["drive-export", videoId],
    queryFn: () => fetchDriveExport(videoId),
    refetchOnWindowFocus: false,
    refetchInterval: (query) => {
      const state = query.state.data?.export?.status;
      return state === "pending" || state === "preparing" || state === "uploading"
        ? 2_000
        : false;
    },
  });
  return { status };
}

/**
 * 下载 .vinsight:取 manifest(视频走网盘预签名直链,标注为现场生成),
 * 浏览器流式组包落盘。未发布时抛 drive_export_not_published。
 */
export function usePackageDownload(videoId: string) {
  const [progress, setProgress] = useState<{ received: number; total: number } | null>(null);
  const mutation = useMutation({
    mutationFn: async (filename: string) => {
      const manifest = await fetchPackageManifest(videoId);
      const { downloadVinsightPackage, externalizeAnnotationImages } = await import(
        "@/platform/package-download"
      );
      const assets = new Map<string, { path: string; data: Uint8Array }>();
      for (const annotation of manifest.document.annotation_track.annotations) {
        externalizeAnnotationImages(annotation, assets);
      }
      const stem = filename.replace(/\.[^./\\]+$/, "") || "video";
      setProgress({ received: 0, total: manifest.video_bytes });
      return downloadVinsightPackage({
        videoUrl: manifest.video_url,
        document: manifest.document,
        mediaPath: manifest.document.video.media_path,
        videoBytes: manifest.video_bytes,
        assets: [...assets.values()],
        filename: stem,
        onProgress: ({ receivedBytes, totalBytes }) => setProgress({ received: receivedBytes, total: totalBytes }),
      });
    },
    onSettled: () => setProgress(null),
  });
  return { ...mutation, progress };
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
    mutationFn: (data: Parameters<typeof createAnnotation>[1]) => createAnnotation(videoId, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["annotations", videoId] }),
  });
}

export function useUpdateAnnotation(videoId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { id: string; values: Parameters<typeof updateAnnotation>[1] }) =>
      updateAnnotation(data.id, data.values),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["annotations", videoId] }),
  });
}

export function useDeleteAnnotation(videoId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteAnnotation,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["annotations", videoId] }),
  });
}

export function useAnnotationComments(annotationId: string) {
  return useQuery({
    queryKey: ["annotation-comments", annotationId],
    queryFn: () => fetchAnnotationComments(annotationId),
  });
}

export function useCreateAnnotationComment(annotationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: string) => createAnnotationComment(annotationId, body),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["annotation-comments", annotationId] }),
  });
}
