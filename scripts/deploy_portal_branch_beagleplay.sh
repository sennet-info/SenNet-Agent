#!/usr/bin/env bash
set -euo pipefail

SCRIPT_NAME="$(basename "$0")"
EXPECTED_REPO_DIR="/opt/sennet-agent/repo"
RUNTIME_ROOT="/home/debian/sennet-portal"
RUNTIME_PORTAL_DIR="$RUNTIME_ROOT/portal"
REQUIRED_SERVICE="sennet-portal.service"
HEALTHCHECK_URL="http://127.0.0.1:3000/alertas"
STANDALONE_PATH="$RUNTIME_PORTAL_DIR/.next/standalone"

log() {
  echo "[$SCRIPT_NAME] $*"
}

die() {
  echo "[$SCRIPT_NAME] ERROR: $*" >&2
  exit 1
}

usage() {
  cat <<USAGE
Usage: $SCRIPT_NAME <branch>

Deploys portal code from the current repository checkout into BeaglePlay runtime.

Arguments:
  branch    Git branch to deploy (must exist in origin/<branch>)
USAGE
}

require_cmd() {
  local cmd="$1"
  command -v "$cmd" >/dev/null 2>&1 || die "Required command not found: $cmd"
}

main() {
  if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
    usage
    exit 0
  fi

  local branch="${1:-}"
  [ -n "$branch" ] || {
    usage
    die "Missing required <branch> argument"
  }

  require_cmd git
  require_cmd rsync
  require_cmd systemctl
  require_cmd curl

  local repo_dir
  repo_dir="$(git rev-parse --show-toplevel 2>/dev/null)" || die "This script must run inside a git repository"

  if [ "$repo_dir" != "$EXPECTED_REPO_DIR" ]; then
    die "Unexpected repository location: $repo_dir (expected $EXPECTED_REPO_DIR). Run this script from BeaglePlay working repo."
  fi

  cd "$repo_dir"

  local portal_source_dir="$repo_dir/portal"

  [ -d "$portal_source_dir" ] || die "Portal source directory not found: $portal_source_dir"

  log "Fetching latest refs"
  git fetch origin --prune

  log "Validating branch origin/$branch"
  git show-ref --verify --quiet "refs/remotes/origin/$branch" || die "Remote branch origin/$branch does not exist"

  log "Checking out branch $branch"
  if git show-ref --verify --quiet "refs/heads/$branch"; then
    git checkout "$branch"
  else
    git checkout -b "$branch" "origin/$branch"
  fi

  log "Hard reset to origin/$branch"
  git reset --hard "origin/$branch"

  log "Stopping $REQUIRED_SERVICE"
  sudo systemctl stop "$REQUIRED_SERVICE"

  log "Syncing portal/ into $RUNTIME_PORTAL_DIR"
  sudo mkdir -p "$RUNTIME_PORTAL_DIR"

  RSYNC_CHOWN_ARGS=()
  if rsync --help 2>&1 | grep -q -- '--chown'; then
    RSYNC_CHOWN_ARGS+=(--chown=debian:debian)
  fi

  sudo rsync -a --delete "${RSYNC_CHOWN_ARGS[@]}" \
    --exclude node_modules \
    --exclude .next \
    --exclude .git \
    "$portal_source_dir/" "$RUNTIME_PORTAL_DIR/"

  sudo chown -R debian:debian "$RUNTIME_ROOT"

  log "Building standalone portal bundle"
  sudo -u debian -H bash -lc 'cd /home/debian/sennet-portal/portal && ./scripts/build_standalone.sh'

  [ -d "$STANDALONE_PATH" ] || die "Standalone build output missing: $STANDALONE_PATH"

  log "Restarting $REQUIRED_SERVICE"
  sudo systemctl restart "$REQUIRED_SERVICE"

  log "Verifying systemd service is active"
  sudo systemctl is-active --quiet "$REQUIRED_SERVICE" || die "$REQUIRED_SERVICE is not active after restart"

  log "Verifying service process uses .next/standalone"
  local main_pid
  main_pid="$(sudo systemctl show -p MainPID --value "$REQUIRED_SERVICE")"
  [ -n "$main_pid" ] && [ "$main_pid" != "0" ] || die "Unable to read MainPID for $REQUIRED_SERVICE"

  local proc_cmdline
  proc_cmdline="$(tr '\0' ' ' < "/proc/$main_pid/cmdline" 2>/dev/null || true)"
  [ -n "$proc_cmdline" ] || die "Unable to read cmdline for PID $main_pid"

  case "$proc_cmdline" in
    *"$STANDALONE_PATH"*)
      ;;
    *)
      die "Service PID $main_pid is not running from $STANDALONE_PATH. Cmdline: $proc_cmdline"
      ;;
  esac

  log "Verifying HTTP response from /alertas"
  local http_code
  http_code="$(curl -sS -o /tmp/sennet_portal_alertas_check.html -w '%{http_code}' --max-time 15 "$HEALTHCHECK_URL")" \
    || die "curl request to $HEALTHCHECK_URL failed"

  case "$http_code" in
    200|301|302|307|308)
      ;;
    *)
      die "Unexpected HTTP status from $HEALTHCHECK_URL: $http_code"
      ;;
  esac

  log "Deployment complete for branch '$branch'"
  log "Service: $REQUIRED_SERVICE (active)"
  log "Healthcheck: $HEALTHCHECK_URL returned HTTP $http_code"
}

main "$@"
