# Repository guidance

## Stack

- Backend: Go 1.26 with Chi, pgx/sqlc, AWS SDK v2, JWT, and PBKDF2 password compatibility. Formatted with `gofmt`, checked with `go vet`, and tested with the race detector.
- Frontend: React 19 + TanStack Router + TanStack Query + TailwindCSS 4, built with Vite and managed with `pnpm`.
- Classroom: an Electron + React + Vite desktop player in `class-button/desktop/`
  backed by a nested Rust workspace for the sidecar, serial host tools, protocol,
  and browser adapter. ESP32-S3 firmware is a separate nested workspace so its
  ESP-IDF target does not affect host builds.
- Storage: PostgreSQL 16 plus MinIO locally or Cloudflare R2 in production.
- Orchestration: layered Docker Compose driven by `scripts/dev.sh` and `scripts/deploy-prod.sh`.

## Common commands

Run from the repository root:

```sh
just dev                    # start PostgreSQL, MinIO, Go API, and frontend
just dev down               # remove local containers and keep volumes
just dev reset              # also remove development volumes
just dev logs backend       # follow one service
just dev rebuild frontend   # rebuild one service
just dev db                 # open psql

just desktop                # run the Electron classroom player
just desktop demo           # run with a simulated button press
just desktop open VIDEO     # open a video immediately

just check                  # verify web plus desktop products
just check unit             # run all unit suites only
just check web              # verify backend and frontend
just check desktop          # verify Rust host and Electron application
just fix                    # format supported products
just deploy                 # pull backend/frontend images and deploy
```

The root Justfile exposes workflows, not component-level wrappers. Use Go,
pnpm, Cargo, and the scripts inside each component for specialized operations.

The dev stack always loads `docker/.env.example` and optionally loads the ignored `docker/.env.dev`. Production additionally uses the ignored `docker/.env.prod`.

## Architecture

### Backend (`backend/`)

The Go API is split into domain services and platform adapters:

- `cmd/api/` — process startup, signals, structured logging, and graceful shutdown.
- `internal/app/` — dependency construction and service wiring.
- `internal/httpapi/` — Chi routes, middleware, authentication, validation, and DTO mapping.
- `internal/auth/`, `groups/`, `videos/`, `annotations/` — domain services and their repository contracts.
- `internal/platform/config/` — environment-backed runtime configuration.
- `internal/platform/postgres/` — pgx pool, sqlc-backed repositories, and generated query code.
- `internal/platform/storage/` — S3-compatible multipart upload, playback URL, and object lifecycle adapter.
- `internal/shared/` — small cross-domain error and optional-value types.
- `db/queries/` — sqlc source queries; regenerate after edits.
- `db/schema.sql` — schema snapshot for new local databases.
- `internal/platform/postgres/migrations.go` — ordered Go migrations applied at API startup.
- `api/openapi.json` — compatibility contract snapshot.

Services depend on narrow interfaces rather than pgx or S3 clients directly. Keep transport types in `httpapi`, persistence details in `platform/postgres`, and object storage details in `platform/storage`.

Clients upload directly to MinIO/R2 through presigned multipart URLs. Upload concurrency remains intentionally serialized by default for constrained production tunnels.

### Frontend (`frontend/src/`)

- `routes/` — TanStack Router file routes; do not edit generated `routeTree.gen.ts`.
- `features/<domain>/` — typed API calls and TanStack Query hooks.
- `components/layout/` — shared layout chrome.
- `i18n/` — English and Chinese resources.

Production nginx serves the bundle and proxies `/api` to the Go service.

### Classroom system (`class-button/`)

`class-button/` is a nested host-side Cargo workspace:

- `crates/class-button-protocol/` — dependency-free `no_std` ESP-NOW frame
  format shared by firmware and host software. Keep wire-format changes backward
  compatible or version the protocol explicitly.
- `crates/class-button-core/` — classroom/device mapping, press-event identity,
  session handling, and retry deduplication. It must remain independent of serial,
  HTTP, and UI implementations.
- `crates/class-button-host/` — USB serial discovery and receiver line parsing.
- `crates/class-button-cli/` — host diagnostics, serial listening, and simulated
  events.
- `crates/class-button-sidecar/` — headless Rust runtime for package validation,
  annotation normalization, serial events, and the localhost compatibility
  server. It communicates with Electron main through versioned JSON lines.
- `desktop/` — Electron main/preload processes and the React/Vite classroom
  player. The sandboxed renderer only receives a narrow typed preload API.
- `player-adapter/` — compatibility adapter for pausing browser video through the
  localhost WebSocket service. Student identity intentionally stays in the native
  process and is not sent to arbitrary webpages.
- `firmware/esp32s3/` — separate ESP-IDF Cargo workspace containing `button` and
  `receiver` binaries. Do not add it to the host workspace or run host-wide Cargo
  commands from this directory.

Electron main owns process lifecycle, file dialogs, the allowlisted custom-media
protocol, and the Rust sidecar. Keep `nodeIntegration` disabled, context isolation
and renderer sandboxing enabled, validate IPC senders, and expose only task-specific
functions from preload. The React renderer owns player state and presentation but
must not receive filesystem paths or raw Electron APIs.

Serial discovery and the localhost compatibility server stay in the Tokio Rust
sidecar. Student identity travels only over the private sidecar/Electron channel;
the browser compatibility WebSocket remains pause-only. A physical or simulated
student press must pause the HTML video before displaying the student overlay.

The desktop player is a read-only consumer of VideoInsight annotations. For a
video such as `lesson.mp4`, it searches for `lesson.mp4.annotations.json`, then
`lesson.annotations.json`, then `annotations.json`. Sidecars may be either the
SaaS annotation array or an object with an `annotations` array. Keep this shape
compatible with the API DTOs in `frontend/src/types/index.ts` and
`backend/internal/httpapi/types.go`; see `class-button/docs/desktop.md`.

Run host and Electron checks from the repository root with
`just check desktop`. The ESP32-S3 workspace requires the `esp` Rust toolchain
and ESP-IDF environment, so
firmware builds are separate and should name the intended role explicitly.

## Deployment

- Local: `just dev` builds the Go dev image and starts bundled MinIO.
- Production: `just deploy` pulls immutable `video-insight-backend` and `video-insight-frontend` images.
- Only frontend port 8080 is bound to the host. Cloudflared publishes the app; R2 or browser-reachable MinIO serves object URLs.
- Preserve `GO_SEED_ADMIN_ON_STARTUP=false` after the first production bootstrap.
- Desktop packages are produced by `class-button/scripts/package-macos.sh` or
  `class-button/scripts/package-windows.ps1`; generated `target/` and `dist/`
  trees stay ignored.

See `docs/deployment.md` for the runbook.
