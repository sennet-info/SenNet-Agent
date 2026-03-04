import traceback
from typing import Optional
import asyncio
import os
import sys
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse

from agent_api.config import APP_DIR, OUTPUT_DIR, TenantNotFoundError, get_tenant_auth, safe_output_path
from agent_api.schemas import ReportRequest, ReportResponse

if str(APP_DIR) not in sys.path:
    sys.path.append(str(APP_DIR))

from core.discovery import list_clients, list_devices, list_serials, list_sites
from core.report import generate_report_pdf

MAX_DEVICES = 50
REPORT_TIMEOUT_SECONDS = 180

app = FastAPI(title="SenNet Agent API", version="0.1.0")


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
        )

    original_cwd = Path.cwd()
    try:
        os.chdir(APP_DIR)
        pdf_path = await asyncio.wait_for(_build(), timeout=REPORT_TIMEOUT_SECONDS)
    except TimeoutError as exc:
        raise HTTPException(status_code=504, detail="Tiempo de generación agotado") from exc
    finally:
        os.chdir(original_cwd)

    if not pdf_path:
        raise HTTPException(status_code=500, detail="No se pudo generar el PDF")

    safe_path = safe_output_path(pdf_path)
    if not safe_path.exists():
        raise HTTPException(status_code=500, detail="PDF generado no encontrado en disco")

    return ReportResponse(pdf_path=str(safe_path), filename=safe_path.name)


@app.get("/v1/reports/download")
def download_report(path: str = Query(...)):
    try:
        safe_path = safe_output_path(path)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if not safe_path.exists() or not safe_path.is_file():
        raise HTTPException(status_code=404, detail="Archivo no encontrado")

    return FileResponse(path=safe_path, media_type="application/pdf", filename=safe_path.name)
