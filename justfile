# VideoInsight's public developer workflows.
#
# Keep this interface small. Component-specific operations belong to Go, pnpm,
# Cargo, or the scripts in their respective directories.

# Show the public workflow commands
[private]
default:
    @just --list --unsorted

# Develop the hosted application: start, stop, down, reset, restart, rebuild, logs, logs-once, or db
dev action="start" service="":
    #!/usr/bin/env bash
    set -euo pipefail

    action={{ quote(action) }}
    service={{ quote(service) }}

    run_dev() {
      local command="$1"
      if [[ -n "$service" ]]; then
        exec ./scripts/dev.sh "$command" "$service"
      fi
      exec ./scripts/dev.sh "$command"
    }

    require_no_service() {
      if [[ -n "$service" ]]; then
        echo "The '$action' action does not accept a service." >&2
        exit 2
      fi
    }

    case "$action" in
      start) run_dev up ;;
      stop|down|restart|rebuild) run_dev "$action" ;;
      reset)
        require_no_service
        exec ./scripts/dev.sh nuke
        ;;
      logs) run_dev logs-f ;;
      logs-once) run_dev logs ;;
      db)
        require_no_service
        exec ./scripts/dev.sh shell-db
        ;;
      *)
        echo "Usage: just dev [start|stop|down|reset|restart|rebuild|logs|logs-once|db] [service]" >&2
        exit 2
        ;;
    esac

# Run the classroom application: run, demo, or open <video>
desktop action="run" target="":
    #!/usr/bin/env bash
    set -euo pipefail

    action={{ quote(action) }}
    target={{ quote(target) }}

    case "$action" in
      run)
        if [[ -n "$target" ]]; then
          echo "Usage: just desktop [run|demo] or just desktop open <video>" >&2
          exit 2
        fi
        cd class-button/desktop
        exec pnpm dev
        ;;
      demo)
        if [[ -n "$target" ]]; then
          echo "Usage: just desktop demo" >&2
          exit 2
        fi
        cd class-button/desktop
        exec pnpm dev:demo
        ;;
      open)
        if [[ -z "$target" ]]; then
          echo "Usage: just desktop open <video>" >&2
          exit 2
        fi
        cd class-button/desktop
        exec pnpm dev -- --video "$target"
        ;;
      *)
        echo "Usage: just desktop [run|demo] or just desktop open <video>" >&2
        exit 2
        ;;
    esac

# Verify supported products: all, unit, web, or desktop
check scope="all":
    #!/usr/bin/env bash
    set -euo pipefail

    scope={{ quote(scope) }}

    check_web() {
      echo "Checking hosted application..."
      (cd backend && test -z "$(gofmt -l .)")
      (cd backend && go vet ./...)
      (cd backend && go test -race ./...)
      (cd frontend && pnpm lint)
      (cd frontend && pnpm test)
      (cd frontend && pnpm build)
    }

    check_desktop() {
      echo "Checking classroom application..."
      (cd class-button && cargo fmt --all -- --check)
      (cd class-button && cargo test --workspace)
      (cd class-button/desktop && pnpm check)
    }

    check_unit() {
      echo "Running unit tests..."
      (cd backend && go test -race ./...)
      (cd frontend && pnpm test)
      (cd class-button && cargo test --workspace)
      (cd class-button/desktop && pnpm test)
    }

    case "$scope" in
      all)
        check_web
        check_desktop
        ;;
      unit) check_unit ;;
      web) check_web ;;
      desktop) check_desktop ;;
      *)
        echo "Usage: just check [all|unit|web|desktop]" >&2
        exit 2
        ;;
    esac

# Apply safe automatic fixes: all, web, or desktop
fix scope="all":
    #!/usr/bin/env bash
    set -euo pipefail

    scope={{ quote(scope) }}

    fix_web() {
      (cd backend && gofmt -w .)
      (cd frontend && pnpm lint:fix)
      (cd frontend && pnpm format)
    }

    fix_desktop() {
      (cd class-button && cargo fmt --all)
    }

    case "$scope" in
      all)
        fix_web
        fix_desktop
        ;;
      web) fix_web ;;
      desktop) fix_desktop ;;
      *)
        echo "Usage: just fix [all|web|desktop]" >&2
        exit 2
        ;;
    esac

# Reconcile production: apply or down
deploy action="apply":
    #!/usr/bin/env bash
    set -euo pipefail

    action={{ quote(action) }}

    case "$action" in
      apply) exec ./scripts/deploy-prod.sh up ;;
      down) exec ./scripts/deploy-prod.sh down ;;
      *)
        echo "Usage: just deploy [apply|down]" >&2
        exit 2
        ;;
    esac
