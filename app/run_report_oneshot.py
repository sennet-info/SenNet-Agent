import asyncio
import os
import traceback
import sys
from datetime import datetime

# Añadimos el directorio actual al path para asegurar imports
APP_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(APP_DIR)
sys.path.append(APP_DIR)
sys.path.append(REPO_ROOT)

from modules.scheduler_logic import SchedulerLogic
from agent_api.main import scheduler_run_task
from agent_api.schemas import SchedulerRunRequest

# RUTA LOG CRON
BASE_DIR = APP_DIR
CRON_LOG_FILE = os.path.join(BASE_DIR, "cron_log.log")


def log_cron(event, **kwargs):
    ts = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    details = ' '.join([f"{k}={v}" for k, v in kwargs.items()])
    line = f"[{ts}] {event} {details}\n"
    with open(CRON_LOG_FILE, 'a', encoding='utf-8') as f:
        f.write(line)
    print(line.strip())


def _run_task_via_fastapi(task_id: str) -> dict:
    """Ejecuta exactamente el flujo moderno del scheduler FastAPI."""
    payload = SchedulerRunRequest(debug=True)
    return asyncio.run(scheduler_run_task(task_id=task_id, payload=payload))


def _extract_range_bounds(run_resp: dict):
    debug = run_resp.get("debug") if isinstance(run_resp, dict) else {}
    if not isinstance(debug, dict):
        return None, None
    resolved = debug.get("resolved_range") if isinstance(debug.get("resolved_range"), dict) else {}
    return resolved.get("start"), resolved.get("stop")


def main():
    print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] 🔎 CRON: Buscando tareas...")

    try:
        tasks = SchedulerLogic.load_tasks()
        if not tasks:
            print("   (Sin tareas definidas)")
            return

        tasks_executed = 0

        for task in tasks:
            claim = SchedulerLogic.claim_execution(task['id'], source="cron")
            if not claim.get('ok'):
                log_cron("TASK_EXECUTE_SKIP", task_id=task['id'], reason=claim.get('reason'))
                continue

            run_id = claim.get('run_id')
            log_cron("TASK_EXECUTE_START", task_id=task['id'], run_id=run_id)
            print(f"   🚀 Ejecutando vía FastAPI: {task['client']} - {task['site']} ({task['frequency']})")

            sent_ok = False
            range_start = None
            range_end = None
            try:
                result = _run_task_via_fastapi(task['id'])
                sent_ok = bool(result.get("email_sent"))
                range_start, range_end = _extract_range_bounds(result)

                if result.get("ok") and result.get("pdf_path"):
                    log_cron(
                        "TASK_EXECUTE_DONE",
                        task_id=task['id'],
                        run_id=run_id,
                        email_sent=sent_ok,
                        pdf=result.get("filename"),
                    )
                    tasks_executed += 1
                else:
                    log_cron("TASK_EXECUTE_FAILED", task_id=task['id'], run_id=run_id, detail="run_not_ok")
            except Exception as e:
                log_cron("TASK_EXECUTE_ERROR", task_id=task['id'], run_id=run_id, error=str(e))
                print(f"      🔥 Excepción: {e}")
            finally:
                SchedulerLogic.finish_execution(
                    task['id'],
                    run_id,
                    sent_ok=sent_ok,
                    range_start=range_start,
                    range_end=range_end,
                )

        if tasks_executed == 0:
            print("   (Ninguna tarea coincidía con la hora actual)")
        else:
            print(f"   ✅ Total ejecutadas: {tasks_executed}")

    except Exception as e:
        print(f"🔥 Error Global: {e}")
        traceback.print_exc()


if __name__ == "__main__":
    main()
