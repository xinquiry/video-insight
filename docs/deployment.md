# Development And Production Workflow

## Local Development

Run the local stack with hot reload:

```sh
just up
```

This uses `docker/docker-compose.base.yaml` plus `docker/docker-compose.dev.yaml`.
The backend and frontend are built from their `dev` Docker targets and bind-mount
local source code. `docker/.env.example` contains the full default config list,
and `docker/.env.dev` contains only lightweight development overrides.

## Image Publishing

Pushing to `main` runs `.github/workflows/build-images.yaml` and publishes:

```text
ghcr.io/OWNER/video-insight-backend:latest
ghcr.io/OWNER/video-insight-backend-go:latest
ghcr.io/OWNER/video-insight-frontend:latest
```

The `backend` image is retained temporarily for Alembic migrations and Python
rollback. Production application traffic runs through `backend-go`.

The workflow also publishes immutable `sha-...` tags. Pull requests build both
production images but do not push them.

If the GHCR packages are not public, log in on the VPS before deploying:

```sh
docker login ghcr.io
```

## VPS Setup

Keep Cloudflared on the host. Point your public app hostname to the frontend
service, for example:

```text
https://app.example.com -> http://localhost:8080
```

This app returns MinIO presigned playback URLs, so MinIO also needs a browser
reachable hostname:

```text
https://media.example.com -> http://localhost:9000
```

Create `docker/.env.prod` on the VPS from `docker/.env.example` and override production values:

```text
IMAGE_REPOSITORY=ghcr.io/OWNER/video-insight
CORS_ORIGINS=["https://app.example.com"]
MINIO_PUBLIC_ENDPOINT=media.example.com
MINIO_SECURE=false
MINIO_PUBLIC_SECURE=true
```

Use strong production values for `POSTGRES_PASSWORD`, `SECRET_KEY`, and
`MINIO_ROOT_PASSWORD`. The API seeds an admin account on startup from
`ADMIN_USERNAME` and `ADMIN_PASSWORD`; set both before the first production
deploy and rotate `ADMIN_PASSWORD` from the VPS environment when needed.

## Deploy Latest

From the repo on the VPS:

```sh
git pull --ff-only
just prod-up
```

The script pulls the latest GHCR images, starts Postgres and MinIO, runs Alembic
migrations through the transitional Python tools service, then starts the Go
backend and frontend. The frontend container serves the React app and proxies
`/api` to the backend inside Docker.

## Go Backend Candidate And Rollback

Before the first Go cutover, set this in `docker/.env.prod` so starting a
candidate does not rewrite the existing administrator password hash:

```text
GO_SEED_ADMIN_ON_STARTUP=false
```

Start the Go image beside the live backend on localhost port 8001:

```sh
docker compose -p videoinsight \
  --env-file docker/.env.example \
  --env-file docker/.env.prod \
  -f docker/docker-compose.prod.yaml \
  --profile candidate up -d backend-go-candidate
curl --fail http://127.0.0.1:8001/api/health
```

After candidate verification, `just prod-up` replaces only the application
backend, waits for health, and then recreates the frontend. PostgreSQL and R2
remain unchanged.

For immediate rollback, run:

```sh
just prod-rollback-python
```

This removes only the Go application container, starts the Python fallback with
the stable Docker network alias `backend`, and restarts the frontend so Nginx
resolves the fallback address. PostgreSQL and R2 are not changed. A later
`just prod-up` removes the fallback and returns traffic to Go.
