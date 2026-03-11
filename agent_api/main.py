from typing import Optional
import asyncio
import json
import os
import sys
from datetime import datetime
from pathlib import Path

from fastapi import Body, Depends, FastAPI, Header, HTTPException, Query
from fastapi.responses import FileResponse

from agent_api.config import (
    APP_DIR,
    TenantNotFoundError,
    get_tenant_auth,
    load_energy_prices_config,
    load_roles_config,
    load_tenants_config,
    safe_output_path,
    save_energy_prices_config,
    save_roles_config,
    save_tenants_config,
)
from agent_api.schemas import (
    ROLE_OPTIONS,
    ReportRequest,
    ReportResponse,
    RoleUpsertRequest,
    SchedulerRunRequest,
    SchedulerTaskCreateRequest,
    SchedulerTaskUpdateRequest,
    SmtpConfigRequest,
    SmtpTestRequest,
    TenantUpsertRequest,
)
from agent_api.scheduler_store import list_tasks, mask_smtp, save_tasks, smtp_store
from agent_api.scheduler_executor import claim_task_run, execute_scheduled_task, finish_task_run, run_due_scheduler_tasks
from agent_api.report_time import resolve_report_time
from agent_api.pricing import get_pricing_config, resolve_default_price
from agent_api.versioning import get_runtime_version

if str(APP_DIR) not in sys.path:
    sys.path.append(str(APP_DIR))

from core.discovery import list_clients, list_devices, list_serials, list_sites
from core.report import generate_report_pdf
from modules.email_sender import EmailSender

MAX_DEVICES = 50
REPORT_TIMEOUT_SECONDS = 180
SCHEDULER_RUN_TIMEOUT_SECONDS = 240

app = FastAPI(title="SenNet Agent API", version="0.1.0")


def _require_admin_token(authorization: Optional[str] = Header(default=None)):
    expected = os.getenv("AGENT_ADMIN_TOKEN")
    if not expected:
        raise HTTPException(status_code=503, detail="AGENT_ADMIN_TOKEN no configurado")

    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")

    provided = authorization.split(" ", 1)[1].strip()
    if provided != expected:
        raise HTTPException(status_code=401, detail="Invalid bearer token")


def _require_admin_for_tasks_read(authorization: Optional[str] = Header(default=None)):
    require_token = os.getenv("REQUIRE_ADMIN_FOR_READ", "false").lower() == "true"
    if require_token:
        _require_admin_token(authorization)


def _require_admin_for_smtp_read(authorization: Optional[str] = Header(default=None)):
    _require_admin_token(authorization)


@app.get("/v1/health")
def health():
    return {"ok": True, "runtime": get_runtime_version()}


def _tenant_auth_or_404(tenant: str):
    try:
        return get_tenant_auth(tenant)
    except TenantNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.get("/v1/discovery/clients")
def discovery_clients(tenant: str = Query(...)):
    return {"items": list_clients(_tenant_auth_or_404(tenant))}


@app.get("/v1/discovery/sites")
def discovery_sites(tenant: str = Query(...), client: str = Query(...)):
    return {"items": list_sites(_tenant_auth_or_404(tenant), client)}


@app.get("/v1/discovery/serials")
def discovery_serials(tenant: str = Query(...), client: str = Query(...), site: str = Query(...)):
    return {"items": list_serials(_tenant_auth_or_404(tenant), client, site)}


@app.get("/v1/discovery/devices")
def discovery_devices(
    tenant: str = Query(...),
    client: str = Query(...),
    site: str = Query(...),
    serial: Optional[str] = Query(default=None),
):
    return {"items": list_devices(_tenant_auth_or_404(tenant), client, site, serial=serial)}
