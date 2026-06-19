set dotenv-load

# ── Docker ──────────────────────────────────────────────

# Start all services in dev mode
dev:
    ./scripts/dev.sh -d

# Stop services (keep volumes)
stop:
    ./scripts/dev.sh -s

# Tear down everything (remove volumes)
down:
    ./scripts/dev.sh -e

# ── Backend ─────────────────────────────────────────────

# Run backend locally
run-backend:
    cd backend && uv run uvicorn app.main:create_app --factory --reload --port 8000

# Lint backend
lint-backend:
    cd backend && uv run ruff check . && uv run ruff format --check .

# Fix backend lint
fix-backend:
    cd backend && uv run ruff check --fix . && uv run ruff format .

# Type-check backend
type-backend:
    cd backend && uv run ty check

# Test backend
test-backend:
    cd backend && uv run pytest tests/ -v

# Create alembic migration
migration name:
    cd backend && uv run alembic revision --autogenerate -m "{{name}}"

# Run alembic migrations
migrate:
    cd backend && uv run alembic upgrade head

# ── Frontend ────────────────────────────────────────────

# Run frontend locally
run-frontend:
    cd frontend && pnpm dev

# Lint frontend
lint-frontend:
    cd frontend && pnpm oxlint .

# Fix frontend lint
fix-frontend:
    cd frontend && pnpm oxlint --fix . && pnpm oxfmt .

# Type-check frontend
type-frontend:
    cd frontend && pnpm tsc -b --noEmit

# Test frontend
test-frontend:
    cd frontend && pnpm test

# ── Aggregate ───────────────────────────────────────────

lint: lint-backend lint-frontend
type: type-backend type-frontend
test: test-backend test-frontend
check: lint type test
