import re
from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

# Email: cho phep local-part ASCII + domain + TLD it nhat 2 ky tu
_EMAIL_RE = re.compile(r'^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$')
_ALLOWED_EMAIL_DOMAINS = {"gmail.com", "vng.com.vn"}

# Ky tu cam trong ten nguoi dung:
#   < > " ' / \ &  {}  — HTML/script injection
#   \x00-\x1f \x7f    — control characters (null, CR, LF, tab...)
#   ​‌‍﻿ — zero-width space / ZWNJ / ZWJ / BOM (hay an trong text tieng Viet)
#   ‪-‮      — bidi override (LRE RLE PDF LRO RLO — co the dao nguoc hien thi)
_UNSAFE_CHARS_RE = re.compile(
    r'[<>"\'/\\&{}\x00-\x1f\x7f​‌‍﻿‪-‮]'
)

WORK_STATUSES = ["da_lam", "dang_lam", "se_lam", "phat_sinh", "loai_bo"]
STATUS_LABELS = {
    "da_lam": "Đã làm",
    "dang_lam": "Đang làm",
    "se_lam": "Sẽ làm",
    "phat_sinh": "Phát sinh",
    "loai_bo": "Loại bỏ",
}


# ---------- Objective ----------
class ObjectiveCreate(BaseModel):
    name: str
    description: str = ""
    weight: float = 0.0
    year: int = 2026


class ObjectiveUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    weight: float | None = None


class ObjectiveOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    description: str
    weight: float = 0.0
    year: int
    progress: float = 0.0  # trung binh co trong so cua cac KPI con (da cap 100%)
    kpi_count: int = 0


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
    objective_id: int | None = None
    unit: str = "%"
    target_value: float = 100.0
    current_value: float = 0.0


class KPICreate(KPIBase):
    pass


class KPIUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    target: str | None = None
    weight: float | None = None
    deadline: date | None = None
    unit: str | None = None
    target_value: float | None = None
    current_value: float | None = None
    objective_id: int | None = None
    clear_objective: bool = False  # true -> go KPI khoi muc tieu (vi None nghia la "khong doi")
    reason: str = ""  # ly do thay doi -> ghi vao change log


