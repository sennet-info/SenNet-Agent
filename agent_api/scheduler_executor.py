from __future__ import annotations

import asyncio
import json
import os
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace
from typing import Any

from fastapi import HTTPException

from agent_api.config import APP_DIR, get_tenant_auth, safe_output_path
from agent_api.pricing import resolve_default_price
from agent_api.report_time import resolve_report_time
from agent_api.scheduler_store import list_tasks, scheduler_tasks_store, smtp_store
from core.discovery import list_devices
from core.report import generate_report_pdf
from modules.email_sender import EmailSender

MAX_DEVICES = 50
SCHEDULER_RUN_TIMEOUT_SECONDS = 240
LOCK_STALE_SECONDS = 20 * 60


def _now() -> datetime:
    return datetime.now()


def _iso(ts: datetime) -> str:
    return ts.isoformat(timespec="seconds")


def _emails_html(task: dict[str, Any], start_dt: datetime, end_dt: datetime, source: str) -> tuple[str, str]:
    subject = f"📊 Informe Energético: {task['site']} ({datetime.now().strftime('%d/%m/%Y')})"
    body = (
        f"<p>Informe generado para <b>{task['client']} / {task['site']}</b>.</p>"
        f"<p>Rango: {_iso(start_dt)} → {_iso(end_dt)}</p>"
        f"<p>Origen ejecución: {source}</p>"
    )
    return subject, body


def _resolve_requested_devices(task: dict[str, Any]) -> tuple[str, list[str]]:
    requested_device = task.get("device")
    requested_extras = task.get("extra_devices") or []
    if not requested_device:
        raise HTTPException(status_code=422, detail="device principal obligatorio")

    dedup_extras: list[str] = []
    for item in requested_extras:
        if item and item != requested_device and item not in dedup_extras:
            dedup_extras.append(item)
    return requested_device, dedup_extras


def _resolve_scope_devices(task: dict[str, Any], auth_config: dict[str, Any]) -> tuple[list[str], list[dict[str, str]], list[str], list[str]]:
    requested_device, requested_extras = _resolve_requested_devices(task)
    requested_all = [requested_device, *requested_extras]
    available = list_devices(auth_config, task["client"], task["site"], serial=task.get("serial"))

    resolved: list[str] = []
    discarded: list[dict[str, str]] = []
    for item in requested_all:
        if item in available:
            if item not in resolved:
                resolved.append(item)
        else:
            discarded.append({"device": item, "reason": "not_available_in_scope"})

    if not resolved:
        raise HTTPException(status_code=422, detail="Ningún dispositivo solicitado está disponible para el alcance tenant/client/site/serial")
    if len(resolved) > MAX_DEVICES:
        raise HTTPException(status_code=422, detail=f"devices excede el máximo permitido ({MAX_DEVICES})")

    return resolved, discarded, requested_all, available


def _resolve_time(task: dict[str, Any]):
    payload = SimpleNamespace(
        range_mode=task.get("report_range_mode"),
        last_days=task.get("last_days"),
        range_label=task.get("range_label"),
        timezone=task.get("timezone"),
        start_dt=datetime.fromisoformat(task["start_dt"]) if task.get("start_dt") else None,
        end_dt=datetime.fromisoformat(task["end_dt"]) if task.get("end_dt") else None,
        range_flux=task.get("range_flux"),
    )
    return resolve_report_time(payload, now=_now().astimezone())


