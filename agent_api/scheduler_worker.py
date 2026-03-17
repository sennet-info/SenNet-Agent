#!/usr/bin/env python3
"""
SenNet Scheduler Worker — FastAPI-only oneshot.

Lanzado por sennet-scheduler-worker.timer cada minuto.
Llama a POST /v1/scheduler/run-due para ejecutar tareas vencidas.
No envía emails directamente; delega todo en FastAPI.

Entorno objetivo: servidor Linux con systemd.
BeaglePlay es solo entorno de prueba.
"""
import asyncio
import json
import logging
import os
from time import perf_counter

from agent_api.main import scheduler_run_due
from agent_api.schemas import SchedulerRunRequest

# Logging estructurado, sin spam.
# Solo loguea si hay tareas vencidas o si ocurre un error.
logger = logging.getLogger("sennet.scheduler_worker")
if not logger.handlers:
    handler = logging.StreamHandler()
    formatter = logging.Formatter(
        "%(asctime)s %(levelname)s %(name)s - %(message)s"
    )
    handler.setFormatter(formatter)
    logger.addHandler(handler)
logger.setLevel(logging.INFO)


def main() -> None:
    started = perf_counter()
    # Debug desactivado en ejecución automática para no penalizar rendimiento.
    # Usar /v1/scheduler/tasks/{id}/debug desde la UI para depurar manualmente.
    payload = SchedulerRunRequest(debug=False)
    try:
        result = asyncio.run(scheduler_run_due(payload=payload))
        due_count = int(result.get("due_count", 0)) if isinstance(result, dict) else 0
        processed = int(result.get("processed", 0)) if isinstance(result, dict) else 0
        duration_ms = int((perf_counter() - started) * 1000)

        if due_count > 0 or processed > 0:
            # Log detallado solo cuando hay trabajo real
            results_summary = []
            for item in (result.get("results") or []):
                task_id = item.get("task_id", "?")
                status = item.get("status", "?")
                email_sent = item.get("email_sent")
                detail = item.get("detail", "")
                if status == "skipped":
                    results_summary.append(f"{task_id}:skipped({detail})")
                elif status == "executed":
                    sent_str = "email_ok" if email_sent else f"email_fail({detail})"
                    results_summary.append(f"{task_id}:ok:{sent_str}")
                else:
                    results_summary.append(f"{task_id}:{status}({detail})")

            logger.info(
                "scheduler_run due=%s processed=%s duration_ms=%s tasks=[%s]",
                due_count,
                processed,
                duration_ms,
                ", ".join(results_summary),
            )
        # Si no hay tareas vencidas: silencio total (no spam en logs)

    except Exception:
        duration_ms = int((perf_counter() - started) * 1000)
        logger.exception("scheduler_worker_failed duration_ms=%s", duration_ms)
        raise


if __name__ == "__main__":
    main()
