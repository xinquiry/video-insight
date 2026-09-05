import { randomUUID } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, readFileSync, statSync } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";

import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  net,
  protocol,
  type WebFrameMain,
} from "electron";

import type {
  CacheState,
  CachedVideoMeta,
  CacheVideoRequest,
  DesktopEvent,
  PlayerAnnotation,
  PlayerMedia,
  RawPlayerMedia,
  RawSidecarEvent,
} from "../shared/contracts";

const APP_SCHEME = "class-button";
const MEDIA_SCHEME = "vinsight-media";
const CACHE_MEDIA_HOST_PREFIX = "cache-";
const SIDECAR_PROTOCOL = 1;
const allowedMediaExtensions = new Set([
  ".vinsight",
  ".mp4",
  ".m4v",
  ".mov",
  ".webm",
  ".mkv",
  ".avi",
  ".wmv",
  ".mpg",
  ".mpeg",
  ".m3u8",
]);

protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
  {
    scheme: MEDIA_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
    },
  },
]);

let mainWindow: BrowserWindow | null = null;
let sidecar: ChildProcessWithoutNullStreams | null = null;
let quitting = false;
let rendererReady = false;
let requestId = 0;
let pendingEvents: DesktopEvent[] = [];
const mediaFiles = new Map<string, string>();
const activeCacheDownloads = new Set<string>();

function isPathInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function rendererContentType(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    default:
      return "application/octet-stream";
  }
}

function registerProtocols(): void {
  protocol.handle(APP_SCHEME, async (request) => {
    const requestUrl = new URL(request.url);
    if (requestUrl.host !== "renderer") return new Response("Not found", { status: 404 });
    const rendererRoot = path.resolve(__dirname, "../renderer");
    const requested = decodeURIComponent(requestUrl.pathname).replace(/^[/\\]+/, "") || "index.html";
    const resolved = path.resolve(rendererRoot, requested);
    if (!isPathInside(rendererRoot, resolved)) return new Response("Not found", { status: 404 });
    try {
      const data = await readFile(resolved);
      return new Response(new Uint8Array(data), {
        headers: { "Content-Type": rendererContentType(resolved) },
      });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  });

  protocol.handle(MEDIA_SCHEME, (request) => {
    const requestUrl = new URL(request.url);
    if (requestUrl.host.startsWith(CACHE_MEDIA_HOST_PREFIX)) {
      const videoId = requestUrl.host.slice(CACHE_MEDIA_HOST_PREFIX.length);
      const cachedPath = cachedVideoPath(videoId);
      if (!cachedPath) return new Response("Media not cached", { status: 404 });
      return serveLocalFile(cachedPath, request);
    }
    const mediaPath = mediaFiles.get(requestUrl.host);
    if (!mediaPath) return new Response("Media lease expired", { status: 404 });
    return serveLocalFile(mediaPath, request);
  });
}

// 直接以文件流 + 手动 Range 响应服务本地视频。
// net.fetch(file://) 对 Range 请求处理不可靠,会导致 Chromium 无法 seek(进度条拖不动)。
function serveLocalFile(filePath: string, request: Request): Response {
  let size: number;
  try {
    size = statSync(filePath).size;
  } catch {
    return new Response("Media missing", { status: 404 });
  }
  const contentType = mediaContentType(filePath);
  const range = request.headers.get("range");

  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (match && (match[1] !== "" || match[2] !== "")) {
      const start = match[1] === "" ? Math.max(0, size - Number(match[2])) : Number(match[1]);
      const end = match[2] === "" || match[1] === "" ? size - 1 : Math.min(Number(match[2]), size - 1);
      if (start >= size || start > end) {
        return new Response(null, {
          status: 416,
          headers: { "Content-Range": `bytes */${size}` },
        });
      }
      const stream = createReadStream(filePath, { start, end });
      return new Response(Readable.toWeb(stream) as ReadableStream, {
        status: 206,
        headers: {
          "Content-Type": contentType,
          "Content-Length": String(end - start + 1),
          "Content-Range": `bytes ${start}-${end}/${size}`,
          "Accept-Ranges": "bytes",
        },
      });
    }
  }

  const stream = createReadStream(filePath);
  return new Response(Readable.toWeb(stream) as ReadableStream, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(size),
      "Accept-Ranges": "bytes",
    },
  });
}

