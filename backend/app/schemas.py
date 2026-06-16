import math
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

KPI_CATEGORIES = {"Work", "Personal"}


def _normalize_category(v) -> str:
    """Chuan hoa category ve "Work" | "Personal" (mac dinh "Work" neu khong hop le)."""
    if isinstance(v, str):
        s = v.strip().lower()
        if s in ("personal", "cá nhân", "ca nhan", "personal goal"):
            return "Personal"
    return "Work"


def _validate_weight(v: float | int | None) -> float | None:
    if v is None:
        return None
    if not math.isfinite(float(v)):
        raise ValueError("Trọng số phải là số hợp lệ")
    if float(v) < 0 or float(v) > 100:
        raise ValueError("Trọng số phải nằm trong khoảng 0-100%")
    if float(v) != int(float(v)):
        raise ValueError("Trọng số phải là số nguyên")
    return float(int(float(v)))


def _validate_positive_number(v: float | int | None, field_name: str) -> float | None:
    if v is None:
        return None
    if not math.isfinite(float(v)):
        raise ValueError(f"{field_name} phải là số hợp lệ")
    if float(v) <= 0:
        raise ValueError(f"{field_name} phải lớn hơn 0")
    return float(v)


def _validate_non_negative_number(v: float | int | None, field_name: str) -> float | None:
    if v is None:
        return None
    if not math.isfinite(float(v)):
        raise ValueError(f"{field_name} phải là số hợp lệ")
    if float(v) < 0:
        raise ValueError(f"{field_name} không được âm")
    return float(v)


def _validate_password_rules(v: str, field_name: str = "Mat khau") -> str:
    if not v:
        raise ValueError(f"{field_name} khong duoc de trong")
    if len(v) < 6:
        raise ValueError(f"{field_name} toi thieu 6 ky tu")
    if len(v) > 100:
        raise ValueError(f"{field_name} qua dai (toi da 100 ky tu)")
    if "\x00" in v:
        raise ValueError(f"{field_name} chua ky tu khong hop le")
    return v


def _validate_safe_text(v: str, field_name: str, max_len: int) -> str:
    v = (v or "").strip()
    if len(v) > max_len:
        raise ValueError(f"{field_name} qua dai (toi da {max_len} ky tu)")
    if _UNSAFE_CHARS_RE.search(v):
        raise ValueError(f"{field_name} chua ky tu khong hop le")
    return v


WORK_STATUSES = ["da_lam", "dang_lam", "se_lam", "phat_sinh", "loai_bo"]
STATUS_LABELS = {
    "da_lam": "Đã làm",
    "dang_lam": "Đang làm",
    "se_lam": "Sẽ làm",
    "phat_sinh": "Phát sinh",
    "loai_bo": "Loại bỏ",
}


# ---------- KPI Cycle ----------
class CycleCreate(BaseModel):
    name: str
    cycle_type: str = "yearly"   # yearly | quarterly | monthly
    start_date: date | None = None
    end_date: date | None = None


class CycleUpdate(BaseModel):
    name: str | None = None
    cycle_type: str | None = None
    start_date: date | None = None
    end_date: date | None = None
    is_active: bool | None = None


class CycleOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    cycle_type: str
    start_date: date | None
    end_date: date | None
    is_active: bool
    is_locked: bool
    locked_at: datetime | None = None
    lock_reason: str = ""
    cloned_from_cycle_id: int | None = None
    objective_count: int = 0


class CycleCloneCreate(BaseModel):
    name: str
    cycle_type: str = "yearly"
    start_date: date | None = None
    end_date: date | None = None
    exclude_objective_ids: list[int] = []  # bo qua cac objective nay khi clone


# ---------- Objective ----------
class ObjectiveCreate(BaseModel):
    name: str
    description: str = ""
    weight: float = 0.0
    year: int = 2026
    cycle_id: int | None = None

    @field_validator("weight")
    @classmethod
    def _weight_int(cls, v: float) -> float:
        return _validate_weight(v)


class ObjectiveUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    weight: float | None = None
    cycle_id: int | None = None

    @field_validator("weight")
    @classmethod
    def _weight_int(cls, v: float | None) -> float | None:
        return _validate_weight(v)


class ObjectiveOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    description: str
    weight: float = 0.0
    year: int
    cycle_id: int | None = None
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
    category: str = "Work"  # "Work" | "Personal"

    @field_validator("category")
    @classmethod
    def _norm_category(cls, v: str) -> str:
        return _normalize_category(v)

    @field_validator("weight")
    @classmethod
    def _weight_int(cls, v: float) -> float:
        return _validate_weight(v)

    @field_validator("target_value")
    @classmethod
    def _target_positive(cls, v: float) -> float:
        return _validate_positive_number(v, "Chỉ tiêu số")

    @field_validator("current_value")
    @classmethod
    def _current_non_negative(cls, v: float) -> float:
        return _validate_non_negative_number(v, "Thực đạt")


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
    category: str | None = None  # "Work" | "Personal"; None = khong doi
    clear_objective: bool = False  # true -> go KPI khoi muc tieu (vi None nghia la "khong doi")
    reason: str = ""  # ly do thay doi -> ghi vao change log

    @field_validator("category")
    @classmethod
    def _norm_category(cls, v: str | None) -> str | None:
        return _normalize_category(v) if v is not None else None

    @field_validator("weight")
    @classmethod
    def _weight_int(cls, v: float | None) -> float | None:
        return _validate_weight(v)

    @field_validator("target_value")
    @classmethod
    def _target_positive(cls, v: float | None) -> float | None:
        return _validate_positive_number(v, "Chỉ tiêu số")

    @field_validator("current_value")
    @classmethod
    def _current_non_negative(cls, v: float | None) -> float | None:
        return _validate_non_negative_number(v, "Thực đạt")


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
class KpiCandidate(BaseModel):
    kpi_id: int
    kpi_name: str
    reason: str = ""


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
    mapping_reason: str = ""
    confidence: float | None = None
    alternative_kpis: list[KpiCandidate] = []
    original_kpi_id: int | None = None
    original_status: str | None = None


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
    mapping_reason: str = ""
    confidence: float | None = None
    alternative_kpis: list[KpiCandidate] = []
    confirmed: bool
    created_at: datetime


class ConfirmItemsRequest(BaseModel):
    items: list[ProposedWorkItem]


class BalanceRequest(BaseModel):
    objective_id: int | None = None  # None = nhom KPI chua gan muc tieu


class AutoMapRequest(BaseModel):
    kpi_ids: list[int]


# ---------- Import Preview (phan tich file truoc khi luu) ----------

class ImportPreviewKpi(BaseModel):
    name: str
    weight: float
    has_weight: bool  # weight > 0
    note: str = ""


class ImportPreviewObjective(BaseModel):
    name: str
    weight: float  # trong so muc tieu tu file (0 neu khong co)
    is_new: bool  # True neu chua ton tai trong he thong
    objective_id: int | None = None  # id objective hien co (neu is_new=False)
    kpis: list[ImportPreviewKpi]
    kpi_total: float  # tong trong so KPI trong file nay
    existing_kpi_total: float = 0.0  # tong trong so KPI da co trong objective


class ImportValidationMessage(BaseModel):
    code: str  # RULE-01 ... RULE-06
    level: str  # "error" | "warning" | "info"
    message: str
    objective_name: str | None = None


class ImportPreviewOut(BaseModel):
    existing_obj_total: float  # tong trong so objective hien co
    objectives: list[ImportPreviewObjective]
    messages: list[ImportValidationMessage]
    can_save: bool  # False neu co loi cung (hard error)
    needs_weight_input: bool  # True neu co muc tieu moi hoac KPI chua co trong so


# ---------- De xuat tao KPI tu chat (cho nguoi dung xac nhan) ----------
class ProposedObjective(BaseModel):
    """Muc tieu (Objective) MOI do Agent de xuat tao kem KPI."""

    name: str
    description: str = ""
    weight: float = 0.0

    @field_validator("weight")
    @classmethod
    def _weight_int(cls, v: float) -> float:
        return _validate_weight(v)


