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
just release <version>           # bump, tag, and push a desktop release
just deploy                       # reconcile production
```

Teachers can download the current macOS and Windows desktop packages from
[GitHub Releases](https://github.com/xinquiry/video-insight/releases/latest).

Specialized backend, frontend, Rust, and ESP32 operations use their native
tooling inside the relevant directory; see the component guides below.

## Repository layout

The frontend is a pnpm workspace: `packages/ui` holds the single shared React
application, and the thin `apps/web` and `apps/desktop` shells mount it with
web and Electron host implementations.

- `backend/` — canonical Go API.
- `packages/ui/` — shared React application (`@videoinsight/ui`): routes,
  features, components, i18n, and the host boundary.
- `apps/web/` — hosted web shell; production nginx serves the bundle and
  proxies `/api`.
- `apps/desktop/` — Electron classroom player.
- `class-button/` — Rust workspace (sidecar, protocol, serial host tools),
  browser adapter, packaging scripts, and the separate ESP32 firmware
  workspace.
- `hardware/` — CadQuery sources for the 3D-printable Key enclosure.
- `docker/` — local and production Compose definitions.
- `scripts/` — development, deployment, and release entry points.
- `docs/deployment.md` — production runbook.
- `docs/portable-export.md` — versioned video and annotation export contract.

See [the backend guide](backend/README.md) for API development and
[the deployment guide](docs/deployment.md) for production operations. See the
[Class Button guide](class-button/README.md) for the classroom system and the
[desktop player guide](class-button/docs/desktop.md) for the Electron player,
portable packages, and annotation sidecar details.