function mediaContentType(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case ".mp4":
    case ".m4v":
      return "video/mp4";
    case ".webm":
      return "video/webm";
    case ".mov":
      return "video/quicktime";
    case ".mkv":
      return "video/x-matroska";
    case ".avi":
      return "video/x-msvideo";
    case ".wmv":
      return "video/x-ms-wmv";
    case ".mpg":
    case ".mpeg":
      return "video/mpeg";
    case ".m3u8":
      return "application/vnd.apple.mpegurl";
    default:
      return "application/octet-stream";
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1220,
    height: 780,
    minWidth: 900,
    minHeight: 620,
    title: "Class Button · VideoInsight Player",
    backgroundColor: "#080b10",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.webContents.on("did-fail-load", (_event, code, description) => {
    emit({ type: "error", message: `播放器界面载入失败（${code}）：${description}` });
    mainWindow?.show();
  });
  mainWindow.webContents.once("did-finish-load", () => {
    rendererReady = true;
    for (const event of pendingEvents) mainWindow?.webContents.send("desktop:event", event);
    pendingEvents = [];
    emit({ type: "fullscreen_changed", fullscreen: mainWindow?.isFullScreen() ?? false });
  });
  mainWindow.on("enter-full-screen", () => emit({ type: "fullscreen_changed", fullscreen: true }));
  mainWindow.on("leave-full-screen", () => emit({ type: "fullscreen_changed", fullscreen: false }));
  mainWindow.on("closed", () => {
    rendererReady = false;
    mainWindow = null;
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event, target) => {
    if (!isTrustedRendererUrl(target)) event.preventDefault();
  });

  const developmentUrl = process.env.ELECTRON_RENDERER_URL;
  if (developmentUrl) void mainWindow.loadURL(developmentUrl);
  else void mainWindow.loadURL(`${APP_SCHEME}://renderer/index.html`);
}

function isTrustedRendererUrl(value: string): boolean {
  if (value.startsWith(`${APP_SCHEME}://renderer/`)) return true;
  const developmentUrl = process.env.ELECTRON_RENDERER_URL;
  if (!developmentUrl) return false;
  try {
    return new URL(value).origin === new URL(developmentUrl).origin;
  } catch {
    return false;
  }
}

function validateSender(frame: WebFrameMain | null): boolean {
  return frame !== null && isTrustedRendererUrl(frame.url);
}

function emit(event: DesktopEvent): void {
  if (rendererReady && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("desktop:event", event);
  } else {
    pendingEvents.push(event);
  }
}

function sidecarExecutable(): string {
  const executable = process.platform === "win32" ? "class-button-sidecar.exe" : "class-button-sidecar";
  if (app.isPackaged) return path.join(process.resourcesPath, "bin", executable);
  // apps/desktop -> 仓库根 -> class-button/target/debug
  return path.resolve(app.getAppPath(), "..", "..", "class-button", "target", "debug", executable);
}

function forwardedSidecarArguments(): string[] {
  const result: string[] = [];
  const valueFlags = new Set(["--port", "--baud", "--config", "--video", "--listen", "--demo-delay-ms"]);
  const booleanFlags = new Set(["--demo"]);
  const args = process.argv.slice(1);
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (!argument) continue;
    if (booleanFlags.has(argument)) result.push(argument);
    if (valueFlags.has(argument)) {
      const value = args[index + 1];
      if (value !== undefined) {
        result.push(argument, value);
        index += 1;
      }
    }
  }
  if (app.isPackaged && !result.includes("--config")) {
    const portableConfig = process.env.PORTABLE_EXECUTABLE_DIR
      ? path.join(process.env.PORTABLE_EXECUTABLE_DIR, "classroom.json")
      : undefined;
    result.push(
      "--config",
      portableConfig && existsSync(portableConfig)
        ? portableConfig
        : path.join(process.resourcesPath, "classroom.json"),
    );
  }
  return result;
}

function startSidecar(): void {
  const executable = sidecarExecutable();
  if (!existsSync(executable)) {
    emit({ type: "error", message: `找不到课堂运行时：${executable}` });
    return;
  }

  sidecar = spawn(executable, forwardedSidecarArguments(), {
    cwd: app.isPackaged ? process.resourcesPath : path.resolve(app.getAppPath(), "..", "..", "class-button"),
    stdio: ["pipe", "pipe", "pipe"],
  });
  const lines = createInterface({ input: sidecar.stdout });
  lines.on("line", (line) => {
    try {
      handleSidecarEvent(JSON.parse(line) as RawSidecarEvent);
    } catch (error) {
      emit({ type: "error", message: `课堂运行时返回了无效数据：${String(error)}` });
    }
  });
  if (!app.isPackaged) {
    sidecar.stderr.on("data", (chunk: Buffer) => {
      if (!process.stderr.destroyed) process.stderr.write(chunk);
    });
  }
  sidecar.on("error", (error) => emit({ type: "error", message: `无法启动课堂运行时：${error.message}` }));
  sidecar.on("close", (code) => {
    sidecar = null;
    if (!quitting) emit({ type: "error", message: `课堂运行时已退出（${code ?? "unknown"}）` });
  });
}

