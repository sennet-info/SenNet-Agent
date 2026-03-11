#!/usr/bin/env python3
import json
import os
import sys
from datetime import datetime
from urllib import error, request

API_BASE = os.getenv("SCHEDULER_API_BASE", "http://127.0.0.1:8000").rstrip("/")
API_TOKEN = os.getenv("AGENT_ADMIN_TOKEN", "")
CRON_LOG_FILE = os.getenv("SCHEDULER_CRON_LOG", "/opt/sennet-agent/cron_log.log")


def log_cron(event: str, **kwargs):
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    details = " ".join([f"{k}={v}" for k, v in kwargs.items()])
    line = f"[{ts}] {event} {details}\n"
    os.makedirs(os.path.dirname(CRON_LOG_FILE), exist_ok=True)
    with open(CRON_LOG_FILE, "a", encoding="utf-8") as f:
        f.write(line)
    print(line.strip())


def main() -> int:
    if not API_TOKEN:
        log_cron("SCHEDULER_API_TICK_ERROR", detail="AGENT_ADMIN_TOKEN no configurado")
        return 1

    url = f"{API_BASE}/v1/scheduler/run-due"
    req = request.Request(url, method="POST", headers={"Authorization": f"Bearer {API_TOKEN}", "Content-Type": "application/json"}, data=b"{}")

    try:
        with request.urlopen(req, timeout=120) as resp:
            payload = json.loads(resp.read().decode("utf-8") or "{}")
            processed = payload.get("processed", 0)
            log_cron("SCHEDULER_API_TICK_OK", processed=processed)
            for item in payload.get("items", []):
                log_cron("SCHEDULER_TASK_RESULT", **item)
            return 0
    except error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="ignore")
        log_cron("SCHEDULER_API_TICK_HTTP_ERROR", status=exc.code, detail=detail[:500])
        return 2
    except Exception as exc:  # noqa: BLE001
        log_cron("SCHEDULER_API_TICK_ERROR", detail=str(exc))
        return 3


if __name__ == "__main__":
    sys.exit(main())
