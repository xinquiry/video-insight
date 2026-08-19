# Show available commands
default:
    @just --list

# ── Docker: development stack ───────────────────────────

# Start all services
up:
    ./scripts/dev.sh up

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
    ./scripts/dev.sh restart {{service}}

# Rebuild and start all services, or one service: just rebuild frontend
rebuild service="":
    ./scripts/dev.sh rebuild {{service}}

# Show logs for all services, or one service: just logs backend
logs service="":
    ./scripts/dev.sh logs {{service}}

# Follow logs for all services, or one service: just logs-f backend
logs-f service="":
    ./scripts/dev.sh logs-f {{service}}

# Open a psql shell in the dev database container
shell-db:
    ./scripts/dev.sh shell-db

# ── Database migrations ─────────────────────────────────

# Create an Alembic migration
migrate message:
    cd backend && uv run alembic revision --autogenerate -m "{{message}}"

# Apply all pending migrations
migrate-up:
    cd backend && uv run alembic upgrade head

# Roll back one migration
migrate-down:
    cd backend && uv run alembic downgrade -1

# ── Backend ─────────────────────────────────────────────

lint-backend:
    cd backend && uv run ruff check . && uv run ruff format --check .

fix-backend:
    cd backend && uv run ruff check --fix . && uv run ruff format .

type-backend:
    cd backend && uv run ty check

test-backend:
    cd backend && uv run pytest tests/ -v

# ── Go backend migration ────────────────────────────────

go-up service="":
    ./scripts/dev-go.sh up {{service}}

go-down:
    ./scripts/dev-go.sh down

go-restart service="":
    ./scripts/dev-go.sh restart {{service}}

go-logs service="backend":
    ./scripts/dev-go.sh logs {{service}}

go-run:
    cd backend-go && go run ./cmd/api

go-generate:
    cd backend-go && go run github.com/sqlc-dev/sqlc/cmd/sqlc@v1.31.1 generate

go-test:
    cd backend-go && go test ./...

go-check:
    cd backend-go && gofmt -d . && go vet ./... && go test ./...

# ── Frontend ────────────────────────────────────────────

lint-frontend:
    cd frontend && pnpm oxlint .

fix-frontend:
    cd frontend && pnpm oxlint --fix . && pnpm oxfmt .

type-frontend:
    cd frontend && pnpm tsc -b --noEmit

test-frontend:
    cd frontend && pnpm test

# ── Aggregate checks ────────────────────────────────────

lint: lint-backend lint-frontend

fix: fix-backend fix-frontend

type: type-backend type-frontend

test: test-backend test-frontend

# Lint and type-check backend + frontend
check: lint type

# ── Production stack ────────────────────────────────────

# Pull images, migrate, and start production services
prod-up:
    ./scripts/deploy-prod.sh up

# Stop and remove production containers/networks, keep volumes
prod-down:
    ./scripts/deploy-prod.sh down

prod-rollback-python:
    ./scripts/deploy-prod.sh rollback-python