function handleSidecarEvent(event: RawSidecarEvent): void {
  if (event.type === "ready" && event.protocol !== SIDECAR_PROTOCOL) {
    emit({
      type: "error",
      message: `课堂运行时协议版本不兼容：${event.protocol}，播放器需要 ${SIDECAR_PROTOCOL}`,
    });
    return;
  }
  if (event.type !== "media_opened") {
    emit(event);
    return;
  }

  const media = exposeMedia(event.media);
  if (media) emit({ ...event, media });
}

function sanitizeVideoId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const videoId = value.trim();
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(videoId) ? videoId : null;
}

function cacheRoot(): string {
  return path.join(app.getPath("userData"), "cache", "videos");
}

function cacheDir(videoId: string): string {
  return path.join(cacheRoot(), videoId);
}

function cachedVideoPath(videoId: string): string | null {
  try {
    const meta = JSON.parse(readFileSync(path.join(cacheDir(videoId), "meta.json"), "utf8")) as { videoFile?: unknown };
    if (typeof meta.videoFile !== "string" || meta.videoFile === "") return null;
    const videoPath = path.join(cacheDir(videoId), meta.videoFile);
    return statSync(videoPath).isFile() ? videoPath : null;
  } catch {
    return null;
  }
}

function cachedMediaPayload(videoId: string): PlayerMedia | null {
  const videoPath = cachedVideoPath(videoId);
  if (!videoPath) return null;
  const directory = cacheDir(videoId);
  let meta: CachedVideoMeta;
  let annotations: PlayerAnnotation[];
  try {
    meta = JSON.parse(readFileSync(path.join(directory, "meta.json"), "utf8")) as CachedVideoMeta;
    annotations = JSON.parse(readFileSync(path.join(directory, "annotations.json"), "utf8")) as PlayerAnnotation[];
  } catch {
    return null;
  }
  return {
    source: `${MEDIA_SCHEME}://${CACHE_MEDIA_HOST_PREFIX}${videoId}/video`,
    display_name: meta.displayName,
    annotations,
    annotation_status: "本地缓存",
  };
}

