import {
  tokenStorage,
  type CacheState,
  type HostServices,
  type ProcessedPress,
} from "@videoinsight/ui";
import type { DesktopEvent, PlayerMedia } from "../../shared/contracts";

const MEDIA_OPENED_EVENT = "vinsight:media-opened";

/**
 * 桌面宿主。未配置后端地址时保持离线(仅课堂播放);配置后可登录,
 * 在线能力叠加进来。按钮/打开文件等桌面能力恒可用。
 */
export function createDesktopHost(options?: { apiBaseUrl?: string }): HostServices {
  const apiBaseUrl = options?.apiBaseUrl ?? "";
  const online = Boolean(apiBaseUrl);

  const emitMediaOpened = (media: PlayerMedia) => {
    window.dispatchEvent(
      new CustomEvent(MEDIA_OPENED_EVENT, {
        detail: {
          displayName: media.display_name,
          sourceUrl: media.source,
          annotationStatus: media.annotation_status,
          annotations: media.annotations,
        },
      }),
    );
  };

  // 统一订阅 sidecar 事件:media_opened 转成 ui 的媒体事件,press 单独分发。
  const pressListeners = new Set<(press: ProcessedPress) => void>();
  const statusListeners = new Set<(online: boolean, port?: string) => void>();
  let subscribed = false;

  const ensureSubscribed = () => {
    if (subscribed) return;
    subscribed = true;
    window.classButton.onEvent((event: DesktopEvent) => {
      if (event.type === "press") {
        for (const listener of pressListeners) listener(event.press);
      } else if (event.type === "receiver_status") {
        for (const listener of statusListeners) listener(event.online, event.port);
      } else if (event.type === "media_opened") {
        emitMediaOpened(event.media);
      }
    });
  };

  return {
    kind: "desktop",
    api: online
      ? { baseUrl: apiBaseUrl, getToken: () => tokenStorage.get() }
      : null,
    capabilities: {
      auth: online,
      annotate: online,
      cache: true,
      openLocal: true,
      classroom: true,
    },
    media: {
      openFile: async () => {
        ensureSubscribed();
        await window.classButton.openFile();
      },
      openDroppedFile: async (file) => {
        ensureSubscribed();
        await window.classButton.openDroppedFile(file);
      },
      cacheVideo: async (id, payload) => {
        await window.classButton.cacheVideo({ videoId: id, ...payload });
      },
      cacheStatus: async (id): Promise<CacheState> => window.classButton.cacheStatus(id),
      setFullscreen: (on) => window.classButton.setFullscreen(on).then(() => undefined),
    },
    classroom: {
      onPress: (cb) => {
        ensureSubscribed();
        pressListeners.add(cb);
        return () => pressListeners.delete(cb);
      },
      onReceiverStatus: (cb) => {
        ensureSubscribed();
        statusListeners.add(cb);
        return () => statusListeners.delete(cb);
      },
    },
  };
}
