import fcntl
import json
import os
import tempfile
import uuid
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path
from typing import Any, Callable

from fastapi import HTTPException

from modules.report_range import DEFAULT_REPORT_RANGE_MODE

DEFAULT_SCHEDULED_PATH = Path("/opt/sennet-agent/scheduled_tasks.json")
DEFAULT_SMTP_PATH = Path("/opt/sennet-agent/smtp_config.json")


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