async function cacheVideo(payload: CacheVideoRequest): Promise<{ ok: boolean; state: CacheState }> {
  const state = (): { ok: boolean; state: CacheState } => ({
    ok: cachedVideoPath(payload.videoId) !== null,
    state: cachedVideoPath(payload.videoId) !== null ? "cached" : "none",
  });
  if (activeCacheDownloads.has(payload.videoId)) return state();
  activeCacheDownloads.add(payload.videoId);
  const directory = cacheDir(payload.videoId);
  const staging = `${directory}.download-${randomUUID()}`;
  try {
    const parsed = new URL(payload.downloadUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return state();
    const response = await net.fetch(payload.downloadUrl);
    if (!response.ok || !response.body) return state();
    await mkdir(staging, { recursive: true });
    const videoPath = path.join(staging, "video.bin");
    await pipeline(Readable.fromWeb(response.body as import("node:stream/web").ReadableStream), createWriteStream(videoPath));
    const sizeBytes = (await stat(videoPath)).size;
    const meta: CachedVideoMeta = {
      videoId: payload.videoId,
      displayName: payload.displayName,
      contentType: response.headers.get("Content-Type") ?? "application/octet-stream",
      cachedAt: new Date().toISOString(),
      sizeBytes,
      sourceUrl: payload.downloadUrl,
    };
    await writeFile(path.join(staging, "annotations.json"), JSON.stringify(payload.annotations));
    await writeFile(path.join(staging, "meta.json"), JSON.stringify({ ...meta, videoFile: "video.bin" }));
    await rm(directory, { recursive: true, force: true });
    await rename(staging, directory);
    return { ok: true, state: "cached" };
  } catch (error) {
    emit({ type: "error", message: `缓存视频失败：${String(error)}` });
    return state();
  } finally {
    activeCacheDownloads.delete(payload.videoId);
    await rm(staging, { recursive: true, force: true }).catch(() => undefined);
  }
}

function exposeMedia(media: RawPlayerMedia): PlayerMedia | null {
  mediaFiles.clear();
  if (media.source.kind === "network") return { ...media, source: media.source.url };
  if (!path.isAbsolute(media.source.path) || !existsSync(media.source.path)) {
    emit({ type: "error", message: "课堂运行时返回了无效的本地视频路径" });
    return null;
  }
  const token = randomUUID();
  mediaFiles.set(token, media.source.path);
  return { ...media, source: `${MEDIA_SCHEME}://${token}/video` };
}

function sendOpenMedia(source: string): boolean {
  if (!sidecar?.stdin.writable) {
    emit({ type: "error", message: "课堂运行时尚未就绪" });
    return false;
  }
  requestId += 1;
  sidecar.stdin.write(`${JSON.stringify({ type: "open_media", request_id: requestId, source })}\n`);
  return true;
}

function registerIpc(): void {
  ipcMain.handle("desktop:open-file", async (event) => {
    if (!validateSender(event.senderFrame) || !mainWindow) return false;
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "打开课堂视频",
      properties: ["openFile"],
      filters: [
        {
          name: "VideoInsight package or video",
          extensions: ["vinsight", "mp4", "m4v", "mov", "webm", "mkv", "avi", "wmv", "mpg", "mpeg", "m3u8"],
        },
        { name: "All files", extensions: ["*"] },
      ],
    });
    const selected = result.filePaths[0];
    return !result.canceled && selected !== undefined ? sendOpenMedia(selected) : false;
  });

  ipcMain.handle("desktop:open-dropped-file", (event, source: unknown) => {
    if (!validateSender(event.senderFrame) || typeof source !== "string") return false;
    const extension = path.extname(source).toLowerCase();
    if (!path.isAbsolute(source) || !allowedMediaExtensions.has(extension)) return false;
    try {
      if (!statSync(source).isFile()) return false;
    } catch {
      return false;
    }
    return sendOpenMedia(source);
  });

  ipcMain.handle("desktop:set-fullscreen", (event, fullscreen: unknown) => {
    if (!validateSender(event.senderFrame) || typeof fullscreen !== "boolean" || !mainWindow) return false;
    mainWindow.setFullScreen(fullscreen);
    return mainWindow.isFullScreen();
  });

  ipcMain.handle("desktop:cache-video", async (event, payload: unknown) => {
    if (!validateSender(event.senderFrame) || typeof payload !== "object" || payload === null) {
      return { ok: false, state: "none" };
    }
    const candidate = payload as Partial<CacheVideoRequest>;
    const videoId = sanitizeVideoId(candidate.videoId);
    if (
      !videoId ||
      typeof candidate.downloadUrl !== "string" ||
      typeof candidate.displayName !== "string" ||
      !Array.isArray(candidate.annotations)
    ) {
      return { ok: false, state: "none" };
    }
    return cacheVideo({
      videoId,
      downloadUrl: candidate.downloadUrl,
      displayName: candidate.displayName,
      annotations: candidate.annotations,
    });
  });

  ipcMain.handle("desktop:cache-status", (event, value: unknown): CacheState => {
    const videoId = sanitizeVideoId(value);
    if (!validateSender(event.senderFrame) || !videoId) return "none";
    return cachedVideoPath(videoId) !== null ? "cached" : "none";
  });

  ipcMain.handle("desktop:list-cached", async (event): Promise<CachedVideoMeta[]> => {
    if (!validateSender(event.senderFrame)) return [];
    const result: CachedVideoMeta[] = [];
    try {
      for (const entry of await readdir(cacheRoot(), { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const videoId = sanitizeVideoId(entry.name);
        if (!videoId || cachedVideoPath(videoId) === null) continue;
        try {
          result.push(JSON.parse(readFileSync(path.join(cacheDir(videoId), "meta.json"), "utf8")) as CachedVideoMeta);
        } catch {
          continue;
        }
      }
    } catch {
      return result;
    }
    return result;
  });

  ipcMain.handle("desktop:open-cached", (event, value: unknown) => {
    const videoId = sanitizeVideoId(value);
    if (!validateSender(event.senderFrame) || !videoId) return false;
    const media = cachedMediaPayload(videoId);
    if (!media) return false;
    requestId += 1;
    emit({ type: "media_opened", request_id: requestId, media });
    return true;
  });
}

app.whenReady().then(() => {
  registerProtocols();
  registerIpc();
  createWindow();
  startSidecar();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("before-quit", () => {
  quitting = true;
  if (sidecar?.stdin.writable) sidecar.stdin.write(`${JSON.stringify({ type: "shutdown" })}\n`);
});

app.on("will-quit", () => {
  sidecar?.kill();
  sidecar = null;
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
