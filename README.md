# VideoInsight

VideoInsight is a video annotation application with a Go API, React frontend,
PostgreSQL metadata store, and S3-compatible object storage.

## Development

Start the complete local stack:

```sh
just up
```

The application is available at `http://localhost:5173`; the API listens on
`http://localhost:8000`.

Run the checks:

```sh
just check
just test
```

## Repository layout

- `backend/` — canonical Go API.
- `frontend/` — React application and production nginx proxy.
- `docker/` — local and production Compose definitions.
- `scripts/` — development and deployment entry points.
- `docs/deployment.md` — production runbook.

The former Python service is preserved only as a frozen, non-operational
[archive](backend-legacy/README.md). It is not built, tested, deployed, or used
for database migrations.

See [the backend guide](backend/README.md) for API development and
[the deployment guide](docs/deployment.md) for production operations.
