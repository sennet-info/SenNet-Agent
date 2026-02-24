#!/usr/bin/env bash
set -euo pipefail

BASE="/opt/sennet-agent"
REPO_DIR="$BASE/repo"
VENV="$BASE/venv"
DEPLOY_BRANCH="${DEPLOY_BRANCH:-main}"

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

echo "==> Install systemd service"
sudo cp "$REPO_DIR/systemd/sennet-agent.service" /etc/systemd/system/sennet-agent.service
sudo systemctl daemon-reload
sudo systemctl enable --now sennet-agent.service
sudo systemctl restart sennet-agent.service

echo "==> Install cron"
sudo cp "$REPO_DIR/cron/sennet-agent.cron" /etc/cron.d/sennet-agent
sudo chmod 644 /etc/cron.d/sennet-agent

echo "==> Done"
systemctl --no-pager --full status sennet-agent.service || true