class ProposedKPI(BaseModel):
    name: str
    description: str = ""
    target: str = ""
    unit: str = "%"
    target_value: float = 100.0
    weight: float = 0.0
    deadline: date | None = None
    category: str = "Work"  # "Work" | "Personal" — agent suy luan tu ngu canh
    objective_id: int | None = None
    objective_name: str | None = None
    # ten muc tieu MOI trong proposed_objectives ma KPI nay thuoc ve (None = dung objective_id)
    objective_ref: str | None = None

    @field_validator("weight")
    @classmethod
    def _weight_int(cls, v: float) -> float:
        return _validate_weight(v)

    @field_validator("target_value")
    @classmethod
    def _target_positive(cls, v: float) -> float:
        return _validate_positive_number(v, "Chỉ tiêu số")


class DeleteProposal(BaseModel):
    """De xuat xoa KPI/Objective - cho nguoi dung xac nhan."""

    target_type: str = Field(description="kpi|objective")
    target_id: int | None = None
    target_name: str = ""
    reason: str = ""


class ConfirmDeleteRequest(BaseModel):
    """Yeu cau xac nhan xoa KPI/Objective."""

    target_type: str = Field(description="kpi|objective")
    target_id: int
    reason: str = ""


class WeightChange(BaseModel):
    kpi_id: int
    kpi_name: str | None = None
    old_weight: float | None = None
    new_weight: float

    @field_validator("new_weight")
    @classmethod
    def _weight_int(cls, v: float) -> float:
        return _validate_weight(v)


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
    objectives: list[ProposedObjective] = []  # muc tieu MOI tao truoc, roi gan KPI vao
    kpis: list[ProposedKPI] = []
    weight_changes: list[WeightChange] = []
    cycle_id: int | None = None  # gan vao chu ky nay khi tao Objective moi


# ---------- Chat ----------
class ChatAttachment(BaseModel):
    """File/anh nguoi dung dinh kem vao mot tin nhan chat."""

    id: str
    name: str
    content_type: str = ""
    size: int = 0
    kind: str = "file"  # image | text | spreadsheet | document | pdf | file
    url: str = ""
    extracted_text: str = ""
    error: str = ""


class ChatRequest(BaseModel):
    message: str
    session_id: int | None = None  # None -> tu tao phien moi
    lang: str = "vi"  # "vi" | "en" — ngon ngu tra loi cua Agent
    attachments: list[ChatAttachment] = []


class ChatResponse(BaseModel):
    reply: str
    intent: str = "chat"
    proposed_items: list[ProposedWorkItem] = []
    proposed_objectives: list[ProposedObjective] = []
    proposed_kpis: list[ProposedKPI] = []
    weight_changes: list[WeightChange] = []
    conflicts: list[KPIConflict] = []  # xung dot phat hien giua KPI de xuat va KPI hien co
    delete_proposal: DeleteProposal | None = None  # the xac nhan xoa KPI/Objective
    session_id: int | None = None
    # id tin nhan assistant trong DB — frontend dung de luu trang thai xac nhan de xuat
    message_id: int | None = None


class ProposalStatusUpdate(BaseModel):
    """Trang thai xu ly the de xuat tren mot tin nhan: pending | saved | dismissed."""

    status: str


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


# ---------- Export linh hoat + gui quan ly (M5) ----------
class ExportDataRequest(BaseModel):
    formats: list[str] = ["csv"]  # csv | md | json | xlsx | pdf | docx
    sections: list[str] = ["kpis"]  # kpis | work_items | changelog | reports


class ManagerSendRequest(BaseModel):
    channel: str = "email"  # email | webhook
    recipient: str  # dia chi email hoac URL webhook cua quan ly/mentor
    subject: str | None = None  # tieu de bieu tuych (optional, mac dinh se tao tu dong)
    content: str | None = None  # noi dung bieu tuych (optional, mac dinh se tao tu dong)


class ManagerSendResult(BaseModel):
    mocked: bool  # true = mo phong (chua gui that)
    channel: str
    recipient: str
    subject: str
    body: str  # noi dung markdown se gui (da loc KPI ca nhan)
    note: str = ""


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


