#!/usr/bin/env bash
set -euo pipefail

BASE="/opt/sennet-agent"
REPO_DIR="$BASE/repo"
VENV="$BASE/venv"
DEPLOY_BRANCH="${DEPLOY_BRANCH:-main}"
PORTAL_SOURCE_DIR="$REPO_DIR/portal"
PORTAL_RUNTIME_DIR="/home/debian/sennet-portal"
PORTAL_APP_DIR="$PORTAL_RUNTIME_DIR/portal"

echo "==> Deploy branch: $DEPLOY_BRANCH"
echo "==> Ensure base folders"
mkdir -p "$BASE"

echo "==> Clone or update repo"
if [ ! -d "$REPO_DIR/.git" ]; then
  echo "==> Repository not found in $REPO_DIR; cloning"
  git clone https://github.com/sennet-info/SenNet-Agent.git "$REPO_DIR"
fi

cd "$REPO_DIR"

echo "==> Fetch latest refs from all remotes"
git fetch --all

echo "==> Validating remote branch origin/$DEPLOY_BRANCH"
if ! git show-ref --verify --quiet "refs/remotes/origin/$DEPLOY_BRANCH"; then
  echo "ERROR: Remote branch origin/$DEPLOY_BRANCH does not exist."
  echo "Please set DEPLOY_BRANCH to an existing branch and retry."
  exit 1
fi

echo "==> Checking out branch $DEPLOY_BRANCH"
if git show-ref --verify --quiet "refs/heads/$DEPLOY_BRANCH"; then
  git checkout "$DEPLOY_BRANCH"
else
  git checkout -b "$DEPLOY_BRANCH" "origin/$DEPLOY_BRANCH"
fi

echo "==> Resetting local branch to origin/$DEPLOY_BRANCH"
git reset --hard "origin/$DEPLOY_BRANCH"

echo "==> Ensure venv"
if [ ! -d "$VENV" ]; then
  python3 -m venv "$VENV"
fi

echo "==> Install dependencies"
"$VENV/bin/pip" install --upgrade pip wheel
if [ -f "$REPO_DIR/requirements.txt" ]; then
  "$VENV/bin/pip" install -r "$REPO_DIR/requirements.txt"
fi

echo "==> Install API systemd service"
sudo cp "$REPO_DIR/systemd/sennet-agent-api.service" /etc/systemd/system/sennet-agent-api.service
sudo systemctl daemon-reload
sudo systemctl enable --now sennet-agent-api.service
sudo systemctl restart sennet-agent-api.service

# Streamlit queda opcional/legacy (no operativo para scheduler)
if [ -f "$REPO_DIR/systemd/sennet-agent.service" ]; then
  sudo cp "$REPO_DIR/systemd/sennet-agent.service" /etc/systemd/system/sennet-agent.service
fi

echo "==> Install cron"
sudo cp "$REPO_DIR/cron/sennet-agent.cron" /etc/cron.d/sennet-agent
sudo chmod 644 /etc/cron.d/sennet-agent

if [ -d "$PORTAL_SOURCE_DIR" ]; then
  echo "==> Portal detected in $PORTAL_SOURCE_DIR"
  echo "==> Sync portal sources to $PORTAL_APP_DIR"
  sudo mkdir -p "$PORTAL_APP_DIR"

  RSYNC_CHOWN_ARGS=()
  if rsync --help 2>&1 | grep -q -- '--chown'; then
    RSYNC_CHOWN_ARGS+=(--chown=debian:debian)
  fi

  sudo rsync -a --delete "${RSYNC_CHOWN_ARGS[@]}" \
    --exclude node_modules \
    --exclude .next \
    --exclude .git \
    "$PORTAL_SOURCE_DIR/" "$PORTAL_APP_DIR/"

  sudo chown -R debian:debian "$PORTAL_RUNTIME_DIR"

  echo "==> Build portal standalone bundle as debian user"
  sudo -u debian -H bash -lc 'cd /home/debian/sennet-portal && cd portal && ./scripts/build_standalone.sh'

  echo "==> Install portal systemd service"
  sudo cp "$REPO_DIR/systemd/sennet-portal.service" /etc/systemd/system/sennet-portal.service
  sudo systemctl daemon-reload
  sudo systemctl enable --now sennet-portal.service
  sudo systemctl restart sennet-portal.service
else
  echo "==> Portal directory not found; skipping portal deployment"
fi

echo "==> Done"
systemctl --no-pager --full status sennet-agent-api.service || true
if systemctl list-unit-files | grep -q '^sennet-portal.service'; then
  systemctl --no-pager --full status sennet-portal.service || true
fi
