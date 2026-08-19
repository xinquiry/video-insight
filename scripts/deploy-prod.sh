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

compose_with_profile() {
  profile="$1"
  shift
  docker compose -p "$PROJECT_NAME" \
    --env-file "$DEFAULT_ENV_FILE" \
    --env-file "$PROD_ENV_FILE" \
    -f "$DOCKER_DIR/docker-compose.prod.yaml" \
    --profile "$profile" \
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

wait_for_profile_service() {
  profile="$1"
  service="$2"
  timeout="${3:-120}"
  elapsed=0

  while [ "$elapsed" -lt "$timeout" ]; do
    container_id="$(compose_with_profile "$profile" ps -q "$service")"
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
  compose_with_profile "$profile" ps
  return 1
}

case "${1:-up}" in
  up)
    echo "Pulling production images..."
    compose pull postgresql backend frontend
    compose_with_profile legacy-tools pull backend-legacy-tools
    compose_with_profile legacy-fallback pull backend-legacy-fallback

    echo "Starting stateful dependencies..."
    compose up -d postgresql
    wait_for_healthy postgresql
    if [ "${COMPOSE_PROFILES:-}" = "selfhosted-minio" ]; then
      compose up -d minio
      wait_for_healthy minio
    fi

    echo "Running database migrations..."
    compose_with_profile legacy-tools run --rm backend-legacy-tools alembic upgrade head

    echo "Starting application services..."
    compose_with_profile legacy-fallback stop backend-legacy-fallback >/dev/null 2>&1 || true
    compose_with_profile legacy-fallback rm -f backend-legacy-fallback >/dev/null 2>&1 || true
    compose up -d --remove-orphans backend
    wait_for_healthy backend
    compose up -d --remove-orphans frontend
    wait_for_healthy frontend
    compose ps
    ;;
  rollback-legacy)
    echo "Pulling deprecated fallback image..."
    compose_with_profile legacy-fallback pull backend-legacy-fallback

    echo "Stopping Go backend..."
    compose stop backend || true
    compose rm -f backend || true

    echo "Starting deprecated fallback..."
    compose_with_profile legacy-fallback up -d backend-legacy-fallback
    wait_for_profile_service legacy-fallback backend-legacy-fallback
    compose_with_profile legacy-fallback restart frontend
    compose_with_profile legacy-fallback ps
    ;;
  down)
    compose down
    ;;
  *)
    echo "Usage: $0 [up|down|rollback-legacy]" >&2
    exit 1
    ;;
esac
