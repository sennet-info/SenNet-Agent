from datetime import datetime
from typing import List, Literal, Optional

from pydantic import BaseModel, Field

ROLE_OPTIONS = [
    "consumption",
    "generation",
    "storage",
    "meter_fluids",
    "meter_people",
    "environmental",
]


class ReportRequest(BaseModel):
    tenant: str
    client: str
    site: str
    devices: List[str] = Field(min_length=1, max_length=50)
    range_flux: str = "7d"
    range_mode: Optional[Literal["last_n_days", "month_to_date", "previous_full_month", "custom", "last_days", "full_month"]] = None
    last_days: Optional[int] = Field(default=None, ge=1, le=365)
    range_label: Optional[str] = None
    timezone: Optional[str] = None
    price: float = 0.14
    price_source: Optional[str] = None
    price_override: Optional[bool] = None
    serial: Optional[str] = None
    start_dt: Optional[datetime] = None
    end_dt: Optional[datetime] = None
    debug: bool = False
    debug_sample_n: int = Field(default=10, ge=1, le=50)
    max_workers: int = Field(default=4, ge=1, le=16)
    force_recalculate: bool = False
    report_options: Optional[dict] = None


class ReportResponse(BaseModel):
    pdf_path: str
    filename: str
    debug_path: Optional[str] = None
    debug: Optional[dict] = None


class TenantUpsertRequest(BaseModel):
    url: str = Field(min_length=1)
    token: str = Field(min_length=1)
    org: str = Field(min_length=1)
    bucket: str = Field(min_length=1)


class RoleUpsertRequest(BaseModel):
    role: str = Field(min_length=1)


class SchedulerTaskBase(BaseModel):
    name: Optional[str] = None
    tenant_alias: str = Field(min_length=1, alias="tenant")
    client: str = Field(min_length=1)
    site: str = Field(min_length=1)
    serial: Optional[str] = None
    device: str = Field(min_length=1)
    extra_devices: List[str] = Field(default_factory=list)
    frequency: Literal["daily", "weekly", "monthly", "cron"] = "daily"
    time: str = Field(pattern=r"^([01]\d|2[0-3]):([0-5]\d)$")
    weekday: Optional[int] = Field(default=None, ge=0, le=6)
    cron: Optional[str] = None
    report_range_mode: Optional[str] = None
    range_flux: Optional[str] = None
    start_dt: Optional[datetime] = None
    end_dt: Optional[datetime] = None
    emails: List[str] = Field(min_length=1)
    enabled: bool = True


class SchedulerTaskCreateRequest(SchedulerTaskBase):
    pass


class SchedulerTaskUpdateRequest(BaseModel):
    name: Optional[str] = None
    tenant_alias: Optional[str] = Field(default=None, alias="tenant")
    client: Optional[str] = None
    site: Optional[str] = None
    serial: Optional[str] = None
    device: Optional[str] = None
    extra_devices: Optional[List[str]] = None
    frequency: Optional[Literal["daily", "weekly", "monthly", "cron"]] = None
    time: Optional[str] = Field(default=None, pattern=r"^([01]\d|2[0-3]):([0-5]\d)$")
    weekday: Optional[int] = Field(default=None, ge=0, le=6)
    cron: Optional[str] = None
    report_range_mode: Optional[str] = None
    range_flux: Optional[str] = None
    start_dt: Optional[datetime] = None
    end_dt: Optional[datetime] = None
    emails: Optional[List[str]] = None
    enabled: Optional[bool] = None


class SchedulerRunRequest(BaseModel):
    debug: bool = False
    debug_sample_n: int = Field(default=10, ge=1, le=50)
    max_workers: int = Field(default=4, ge=1, le=16)
    force_recalculate: bool = False
    send_email: bool = True


class SmtpConfigRequest(BaseModel):
    server: str = Field(min_length=1)
    port: int = Field(ge=1, le=65535)
    user: str = Field(min_length=1)
    password: str = ""


class SmtpTestRequest(BaseModel):
    recipient: str = Field(min_length=3)
