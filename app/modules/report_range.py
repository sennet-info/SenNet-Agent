import calendar
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple

DEFAULT_REPORT_RANGE_MODE = "last_7_days"

REPORT_RANGE_OPTIONS = {
    "last_7_days": "Últimos 7 días",
    "last_15_days": "Últimos 15 días",
    "last_30_days": "Últimos 30 días",
    "rolling_1_month": "Último mes (móvil)",
    "month_to_date": "Mes actual (hasta hoy)",
    "previous_full_month": "Mes anterior completo",
    "current_and_previous_full_month": "Mes anterior completo + mes actual (hasta hoy)",
}


def _as_local_time(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.astimezone()
    return value.astimezone()


def _shift_one_month_back(value: datetime) -> datetime:
    year = value.year
    month = value.month - 1
    if month == 0:
        month = 12
        year -= 1

    max_day = calendar.monthrange(year, month)[1]
    return value.replace(year=year, month=month, day=min(value.day, max_day))


def compute_report_range(mode: str, now: Optional[datetime] = None) -> Tuple[datetime, datetime]:
    reference = _as_local_time(now or datetime.now().astimezone())
    safe_mode = mode or DEFAULT_REPORT_RANGE_MODE

    if safe_mode == "last_15_days":
        return reference - timedelta(days=15), reference
    if safe_mode == "last_30_days":
        return reference - timedelta(days=30), reference
    if safe_mode == "rolling_1_month":
        return _shift_one_month_back(reference), reference
    if safe_mode == "month_to_date":
        start = reference.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        return start, reference
    if safe_mode == "previous_full_month":
        current_month_start = reference.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        previous_month_end = current_month_start - timedelta(days=1)
        previous_month_start = previous_month_end.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        return previous_month_start, current_month_start
    if safe_mode == "current_and_previous_full_month":
        current_month_start = reference.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        previous_month_end = current_month_start - timedelta(days=1)
        previous_month_start = previous_month_end.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        return previous_month_start, reference

    return reference - timedelta(days=7), reference


def to_flux_range(start_dt: datetime, end_dt: datetime) -> str:
    start_iso = _as_local_time(start_dt).isoformat(timespec="seconds")
    end_iso = _as_local_time(end_dt).isoformat(timespec="seconds")
    return f"start: time(v: \"{start_iso}\"), stop: time(v: \"{end_iso}\")"


def split_range_by_month(start_dt: datetime, end_dt: datetime) -> List[Dict[str, datetime]]:
    """Split a datetime range into contiguous month-bounded periods."""
    start_local = _as_local_time(start_dt)
    end_local = _as_local_time(end_dt)
    if start_local >= end_local:
        return []

    periods: List[Dict[str, datetime]] = []
    cursor = start_local

    while cursor < end_local:
        month_days = calendar.monthrange(cursor.year, cursor.month)[1]
        month_end_exclusive = cursor.replace(
            day=month_days,
            hour=23,
            minute=59,
            second=59,
            microsecond=999999,
        ) + timedelta(microseconds=1)

        period_end = min(month_end_exclusive, end_local)
        periods.append({"start": cursor, "end": period_end})
        cursor = period_end

    return periods
