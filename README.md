# VideoInsight

VideoInsight is a classroom video platform. The monorepo contains the hosted
annotation SaaS, a native classroom player, and the Class Button hardware stack
that lets a student pause playback and identify who requested help.

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

Run individual products and components:

```sh
just run-saas                 # Go API, React, PostgreSQL, and MinIO
just run-frontend             # React only, outside Docker
just run-backend              # Go API only, outside Docker
just run-desktop              # native Makepad classroom player
just run-desktop-demo         # player plus a simulated student press
just class-button-cli ports   # discover attached USB serial devices
```

Build or flash the ESP32-S3 development firmware:

```sh
just build-esp32 receiver
just build-esp32 button
just flash-esp32 receiver /dev/cu.usbmodemXXXX
```

## Repository layout

- `backend/` — canonical Go API.
- `frontend/` — React application and production nginx proxy.
- `class-button/` — Rust host workspace, Makepad desktop player, browser
  adapter, packaging, and the separate ESP32-S3 firmware workspace.
- `docker/` — local and production Compose definitions.
- `scripts/` — development and deployment entry points.
- `docs/deployment.md` — production runbook.
- `docs/portable-export.md` — versioned video and annotation export contract.

The former Python service is preserved only as a frozen, non-operational
[archive](backend-legacy/README.md). It is not built, tested, deployed, or used
for database migrations.

See [the backend guide](backend/README.md) for API development and
[the deployment guide](docs/deployment.md) for production operations. See the
[Class Button guide](class-button/README.md) for the classroom system and the
[desktop player guide](class-button/docs/desktop.md) for Makepad and annotation
sidecar details.
