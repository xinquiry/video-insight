# Repository guidance

## Stack

- Backend: Go 1.26 with Chi, pgx/sqlc, AWS SDK v2, JWT, and PBKDF2 password compatibility. Formatted with `gofmt`, checked with `go vet`, and tested with the race detector.
- Frontend: React 19 + TanStack Router + TanStack Query + TailwindCSS 4, built with Vite and managed with `pnpm`.
- Storage: PostgreSQL 16 plus MinIO locally or Cloudflare R2 in production.
- Orchestration: layered Docker Compose driven by `scripts/dev.sh` and `scripts/deploy-prod.sh`.

## Common commands

Run from the repository root:

```sh
just up                    # start Postgres, MinIO, Go API, and frontend
just down                  # remove containers and keep volumes
just nuke                  # also remove development volumes
just logs-f backend        # follow the Go API logs
just shell-db              # open psql
just rebuild backend       # rebuild one service

just run-backend           # run the Go API directly
just generate-backend      # regenerate sqlc code
just test-backend          # race-enabled Go tests
just check-backend         # gofmt, vet, and tests

just lint                  # backend + frontend lint
just type                  # Go vet + frontend TypeScript
just test                  # backend + frontend tests
just check                 # lint + type
just fix                   # format/fix both sides

just prod-up               # pull pinned images and deploy
```

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

## Deployment

- Local: `just up` builds the Go dev image and starts bundled MinIO.
- Production: `just prod-up` pulls immutable `video-insight-backend` and `video-insight-frontend` images.
- Only frontend port 8080 is bound to the host. Cloudflared publishes the app; R2 or browser-reachable MinIO serves object URLs.
- Preserve `GO_SEED_ADMIN_ON_STARTUP=false` after the first production bootstrap.

See `docs/deployment.md` for the runbook.
