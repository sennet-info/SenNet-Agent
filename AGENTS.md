# SenNet-Agent – Codex/Agent Guidelines

## Target environment
- Device: BeaglePlay (Debian ARM64)
- IP: 192.168.1.51
- Base runtime path: /opt/sennet-agent
- Repo path: /opt/sennet-agent/repo
- Venv: /opt/sennet-agent/venv

## Entrypoints
- FastAPI API: /opt/sennet-agent/repo/agent_api/main.py (uvicorn, port 8000)
- Scheduler worker (FastAPI-only): /opt/sennet-agent/repo/agent_api/scheduler_worker.py (triggered by systemd timer every minute)

## Services
- systemd units:
  - /etc/systemd/system/sennet-agent-api.service
  - /etc/systemd/system/sennet-scheduler-worker.timer
  - /etc/systemd/system/sennet-scheduler-worker.service
- Manage:
  - sudo systemctl restart sennet-agent-api.service
  - sudo systemctl restart sennet-scheduler-worker.timer
  - journalctl -u sennet-agent-api.service -n 200 --no-pager
  - journalctl -u sennet-scheduler-worker.service -n 200 --no-pager

## Runtime configs (DO NOT COMMIT)
These are runtime-only and must never be committed to Git:
- /opt/sennet-agent/config_tenants.json
- /opt/sennet-agent/smtp_config.json
- /opt/sennet-agent/scheduled_tasks.json
- /opt/sennet-agent/device_roles.json

Repo uses symlinks in:
- /opt/sennet-agent/repo/app/*.json -> /opt/sennet-agent/*.json

## Deployment
- scripts/deploy.sh:
  - Updates /opt/sennet-agent/repo from GitHub
  - Installs/updates systemd unit
  - Installs/updates API + scheduler worker systemd units
  - Removes legacy /etc/cron.d/sennet-agent
- Keep absolute paths in systemd scripts.

## Safety
- Never log or commit secrets (tokens, SMTP passwords).

## Portal Next.js
- Runtime path: `/home/debian/sennet-portal`
- Manual build: `cd /home/debian/sennet-portal/portal && ./scripts/build_standalone.sh`
- Service restart: `sudo systemctl restart sennet-portal.service`
- Service logs: `journalctl -u sennet-portal.service -n 200 --no-pager`
- URL: `http://<ip>:3000`
