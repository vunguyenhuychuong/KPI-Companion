from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field

WORK_STATUSES = ["da_lam", "dang_lam", "se_lam", "phat_sinh", "loai_bo"]
STATUS_LABELS = {
    "da_lam": "Đã làm",
    "dang_lam": "Đang làm",
    "se_lam": "Sẽ làm",
    "phat_sinh": "Phát sinh",
    "loai_bo": "Loại bỏ",
}


# ---------- KPI ----------
class SubGoalOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    period_type: str
    period_label: str
    description: str
    expected_progress: float
    sort_order: int


class KPIBase(BaseModel):
    name: str
    description: str = ""
    target: str = ""
    weight: float = 0.0
    year: int = 2026
    deadline: date | None = None


class KPICreate(KPIBase):
    pass


class KPIUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    target: str | None = None
    weight: float | None = None
    deadline: date | None = None
    progress: float | None = None
    reason: str = ""  # ly do thay doi -> ghi vao change log


class KPIOut(KPIBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    progress: float
    archived: bool
    created_at: datetime
    sub_goals: list[SubGoalOut] = []


# ---------- Work items ----------
class ProposedWorkItem(BaseModel):
    """Dau viec do Agent de xuat, cho nguoi dung xac nhan."""

    title: str
    detail: str = ""
    status: str = Field(description="da_lam|dang_lam|se_lam|phat_sinh|loai_bo")
    kpi_id: int | None = None
    kpi_name: str | None = None
    progress_delta: float = 0.0
    source: str = "chat"
    source_ref: str = ""
    work_date: date | None = None


class WorkItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    kpi_id: int | None
    title: str
    detail: str
    status: str
    progress_delta: float
    source: str
    source_ref: str
    work_date: date | None
    confirmed: bool
    created_at: datetime


class ConfirmItemsRequest(BaseModel):
    items: list[ProposedWorkItem]


# ---------- Chat ----------
class ChatRequest(BaseModel):
    message: str


class ChatResponse(BaseModel):
    reply: str
    intent: str = "chat"
    proposed_items: list[ProposedWorkItem] = []


class ChatMessageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    role: str
    content: str
    meta: dict | None = None
    created_at: datetime


# ---------- Dashboard ----------
class KPIStatus(BaseModel):
    kpi: KPIOut
    expected_progress: float  # % ky vong theo thoi gian troi qua
    health: str  # green | yellow | red
    gap: float


class DashboardOut(BaseModel):
    year: int
    overall_progress: float  # co trong so
    kpi_statuses: list[KPIStatus]
    warnings: list[str]
    counts_by_status: dict[str, int]
    recent_items: list[WorkItemOut]


# ---------- Sync ----------
class SyncRequest(BaseModel):
    sources: list[str]  # gmail | calendar | sheets
    start_date: date | None = None
    end_date: date | None = None


class ChangeLogOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    kpi_id: int
    changed_at: datetime
    field: str
    old_value: str
    new_value: str
    reason: str
