#!/usr/bin/env bash
set -euo pipefail

DOCKER_DIR="$(cd "$(dirname "$0")/../docker" && pwd)"
PROJECT_NAME="videoinsight-go"
DEFAULT_ENV_FILE="$DOCKER_DIR/.env.example"
DEV_ENV_FILE="$DOCKER_DIR/.env.dev"

compose() {
  env_args=(--env-file "$DEFAULT_ENV_FILE")
  if [ -f "$DEV_ENV_FILE" ]; then
    env_args+=(--env-file "$DEV_ENV_FILE")
  fi
  docker compose -p "$PROJECT_NAME" \
    "${env_args[@]}" \
    -f "$DOCKER_DIR/docker-compose.base.yaml" \
    -f "$DOCKER_DIR/docker-compose.go.yaml" \
    "$@"
}

case "${1:-}" in
  up) shift; compose up -d "$@" ;;
  stop) shift; compose stop "$@" ;;
  down) shift; compose down "$@" ;;
  nuke) shift; compose down -v "$@" ;;
  restart) shift; compose restart "$@" ;;
  rebuild) shift; compose up -d --build "$@" ;;
  logs) shift; compose logs "$@" ;;
  logs-f) shift; compose logs -f "$@" ;;
  shell-db) compose exec postgresql sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' ;;
  *) echo "Usage: $0 <up|stop|down|nuke|restart|rebuild|logs|logs-f|shell-db> [service]"; exit 1 ;;
esac
