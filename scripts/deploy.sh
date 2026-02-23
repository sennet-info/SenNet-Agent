#!/usr/bin/env bash
set -euo pipefail

BASE="/opt/sennet-agent"
REPO_DIR="$BASE/repo"
VENV="$BASE/venv"

echo "==> Ensure base folders"
mkdir -p "$BASE"

echo "==> Clone or update repo"
if [ ! -d "$REPO_DIR/.git" ]; then
  git clone https://github.com/sennet-info/SenNet-Agent.git "$REPO_DIR"
else
  cd "$REPO_DIR"
  git fetch --all
  git reset --hard origin/main
fi

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
