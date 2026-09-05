import { strToU8, zipSync, type Zippable } from "fflate";
import type { Annotation, RichTextDocument, Video } from "@/types";

/**
 * 前端 .vinsight 组包。
 *
 * 复刻 backend/internal/portable/document.go 的 WritePackage 输出,使桌面
 * sidecar(class-button-sidecar/src/package.rs)能按同一契约解析:
 * - 首个条目为未压缩(Store)的 "mimetype",内容固定为包 MIME。
 * - "manifest.json" 为 UTF-8 JSON,Deflate 压缩。
 * - 批注里的 base64 图片外置为 assets/<sha256>.<ext>,引用改为
 *   vinsight-asset://<path>,资源本体 Store 存储。
 * - 视频本体放在 media/<filename>,Store 存储且大小等于 size_bytes。
 */

export const PACKAGE_MIME = "application/vnd.videoinsight.package+zip";
export const PACKAGE_EXTENSION = ".vinsight";
const MANIFEST_PATH = "manifest.json";
const ASSET_SCHEME = "vinsight-asset://";
const MAX_PACKAGE_ASSETS = 4093;
const MAX_PACKAGE_ASSET_BYTES = 64 * 1024 * 1024;
const MAX_IMAGE_BYTES = 50 * 1024 * 1024;

const DOCUMENT_FORMAT = "videoinsight.annotated-video";
const DOCUMENT_FORMAT_VERSION = 1;
const TRACK_FORMAT = "videoinsight.annotation-track";
const TRACK_FORMAT_VERSION = 1;

type Asset = { path: string; data: Uint8Array };

const IMAGE_TYPES: ReadonlyArray<{ prefix: string; contentType: string; extension: string }> = [
  { prefix: "data:image/png;base64,", contentType: "image/png", extension: ".png" },
  { prefix: "data:image/jpeg;base64,", contentType: "image/jpeg", extension: ".jpg" },
  { prefix: "data:image/gif;base64,", contentType: "image/gif", extension: ".gif" },
  { prefix: "data:image/webp;base64,", contentType: "image/webp", extension: ".webp" },
];

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

async function sha256Hex(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data.slice().buffer as ArrayBuffer);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