@app.get("/v1/pricing/resolve")
def pricing_resolve(
    tenant: str = Query(...),
    client: Optional[str] = Query(default=None),
    site: Optional[str] = Query(default=None),
    serial: Optional[str] = Query(default=None),
):
    price, source, matched_key = resolve_default_price(tenant=tenant, client=client, site=site, serial=serial)
    return {
        "price": price,
        "source": source,
        "scope": {"tenant": tenant, "client": client, "site": site, "serial": serial},
        "matched_key": matched_key,
    }


@app.get("/v1/pricing/defaults", dependencies=[Depends(_require_admin_token)])
def pricing_defaults_get():
    return {"item": get_pricing_config()}


@app.post("/v1/pricing/defaults", dependencies=[Depends(_require_admin_token)])
def pricing_defaults_put(payload: dict = Body(...)):
    fallback = payload.get("fallback")
    scopes = payload.get("scopes")
    if fallback is not None and not isinstance(fallback, (int, float)):
        raise HTTPException(status_code=422, detail="fallback debe ser numérico")
    if scopes is not None and not isinstance(scopes, dict):
        raise HTTPException(status_code=422, detail="scopes debe ser un objeto")
    save_energy_prices_config(payload)
    return {"ok": True, "item": get_pricing_config()}


@app.post("/v1/reports", response_model=ReportResponse)
async def create_report(payload: ReportRequest):
    if len(payload.devices) > MAX_DEVICES:
        raise HTTPException(status_code=422, detail=f"devices excede el máximo permitido ({MAX_DEVICES})")

    auth_config = _tenant_auth_or_404(payload.tenant)
    resolved_time = resolve_report_time(payload)
    default_price, default_source, default_match_key = resolve_default_price(
        tenant=payload.tenant,
        client=payload.client,
        site=payload.site,
        serial=payload.serial,
    )
    effective_price = payload.price
    effective_source = payload.price_source or default_source
    effective_override = payload.price_override if payload.price_override is not None else abs(effective_price - default_price) > 1e-9

    async def _build():
        return await asyncio.to_thread(
            generate_report_pdf,
            auth_config,
            payload.client,
            payload.site,
            payload.devices,
            resolved_time.range_flux,
            effective_price,
            payload.serial,
            resolved_time.start_dt,
            resolved_time.end_dt,
            False,
            None,
            payload.max_workers,
            payload.debug,
            payload.debug_sample_n,
            payload.force_recalculate,
            resolved_time.range_mode,
            resolved_time.range_label,
        )

    original_cwd = Path.cwd()
    try:
        os.chdir(APP_DIR)
        build_result = await asyncio.wait_for(_build(), timeout=REPORT_TIMEOUT_SECONDS)
    except TimeoutError as exc:
        raise HTTPException(status_code=504, detail="Tiempo de generación agotado") from exc
    finally:
        os.chdir(original_cwd)

    if payload.debug:
        pdf_path, debug_payload = build_result
    else:
        pdf_path = build_result
        debug_payload = None

    if not pdf_path:
        raise HTTPException(status_code=500, detail="No se pudo generar el PDF")

    safe_path = safe_output_path(pdf_path)
    if not safe_path.exists():
        raise HTTPException(status_code=500, detail="PDF generado no encontrado en disco")

    debug_path_value = None
    debug_inline = None
    if payload.debug and debug_payload is not None:
        enriched_debug = {
            **debug_payload,
            "resolved_range": {
                **debug_payload.get("resolved_range", {}),
                "user_mode": payload.range_mode,
                "range_mode": resolved_time.range_mode,
                "range_label": resolved_time.range_label,
                "start": resolved_time.start_dt.isoformat(),
                "stop": resolved_time.end_dt.isoformat(),
                "range_flux": resolved_time.range_flux,
                "timezone": resolved_time.timezone,
                "criteria": resolved_time.criteria,
                "adjusted": resolved_time.adjusted,
            },
            "inputs": {
                **debug_payload.get("inputs", {}),
                "tenant": payload.tenant,
                "client": payload.client,
                "site": payload.site,
                "serial": payload.serial,
                "devices": payload.devices,
                "range_mode": payload.range_mode,
                "last_days": payload.last_days,
                "range_label": payload.range_label,
                "timezone": payload.timezone,
                "range_flux": resolved_time.range_flux,
                "start_dt": resolved_time.start_dt.isoformat(),
                "end_dt": resolved_time.end_dt.isoformat(),
                "price": effective_price,
                "max_workers": payload.max_workers,
                "force_recalculate": payload.force_recalculate,
                "price_effective": effective_price,
                "price_source": effective_source,
                "price_override": effective_override,
                "price_scope": {
                    "tenant": payload.tenant,
                    "client": payload.client,
                    "site": payload.site,
                    "serial": payload.serial,
                },
                "price_scope_matched_key": default_match_key,
            },
            "pricing": {
                "price_effective": effective_price,
                "price_source": effective_source,
                "price_override": effective_override,
                "price_default": default_price,
                "price_default_source": default_source,
                "price_scope": {
                    "tenant": payload.tenant,
                    "client": payload.client,
                    "site": payload.site,
                    "serial": payload.serial,
                },
                "price_scope_matched_key": default_match_key,
            },
        }

        debug_filename = safe_path.with_suffix(".debug.json").name
        debug_file = safe_output_path(debug_filename)
        debug_file.write_text(json.dumps(enriched_debug, ensure_ascii=False, indent=2), encoding="utf-8")
        debug_path_value = str(debug_file)

        inline_data = json.dumps(enriched_debug, ensure_ascii=False)
        if len(inline_data.encode("utf-8")) <= 64_000:
            debug_inline = enriched_debug

    return ReportResponse(pdf_path=str(safe_path), filename=safe_path.name, debug_path=debug_path_value, debug=debug_inline)


