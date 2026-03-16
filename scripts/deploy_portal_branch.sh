#!/usr/bin/env bash
set -euo pipefail

# SenNet Portal — despliegue de rama
# Variables configurables:
#   SENNET_USER      Usuario del sistema  (default: sennet)
#   PORTAL_RUNTIME   Directorio del portal (default: /opt/sennet-portal)
#
# Ejemplo BeaglePlay:
#   SENNET_USER=debian PORTAL_RUNTIME=/home/debian/sennet-portal \
#     ./scripts/deploy_portal_branch.sh feat/mi-rama

SCRIPT_NAME="$(basename "$0")"
SENNET_USER="${SENNET_USER:-sennet}"
PORTAL_RUNTIME="${PORTAL_RUNTIME:-/opt/sennet-portal}"
PORTAL_APP_DIR="$PORTAL_RUNTIME/portal"
REQUIRED_SERVICE="sennet-portal.service"
HEALTHCHECK_URL="http://127.0.0.1:3000/alertas"
STANDALONE_PATH="$PORTAL_APP_DIR/.next/standalone"

log() { echo "[$SCRIPT_NAME] $*"; }
die() { echo "[$SCRIPT_NAME] ERROR: $*" >&2; exit 1; }

usage() {
  cat <<USAGE
Usage: $SCRIPT_NAME <branch>
Deploys portal from current repo into runtime directory.
Arguments:
  branch    Git branch to deploy (must exist in origin/<branch>)
Environment:
  SENNET_USER      System user owning portal files (default: sennet)
  PORTAL_RUNTIME   Portal root directory           (default: /opt/sennet-portal)
Example (BeaglePlay):
  SENNET_USER=debian PORTAL_RUNTIME=/home/debian/sennet-portal \\
    ./scripts/deploy_portal_branch.sh feat/my-branch
USAGE
}

[ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ] && { usage; exit 0; }
branch="${1:-}"
[ -n "$branch" ] || { usage; die "Missing required <branch> argument"; }

command -v git >/dev/null 2>&1 || die "git not found"
command -v rsync >/dev/null 2>&1 || die "rsync not found"
command -v systemctl >/dev/null 2>&1 || die "systemctl not found"
command -v curl >/dev/null 2>&1 || die "curl not found"

repo_dir="$(git rev-parse --show-toplevel 2>/dev/null)" || die "Must run inside a git repo"
portal_source_dir="$repo_dir/portal"
[ -d "$portal_source_dir" ] || die "Portal source not found: $portal_source_dir"

cd "$repo_dir"
log "Fetching latest refs"
git fetch origin --prune

git show-ref --verify --quiet "refs/remotes/origin/$branch" || die "Remote branch origin/$branch does not exist"

if git show-ref --verify --quiet "refs/heads/$branch"; then
  git checkout "$branch"
else
  git checkout -b "$branch" "origin/$branch"
fi
git reset --hard "origin/$branch"

log "Stopping $REQUIRED_SERVICE"
sudo systemctl stop "$REQUIRED_SERVICE"

log "Syncing portal/ into $PORTAL_APP_DIR"
sudo mkdir -p "$PORTAL_APP_DIR"

RSYNC_CHOWN_ARGS=()
rsync --help 2>&1 | grep -q -- '--chown' && RSYNC_CHOWN_ARGS+=(--chown="${SENNET_USER}:${SENNET_USER}")

sudo rsync -a --delete "${RSYNC_CHOWN_ARGS[@]}" \
  --exclude node_modules --exclude .next --exclude .git \
  "$portal_source_dir/" "$PORTAL_APP_DIR/"

sudo chown -R "${SENNET_USER}:${SENNET_USER}" "$PORTAL_RUNTIME"

log "Building standalone bundle as $SENNET_USER"
sudo -u "$SENNET_USER" -H bash -lc "cd ${PORTAL_APP_DIR} && ./scripts/build_standalone.sh"

[ -d "$STANDALONE_PATH" ] || die "Standalone build missing: $STANDALONE_PATH"

log "Restarting $REQUIRED_SERVICE"
sudo systemctl restart "$REQUIRED_SERVICE"
sudo systemctl is-active --quiet "$REQUIRED_SERVICE" || die "$REQUIRED_SERVICE not active after restart"

main_pid="$(sudo systemctl show -p MainPID --value "$REQUIRED_SERVICE")"
[ -n "$main_pid" ] && [ "$main_pid" != "0" ] || die "Unable to read MainPID"
proc_cmdline="$(tr '\0' ' ' < "/proc/$main_pid/cmdline" 2>/dev/null || true)"
case "$proc_cmdline" in
  *"$STANDALONE_PATH"*) ;;
  *) die "Service not running from $STANDALONE_PATH" ;;
esac

http_code="$(curl -sS -o /tmp/sennet_check.html -w '%{http_code}' --max-time 15 "$HEALTHCHECK_URL")" \
  || die "curl to $HEALTHCHECK_URL failed"
case "$http_code" in
  200|301|302|307|308) ;;
  *) die "Unexpected HTTP $http_code from $HEALTHCHECK_URL" ;;
esac

log "Deploy complete: branch '$branch' | service active | HTTP $http_code"
