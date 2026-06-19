export interface User {
  id: string;
  username: string;
  created_at: string;
}

export interface AuthToken {
  access_token: string;
  token_type: "bearer";
  user: User;
}

export interface Video {
  id: string;
  title: string;
  description: string | null;
  original_filename: string;
  content_type: string;
  size_bytes: number;
  playback_url: string | null;
  created_at: string;
  updated_at: string | null;
}

export interface Annotation {
  id: string;
  video_id: string;
  timestamp_seconds: number;
  title: string;
  body: string;
  kind: string;
  color: string;
  custom_data: Record<string, unknown>;
  created_at: string;
  updated_at: string | null;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}
