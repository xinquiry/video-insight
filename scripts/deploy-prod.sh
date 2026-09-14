#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DOCKER_DIR="$ROOT_DIR/docker"
PROJECT_NAME="videoinsight"
DEFAULT_ENV_FILE="$DOCKER_DIR/.env.example"
PROD_ENV_FILE="$DOCKER_DIR/.env.prod"
ACTIVE_PROFILES="${COMPOSE_PROFILES:-}"

if [ ! -f "$DEFAULT_ENV_FILE" ]; then
  echo "Missing $DEFAULT_ENV_FILE." >&2
  exit 1
fi

if [ ! -f "$PROD_ENV_FILE" ]; then
  echo "Missing $PROD_ENV_FILE. Copy docker/.env.example to docker/.env.prod and fill in production overrides." >&2
  exit 1
fi

if [ -z "$ACTIVE_PROFILES" ]; then
  ACTIVE_PROFILES="$(sed -n 's/^[[:space:]]*COMPOSE_PROFILES=//p' "$PROD_ENV_FILE" | tail -n 1)"
  ACTIVE_PROFILES="${ACTIVE_PROFILES%\"}"
  ACTIVE_PROFILES="${ACTIVE_PROFILES#\"}"
fi

compose() {
  COMPOSE_PROFILES="$ACTIVE_PROFILES" docker compose -p "$PROJECT_NAME" \
    --env-file "$DEFAULT_ENV_FILE" \
    --env-file "$PROD_ENV_FILE" \
    -f "$DOCKER_DIR/docker-compose.prod.yaml" \
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

profile_enabled() {
  case ",$ACTIVE_PROFILES," in
    *,"$1",*) return 0 ;;
    *) return 1 ;;
  esac
}

case "${1:-up}" in
  up)
    echo "Pulling production images..."
    compose pull postgresql backend frontend
    if profile_enabled drive-export; then
      compose pull tbox-webdav
    fi

    echo "Starting stateful dependencies..."
    compose up -d postgresql
    wait_for_healthy postgresql
    if profile_enabled selfhosted-minio; then
      compose up -d minio
      wait_for_healthy minio
    fi

    if profile_enabled drive-export; then
      echo "Starting the private TboxWebdav sidecar..."
      compose up -d tbox-webdav
      wait_for_healthy tbox-webdav
    fi

    echo "Starting Go backend and applying pending database migrations..."
    compose up -d --remove-orphans backend
    wait_for_healthy backend
    compose up -d --remove-orphans frontend
    wait_for_healthy frontend
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
