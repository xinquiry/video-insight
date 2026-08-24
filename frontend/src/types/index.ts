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