@app.get("/v1/reports/download")
def download_report(path: str = Query(...)):
    try:
        safe_path = safe_output_path(path)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if not safe_path.exists() or not safe_path.is_file():
        raise HTTPException(status_code=404, detail="Archivo no encontrado")

    return FileResponse(path=safe_path, media_type="application/pdf", filename=safe_path.name)


@app.get("/v1/reports/download-debug")
def download_report_debug(path: str = Query(...)):
    try:
        safe_path = safe_output_path(path)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if not safe_path.exists() or not safe_path.is_file():
        raise HTTPException(status_code=404, detail="Archivo no encontrado")

    return FileResponse(path=safe_path, media_type="application/json", filename=safe_path.name)


@app.get("/v1/scheduler/tasks", dependencies=[Depends(_require_admin_for_tasks_read)])
def scheduler_list_tasks():
    tasks = []
    for task in list_tasks():
        clean = dict(task)
        clean.pop("influx_token", None)
        price, source, matched_key = resolve_default_price(
            tenant=clean.get("tenant_alias") or clean.get("tenant"),
            client=clean.get("client"),
            site=clean.get("site"),
            serial=clean.get("serial"),
        )
        clean["expected_pricing"] = {"price": price, "source": source, "matched_key": matched_key}
        tasks.append(clean)
    return {"items": tasks}


def _validate_task_business_rules(task: dict):
    if not task.get("tenant_alias"):
        raise HTTPException(status_code=422, detail="tenant es obligatorio")
    if not task.get("client") or not task.get("site"):
        raise HTTPException(status_code=422, detail="client y site son obligatorios")
    if not task.get("device"):
        raise HTTPException(status_code=422, detail="device principal obligatorio")
    if not task.get("emails"):
        raise HTTPException(status_code=422, detail="emails requerido")
    if not (task.get("range_flux") or task.get("report_range_mode") or (task.get("start_dt") and task.get("end_dt"))):
        raise HTTPException(status_code=422, detail="Define report_range_mode, range_flux o start_dt/end_dt")
    if task.get("frequency") == "weekly" and task.get("weekday") is None:
        raise HTTPException(status_code=422, detail="weekday obligatorio para frecuencia weekly")


