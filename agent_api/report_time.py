from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any, Dict, Optional

from fastapi import HTTPException

from modules.report_range import compute_report_range, to_flux_range

MODE_ALIASES = {
    "last_days": "last_n_days",
    "last_n_days": "last_n_days",
    "last_7_days": "last_n_days",
    "last_30_days": "last_n_days",
    "full_month": "month_to_date",
    "month_to_date": "month_to_date",
    "previous_full_month": "previous_full_month",
    "custom": "custom",
}


@dataclass
class ResolvedReportTime:
    range_mode: str
    start_dt: datetime
    end_dt: datetime
    range_flux: str
    range_label: str
    timezone: str
    criteria: Dict[str, Any]
    adjusted: bool = False


def _as_local(value: datetime, reference_tz):
    if value.tzinfo is None:
        return value.replace(tzinfo=reference_tz)
    return value.astimezone(reference_tz)


def _label_from_mode(mode: str, days: Optional[int] = None):
    if mode == "month_to_date":
        return "Mes en curso (día 1 a ahora)"
    if mode == "previous_full_month":
        return "Último mes cerrado (mes anterior completo)"
    if mode == "custom":
        return "Personalizado"
    safe_days = days if days and days > 0 else 7
    return f"Últimos {safe_days} días"


def resolve_report_time(payload: Any, now: Optional[datetime] = None) -> ResolvedReportTime:
    reference = now or datetime.now().astimezone()
    tzinfo = reference.tzinfo
    raw_mode = (getattr(payload, "range_mode", None) or "").strip() or None
    if not raw_mode:
        raw_flux = (getattr(payload, "range_flux", None) or "").strip()
        if raw_flux in MODE_ALIASES:
            raw_mode = raw_flux
    mode = MODE_ALIASES.get(raw_mode or "", "last_n_days")

    inferred_last_days = None
    if raw_mode == "last_7_days":
        inferred_last_days = 7
    elif raw_mode == "last_30_days":
        inferred_last_days = 30

    if getattr(payload, "start_dt", None) and getattr(payload, "end_dt", None):
        start_dt = _as_local(payload.start_dt, tzinfo)
        end_dt = _as_local(payload.end_dt, tzinfo)
        resolved_mode = "custom" if mode == "last_n_days" else mode
        criteria = {"source": "explicit_datetimes"}
        adjusted = False
    elif mode == "custom":
        raise HTTPException(status_code=422, detail="Modo personalizado requiere start_dt y end_dt")
    elif mode == "last_n_days":
        days = getattr(payload, "last_days", None) or inferred_last_days
        if not days:
            range_flux = (getattr(payload, "range_flux", "") or "").strip()
            if range_flux.endswith("d") and range_flux[:-1].isdigit():
                days = int(range_flux[:-1])
        safe_days = days if isinstance(days, int) and days > 0 else 7
        start_dt = reference - timedelta(days=safe_days)
        end_dt = reference
        resolved_mode = "last_n_days"
        criteria = {"days": safe_days}
        adjusted = safe_days != days
    else:
        start_dt, end_dt = compute_report_range(mode, reference)
        if mode == "previous_full_month":
            end_dt = end_dt - timedelta(seconds=1)
        resolved_mode = mode
        criteria = {"semantic": mode}
        adjusted = False

    if start_dt > end_dt:
        raise HTTPException(status_code=422, detail="start_dt debe ser menor o igual a end_dt")
    if start_dt == end_dt:
        raise HTTPException(status_code=422, detail="El rango temporal no puede ser vacío")
    if resolved_mode == "custom" and end_dt > reference:
        raise HTTPException(status_code=422, detail="No se permiten periodos futuros")

    label = getattr(payload, "range_label", None) or _label_from_mode(resolved_mode, criteria.get("days"))

    return ResolvedReportTime(
        range_mode=resolved_mode,
        start_dt=start_dt,
        end_dt=end_dt,
        range_flux=to_flux_range(start_dt, end_dt),
        range_label=label,
        timezone=str(tzinfo) if tzinfo else "UTC",
        criteria=criteria,
        adjusted=adjusted,
    )
