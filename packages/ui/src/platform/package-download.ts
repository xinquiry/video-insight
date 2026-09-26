/**
 * 流式 .vinsight 组包下载器。
 *
 * 结构(与 backend/internal/portable/document.go 的 WritePackage 字节级一致,
 * 桌面端 sidecar 按此契约解析):
 *   mimetype(Store, 首条) → manifest.json(Deflate) → assets/*(Store) → media/*(Store)
 *
 * 关键设计:
 * - 视频字节不进内存:每块 Range 分块下载(单块重试)后立即写入输出流。
 * - 优先 File System Access API(showSaveFilePicker + FileSystemWritableFileStream),
 *   边组边落盘,内存占用为常数级;不支持时降级为 Blob(全部缓冲在内存,
 *   需要调用方确保设备内存足够——桌面场景可接受)。
 * - 视频条目用 ZipPassThrough(Store,零 CPU);manifest 用 ZipDeflate。
 */
import {
  type AsyncFlateStreamHandler,
  Zip,
  ZipDeflate,
  ZipPassThrough,
  strToU8,
} from "fflate";

export const PACKAGE_MIME = "application/vnd.videoinsight.package+zip";
export const PACKAGE_EXTENSION = ".vinsight";

export type DownloadProgress = {
  receivedBytes: number;
  totalBytes: number;
};

export type PackageDownloadInput = {
  /** 预签名的视频对象 URL(网盘 COS),支持 Range。 */
  videoUrl: string;
  /** 便携包 manifest 文档(后端 /package-manifest 现场生成的 JSON)。 */
  document: unknown;
  /** 视频条目在包内的路径,如 media/lesson.mp4。 */
  mediaPath: string;
  /** 视频字节总数(用于进度与分块计划)。 */
  videoBytes: number;
  /** 标注中外置的图片资源(已 base64 解码)。 */
  assets: Array<{ path: string; data: Uint8Array }>;
  /** 保存文件名(不含扩展名)。 */
  filename: string;
  onProgress?: (progress: DownloadProgress) => void;
  signal?: AbortSignal;
};

type ChunkPlan = { start: number; endInclusive: number };

const DEFAULT_CHUNK_SIZE = 8 * 1024 * 1024;
const DEFAULT_MAX_RETRIES = 5;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function chunkPlans(total: number, chunkSize: number): ChunkPlan[] {
  const plans: ChunkPlan[] = [];
  for (let offset = 0; offset < total; offset += chunkSize) {
    plans.push({ start: offset, endInclusive: Math.min(offset + chunkSize, total) - 1 });
  }
  return plans;
}

