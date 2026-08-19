# VideoInsight backend

The production API is written in Go and organized by domain around explicit
service interfaces and platform adapters.

## Run locally

Start PostgreSQL, MinIO, the Go API, and the frontend:

```sh
just up
```

To run the API directly against already-running dependencies:

```sh
GO_DATABASE_URL=postgres://videoinsight:videoinsight@localhost:5432/videoinsight \
MINIO_ENDPOINT=localhost:9000 \
MINIO_PUBLIC_ENDPOINT=localhost:9000 \
MINIO_ACCESS_KEY=videoinsight \
MINIO_SECRET_KEY=videoinsight-secret \
go run ./cmd/api
```

The service listens on `:8000` unless `GO_BACKEND_ADDRESS` is set. Fresh local
environments create the configured administrator; established production
environments should set `GO_SEED_ADMIN_ON_STARTUP=false`.

Regenerate type-safe PostgreSQL queries after changing SQL:

```sh
just generate-backend
```

Run all backend checks:

```sh
just check-backend
```

`db/schema.sql` is the schema snapshot used to initialize a new development
database. Existing production databases retain their Alembic history while
migration ownership is transferred to Go.