async def execute_scheduled_task(
    task: dict[str, Any],
    *,
    trigger_source: str,
    debug: bool = True,
    send_email: bool = True,
    max_workers: int = 4,
    debug_sample_n: int = 10,
    force_recalculate: bool = False,
) -> dict[str, Any]:
    tenant = task.get("tenant_alias") or task.get("tenant")
    if not tenant:
        raise HTTPException(status_code=422, detail="tenant es obligatorio")

    auth_config = get_tenant_auth(tenant)
    resolved_time = _resolve_time(task)
    resolved_devices, discarded_devices, requested_devices, available_scope_devices = _resolve_scope_devices(task, auth_config)

    effective_price, price_source, price_match_key = resolve_default_price(
        tenant=tenant,
        client=task.get("client"),
        site=task.get("site"),
        serial=task.get("serial"),
    )

    async def _build():
        return await asyncio.to_thread(
            generate_report_pdf,
            auth_config,
            task["client"],
            task["site"],
            resolved_devices,
            resolved_time.range_flux,
            effective_price,
            task.get("serial"),
            resolved_time.start_dt,
            resolved_time.end_dt,
            False,
            None,
            max_workers,
            debug,
            debug_sample_n,
            force_recalculate,
            resolved_time.range_mode,
            resolved_time.range_label,
        )

    original_cwd = Path.cwd()
    try:
        os.chdir(APP_DIR)
        build_result = await asyncio.wait_for(_build(), timeout=SCHEDULER_RUN_TIMEOUT_SECONDS)
    except TimeoutError as exc:
        raise HTTPException(status_code=504, detail="Timeout ejecutando tarea") from exc
    finally:
        os.chdir(original_cwd)

    if debug:
        pdf_path, debug_payload = build_result
    else:
        pdf_path = build_result
        debug_payload = {}

    if not pdf_path:
        raise HTTPException(status_code=500, detail="No se pudo generar el PDF")

    safe_path = safe_output_path(pdf_path)
    if not safe_path.exists():
        raise HTTPException(status_code=500, detail="PDF generado no encontrado en disco")

    task_snapshot = {
        k: task.get(k)
        for k in [
            "id",
            "tenant_alias",
            "client",
            "site",
            "serial",
            "device",
            "extra_devices",
            "frequency",
            "time",
            "report_range_mode",
            "range_flux",
            "start_dt",
            "end_dt",
            "emails",
            "enabled",
        ]
    }
    enriched_debug = {
        **(debug_payload if isinstance(debug_payload, dict) else {}),
        "task_id": task.get("id"),
        "task_snapshot": task_snapshot,
        "tenant": tenant,
        "client": task.get("client"),
        "site": task.get("site"),
        "serial": task.get("serial"),
        "requested_device": task.get("device"),
        "requested_extra_devices": task.get("extra_devices") or [],
        "requested_devices": requested_devices,
        "resolved_devices": resolved_devices,
        "discarded_devices": discarded_devices,
        "available_scope_devices": available_scope_devices,
        "price_effective": effective_price,
        "price_source": price_source,
        "price_scope": {
            "tenant": tenant,
            "client": task.get("client"),
            "site": task.get("site"),
            "serial": task.get("serial"),
        },
        "price_scope_matched_key": price_match_key,
        "range_mode": resolved_time.range_mode,
        "range_label": resolved_time.range_label,
        "start_dt": _iso(resolved_time.start_dt),
        "end_dt": _iso(resolved_time.end_dt),
        "range_flux": resolved_time.range_flux,
        "range_resolution": {
            "timezone": resolved_time.timezone,
            "criteria": resolved_time.criteria,
            "adjusted": resolved_time.adjusted,
            "task_report_range_mode": task.get("report_range_mode"),
        },
        "trigger_source": trigger_source,
    }

    debug_file = safe_output_path(f"{safe_path.stem}.scheduler.debug.json")
    debug_file.write_text(json.dumps(enriched_debug, ensure_ascii=False, indent=2), encoding="utf-8")

    email_sent = False
    email_detail = "email_disabled"
    recipients = task.get("emails") or []
    if send_email:
        cfg = smtp_store().read(default={})
        required = ["server", "port", "user", "password"]
        missing = [key for key in required if not cfg.get(key)]
        if missing:
            raise HTTPException(status_code=422, detail=f"SMTP incompleto: faltan {', '.join(missing)}")
        subject, body = _emails_html(task, resolved_time.start_dt, resolved_time.end_dt, trigger_source)
        sender = EmailSender(cfg["server"], cfg["port"], cfg["user"], cfg["password"])
        email_sent, email_detail = sender.send_email(recipients, subject, body, str(safe_path))
        if not email_sent:
            raise HTTPException(status_code=500, detail=email_detail)

    return {
        "ok": True,
        "pdf_path": str(safe_path),
        "filename": safe_path.name,
        "debug_path": str(debug_file),
        "debug": enriched_debug if debug else None,
        "email_sent": email_sent,
        "email_recipients": recipients,
        "email_detail": email_detail,
        "requested_devices": requested_devices,
        "resolved_devices": resolved_devices,
        "discarded_devices": discarded_devices,
        "effective_price": effective_price,
        "price_source": price_source,
        "price_match_key": price_match_key,
        "range_mode": resolved_time.range_mode,
        "range_label": resolved_time.range_label,
        "start_dt": _iso(resolved_time.start_dt),
        "end_dt": _iso(resolved_time.end_dt),
        "range_flux": resolved_time.range_flux,
    }


def _is_due(task: dict[str, Any], now: datetime) -> bool:
    if not task.get("enabled", True):
        return False
    hh, mm = (task.get("time") or "00:00").split(":")
    scheduled_today = now.replace(hour=int(hh), minute=int(mm), second=0, microsecond=0)
    if now < scheduled_today:
        return False
    if (now - scheduled_today).total_seconds() > 600:
        return False
    last_run_str = task.get("last_run_ts") or task.get("last_run")
    if task.get("frequency") == "weekly":
        if task.get("weekday") is not None and int(task.get("weekday")) != now.weekday():
            return False
    elif task.get("frequency") == "monthly":
        if now.day != 1:
            return False
    elif task.get("frequency") == "cron":
        return False
    if last_run_str:
        last_run = datetime.fromisoformat(last_run_str)
        if last_run.strftime("%Y-%m-%d %H:%M") == now.strftime("%Y-%m-%d %H:%M"):
            return False
        if task.get("frequency") == "daily" and last_run.date() >= now.date():
            return False
        if task.get("frequency") == "weekly" and last_run.isocalendar()[:2] == now.isocalendar()[:2]:
            return False
        if task.get("frequency") == "monthly" and last_run.year == now.year and last_run.month == now.month:
            return False
    return True