async function fetchChunk(
  url: string,
  plan: ChunkPlan,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  const response = await fetch(url, {
    headers: { Range: `bytes=${plan.start}-${plan.endInclusive}` },
    signal,
  });
  if (response.status !== 206 && response.status !== 200) {
    throw new Error(`chunk ${plan.start} failed with status ${response.status}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

async function fetchChunkWithRetry(
  url: string,
  plan: ChunkPlan,
  maxRetries: number,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      return await fetchChunk(url, plan, signal);
    } catch (error) {
      if (signal?.aborted) throw error;
      lastError = error;
      await sleep(Math.min(500 * 2 ** attempt, 8000));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("chunk download failed");
}

/** 输出目标:支持顺序 write + close 的最小接口(两种模式共用)。 */
export interface SaveTarget {
  write(bytes: Uint8Array): Promise<void>;
  close(): Promise<void>;
  /** Blob 模式下取最终结果;流式模式返回 null(已直接落盘)。 */
  result(): Blob | null;
}

async function openSaveTarget(
  filename: string,
): Promise<SaveTarget | null> {
  // File System Access API:建议优先(Chrome/Edge);用户取消选择返回 null。
  const picker = (window as { showSaveFilePicker?: (options: unknown) => Promise<FileSystemFileHandle> })
    .showSaveFilePicker;
  if (typeof picker === "function") {
    try {
      const handle = await picker({
        suggestedName: `${filename}${PACKAGE_EXTENSION}`,
        types: [{ description: "VideoInsight package", accept: { [PACKAGE_MIME]: [PACKAGE_EXTENSION] } }],
      });
      const writable = await handle.createWritable();
      return {
        write: (bytes) => writable.write(bytes.slice().buffer as ArrayBuffer),
        close: () => writable.close(),
        result: () => null,
      };
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return null;
      // picker 存在但失败(如非用户手势):降级到 Blob。
    }
  }
  const chunks: BlobPart[] = [];
  return {
    write: async (bytes) => {
      chunks.push(bytes.slice().buffer as ArrayBuffer);
    },
    close: async () => {},
    result: () => new Blob(chunks, { type: PACKAGE_MIME }),
  };
}

/**
 * 组包并保存。返回:
 * - "saved":已写入用户选择的文件(流式)或已触发下载(Blob)。
 * - "cancelled":用户取消了保存对话框。
 */
export async function downloadVinsightPackage(
  input: PackageDownloadInput,
): Promise<"saved" | "cancelled"> {
  const target = await openSaveTarget(input.filename);
  if (!target) return "cancelled";

  const abort = input.signal;

  let zipError: Error | null = null;
  const zipDone = new Promise<void>((resolve, reject) => {
    zipPromiseResolve = resolve;
    zipPromiseReject = reject;
  });
  var zipPromiseResolve: () => void;
  var zipPromiseReject: (err: Error) => void;

  const onZipData: AsyncFlateStreamHandler = (err, data, final) => {
    if (err) {
      zipError = err;
      zipPromiseReject(err);
      return;
    }
    if (data && data.length > 0) {
      void target
        .write(data)
        .then(() => {
          if (final) zipPromiseResolve();
        })
        .catch(zipPromiseReject);
    } else if (final) {
      zipPromiseResolve();
    }
  };

  const zip = new Zip(onZipData);

  // 1. mimetype — Store, 首条目(未压缩,便于类型嗅探)。
  const mimetype = new ZipPassThrough("mimetype");
  zip.add(mimetype);
  mimetype.push(strToU8(PACKAGE_MIME), true);

  // 2. manifest.json — Deflate(几 KB,内容压缩有收益)。
  const manifest = new ZipDeflate("manifest.json", { level: 6 });
  zip.add(manifest);
  manifest.push(strToU8(JSON.stringify(input.document, null, 2) + "\n"), true);

  // 3. assets — Store, 资源已是压缩格式。
  for (const asset of input.assets) {
    const entry = new ZipPassThrough(asset.path);
    zip.add(entry);
    entry.push(asset.data, true);
  }

  // 4. media/<filename> — Store, 分块流式写入(核心路径,内存常数级)。
  const media = new ZipPassThrough(input.mediaPath);
  zip.add(media);

  let received = 0;
  const plans = chunkPlans(input.videoBytes, DEFAULT_CHUNK_SIZE);
  for (const plan of plans) {
    if (abort?.aborted) throw new DOMException("Download aborted", "AbortError");
    const chunk = await fetchChunkWithRetry(input.videoUrl, plan, DEFAULT_MAX_RETRIES, abort);
    const last = plan.endInclusive >= input.videoBytes - 1;
    await new Promise<void>((resolve, reject) => {
      try {
        media.push(chunk, last);
        // ZipPassThrough ondata emits the data synchronously; drain it.
        resolve();
      } catch (err) {
        reject(err instanceof Error ? err : new Error("zip media write failed"));
      }
    });
    received += chunk.length;
    input.onProgress?.({ receivedBytes: received, totalBytes: input.videoBytes });
  }

  // 关闭 zip(central directory 落盘),等待全部写出。
  zip.end();
  await zipDone;
  if (zipError) throw zipError;
  await target.close();

  // Blob 模式:触发浏览器下载。
  const blob = target.result();
  if (blob) {
    const anchor = document.createElement("a");
    anchor.href = URL.createObjectURL(blob);
    anchor.download = `${input.filename}${PACKAGE_EXTENSION}`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(anchor.href), 60_000);
  }
  return "saved";
}

/**
 * 从标注富文本中提取内嵌 base64 图片为包资源(引用替换为
 * vinsight-asset://)。与后端 externalizeImages 行为一致。
 */
export function externalizeAnnotationImages(
  value: unknown,
  assets: Map<string, { path: string; data: Uint8Array }>,
): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => externalizeAnnotationImages(item, assets));
  }
  if (typeof value !== "object" || value === null) return value;
  const node = value as Record<string, unknown>;
  const attrs = node.attrs as Record<string, unknown> | undefined;
  if (node.type === "image" && attrs) {
    const src = typeof attrs.src === "string" ? attrs.src : "";
    const asset = assetFromDataURL(src);
    if (asset) {
      assets.set(asset.path, asset);
      attrs.src = `vinsight-asset://${asset.path}`;
    }
  }
  for (const key of Object.keys(node)) {
    node[key] = externalizeAnnotationImages(node[key], assets);
  }
  return node;
}

function assetFromDataURL(source: string): { path: string; data: Uint8Array } | null {
  const types: Array<{ prefix: string; extension: string }> = [
    { prefix: "data:image/png;base64,", extension: ".png" },
    { prefix: "data:image/jpeg;base64,", extension: ".jpg" },
    { prefix: "data:image/gif;base64,", extension: ".gif" },
    { prefix: "data:image/webp;base64,", extension: ".webp" },
  ];
  for (const { prefix, extension } of types) {
    if (!source.startsWith(prefix)) continue;
    const binary = atob(source.slice(prefix.length));
    const data = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) data[i] = binary.charCodeAt(i);
    const path = `assets/${sha1HexSync(data)}${extension}`;
    return { path, data };
  }
  return null;
}

function sha1HexSync(data: Uint8Array): string {
  // 资源路径只需要稳定去重,不要求密码学强度;FNV-1a 64bit 足够。
  let hash = 0xcbf29ce484222325n;
  for (const byte of data) {
    hash ^= BigInt(byte);
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, "0");
}
