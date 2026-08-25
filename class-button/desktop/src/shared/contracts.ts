export type ProcessedPress = {
  classroom: string;
  student: string;
  seat?: string;
  device_id: number;
  session_id: number;
  sequence: number;
  battery_mv: number;
  received_at_ms: number;
};

export type AnnotationBlock =
  | { type: "text"; text: string }
  | { type: "image"; src: string; alt: string };

export type PlayerAnnotation = {
  timestamp_seconds: number;
  duration_seconds: number;
  kind: string;
  color: string;
  blocks: AnnotationBlock[];
  text: string;
};

export type RawPlayerMedia = {
  source: { kind: "local"; path: string } | { kind: "network"; url: string };
  display_name: string;
  annotations: PlayerAnnotation[];
  annotation_status: string;
};

export type PlayerMedia = Omit<RawPlayerMedia, "source"> & {
  source: string;
};

export type RawSidecarEvent =
  | { type: "ready"; protocol: number; classroom: string }
  | { type: "receiver_status"; online: boolean; port?: string }
  | { type: "press"; press: ProcessedPress }
  | { type: "media_opened"; request_id: number; media: RawPlayerMedia }
  | { type: "error"; message: string; request_id?: number };

export type DesktopEvent =
  | Exclude<RawSidecarEvent, { type: "media_opened" }>
  | { type: "media_opened"; request_id: number; media: PlayerMedia }
  | { type: "fullscreen_changed"; fullscreen: boolean };

export type ClassButtonApi = {
  openFile: () => Promise<boolean>;
  openDroppedFile: (file: File) => Promise<boolean>;
  setFullscreen: (fullscreen: boolean) => Promise<boolean>;
  onEvent: (listener: (event: DesktopEvent) => void) => void;
  clearEventListeners: () => void;
};