class UserProfileUpdate(BaseModel):
    name: str
    role: str | None = None
    picture: str | None = None

    @field_validator("name")
    @classmethod
    def _validate_name(cls, v: str) -> str:
        v = _validate_safe_text(v, "Ten", 100)
        if not v:
            raise ValueError("Ten khong duoc de trong")
        return v

    @field_validator("role")
    @classmethod
    def _validate_role(cls, v: str | None) -> str | None:
        return _validate_safe_text(v, "Vi tri cong viec", 100) if v is not None else None

    @field_validator("picture")
    @classmethod
    def _validate_picture(cls, v: str | None) -> str | None:
        if v is None:
            return None
        v = v.strip()
        if len(v) > 500:
            raise ValueError("URL anh dai dien qua dai (toi da 500 ky tu)")
        if v and not (v.startswith("http://") or v.startswith("https://") or v.startswith("data:image/")):
            raise ValueError("Anh dai dien phai la URL http(s) hoac data:image")
        return v


class PasswordUpdate(BaseModel):
    current_password: str = ""
    new_password: str

    @field_validator("new_password")
    @classmethod
    def _validate_new_password(cls, v: str) -> str:
        return _validate_password_rules(v, "Mat khau moi")


class ForgotPasswordRequest(BaseModel):
    email: str

    @field_validator("email")
    @classmethod
    def _normalize_email(cls, v: str) -> str:
        return v.strip().lower()


class PasswordResetRequest(BaseModel):
    token: str
    new_password: str

    @field_validator("new_password")
    @classmethod
    def _validate_new_password(cls, v: str) -> str:
        return _validate_password_rules(v, "Mat khau moi")


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user_id: int
    name: str
    picture: str = ""
    email: str | None = None
    role: str = ""
    onboarding_completed: bool = False


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


class DashboardInsightOut(BaseModel):
    generated_at: datetime
    data_signature: str
    top_strength: str
    top_risk: str
    top_priority: str
    correlation_insight: str
    forecast_next_period: str
    kpi_adjustment: str
    suggested_actions: list[str] = []
    risk_kpi_id: int | None = None
    priority_kpi_id: int | None = None
    strength_category: str = "None"


# ---------- Coaching & Remediation (RCA — M4) ----------
class RootCause(BaseModel):
    cause: str  # gia thuyet nguyen nhan goc re (LLM sinh)
    question: str = ""  # cau hoi goi mo de nguoi dung tu xac nhan (chain-of-thought probing)


class CoachingOut(BaseModel):
    kpi_id: int
    kpi_name: str
    health: str  # green | yellow | red
    gap: float
    analysis: str  # van ban RCA do LLM sinh (khong hardcode)
    root_causes: list[RootCause] = []
    proposed_items: list[ProposedWorkItem] = []  # viec khac phuc -> tai dung luong confirm


# ---------- Du bao van toc (AI Predictive Runrate) ----------
class ForecastPoint(BaseModel):
    date: date
    value: float  # % tien do (current_value / target_value * 100)


class KPIForecastOut(BaseModel):
    kpi_id: int
    kpi_name: str
    unit: str
    target_value: float
    current_value: float
    current_progress: float
    daily_velocity: float  # gia tri (theo don vi KPI) dat duoc moi ngay theo lich su
    forecast_value: float  # gia tri du bao dat duoc vao deadline neu giu van toc hien tai
    forecast_progress: float  # % du bao vao deadline (co the vuot 100%)
    days_remaining: int
    eta_date: date | None = None  # ngay du kien cham chi tieu (None: da dat / dung yen)
    on_track: bool  # du bao co kip chi tieu truoc deadline khong
    forecast_health: str  # green | yellow | red — dua tren du bao (khac health hien tai)
    has_history: bool  # co du lieu dau viec de tinh van toc dang tin khong
    actual_series: list[ForecastPoint] = []  # tien do thuc te tich luy theo thoi gian
    expected_series: list[ForecastPoint] = []  # duong ke hoach/ky vong (SMART hoac tuyen tinh)
    forecast_series: list[ForecastPoint] = []  # duong du bao tu hom nay -> deadline


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


# ---------- Burnout Guardrail (M4) ----------
class CalendarEventOut(BaseModel):
    date: str   # ISO "YYYY-MM-DD"
    title: str
    hours: float  # so gio chiem dung


