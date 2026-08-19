# VideoInsight Go backend

This directory contains the contract-compatible Go replacement for the current
FastAPI backend. During migration it runs alongside `backend/`; production
deployment remains on Python until the separate cutover phase.

## Run locally

Run the complete local stack with the Go backend:

```sh
just go-up
```

It uses a separate `videoinsight-go` Compose project and initializes new local
Postgres volumes from `db/schema.sql`; it does not change the Python development
stack. To run the API directly against already-running dependencies instead:

```sh
GO_DATABASE_URL=postgres://videoinsight:videoinsight@localhost:5432/videoinsight \
MINIO_ENDPOINT=localhost:9000 \
MINIO_PUBLIC_ENDPOINT=localhost:9000 \
MINIO_ACCESS_KEY=videoinsight \
MINIO_SECRET_KEY=videoinsight-secret \
go run ./cmd/api
```

The service listens on `:8000` unless `GO_BACKEND_ADDRESS` is set.
Existing deployments should set `GO_SEED_ADMIN_ON_STARTUP=false`; fresh local
environments keep the compatibility default and create the configured admin.

Regenerate type-safe PostgreSQL queries after changing SQL:

```sh
just go-generate
```

## Checks

```sh
go test ./...
go test -race ./...
go vet ./...
```

`db/schema.sql` is a snapshot of the existing Alembic-managed schema. Database
migration ownership will move to Go only during the later deployment phase.
