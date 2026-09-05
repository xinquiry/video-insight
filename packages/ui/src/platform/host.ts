import { createContext, useContext } from "react";

export type PlayableSource =
  | { kind: "network"; url: string }
  | { kind: "cache"; url: string }
  | { kind: "package"; url: string };

export type CacheState = "none" | "partial" | "cached";

/** 与 sidecar PlayerAnnotation 对齐的只读播放批注。 */
export type PlayerAnnotation = {
  timestamp_seconds: number;
  duration_seconds: number;
  kind: string;
  color: string;
  blocks: Array<{ type: "text"; text: string } | { type: "image"; src: string; alt: string }>;
  text: string;
};

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

export type HostCapabilities = {
  /** 是否有可用的后端会话(web 恒 true;桌面登录后 true)。 */
  auth: boolean;
  /** 是否能写标注(需要后端)。 */
  annotate: boolean;
  /** 是否支持本地缓存离线播放。 */
  cache: boolean;
  /** 是否能打开本地导出视频/课程包。 */
  openLocal: boolean;
  /** 是否有课堂按钮事件。 */
  classroom: boolean;
};

export type HostServices = {
  kind: "web" | "desktop";
  /** 后端接入;null 表示离线(桌面未登录)。 */
  api: { baseUrl: string; getToken(): string | null } | null;
  capabilities: HostCapabilities;
  media?: {
    openFile(): Promise<void>;
    openDroppedFile(file: File): Promise<void>;
    cacheVideo(
      id: string,
      payload: { downloadUrl: string; displayName: string; annotations: PlayerAnnotation[] },
    ): Promise<void>;
    cacheStatus(id: string): Promise<CacheState>;
    setFullscreen(on: boolean): Promise<void>;
  };
  classroom?: {
    onPress(cb: (press: ProcessedPress) => void): () => void;
    onReceiverStatus(cb: (online: boolean, port?: string) => void): () => void;
  };
};

const HostContext = createContext<HostServices | null>(null);

export const HostProvider = HostContext.Provider;

export function useHost(): HostServices {
  const host = useContext(HostContext);
  if (!host) throw new Error("useHost must be used within a HostProvider");
  return host;
}

export function useCapabilities(): HostCapabilities {
  return useHost().capabilities;
}
