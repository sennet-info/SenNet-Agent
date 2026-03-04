from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field


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


class ReportResponse(BaseModel):
    pdf_path: str
    filename: str
