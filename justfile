# Show available commands
default:
    @just --list

# ── Docker: development stack ───────────────────────────

# Start all services
up:
    ./scripts/dev.sh up

# Start the complete SaaS stack (alias for `just up`)
run-saas: up

# Stop services without removing containers
stop:
    ./scripts/dev.sh stop

# Stop and remove containers/networks, keep volumes
down:
    ./scripts/dev.sh down

# Stop and remove containers/networks/volumes
nuke:
    ./scripts/dev.sh nuke

# Restart all services, or one service: just restart backend
restart service="":
    ./scripts/dev.sh restart {{ service }}

# Rebuild and start all services, or one service: just rebuild frontend
rebuild service="":
    ./scripts/dev.sh rebuild {{ service }}

# Show logs for all services, or one service: just logs backend
logs service="":
    ./scripts/dev.sh logs {{ service }}

# Follow logs for all services, or one service: just logs-f backend
logs-f service="":
    ./scripts/dev.sh logs-f {{ service }}

# Open a psql shell in the dev database container
shell-db:
    ./scripts/dev.sh shell-db

# ── Backend ─────────────────────────────────────────────

lint-backend:
    cd backend && test -z "$(gofmt -l .)"

fix-backend:
    cd backend && gofmt -w .

type-backend:
    cd backend && go vet ./...

test-backend:
    cd backend && go test -race ./...

run-backend:
    cd backend && go run ./cmd/api

generate-backend:
    cd backend && go run github.com/sqlc-dev/sqlc/cmd/sqlc@v1.31.1 generate

check-backend: lint-backend type-backend test-backend

# ── Frontend ────────────────────────────────────────────

# Run the React development server outside Docker
run-frontend:
    cd frontend && pnpm dev

lint-frontend:
    cd frontend && pnpm oxlint .

fix-frontend:
    cd frontend && pnpm oxlint --fix . && pnpm oxfmt .

type-frontend:
    cd frontend && pnpm tsc -b --noEmit

test-frontend:
    cd frontend && pnpm test

# ── Classroom player and hardware ───────────────────────

# Run the Electron classroom player; pass CLI flags as one quoted string
run-desktop args="":
    cd class-button/desktop && pnpm dev -- {{ args }}

# Run the player and inject one sample student press
run-desktop-demo:
    cd class-button/desktop && pnpm dev:demo

# Run host diagnostics, for example: just class-button-cli "ports"
class-button-cli args="ports":
    cd class-button && cargo run --bin class-button -- {{ args }}

# Format-check and test all host-side Class Button crates
check-class-button:
    cd class-button && cargo fmt --all -- --check
    cd class-button && cargo test --workspace

# Type-check, test, and bundle the Electron classroom player
check-desktop:
    cd class-button/desktop && pnpm check

# Test the browser compatibility adapter
test-player-adapter:
    npm --prefix class-button/player-adapter test

# Build one ESP32-S3 image: receiver or button
build-esp32 role="receiver":
    cd class-button/firmware/esp32s3 && rustup run esp cargo build --release --bin {{ role }}

# Flash and monitor one ESP32-S3 image; pass its serial port explicitly
flash-esp32 role port:
    cd class-button/firmware/esp32s3 && rustup run esp cargo build --release --bin {{ role }}
    cd class-button/firmware/esp32s3 && espflash flash --monitor --port {{ port }} --flash-size 16mb target/xtensa-esp32s3-espidf/release/{{ role }}

# ── Aggregate checks ────────────────────────────────────

lint: lint-backend lint-frontend

fix: fix-backend fix-frontend

type: type-backend type-frontend

test: test-backend test-frontend

# Lint and type-check backend + frontend
check: lint type

# Verify SaaS plus Class Button host software and browser adapter
check-all: check test check-class-button check-desktop test-player-adapter

# ── Production stack ────────────────────────────────────

# Pull images and start production services; the Go backend migrates on startup
prod-up:
    ./scripts/deploy-prod.sh up

# Stop and remove production containers/networks, keep volumes
prod-down:
    ./scripts/deploy-prod.sh down
