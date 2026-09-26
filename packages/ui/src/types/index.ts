export interface User {
  id: string;
  group_id: string;
  username: string;
  is_admin: boolean;
  created_at: string;
}

export interface AuthToken {
  access_token: string;
  token_type: "bearer";
  user: User;
}

export interface Video {
  id: string;
  group_id: string;
  title: string;
  description: string | null;
  original_filename: string;
  content_type: string;
  size_bytes: number;
  playback_url: string | null;
  processing_status: "pending" | "processing" | "ready" | "failed";
  processing_error: string | null;
  created_at: string;
  updated_at: string | null;
}

export interface DriveExport {
  id: string;
  video_id: string;
  status: "pending" | "preparing" | "uploading" | "completed" | "failed";
  destination_path: string;
  size_bytes: number | null;
  error: string | null;
  attempts: number;
  created_at: string;
  updated_at: string | null;
  completed_at: string | null;
}

/** 下载组包原料:后端现场生成的便携 manifest + 网盘预签名视频 URL。 */
export interface PackageManifest {
  /** portable.Document(与后端 manifest.json 同构)。 */
  document: {
    format: string;
    format_version: number;
    exported_at: string;
    video: {
      id: string;
      title: string;
      description: string | null;
      filename: string;
      media_path: string;
      content_type: string;
      size_bytes: number;
    };
    annotation_track: {
      format: string;
      format_version: number;
      annotations: unknown[];
      extensions: Record<string, unknown>;
    };
    extensions: Record<string, unknown>;
  };
  video_url: string;
  package_mime: string;
  video_bytes: number;
  filename: string;
}

export interface DriveExportStatus {
  enabled: boolean;
  export: DriveExport | null;
  /** 短时效 COS 预签名 URL，仅在 export.status === "completed" 时存在；浏览器经它直连下载。 */
  download_url?: string;
}

export interface Group {
  id: string;
  name: string;
  created_at: string;
}

export interface RichTextNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: RichTextNode[];
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
  text?: string;
}

export interface RichTextDocument extends RichTextNode {
  type: "doc";
}

export interface Annotation {
  id: string;
  video_id: string;
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
  created_at: string;
  updated_at: string | null;
}

export interface AnnotationComment {
  id: string;
  annotation_id: string;
  user_id: string;
  author_username: string;
  body: string;
  created_at: string;
  updated_at: string | null;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}
