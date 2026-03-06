#!/usr/bin/env python3
"""Trigger Portal alerts evaluation from cron/systemd timer."""

import os
import sys
import requests

PORTAL_BASE = os.getenv("SENNET_PORTAL_BASE", "http://127.0.0.1:3000")
ADMIN_TOKEN = os.getenv("SENNET_ADMIN_TOKEN", "")

if not ADMIN_TOKEN:
    print("SENNET_ADMIN_TOKEN is required", file=sys.stderr)
    sys.exit(1)

resp = requests.post(
    f"{PORTAL_BASE.rstrip('/')}/api/alerts/run",
    headers={"Authorization": f"Bearer {ADMIN_TOKEN}"},
    timeout=40,
)
print(resp.text)
resp.raise_for_status()
