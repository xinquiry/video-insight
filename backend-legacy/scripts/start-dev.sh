#!/usr/bin/env sh
set -eu

attempt=1
until uv run alembic upgrade head; do
  if [ "$attempt" -ge 10 ]; then
    echo "Database migrations failed after $attempt attempts." >&2
    exit 1
  fi
  attempt=$((attempt + 1))
  sleep 2
done

exec uv run uvicorn app.main:create_app --factory --host 0.0.0.0 --port 8000 --reload
