# SenNet-Agent – Codex/Agent Guidelines

## Target environment
- Device: BeaglePlay (Debian ARM64)
- IP: 192.168.1.51
- Base runtime path: /opt/sennet-agent
- Repo path: /opt/sennet-agent/repo
- Venv: /opt/sennet-agent/venv

## Entrypoints
- Streamlit UI: /opt/sennet-agent/repo/app/app.py (port 8501)
- Cron oneshot: /opt/sennet-agent/repo/app/run_report_oneshot.py (runs every minute)

## Services
- systemd unit: /etc/systemd/system/sennet-agent.service
- Manage:
  - sudo systemctl restart sennet-agent.service
  - journalctl -u sennet-agent.service -n 200 --no-pager

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
  - Installs/updates /etc/cron.d/sennet-agent
- Keep absolute paths in systemd/cron/scripts.

## Safety
- Never log or commit secrets (tokens, SMTP passwords).
