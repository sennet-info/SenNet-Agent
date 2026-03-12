#!/usr/bin/env python3
"""DEPRECATED: legacy scheduler runner disabled.

This file must never execute scheduled tasks in production.
Use `agent_api/scheduler_worker.py` via systemd timer.
"""

from datetime import datetime


if __name__ == "__main__":
    print(f"[{datetime.now().isoformat(timespec='seconds')}] DEPRECATED: run_report_oneshot.py is disabled.")
    print("Use sennet-scheduler-worker.timer -> agent_api/scheduler_worker.py")
    raise SystemExit(2)
