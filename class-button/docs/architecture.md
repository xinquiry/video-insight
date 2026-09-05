# Electron desktop architecture

The classroom player is split into three trust and runtime boundaries:

1. `crates/class-button-sidecar/` is a headless Rust process. It owns classroom
   configuration, Hub serial discovery, retry deduplication, the pause-only
   localhost compatibility server, `.vinsight` validation/extraction, legacy
   annotation sidecars, and normalized rich-content blocks.
2. `apps/desktop/src/main/` is Electron's privileged main process. It launches the
   sidecar, validates its versioned JSON-lines events, handles native file dialogs,
   leases validated media through an opaque `vinsight-media://` URL, controls the
   window, and validates renderer IPC senders.
3. `apps/desktop/src/renderer/` is a sandboxed React renderer. It owns player state and
   presentation but has no Node.js, filesystem, serial, or raw Electron access.
   `apps/desktop/src/preload/` exposes only typed open-file, dropped-file, fullscreen,
   and event-subscription operations through `contextBridge`.

## Data flow

```text
Class Button Hub
       |
       v
Rust sidecar -- private JSON lines --> Electron main --> preload --> React
       |
       +-- 127.0.0.1:9842 WebSocket (pause command only)
```

Student identity never enters the browser compatibility WebSocket. In the React
event handler, a press pauses the HTML video synchronously before dispatching the
state change that displays the student overlay.

## Media and annotation boundaries

- `portable_contract.rs` owns format/version identifiers and image signature rules.
- `package.rs` owns ZIP structure validation, safe extraction, size limits, asset
  resolution, and temporary-file lifetime.
- `annotations.rs` accepts versioned documents and legacy sidecars, then produces
  ordered text/image presentation blocks.
- `media.rs` converts those internal models to the versioned sidecar transport.
- Electron main replaces local paths with an opaque, in-memory media lease. The
  renderer never receives a local path and cannot ask the protocol for arbitrary
  files.

Package paths remain untrusted. Readers reject absolute paths, parent traversal,
duplicate entries, excessive entry counts, oversized manifests/assets, compressed
video entries, and media-size mismatches. Replacing a package or terminating the
sidecar releases its extracted video directory.

## UI system

The renderer is a thin entry that mounts the shared `@videoinsight/ui`
application root with the desktop host implementation
(`apps/desktop/src/renderer/platform/host.desktop.ts`). Player state, the
annotation timeline, and the student overlay are owned by that shared React
application; the injected `HostServices` add media caching (offline playback),
local `.vinsight` open, and classroom button events, so the desktop differs
from the web only through the host. The palette mirrors the SaaS product
(`paper #faf7f2`, `surface #fffdf9`, `ink #1c1a17`, `muted #8a817a`,
`accent #c0512f`).

The renderer uses Chromium's HTML video element. MP4 with H.264/AAC and WebM are the
supported baseline. Other extensions may be selectable for legacy parity but must
be verified against the packaged Chromium build on each target platform.

## Security invariants

- `nodeIntegration` remains disabled.
- Context isolation, renderer sandboxing, web security, and a restrictive CSP stay
  enabled.
- Preload never exports `ipcRenderer` or generic send/invoke functions.
- Main validates each IPC sender and denies new windows or external navigation.
- Local app assets and video use allowlisted custom protocols rather than exposing
  arbitrary `file://` access to the renderer.
- Sidecar stdout contains protocol JSON only; diagnostics go to stderr.
