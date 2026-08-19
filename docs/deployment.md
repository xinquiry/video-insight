# Development And Production Workflow

## Local Development

Run the complete stack with the Go backend and frontend hot reload:

```sh
just up
```

This uses `docker/docker-compose.base.yaml` plus
`docker/docker-compose.dev.yaml`. PostgreSQL and MinIO persist in Docker
volumes, while `backend/` and `frontend/` are bind-mounted into their dev
containers. Defaults live in `docker/.env.example`; optional local overrides
live in the ignored `docker/.env.dev`.

Useful backend commands:

```sh
just run-backend
just generate-backend
just test-backend
just check-backend
```

## Image Publishing

Pushing to `main` runs `.github/workflows/build-images.yaml`. Go formatting,
vet, and race-enabled tests must pass before the workflow publishes:

```text
ghcr.io/OWNER/video-insight-backend:latest
ghcr.io/OWNER/video-insight-frontend:latest
```

Every image also receives an immutable `sha-...` tag. Production should pin an
immutable tag with `IMAGE_TAG`; pull requests build images without publishing
them.

Deprecated: `backend-legacy/` and its `video-insight-backend-legacy` image are retained only for existing Alembic history and emergency rollback.

If the GHCR packages are private, authenticate on the server before deploying:

```sh
docker login ghcr.io
```

## VPS Setup

Keep Cloudflared on the host and route the public application hostname to the
frontend container:

```text
https://app.example.com -> http://localhost:8080
```

The API returns browser-facing presigned object URLs. When using self-hosted
MinIO, route a second public hostname to MinIO; Cloudflare R2 needs no local
storage service.

Create the ignored `docker/.env.prod` from `docker/.env.example` and override
the production values:

```text
IMAGE_REPOSITORY=ghcr.io/OWNER/video-insight
IMAGE_TAG=sha-0123456
CORS_ORIGINS=["https://app.example.com"]
GO_SEED_ADMIN_ON_STARTUP=false
MINIO_ENDPOINT=<account_id>.r2.cloudflarestorage.com
MINIO_PUBLIC_ENDPOINT=<account_id>.r2.cloudflarestorage.com
MINIO_ACCESS_KEY=<R2 access key>
MINIO_SECRET_KEY=<R2 secret>
MINIO_BUCKET=video-insight
MINIO_SECURE=true
MINIO_PUBLIC_SECURE=true
MINIO_REGION=auto
```

Use strong production values for `POSTGRES_PASSWORD`, `SECRET_KEY`, and
`ADMIN_PASSWORD`. A fresh environment can leave
`GO_SEED_ADMIN_ON_STARTUP=true` for its first start; established environments
should keep it disabled so restarts do not rotate administrator credentials.

## Deploy

From the repository on the server:

```sh
git pull --ff-only
just prod-up
```

The deployment script pulls the pinned images, starts PostgreSQL, applies
pending database migrations, starts the Go API, waits for readiness, and then
starts the frontend. PostgreSQL data and R2 objects remain in place during an
application release.

Verify the deployment:

```sh
curl --fail http://127.0.0.1:8080/api/health
curl --fail http://127.0.0.1:8080/api/health/ready
```

For an emergency application rollback without changing PostgreSQL or R2:

```sh
just prod-rollback-legacy
```