function validImageSignature(contentType: string, data: Uint8Array): boolean {
  const starts = (...bytes: number[]) => bytes.every((b, i) => data[i] === b);
  switch (contentType) {
    case "image/png":
      return starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
    case "image/jpeg":
      return starts(0xff, 0xd8, 0xff);
    case "image/gif":
      return starts(0x47, 0x49, 0x46, 0x38);
    case "image/webp":
      return (
        data.length >= 12 &&
        starts(0x52, 0x49, 0x46, 0x46) &&
        data[8] === 0x57 && data[9] === 0x45 && data[10] === 0x42 && data[11] === 0x50
      );
    default:
      return false;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 深拷贝批注 content,并把其中的 base64 图片外置进 assets。 */
async function externalizeImages(
  value: unknown,
  assets: Map<string, Asset>,
): Promise<unknown> {
  if (Array.isArray(value)) {
    const out: unknown[] = [];
    for (const child of value) out.push(await externalizeImages(child, assets));
    return out;
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      if (key === "attrs" && isPlainObject(child) && value["type"] === "image") {
        const source = child["src"];
        out[key] = { ...child };
        if (typeof source === "string" && source !== "") {
          const asset = await assetFromDataURL(source);
          if (asset) {
            assets.set(asset.path, asset);
            (out[key] as Record<string, unknown>)["src"] = ASSET_SCHEME + asset.path;
          }
        }
        continue;
      }
      out[key] = await externalizeImages(child, assets);
    }
    return out;
  }
  return value;
}

async function assetFromDataURL(source: string): Promise<Asset | null> {
  for (const imageType of IMAGE_TYPES) {
    if (!source.startsWith(imageType.prefix)) continue;
    const data = base64ToBytes(source.slice(imageType.prefix.length));
    if (data.length > MAX_IMAGE_BYTES) {
      throw new Error("annotation image exceeds package limit");
    }
    if (!validImageSignature(imageType.contentType, data)) {
      throw new Error(`annotation image content does not match ${imageType.contentType}`);
    }
    const digest = await sha256Hex(data);
    return { path: `assets/${digest}${imageType.extension}`, data };
  }
  return null;
}

function annotationToPortable(annotation: Annotation, content: unknown) {
  return {
    id: annotation.id,
    timestamp_seconds: annotation.timestamp_seconds,
    duration_seconds: annotation.duration_seconds,
    position_x: annotation.position_x,
    position_y: annotation.position_y,
    region_x: annotation.region_x,
    region_y: annotation.region_y,
    region_width: annotation.region_width,
    region_height: annotation.region_height,
    shape: annotation.shape,
    display_mode: annotation.display_mode,
    interactive: annotation.interactive,
    content,
    kind: annotation.kind,
    color: annotation.color,
    custom_data: annotation.custom_data ?? {},
    created_at: annotation.created_at,
    updated_at: annotation.updated_at,
  };
}

export type PackageInput = {
  video: Video;
  annotations: Annotation[];
  /** 视频字节;调用方负责下载完成且长度等于 video.size_bytes。 */
  media: Uint8Array;
  exportedAt?: Date;
};

/**
 * 组装 .vinsight zip。media 以 Store(不压缩)写入,与后端一致;
 * 视频已是压缩编码,再压缩无收益且慢。
 */
export async function buildVinsightPackage(input: PackageInput): Promise<Uint8Array> {
  const { video, annotations, media } = input;
  const exportedAt = input.exportedAt ?? new Date();

  const assets = new Map<string, Asset>();
  const portableAnnotations: unknown[] = [];
  for (const annotation of annotations) {
    const content = (await externalizeImages(
      annotation.content as RichTextDocument,
      assets,
    )) as unknown;
    portableAnnotations.push(annotationToPortable(annotation, content));
  }

  const assetList = [...assets.values()].sort((a, b) => (a.path < b.path ? -1 : 1));
  const totalAssetBytes = assetList.reduce((sum, asset) => sum + asset.data.length, 0);
  if (assetList.length > MAX_PACKAGE_ASSETS) {
    throw new Error("package contains too many annotation assets");
  }
  if (totalAssetBytes > MAX_PACKAGE_ASSET_BYTES) {
    throw new Error("package annotation assets exceed 64 MiB");
  }

  const mediaPath = `media/${video.original_filename}`;
  const manifest = {
    format: DOCUMENT_FORMAT,
    format_version: DOCUMENT_FORMAT_VERSION,
    exported_at: exportedAt.toISOString(),
    video: {
      id: video.id,
      title: video.title,
      description: video.description,
      filename: video.original_filename,
      media_path: mediaPath,
      content_type: video.content_type,
      size_bytes: video.size_bytes,
    },
    annotation_track: {
      format: TRACK_FORMAT,
      format_version: TRACK_FORMAT_VERSION,
      annotations: portableAnnotations,
      extensions: {},
    },
    extensions: {},
  };

  const manifestJson = JSON.stringify(manifest, null, 2) + "\n";

  // 条目顺序与后端 WritePackage 一致:mimetype(Store, 首条) → manifest(Deflate)
  // → assets(Store) → media(Store)。level 0 即 Store。
  const mtime = exportedAt;
  const files: Zippable = {
    mimetype: [strToU8(PACKAGE_MIME), { level: 0, mtime }],
    [MANIFEST_PATH]: [strToU8(manifestJson), { level: 6, mtime }],
  };
  for (const asset of assetList) {
    files[asset.path] = [asset.data, { level: 0, mtime }];
  }
  files[mediaPath] = [media, { level: 0, mtime }];

  return zipSync(files);
}