class KPIOut(KPIBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    progress: float  # co the vuot 100%
    progress_capped: float  # dung khi tong hop
    archived: bool
    created_at: datetime
    objective_name: str | None = None
    sub_goals: list[SubGoalOut] = []


# ---------- Work items ----------
class ProposedWorkItem(BaseModel):
    """Dau viec do Agent de xuat, cho nguoi dung xac nhan."""

    title: str
    detail: str = ""
    status: str = Field(description="da_lam|dang_lam|se_lam|phat_sinh|loai_bo")
    kpi_id: int | None = None
    kpi_name: str | None = None
    kpi_unit: str | None = None  # don vi cua KPI de hien thi (vd: khoa hoc, %, bao cao)
    value_delta: float = 0.0  # cong them vao THUC DAT theo don vi KPI (am de tru)
    source: str = "chat"
    source_ref: str = ""
    work_date: date | None = None


class WorkItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    kpi_id: int | None
    kpi_name: str | None = None
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


class BalanceRequest(BaseModel):
    objective_id: int | None = None  # None = nhom KPI chua gan muc tieu


# ---------- De xuat tao KPI tu chat (cho nguoi dung xac nhan) ----------
class ProposedKPI(BaseModel):
    name: str
    description: str = ""
    target: str = ""
    unit: str = "%"
    target_value: float = 100.0
    weight: float = 0.0
    deadline: date | None = None
    objective_id: int | None = None
    objective_name: str | None = None


class WeightChange(BaseModel):
    kpi_id: int
    kpi_name: str | None = None
    old_weight: float | None = None
    new_weight: float


CONFLICT_TYPES = {
    "resource_tradeoff", "speed_vs_quality", "growth_vs_stability",
    "time_overload", "metric_overlap",
}


class KPIConflict(BaseModel):
    """Mot xung dot giua 2+ KPI do Agent phat hien."""

    kpi_ids: list[int] = []  # id KPI hien co lien quan ([] neu chi dinh KPI dang de xuat)
    kpi_names: list[str] = []
    type: str = "resource_tradeoff"
    severity: str = "medium"  # high | medium | low
    explanation: str = ""
    suggestion: str = ""


class ConflictAnalysisOut(BaseModel):
    conflicts: list[KPIConflict] = []
    analyzed_kpis: int = 0


class KPIProposalConfirm(BaseModel):
    kpis: list[ProposedKPI] = []
    weight_changes: list[WeightChange] = []


# ---------- Chat ----------
class ChatRequest(BaseModel):
    message: str
    session_id: int | None = None  # None -> tu tao phien moi


class ChatResponse(BaseModel):
    reply: str
    intent: str = "chat"
    proposed_items: list[ProposedWorkItem] = []
    proposed_kpis: list[ProposedKPI] = []
    weight_changes: list[WeightChange] = []
    conflicts: list[KPIConflict] = []  # xung dot phat hien giua KPI de xuat va KPI hien co
    session_id: int | None = None


class ChatMessageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    role: str
    content: str
    meta: dict | None = None
    created_at: datetime


class ChatSessionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    title: str
    created_at: datetime


# ---------- Bao cao ky ----------
class ReportGenerateRequest(BaseModel):
    period_type: str = "week"  # week | month | quarter | year
    period_label: str | None = None  # "2026-06" | "Q2/2026" | "2026"; None -> ky hien tai


class SavedReportOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    period_type: str
    period_label: str
    content: str
    created_at: datetime


# ---------- Auth ----------
class UserCreate(BaseModel):
    email: str
    password: str
    name: str = ""

    @field_validator("email")
    @classmethod
    def _validate_email(cls, v: str) -> str:
        v = v.strip().lower()
        if not v:
            raise ValueError("Email không được để trống")
        if len(v) > 254:
            raise ValueError("Email quá dài (tối đa 254 ký tự)")
        if not _EMAIL_RE.match(v):
            raise ValueError("Email không đúng định dạng (vd: ten@vng.com.vn)")
        domain = v.split("@")[1]
        if domain not in _ALLOWED_EMAIL_DOMAINS:
            raise ValueError("Chỉ chấp nhận email @gmail.com hoặc @vng.com.vn")
        return v

    @field_validator("password")
    @classmethod
    def _validate_password(cls, v: str) -> str:
        if not v:
            raise ValueError("Mật khẩu không được để trống")
        if len(v) < 6:
            raise ValueError("Mật khẩu tối thiểu 6 ký tự")
        if len(v) > 100:
            raise ValueError("Mật khẩu quá dài (tối đa 100 ký tự)")
        if "\x00" in v:
            raise ValueError("Mật khẩu chứa ký tự không hợp lệ")
        return v

    @field_validator("name")
    @classmethod
    def _validate_name(cls, v: str) -> str:
        v = v.strip()
        if len(v) > 100:
            raise ValueError("Tên quá dài (tối đa 100 ký tự)")
        if _UNSAFE_CHARS_RE.search(v):
            raise ValueError('Tên chứa ký tự không hợp lệ (không dùng: < > " \' / \\ & { })')
        return v


class UserLogin(BaseModel):
    email: str
    password: str

    @field_validator("email")
    @classmethod
    def _normalize_email(cls, v: str) -> str:
        v = v.strip().lower()
        if not v:
            raise ValueError("Email không được để trống")
        return v

    @field_validator("password")
    @classmethod
    def _check_password_nonempty(cls, v: str) -> str:
        if not v:
            raise ValueError("Mật khẩu không được để trống")
        return v


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user_id: int
    name: str
    picture: str = ""


class GoogleTokenRequest(BaseModel):
    credential: str  # Google ID token từ @react-oauth/google


# ---------- Dashboard ----------
class KPIStatus(BaseModel):
    kpi: KPIOut
    expected_progress: float  # % ky vong theo thoi gian troi qua
    health: str  # green | yellow | red
    gap: float


class DashboardOut(BaseModel):
    year: int
    overall_progress: float  # co trong so
    objectives: list[ObjectiveOut] = []
    kpi_statuses: list[KPIStatus]
    warnings: list[str]
    counts_by_status: dict[str, int]
    recent_items: list[WorkItemOut]
    todo_items: list[WorkItemOut] = []  # viec can lam: se_lam + dang_lam
    weekly_activity: list[dict] = []  # 8 tuan gan nhat: [{"label": "08/06", "count": n}]


# ---------- Sync ----------
class SyncRequest(BaseModel):
    sources: list[str]  # gmail | calendar | sheets
    start_date: date | None = None
    end_date: date | None = None


class ChangeLogOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    kpi_id: int
    kpi_name: str | None = None
    changed_at: datetime
    field: str
    old_value: str
    new_value: str
    reason: str
