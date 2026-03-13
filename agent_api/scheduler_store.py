import fcntl
import json
import os
import tempfile
import uuid
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Optional

from fastapi import HTTPException

from modules.report_range import DEFAULT_REPORT_RANGE_MODE

DEFAULT_SCHEDULED_PATH = Path("/opt/sennet-agent/scheduled_tasks.json")
DEFAULT_SMTP_PATH = Path("/opt/sennet-agent/smtp_config.json")


LOCK_STALE_SECONDS = 300
SCHEDULER_SOURCES = {"timer", "manual", "debug"}

class JsonFileStore:
    def __init__(self, path: Path):
        self.path = path
        self.lock_path = Path(f"{path}.lock")

    @contextmanager
    def _locked(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.lock_path.parent.mkdir(parents=True, exist_ok=True)
        with self.lock_path.open("a+", encoding="utf-8") as lock_handle:
            fcntl.flock(lock_handle.fileno(), fcntl.LOCK_EX)
            try:
                yield
            finally:
                fcntl.flock(lock_handle.fileno(), fcntl.LOCK_UN)

    def read(self, default: Any):
        with self._locked():
            if not self.path.exists():
                return default
            with self.path.open("r", encoding="utf-8") as handle:
                return json.load(handle)

    def update(self, default: Any, mutate_fn: Callable[[Any], Any]):
        with self._locked():
            data = default
            if self.path.exists():
                with self.path.open("r", encoding="utf-8") as handle:
                    data = json.load(handle)
            updated = mutate_fn(data)
            self._atomic_write(updated)
            return updated

    def _atomic_write(self, data: Any):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp_name = tempfile.mkstemp(prefix=f".{self.path.name}.", dir=str(self.path.parent))
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                json.dump(data, handle, indent=2, ensure_ascii=False)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(tmp_name, self.path)
        finally:
            if os.path.exists(tmp_name):
                os.unlink(tmp_name)


def _now_iso() -> str:
    return datetime.now().isoformat(timespec="seconds")


def _normalize_task(task: dict[str, Any]) -> dict[str, Any]:
    normalized = dict(task)
    normalized["id"] = normalized.get("id") or str(uuid.uuid4())
    normalized["tenant_alias"] = normalized.get("tenant_alias") or normalized.get("tenant")
    normalized["extra_devices"] = [d for d in normalized.get("extra_devices", []) if d]
    normalized["enabled"] = bool(normalized.get("enabled", True))
    normalized["report_range_mode"] = normalized.get("report_range_mode") or DEFAULT_REPORT_RANGE_MODE
    normalized["created_at"] = normalized.get("created_at") or _now_iso()
    normalized["frequency"] = normalized.get("frequency") or "daily"
    normalized["time"] = normalized.get("time") or "08:00"
    normalized["emails"] = normalized.get("emails") or []
    normalized["last_run"] = normalized.get("last_run")
    normalized["last_run_ts"] = normalized.get("last_run_ts") or normalized.get("last_run")
    normalized["last_run_id"] = normalized.get("last_run_id")
    normalized["last_manual_run"] = normalized.get("last_manual_run")
    normalized["last_manual_run_id"] = normalized.get("last_manual_run_id")
    normalized["last_email_sent_at"] = normalized.get("last_email_sent_at")
    normalized["last_error"] = normalized.get("last_error")
    normalized["last_status"] = normalized.get("last_status") or "pending"
    normalized["last_duration_ms"] = normalized.get("last_duration_ms")
    normalized["in_progress_run_id"] = normalized.get("in_progress_run_id")
    normalized["in_progress_source"] = normalized.get("in_progress_source")
    normalized["in_progress_started_at"] = normalized.get("in_progress_started_at")
    return normalized


def scheduler_tasks_store() -> JsonFileStore:
    return JsonFileStore(Path(os.getenv("SCHEDULED_TASKS_PATH", str(DEFAULT_SCHEDULED_PATH))))


def smtp_store() -> JsonFileStore:
    return JsonFileStore(Path(os.getenv("SMTP_CONFIG_PATH", str(DEFAULT_SMTP_PATH))))


def list_tasks() -> list[dict[str, Any]]:
    data = scheduler_tasks_store().read(default=[])
    if not isinstance(data, list):
        raise HTTPException(status_code=500, detail="scheduled_tasks.json inválido")
    return [_normalize_task(task) for task in data if isinstance(task, dict)]


def save_tasks(tasks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    normalized = [_normalize_task(task) for task in tasks]

    def _write(_: Any):
        return normalized

    scheduler_tasks_store().update(default=[], mutate_fn=_write)
    return normalized


def mask_smtp(config: dict[str, Any]) -> dict[str, Any]:
    result = dict(config)
    if result.get("password"):
        result["password"] = "********"
    return result


def _parse_iso(value: Optional[str]):
    if not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except Exception:
        return None


def should_run_task(task: dict[str, Any], now: Optional[datetime] = None) -> bool:
    if not task.get("enabled", True):
        return False
    now = now or datetime.now()
    task_time = task.get("time") or "08:00"
    try:
        hh, mm = [int(part) for part in task_time.split(":", 1)]
    except Exception:
        return False

    scheduled_today = now.replace(hour=hh, minute=mm, second=0, microsecond=0)
    if now < scheduled_today:
        return False

    if task.get("frequency") == "weekly":
        if int(task.get("weekday", now.weekday())) != now.weekday():
            return False

    last_run = _parse_iso(task.get("last_run_ts") or task.get("last_run"))
    if last_run and last_run.strftime("%Y-%m-%d %H:%M") == now.strftime("%Y-%m-%d %H:%M"):
        return False

    diff_minutes = (now - scheduled_today).total_seconds() / 60
    if diff_minutes > 10:
        return False

    return True


def list_due_task_ids(now: Optional[datetime] = None) -> list[str]:
    now = now or datetime.now()
    due = []
    for task in list_tasks():
        task_id = task.get("id")
        if task_id and should_run_task(task, now=now):
            due.append(task_id)
    return due


def claim_task_execution(task_id: str, source: str) -> dict[str, Any]:
    if source not in SCHEDULER_SOURCES:
        source = "manual"
    now = datetime.now()
    now_iso = now.isoformat(timespec="seconds")

    def _mutate(tasks: list[dict[str, Any]]):
        normalized = [_normalize_task(item) for item in tasks if isinstance(item, dict)]
        for task in normalized:
            if task.get("id") != task_id:
                continue

            started_at = _parse_iso(task.get("in_progress_started_at"))
            in_progress = task.get("in_progress_run_id")
            if in_progress and started_at and (now - started_at).total_seconds() < LOCK_STALE_SECONDS:
                return {"tasks": normalized, "result": {"ok": False, "reason": "in_progress", "run_id": in_progress}}

            if source == "timer" and not should_run_task(task, now=now):
                return {"tasks": normalized, "result": {"ok": False, "reason": "not_due", "run_id": None}}

            run_id = f"{source}-{task_id[:8]}-{now.strftime('%Y%m%d%H%M%S')}"
            task["in_progress_run_id"] = run_id
            task["in_progress_source"] = source
            task["in_progress_started_at"] = now_iso
            task["last_status"] = "running"
            if source in {"manual", "debug"}:
                task["last_manual_run"] = now_iso
                task["last_manual_run_id"] = run_id
            return {"tasks": normalized, "result": {"ok": True, "reason": "claimed", "run_id": run_id}}

        return {"tasks": normalized, "result": {"ok": False, "reason": "task_not_found", "run_id": None}}

    result_box: dict[str, Any] = {}

    def _writer(data):
        out = _mutate(data)
        result_box.update(out["result"])
        return out["tasks"]

    scheduler_tasks_store().update(default=[], mutate_fn=_writer)
    return result_box


def finish_task_execution(
    task_id: str,
    run_id: Optional[str],
    *,
    status: str,
    sent_ok: bool,
    detail: Optional[str] = None,
    range_start: Optional[str] = None,
    range_end: Optional[str] = None,
    duration_ms: Optional[int] = None,
) -> dict[str, Any]:
    now_iso = datetime.now().isoformat(timespec="seconds")

    result = {"ok": False}

    def _writer(data):
        tasks = [_normalize_task(item) for item in data if isinstance(item, dict)]
        for task in tasks:
            if task.get("id") != task_id:
                continue
            if run_id is None or task.get("in_progress_run_id") == run_id:
                task["in_progress_run_id"] = None
                task["in_progress_source"] = None
                task["in_progress_started_at"] = None
            task["last_status"] = status
            task["last_run"] = now_iso
            task["last_run_ts"] = now_iso
            if run_id:
                task["last_run_id"] = run_id
            if duration_ms is not None:
                task["last_duration_ms"] = int(duration_ms)
            if detail:
                task["last_error"] = detail if status == "error" else None
            elif status != "error":
                task["last_error"] = None
            if range_start:
                task["last_range_start"] = range_start
            if range_end:
                task["last_range_end"] = range_end
            if sent_ok:
                task["last_email_sent_at"] = now_iso
            result["ok"] = True
            break
        return tasks

    scheduler_tasks_store().update(default=[], mutate_fn=_writer)
    return result