class BurnoutOut(BaseModel):
    risk_level: str           # safe | warning | danger
    hours_needed: float       # tong gio uoc tinh can de hoan thanh KPI
    free_hours: float         # quy gio trong trong horizon_days toi
    horizon_days: int         # so ngay nhin toi (14)
    calendar_hours: float     # gio da co lich su kien trong horizon
    pending_items: int        # so dau viec dang cho xac nhan
    detail: list[str]         # giai thich tung buoc tinh toan
    calendar_events: list[CalendarEventOut]  # cac su kien trong horizon


# ---------- Thong bao chu dong (M3) ----------
class NotificationOut(BaseModel):
    id: str  # khoa on dinh de chong lap/danh dau da doc: "type:ref:state"
    type: str  # behind | deadline | overdue | runrate
    severity: str  # high | medium | low
    title: str  # ten KPI hoac ten dau viec
    params: dict = {}  # so lieu de frontend dung i18n soan thong diep (gap, progress, days, forecast...)
    kpi_id: int | None = None


# ---------- Cau hinh ket noi (app-level, doi tu UI) ----------
class ConnectionSettingsOut(BaseModel):
    google_mock_mode: bool  # true = dung mock data
    real_available: bool  # credentials.json co ton tai khong
    effective_mode: str  # "mock" | "real" — che do THUC SU dang chay
    note: str = ""


class ConnectionSettingsUpdate(BaseModel):
    google_mock_mode: bool


# ---------- Ket noi nguon du lieu (OAuth, theo tung nguoi dung) ----------
class IntegrationOut(BaseModel):
    """Mot nguon co the ket noi + trang thai ket noi cua nguoi dung hien tai."""

    provider: str  # google | notion | slack | outlook
    label: str
    icon: str
    sources: list[str] = []  # cac source provider nay cung cap (gmail, calendar, sheets...)
    enabled: bool  # server da cau hinh client (credentials) cho provider nay chua
    connected: bool  # nguoi dung da lien ket chua
    account_email: str = ""
    account_name: str = ""
    connected_at: datetime | None = None


class OAuthStartOut(BaseModel):
    auth_url: str


# ---------- Ghi nho cua Agent (tu hoc tu hoi thoai) ----------
class AgentMemoryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    content: str
    category: str
    created_at: datetime


class AgentCycleLogOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    cycle_key: str
    phase: str
    status: str
    summary: str = ""
    meta: dict | None = None
    created_at: datetime


class AutonomousAgentStatusOut(BaseModel):
    enabled: bool
    interval_seconds: int
    running: bool
    latest_logs: list[AgentCycleLogOut] = []


class CategorySuggestion(BaseModel):
    kpi_id: int
    kpi_name: str
    current_category: str
    suggested_category: str
    reason: str
    confidence: float = 0.0


class AutonomousInboxItem(BaseModel):
    message_id: int
    session_id: int | None = None
    content: str
    event_type: str = ""
    summary: str = ""
    proposed_items: list[ProposedWorkItem] = []
    category_suggestions: list[CategorySuggestion] = []
    proposal_status: str | None = None
    created_at: datetime


# ---------- D1: Onboarding ----------
class OnboardingCompleteRequest(BaseModel):
    role: str = ""


# ---------- D5: Share Links ----------
class ShareLinkCreate(BaseModel):
    expires_in_days: int = 7

    @field_validator("expires_in_days")
    @classmethod
    def _validate_days(cls, v: int) -> int:
        if not 1 <= v <= 30:
            raise ValueError("Thời hạn phải từ 1 đến 30 ngày")
        return v


class ShareLinkOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    token: str
    cycle_id: int
    expires_at: datetime
    revoked_at: datetime | None = None
    created_at: datetime

    @property
    def is_valid(self) -> bool:
        from datetime import datetime
        return self.revoked_at is None and self.expires_at > datetime.now()


# ---------- D2: Notification Settings ----------
class NotificationSettingsOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    kpi_reminder_enabled: bool = True
    weekly_summary_enabled: bool = True
    sync_error_enabled: bool = True
    recipient_email: str = ""


class NotificationSettingsUpdate(BaseModel):
    kpi_reminder_enabled: bool | None = None
    weekly_summary_enabled: bool | None = None
    sync_error_enabled: bool | None = None
    recipient_email: str | None = None
