import json
import os
import uuid
import fcntl
from datetime import datetime
from modules.report_range import DEFAULT_REPORT_RANGE_MODE

# RUTA DE DATOS CORREGIDA PARA CRON (Ruta absoluta dinamica)
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TASKS_FILE = os.path.join(BASE_DIR, "scheduled_tasks.json")
TASKS_LOCK_FILE = f"{TASKS_FILE}.lock"
LOCK_STALE_SECONDS = 300


class SchedulerLogic:
    @staticmethod
    def load_tasks():
        if os.path.exists(TASKS_FILE):
            with open(TASKS_FILE, 'r') as f:
                return json.load(f)
        return []

    @staticmethod
    def save_tasks(tasks):
        with open(TASKS_FILE, 'w') as f:
            json.dump(tasks, f, indent=2)

    @staticmethod
    def _save_tasks_locked(tasks):
        with open(TASKS_FILE, 'w') as f:
            json.dump(tasks, f, indent=2)

    @staticmethod
    def _with_tasks_lock(fn):
        os.makedirs(os.path.dirname(TASKS_LOCK_FILE), exist_ok=True)
        with open(TASKS_LOCK_FILE, "a+") as lock_f:
            fcntl.flock(lock_f.fileno(), fcntl.LOCK_EX)
            tasks = SchedulerLogic.load_tasks()
            result = fn(tasks)
            if result.get("save"):
                SchedulerLogic._save_tasks_locked(tasks)
            fcntl.flock(lock_f.fileno(), fcntl.LOCK_UN)
            return result

    @staticmethod
    def add_task(tenant_alias, client, site, device, frequency, time, emails, report_range_mode=DEFAULT_REPORT_RANGE_MODE):
        tasks = SchedulerLogic.load_tasks()
        task = {
            "id": str(uuid.uuid4()),
            "tenant_alias": tenant_alias,
            "client": client,
            "site": site,
            "device": device,
            "frequency": frequency,
            "time": time,
            "emails": emails,
            "report_range_mode": report_range_mode or DEFAULT_REPORT_RANGE_MODE,
            "last_run": None,
            "last_run_id": None,
            "last_run_ts": None,
            "last_manual_run": None,
            "last_manual_run_id": None,
            "in_progress_run_id": None,
            "in_progress_source": None,
            "in_progress_started_at": None,
            "created_at": datetime.now().isoformat(timespec="seconds")
        }
        tasks.append(task)
        SchedulerLogic.save_tasks(tasks)
        return task

    @staticmethod
    def remove_task(task_id):
        tasks = SchedulerLogic.load_tasks()
        new_tasks = [t for t in tasks if t['id'] != task_id]
        SchedulerLogic.save_tasks(new_tasks)

    @staticmethod
    def should_run(task):
        now = datetime.now()
        task_time_obj = datetime.strptime(task['time'], "%H:%M")
        scheduled_today = now.replace(hour=task_time_obj.hour, minute=task_time_obj.minute, second=0, microsecond=0)

        if now < scheduled_today:
            return False

        # Si hubo ejecución manual este mismo minuto, no ejecutar por cron.
        manual_run_str = task.get('last_manual_run')
        if manual_run_str:
            manual_run = datetime.fromisoformat(manual_run_str)
            if manual_run.strftime("%Y-%m-%d %H:%M") == now.strftime("%Y-%m-%d %H:%M"):
                return False

        last_run_str = task.get('last_run_ts') or task.get('last_run')
        if last_run_str:
            last_run = datetime.fromisoformat(last_run_str)
            if last_run.date() >= now.date():
                return False

        diff_minutes = (now - scheduled_today).total_seconds() / 60
        if diff_minutes > 10:
            return False

        return True

    @staticmethod
    def claim_execution(task_id, source):
        now = datetime.now()
        now_iso = now.isoformat(timespec="seconds")
        run_id = f"{source}-{task_id[:8]}-{now.strftime('%Y%m%d%H%M%S')}"

        def _claim(tasks):
            for t in tasks:
                if t['id'] != task_id:
                    continue

                in_progress_started_at = t.get("in_progress_started_at")
                if t.get("in_progress_run_id") and in_progress_started_at:
                    started_at = datetime.fromisoformat(in_progress_started_at)
                    if (now - started_at).total_seconds() < LOCK_STALE_SECONDS:
                        return {
                            "save": False,
                            "ok": False,
                            "reason": "in_progress",
                            "run_id": t.get("in_progress_run_id")
                        }

                if source == "cron":
                    if not SchedulerLogic.should_run(t):
                        return {"save": False, "ok": False, "reason": "not_due", "run_id": None}
                    manual_run_str = t.get('last_manual_run')
                    if manual_run_str:
                        manual_run = datetime.fromisoformat(manual_run_str)
                        if manual_run.strftime("%Y-%m-%d %H:%M") == now.strftime("%Y-%m-%d %H:%M"):
                            return {"save": False, "ok": False, "reason": "manual_same_minute", "run_id": None}

                    t['last_run'] = now_iso
                    t['last_run_ts'] = now_iso
                    t['last_run_id'] = run_id
                else:
                    t['last_manual_run'] = now_iso
                    t['last_manual_run_id'] = run_id

                t['in_progress_run_id'] = run_id
                t['in_progress_source'] = source
                t['in_progress_started_at'] = now_iso
                return {"save": True, "ok": True, "reason": "claimed", "run_id": run_id}

            return {"save": False, "ok": False, "reason": "task_not_found", "run_id": None}

        return SchedulerLogic._with_tasks_lock(_claim)

    @staticmethod
    def finish_execution(task_id, run_id, sent_ok):
        now_iso = datetime.now().isoformat(timespec="seconds")

        def _finish(tasks):
            for t in tasks:
                if t['id'] != task_id:
                    continue
                if t.get("in_progress_run_id") == run_id:
                    t['in_progress_run_id'] = None
                    t['in_progress_source'] = None
                    t['in_progress_started_at'] = None
                t['last_email_sent_at'] = now_iso if sent_ok else t.get('last_email_sent_at')
                return {"save": True, "ok": True}
            return {"save": False, "ok": False}

        return SchedulerLogic._with_tasks_lock(_finish)

    @staticmethod
    def update_last_run(task_id):
        now_iso = datetime.now().isoformat(timespec="seconds")
        tasks = SchedulerLogic.load_tasks()
        for t in tasks:
            if t['id'] == task_id:
                t['last_run'] = now_iso
                t['last_run_ts'] = now_iso
                t['last_run_id'] = f"manual-{task_id[:8]}-{datetime.now().strftime('%Y%m%d%H%M%S')}"
        SchedulerLogic.save_tasks(tasks)
