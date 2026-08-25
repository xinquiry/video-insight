# VideoInsight backend

The production API is written in Go and organized by domain around explicit
service interfaces and platform adapters.

## Run locally

Start PostgreSQL, MinIO, the Go API, and the frontend:

```sh
just dev
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
cd backend
go run github.com/sqlc-dev/sqlc/cmd/sqlc@v1.31.1 generate
```

Run all hosted-application checks:

```sh
just check web
```

`db/schema.sql` is the schema snapshot used to initialize a new development
database. The Go service applies idempotent forward migrations at startup for
existing databases. Add future migrations to the ordered, append-only list in
`internal/platform/postgres/migrations.go` and update `db/schema.sql` to match.
