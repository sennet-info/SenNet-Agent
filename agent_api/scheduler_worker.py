#!/usr/bin/env python3
import asyncio
from datetime import datetime

from agent_api.main import scheduler_run_due
from agent_api.schemas import SchedulerRunRequest


def main():
    started = datetime.now().isoformat(timespec="seconds")
    print(f"[{started}] Scheduler worker (FastAPI-only) started")
    payload = SchedulerRunRequest(debug=True)
    result = asyncio.run(scheduler_run_due(payload=payload))
    print(result)


if __name__ == "__main__":
    main()
