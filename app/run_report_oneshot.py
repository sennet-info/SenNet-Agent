#!/usr/bin/env python3
"""DEPRECATED: legacy scheduler runner disabled.

Scheduler automation is now executed by `agent_api/scheduler_worker.py`
via `sennet-scheduler-worker.service/.timer`.
"""

from datetime import datetime


def main():
    print(f"[{datetime.now().isoformat(timespec='seconds')}] DEPRECATED: run_report_oneshot.py is disabled.")
    print("Use systemd timer sennet-scheduler-worker.timer (FastAPI-only worker).")


if __name__ == "__main__":
    main()
