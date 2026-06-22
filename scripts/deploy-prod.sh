#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DOCKER_DIR="$ROOT_DIR/docker"
PROJECT_NAME="videoinsight"
DEFAULT_ENV_FILE="$DOCKER_DIR/.env.example"
PROD_ENV_FILE="$DOCKER_DIR/.env.prod"

if [ ! -f "$DEFAULT_ENV_FILE" ]; then
  echo "Missing $DEFAULT_ENV_FILE." >&2
  exit 1
fi

if [ ! -f "$PROD_ENV_FILE" ]; then
  echo "Missing $PROD_ENV_FILE. Copy docker/.env.example to docker/.env.prod and fill in production overrides." >&2
  exit 1
fi

compose() {
  docker compose -p "$PROJECT_NAME" \
    --env-file "$DEFAULT_ENV_FILE" \
    --env-file "$PROD_ENV_FILE" \
    -f "$DOCKER_DIR/docker-compose.prod.yaml" \
    ${COMPOSE_PROFILES:+--profile "$COMPOSE_PROFILES"} \
    "$@"
}

wait_for_healthy() {
  service="$1"
  timeout="${2:-120}"
  elapsed=0

  while [ "$elapsed" -lt "$timeout" ]; do
    container_id="$(compose ps -q "$service")"
    if [ -n "$container_id" ]; then
      status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_id")"
      if [ "$status" = "healthy" ] || [ "$status" = "running" ]; then
        return 0
      fi
    fi
    sleep 2
    elapsed=$((elapsed + 2))
  done

  echo "Timed out waiting for $service to become healthy." >&2
  compose ps
  return 1
}

case "${1:-up}" in
  up)
    echo "Pulling production images..."
    compose pull

    echo "Starting stateful dependencies..."
    compose up -d postgresql
    wait_for_healthy postgresql
    if [ "${COMPOSE_PROFILES:-}" = "selfhosted-minio" ]; then
      compose up -d minio
      wait_for_healthy minio
    fi

    echo "Running database migrations..."
    compose run --rm backend alembic upgrade head

    echo "Starting application services..."
    compose up -d --remove-orphans
    compose ps
    ;;
  down)
    compose down
    ;;
  *)
    echo "Usage: $0 [up|down]" >&2
    exit 1
    ;;
esac
