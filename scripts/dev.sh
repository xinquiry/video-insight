#!/usr/bin/env bash
set -euo pipefail

DOCKER_DIR="$(cd "$(dirname "$0")/../docker" && pwd)"
PROJECT_NAME="videoinsight"
DEFAULT_ENV_FILE="$DOCKER_DIR/.env.example"
DEV_ENV_FILE="$DOCKER_DIR/.env.dev"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m'

compose() {
  env_args=(--env-file "$DEFAULT_ENV_FILE")

  if [ ! -f "$DEFAULT_ENV_FILE" ]; then
    echo -e "${RED}Missing $DEFAULT_ENV_FILE${NC}" >&2
    exit 1
  fi

  if [ ! -f "$DEV_ENV_FILE" ]; then
    echo -e "${YELLOW}Missing docker/.env.dev; using defaults from docker/.env.example only.${NC}"
  else
    env_args+=(--env-file "$DEV_ENV_FILE")
  fi

  docker compose -p "$PROJECT_NAME" \
    "${env_args[@]}" \
    -f "$DOCKER_DIR/docker-compose.base.yaml" \
    -f "$DOCKER_DIR/docker-compose.dev.yaml" \
    "$@"
}

up() {
  echo -e "${GREEN}Starting $PROJECT_NAME services...${NC}"
  compose up -d "$@"
}

stop() {
  echo -e "${YELLOW}Stopping $PROJECT_NAME services...${NC}"
  compose stop "$@"
}

down() {
  echo -e "${YELLOW}Stopping and removing $PROJECT_NAME containers...${NC}"
  compose down "$@"
}

nuke() {
  echo -e "${RED}Stopping $PROJECT_NAME and removing volumes...${NC}"
  compose down -v
}

restart() {
  echo -e "${YELLOW}Restarting $PROJECT_NAME services...${NC}"
  compose restart "$@"
}

rebuild() {
  echo -e "${GREEN}Rebuilding $PROJECT_NAME services...${NC}"
  compose up -d --build "$@"
}

logs() {
  compose logs "$@"
}

logs_follow() {
  compose logs -f "$@"
}

shell_db() {
  compose exec postgresql sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
}

usage() {
  echo "Usage: $0 <up|stop|down|nuke|restart|rebuild|logs|logs-f|shell-db> [service]"
}

case "${1:-}" in
  up) shift; up "$@" ;;
  stop) shift; stop "$@" ;;
  down) shift; down "$@" ;;
  nuke) shift; nuke ;;
  restart) shift; restart "$@" ;;
  rebuild) shift; rebuild "$@" ;;
  logs) shift; logs "$@" ;;
  logs-f) shift; logs_follow "$@" ;;
  shell-db) shell_db ;;
  -h|--help) usage ;;
  "") usage ;;
  *) usage; exit 1 ;;
esac