@app.post("/v1/scheduler/tasks", dependencies=[Depends(_require_admin_token)])
def scheduler_create_task(payload: SchedulerTaskCreateRequest):
    task = payload.model_dump(by_alias=False)
    _validate_task_business_rules(task)

    tasks = list_tasks()
    task["start_dt"] = task.get("start_dt").isoformat() if task.get("start_dt") else None
    task["end_dt"] = task.get("end_dt").isoformat() if task.get("end_dt") else None
    tasks.append(task)
    saved = save_tasks(tasks)
    return {"ok": True, "task": saved[-1]}


@app.put("/v1/scheduler/tasks/{task_id}", dependencies=[Depends(_require_admin_token)])
def scheduler_update_task(task_id: str, payload: SchedulerTaskUpdateRequest):
    tasks = list_tasks()
    patch = payload.model_dump(exclude_unset=True, by_alias=False)
    for key in ["start_dt", "end_dt"]:
        if key in patch and isinstance(patch[key], datetime):
            patch[key] = patch[key].isoformat()

    updated_task = None
    for task in tasks:
        if task.get("id") == task_id:
            task.update(patch)
            _validate_task_business_rules(task)
            updated_task = task
            break

    if not updated_task:
        raise HTTPException(status_code=404, detail="Tarea no encontrada")

    save_tasks(tasks)
    return {"ok": True, "task": updated_task}


@app.delete("/v1/scheduler/tasks/{task_id}", dependencies=[Depends(_require_admin_token)])
def scheduler_delete_task(task_id: str):
    tasks = list_tasks()
    filtered = [task for task in tasks if task.get("id") != task_id]
    if len(filtered) == len(tasks):
        raise HTTPException(status_code=404, detail="Tarea no encontrada")
    save_tasks(filtered)
    return {"ok": True}


@app.post("/v1/scheduler/tasks/{task_id}/run", dependencies=[Depends(_require_admin_token)])
async def scheduler_run_task(task_id: str, payload: SchedulerRunRequest = Body(default=SchedulerRunRequest())):
    claim = claim_task_run(task_id, source="manual", only_if_due=False)
    if not claim.get("ok"):
        if claim.get("reason") == "task_not_found":
            raise HTTPException(status_code=404, detail="Tarea no encontrada")
        raise HTTPException(status_code=409, detail=f"No se pudo reclamar ejecución: {claim.get('reason')}")

    run_id = claim["run_id"]
    task = claim.get("task") or next((item for item in list_tasks() if item.get("id") == task_id), None)
    if not task:
        raise HTTPException(status_code=404, detail="Tarea no encontrada")

    try:
        result = await execute_scheduled_task(
            task,
            trigger_source="manual",
            debug=payload.debug,
            send_email=True,
            max_workers=payload.max_workers,
            debug_sample_n=payload.debug_sample_n,
            force_recalculate=payload.force_recalculate,
        )
        finish_task_run(task_id, run_id, result, None)
        return {**result, "runtime": get_runtime_version()}
    except Exception as exc:
        finish_task_run(task_id, run_id, None, str(exc))
        raise


@app.post("/v1/scheduler/run-due", dependencies=[Depends(_require_admin_token)])
async def scheduler_run_due_tasks():
    result = await run_due_scheduler_tasks()
    return {**result, "runtime": get_runtime_version()}


@app.get("/v1/scheduler/smtp", dependencies=[Depends(_require_admin_for_smtp_read)])
def scheduler_get_smtp():
    cfg = smtp_store().read(default={})
    if not isinstance(cfg, dict):
        raise HTTPException(status_code=500, detail="smtp_config.json inválido")
    return {"item": mask_smtp(cfg)}


