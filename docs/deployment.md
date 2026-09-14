# Development And Production Workflow

## Local Development

Run the complete stack with the Go backend and frontend hot reload:

```sh
just dev
```

This uses `docker/docker-compose.base.yaml` plus
`docker/docker-compose.dev.yaml`. PostgreSQL and MinIO persist in Docker
volumes, while `backend/`, `apps/web/`, and `packages/` are bind-mounted into
their dev containers. Defaults live in `docker/.env.example`; optional local
overrides live in the ignored `docker/.env.dev`.

Useful development commands:

```sh
just dev logs backend
just dev rebuild backend
just check web
just check unit
```

After editing SQL queries, regenerate sqlc code from `backend/` with
`go run github.com/sqlc-dev/sqlc/cmd/sqlc@v1.31.1 generate`.

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

## Playback Optimization

The backend persists a processing job for every completed upload. A single
background worker losslessly remuxes MP4 files with ffmpeg so the `moov` atom
precedes media data (fast-start playback), then atomically replaces the S3
object. The API withholds `playback_url` while a video is pending or processing,
and the frontend polls until it is ready. On startup the backend immediately
requeues work interrupted by a previous restart, even when processing is
temporarily disabled; failed attempts are retried with backoff.

The production image includes ffmpeg and Compose mounts the
`video-processing-tmp` volume at `/var/tmp/video-insight`. Ensure that volume
has enough free space for roughly two copies of the largest uploaded video.
The defaults are normally sufficient; optional overrides are:

```text
VIDEO_PROCESSING_ENABLED=true
VIDEO_PROCESSING_FFMPEG_PATH=ffmpeg
VIDEO_PROCESSING_TEMP_DIR=/var/tmp/video-insight
VIDEO_PROCESSING_POLL_SECONDS=5
VIDEO_PROCESSING_MAX_ATTEMPTS=3
```

Non-MP4 video objects pass through unchanged. Failed jobs expose their status
through the video API and remain unavailable for playback rather than serving
a partially processed object. Run exactly one backend replica while processing
is enabled; concurrency is intentionally limited per backend process. If
`VIDEO_PROCESSING_ENABLED=false`, new uploads are marked ready without
optimization and existing pending jobs wait until processing is re-enabled.

Existing videos are left ready during the schema migration to avoid an
unexpected playback outage. To enqueue an intentional MP4 backfill during a
maintenance window, run the following SQL against the production database:

```sql
UPDATE videos
SET processing_status = 'pending',
    processing_error = NULL,
    processing_attempts = 0,
    processing_started_at = NULL,
    processing_available_at = now(),
    updated_at = now()
WHERE processing_status = 'ready'
  AND (
    content_type ILIKE 'video/mp4%'
    OR original_filename ILIKE '%.mp4'
  );
```

The single worker processes the backfill serially. Already optimized files are
verified and returned to ready without being uploaded again.

## Embedded Annotation Images

Annotation images are stored inline as base64 data URLs. The application accepts
PNG, JPEG, GIF, and WebP images up to 50 MiB each. Base64 expands a 50 MiB image
to roughly 67 MiB, so the annotation endpoints and production nginx allow JSON
request bodies up to 72 MiB. Keep any upstream proxy request-body limit at or
above 72 MiB when changing ingress.

## Export To SJTU Drive

VideoInsight can generate a `.vinsight` package on the server and upload it to
SJTU Drive through a private TboxWebdav sidecar. This is optional and disabled
by default. The browser only queues the job and polls its status; the video does
not pass through the browser or the public application tunnel.

The worker first writes the package under `/var/tmp/video-insight/drive-exports`
because TboxWebdav requires an exact `Content-Length`. It uploads one export at
a time, verifies the remote size with `HEAD`, removes the temporary package,
and retries failed jobs up to three times. Keep free temporary disk space at
least as large as the biggest video in addition to the space needed by video
processing.

TboxWebdav is pinned to v1.0.1, built from its published Linux binary, kept
inside the Compose network, and configured with `NoDelete` access. Do not
publish port 65472. Its source and GPL-2.0 license are available at
<https://github.com/1357310795/TboxWebdav>.

### Obtain The JAAuthCookie

1. Sign in to an SJTU site through jAccount in a private browser session.
2. Open <https://jaccount.sjtu.edu.cn/jaccount/>.
3. In the browser developer tools, open Application, then Cookies, and copy the
   complete `JAAuthCookie` value.
4. Treat it as a password. Do not commit it, paste it into logs, or send it to
   the browser. Close the private browser session after configuring Matrix.

The cookie can expire or be revoked. If jobs begin failing with an
authentication error, replace it in `docker/.env.prod` and redeploy.

### Enable On Matrix

Add these overrides to the ignored `docker/.env.prod`:

```text
COMPOSE_PROFILES=drive-export
DRIVE_EXPORT_ENABLED=true
DRIVE_EXPORT_PASSWORD=<48 hex characters from: openssl rand -hex 24>
TBOX_JA_AUTH_COOKIE=<complete JAAuthCookie value>
```

`DRIVE_EXPORT_PASSWORD` only protects the private backend-to-sidecar request;
it is not the jAccount password. The defaults put exports under
`VideoInsight/<group UUID>/` in SJTU Drive. Override
`DRIVE_EXPORT_DESTINATION_ROOT` to use another root directory.
If Matrix uses the bundled MinIO service, set
`COMPOSE_PROFILES=selfhosted-minio,drive-export` so enabling this feature does
not disable MinIO.

Deploy normally:

```sh
just deploy
```

The first enabled deployment builds the pinned TboxWebdav sidecar and may take
several minutes. After both containers are healthy, open a ready video and use
**Export to drive**. The button progresses through queued, packaging, and
uploading states. A completed job exposes its destination path as the button
tooltip; download the package from the SJTU Drive website or a WebDAV mount.

Before relying on the feature, export a representative large video three times
and confirm the package sizes in SJTU Drive. Keep the existing local export as
a fallback.

## Deploy

From the repository on the server:

```sh
git pull --ff-only
just deploy
```

The deployment script pulls the pinned images and starts PostgreSQL. The Go API
then applies pending migrations under a PostgreSQL advisory lock before it
serves requests. After the API becomes healthy, the script starts the frontend.
PostgreSQL data and R2 objects remain in place during a release.

Verify the deployment:

```sh
curl --fail http://127.0.0.1:8080/api/health
curl --fail http://127.0.0.1:8080/api/health/ready
```