def claim_task_run(task_id: str, source: str, only_if_due: bool) -> dict[str, Any]:
    now = _now()
    now_iso = _iso(now)
    run_id = f"{source}-{task_id[:8]}-{now.strftime('%Y%m%d%H%M%S')}"

    def _claim(data: Any):
        tasks = data if isinstance(data, list) else []
        for t in tasks:
            if t.get("id") != task_id:
                continue
            in_progress = t.get("in_progress_run_id")
            started_at = t.get("in_progress_started_at")
            if in_progress and started_at:
                started_dt = datetime.fromisoformat(started_at)
                if (now - started_dt).total_seconds() < LOCK_STALE_SECONDS:
                    return {"tasks": tasks, "res": {"ok": False, "reason": "in_progress", "run_id": in_progress}}
            if only_if_due and not _is_due(t, now):
                return {"tasks": tasks, "res": {"ok": False, "reason": "not_due", "run_id": None}}
            t["in_progress_run_id"] = run_id
            t["in_progress_source"] = source
            t["in_progress_started_at"] = now_iso
            t["last_run_ts"] = now_iso
            t["last_run_id"] = run_id
            t["last_run"] = now_iso
            return {"tasks": tasks, "res": {"ok": True, "reason": "claimed", "run_id": run_id, "task": dict(t)}}
        return {"tasks": tasks, "res": {"ok": False, "reason": "task_not_found", "run_id": None}}

    holder = {"res": None}

    def mutate(data: Any):
        out = _claim(data)
        holder["res"] = out["res"]
        return out["tasks"]

    scheduler_tasks_store().update(default=[], mutate_fn=mutate)
    return holder["res"] or {"ok": False, "reason": "unknown", "run_id": None}


def finish_task_run(task_id: str, run_id: str, result: dict[str, Any] | None, error: str | None):
    now_iso = _iso(_now())

    def mutate(data: Any):
        tasks = data if isinstance(data, list) else []
        for t in tasks:
            if t.get("id") != task_id:
                continue
            if t.get("in_progress_run_id") == run_id:
                t["in_progress_run_id"] = None
                t["in_progress_source"] = None
                t["in_progress_started_at"] = None
            t["last_execution_status"] = "ok" if not error else "error"
            t["last_execution_error"] = error
            t["last_execution_finished_at"] = now_iso
            if result:
                t["last_range_start"] = result.get("start_dt")
                t["last_range_end"] = result.get("end_dt")
                t["last_price_effective"] = result.get("effective_price")
                t["last_price_source"] = result.get("price_source")
                t["last_price_match_key"] = result.get("price_match_key")
                t["last_debug_path"] = result.get("debug_path")
                t["last_pdf_path"] = result.get("pdf_path")
                t["last_email_recipients"] = result.get("email_recipients")
                t["last_email_detail"] = result.get("email_detail")
                t["last_discarded_devices"] = result.get("discarded_devices")
                if result.get("email_sent"):
                    t["last_email_sent_at"] = now_iso
            return tasks
        return tasks

    scheduler_tasks_store().update(default=[], mutate_fn=mutate)


async def run_due_scheduler_tasks() -> dict[str, Any]:
    now = _now()
    results = []
    for task in list_tasks():
        if not _is_due(task, now):
            continue
        claim = claim_task_run(task.get("id", ""), source="scheduler", only_if_due=True)
        if not claim.get("ok"):
            results.append({"task_id": task.get("id"), "status": "skipped", "reason": claim.get("reason")})
            continue
        run_id = claim["run_id"]
        task_data = claim.get("task") or task
        try:
            execution = await execute_scheduled_task(task_data, trigger_source="scheduler", debug=True, send_email=True)
            finish_task_run(task_data["id"], run_id, execution, None)
            results.append({
                "task_id": task_data["id"],
                "status": "ok",
                "run_id": run_id,
                "price_source": execution.get("price_source"),
                "effective_price": execution.get("effective_price"),
                "email_sent": execution.get("email_sent"),
                "email_detail": execution.get("email_detail"),
                "resolved_devices": execution.get("resolved_devices"),
                "discarded_devices": execution.get("discarded_devices"),
                "debug_path": execution.get("debug_path"),
            })
        except Exception as exc:  # noqa: BLE001
            finish_task_run(task_data["id"], run_id, None, str(exc))
            results.append({"task_id": task_data.get("id"), "status": "error", "run_id": run_id, "error": str(exc)})
    return {"ok": True, "items": results, "processed": len(results)}