@app.put("/v1/scheduler/smtp", dependencies=[Depends(_require_admin_token)])
def scheduler_put_smtp(payload: SmtpConfigRequest):
    new_cfg = payload.model_dump()
    current_cfg = smtp_store().read(default={})
    if not new_cfg.get("password"):
        new_cfg["password"] = current_cfg.get("password", "")

    smtp_store().update(default={}, mutate_fn=lambda _prev: new_cfg)
    return {"ok": True, "item": mask_smtp(new_cfg)}


@app.post("/v1/scheduler/smtp/test", dependencies=[Depends(_require_admin_token)])
def scheduler_test_smtp(payload: SmtpTestRequest):
    cfg = smtp_store().read(default={})
    required = ["server", "port", "user", "password"]
    missing = [key for key in required if not cfg.get(key)]
    if missing:
        raise HTTPException(status_code=422, detail=f"SMTP incompleto: faltan {', '.join(missing)}")

    sender = EmailSender(cfg["server"], cfg["port"], cfg["user"], cfg["password"])
    ok, detail = sender.send_email([payload.recipient], "Test SMTP SenNet", "Correo de prueba SMTP")
    if not ok:
        raise HTTPException(status_code=500, detail=detail)
    return {"ok": True, "detail": detail}


@app.get("/v1/admin/tenants", dependencies=[Depends(_require_admin_token)])
def admin_list_tenants():
    return {"items": load_tenants_config()}


@app.put("/v1/admin/tenants/{alias}", dependencies=[Depends(_require_admin_token)])
def admin_upsert_tenant(alias: str, payload: TenantUpsertRequest):
    alias = alias.strip()
    if not alias:
        raise HTTPException(status_code=422, detail="Alias inválido")

    tenants = load_tenants_config()
    tenants[alias] = payload.model_dump()
    save_tenants_config(tenants)
    return {"ok": True, "alias": alias, "tenant": tenants[alias]}


@app.delete("/v1/admin/tenants/{alias}", dependencies=[Depends(_require_admin_token)])
def admin_delete_tenant(alias: str):
    tenants = load_tenants_config()
    if alias not in tenants:
        raise HTTPException(status_code=404, detail=f"Tenant '{alias}' no existe")

    removed = tenants.pop(alias)
    save_tenants_config(tenants)
    return {"ok": True, "alias": alias, "tenant": removed}




@app.get("/v1/admin/energy-prices", dependencies=[Depends(_require_admin_token)])
def admin_get_energy_prices():
    cfg = load_energy_prices_config()
    return {"item": cfg if isinstance(cfg, dict) else {}}


@app.put("/v1/admin/energy-prices", dependencies=[Depends(_require_admin_token)])
def admin_put_energy_prices(payload: dict = Body(default={})):
    if not isinstance(payload, dict):
        raise HTTPException(status_code=422, detail="Payload inválido")
    save_energy_prices_config(payload)
    return {"ok": True, "item": payload}


@app.get("/v1/admin/roles", dependencies=[Depends(_require_admin_token)])
def admin_list_roles():
    return {"items": load_roles_config(), "role_options": ROLE_OPTIONS}


@app.put("/v1/admin/roles/{device}", dependencies=[Depends(_require_admin_token)])
def admin_upsert_role(device: str, payload: RoleUpsertRequest):
    role = payload.role.strip()
    if role not in ROLE_OPTIONS:
        raise HTTPException(status_code=422, detail=f"role inválido. Opciones: {', '.join(ROLE_OPTIONS)}")

    device = device.strip()
    if not device:
        raise HTTPException(status_code=422, detail="device inválido")

    roles = load_roles_config()
    roles[device] = role
    save_roles_config(roles)
    return {"ok": True, "device": device, "role": role}


@app.delete("/v1/admin/roles/{device}", dependencies=[Depends(_require_admin_token)])
def admin_delete_role(device: str):
    roles = load_roles_config()
    if device not in roles:
        raise HTTPException(status_code=404, detail=f"device '{device}' no existe")

    removed = roles.pop(device)
    save_roles_config(roles)
    return {"ok": True, "device": device, "role": removed}
