from typing import Optional
import asyncio
import json
import os
import sys
from pathlib import Path

from fastapi import Depends, FastAPI, Header, HTTPException, Query
from fastapi.responses import FileResponse

from agent_api.config import (
    APP_DIR,
    TenantNotFoundError,
    get_tenant_auth,
    load_roles_config,
    load_tenants_config,
    safe_output_path,
    save_roles_config,
    save_tenants_config,
)
from agent_api.schemas import ROLE_OPTIONS, ReportRequest, ReportResponse, RoleUpsertRequest, TenantUpsertRequest

if str(APP_DIR) not in sys.path:
    sys.path.append(str(APP_DIR))

from core.discovery import list_clients, list_devices, list_serials, list_sites
from core.report import generate_report_pdf

MAX_DEVICES = 50
REPORT_TIMEOUT_SECONDS = 180

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


@app.get("/v1/health")
def health():
    return {"ok": True}


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


@app.post("/v1/reports", response_model=ReportResponse)
async def create_report(payload: ReportRequest):
    if len(payload.devices) > MAX_DEVICES:
        raise HTTPException(status_code=422, detail=f"devices excede el máximo permitido ({MAX_DEVICES})")

    auth_config = _tenant_auth_or_404(payload.tenant)

    async def _build():
        return await asyncio.to_thread(
            generate_report_pdf,
            auth_config,
            payload.client,
            payload.site,
            payload.devices,
            payload.range_flux,
            payload.price,
            payload.serial,
            payload.start_dt,
            payload.end_dt,
            False,
            None,
            payload.max_workers,
            payload.debug,
            payload.debug_sample_n,
            payload.force_recalculate,
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
            "inputs": {
                **debug_payload.get("inputs", {}),
                "tenant": payload.tenant,
                "client": payload.client,
                "site": payload.site,
                "serial": payload.serial,
                "devices": payload.devices,
                "range_flux": payload.range_flux,
                "start_dt": payload.start_dt.isoformat() if payload.start_dt else None,
                "end_dt": payload.end_dt.isoformat() if payload.end_dt else None,
                "price": payload.price,
                "max_workers": payload.max_workers,
                "force_recalculate": payload.force_recalculate,
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
