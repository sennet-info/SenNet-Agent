from datetime import datetime
from typing import List, Optional

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
    price: float = 0.14
    serial: Optional[str] = None
    start_dt: Optional[datetime] = None
    end_dt: Optional[datetime] = None
    debug: bool = False
    debug_sample_n: int = Field(default=10, ge=1, le=50)
    max_workers: int = Field(default=4, ge=1, le=16)
    force_recalculate: bool = False


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
