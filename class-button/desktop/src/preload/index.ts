import { contextBridge, ipcRenderer, webUtils } from "electron";

import type { ClassButtonApi, DesktopEvent } from "../shared/contracts";

const listeners = new Map<(event: DesktopEvent) => void, (_event: Electron.IpcRendererEvent, value: DesktopEvent) => void>();

const api: ClassButtonApi = {
  openFile: () => ipcRenderer.invoke("desktop:open-file") as Promise<boolean>,
  openDroppedFile: (file) => {
    const source = webUtils.getPathForFile(file);
    return source
      ? (ipcRenderer.invoke("desktop:open-dropped-file", source) as Promise<boolean>)
      : Promise.resolve(false);
  },
  setFullscreen: (fullscreen) =>
    ipcRenderer.invoke("desktop:set-fullscreen", fullscreen) as Promise<boolean>,
  onEvent: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, value: DesktopEvent) => listener(value);
    listeners.set(listener, wrapped);
    ipcRenderer.on("desktop:event", wrapped);
  },
  clearEventListeners: () => {
    for (const wrapped of listeners.values()) ipcRenderer.removeListener("desktop:event", wrapped);
    listeners.clear();
  },
};

contextBridge.exposeInMainWorld("classButton", api);
