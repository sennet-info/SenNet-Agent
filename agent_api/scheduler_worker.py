#!/usr/bin/env python3
import asyncio
import json
import logging
from datetime import datetime
from time import perf_counter

from agent_api.main import scheduler_run_due
from agent_api.schemas import SchedulerRunRequest

logger = logging.getLogger("sennet.scheduler_worker")
if not logger.handlers:
    handler = logging.StreamHandler()
    formatter = logging.Formatter("%(asctime)s %(levelname)s %(name)s - %(message)s")
    handler.setFormatter(formatter)
    logger.addHandler(handler)
logger.setLevel(logging.INFO)


def main():
    started = perf_counter()
    payload = SchedulerRunRequest(debug=False)
    try:
        result = asyncio.run(scheduler_run_due(payload=payload))
        due_count = int(result.get("due_count", 0)) if isinstance(result, dict) else 0
        processed = int(result.get("processed", 0)) if isinstance(result, dict) else 0
        duration_ms = int((perf_counter() - started) * 1000)
        if due_count > 0 or processed > 0:
            logger.info(
                "scheduler_worker_run due=%s processed=%s duration_ms=%s result=%s",
                due_count,
                processed,
                duration_ms,
                json.dumps(result, ensure_ascii=False),
            )
    except Exception:  # noqa: BLE001
        duration_ms = int((perf_counter() - started) * 1000)
        logger.exception("scheduler_worker_failed duration_ms=%s", duration_ms)
        raise


if __name__ == "__main__":
    main()
