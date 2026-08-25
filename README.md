# VideoInsight

VideoInsight is a classroom video platform. The monorepo contains the hosted
annotation SaaS, a native classroom player, and the Class Button hardware stack
that lets a student pause playback and identify who requested help.

## Development

Start the complete local stack:

```sh
just dev
```

The application is available at `http://localhost:5173`; the API listens on
`http://localhost:8000`.

Run the complete check suite or only the unit tests:

```sh
just check
just check unit
```

The root Justfile exposes complete workflows rather than individual component
commands:

```sh
just dev logs backend             # follow one local service
just dev rebuild frontend         # rebuild one local service
just desktop                      # run the classroom player
just desktop demo                 # run with a simulated student press
just desktop open /path/video.mp4 # open a video immediately
just fix                          # format supported products
just deploy                       # reconcile production
```

Teachers can download the current macOS and Windows desktop packages from
[GitHub Releases](https://github.com/xinquiry/video-insight/releases/latest).

Specialized backend, frontend, Rust, and ESP32 operations use their native
tooling inside the relevant directory; see the component guides below.

## Repository layout

- `backend/` — canonical Go API.
- `frontend/` — React application and production nginx proxy.
- `class-button/` — Electron desktop player, Rust hardware/media sidecar, browser
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
[desktop player guide](class-button/docs/desktop.md) for Electron, portable
packages, and annotation sidecar details.
