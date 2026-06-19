#!/usr/bin/env bash
set -euo pipefail

DOCKER_DIR="$(cd "$(dirname "$0")/../docker" && pwd)"
PROJECT_NAME="videoinsight"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m'

compose() {
  if [ ! -f "$DOCKER_DIR/.env" ]; then
    cp "$DOCKER_DIR/.env.example" "$DOCKER_DIR/.env"
    echo -e "${YELLOW}Created docker/.env from docker/.env.example${NC}"
  fi

  docker compose -p "$PROJECT_NAME" \
    -f "$DOCKER_DIR/docker-compose.base.yaml" \
    -f "$DOCKER_DIR/docker-compose.dev.yaml" \
    "$@"
}

start() {
  echo -e "${GREEN}Starting $PROJECT_NAME services...${NC}"
  compose up --build "$@"
}

stop() {
  echo -e "${YELLOW}Stopping $PROJECT_NAME services...${NC}"
  compose stop
}

teardown() {
  echo -e "${RED}Tearing down $PROJECT_NAME (removing volumes)...${NC}"
  compose down -v
}

usage() {
  echo "Usage: $0 [-d|-s|-e]"
  echo "  -d    Start services (detached)"
  echo "  -s    Stop services (keep volumes)"
  echo "  -e    Tear down (remove volumes)"
  echo "  (no flag) Start services in foreground"
}

case "${1:-}" in
  -d) start -d ;;
  -s) stop ;;
  -e) teardown ;;
  -h|--help) usage ;;
  "") start ;;
  *) usage; exit 1 ;;
esac
