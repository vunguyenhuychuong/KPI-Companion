"""SQLAlchemy models. Co user_id tu dau de mo rong multi-user sau hackathon."""
from datetime import date, datetime

from sqlalchemy import (
    JSON,
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


def utcnow() -> datetime:
    """Gio DIA PHUONG (ten ham giu nguyen de khoi doi cac cho dung).

    App single-user chay local — luu gio dia phuong de ngay/gio hien thi
    khop voi nguoi dung VN (UTC+7); truoc day luu UTC nen bi lech -7h.
    """
    return datetime.now()


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(100), default="Người dùng")
    email: Mapped[str | None] = mapped_column(String(254), unique=True, nullable=True, index=True)
    hashed_password: Mapped[str | None] = mapped_column(String(200), nullable=True)
    picture: Mapped[str] = mapped_column(String(500), default="")
    # D1 Onboarding
    onboarding_completed: Mapped[bool] = mapped_column(Boolean, default=False)
    onboarding_skipped_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    role: Mapped[str] = mapped_column(String(100), default="")

    kpis: Mapped[list["KPI"]] = relationship(back_populates="user")


class KPICycle(Base):
    """Chu ky danh gia KPI (nam/quy/thang). Objective thuoc ve mot Cycle."""

    __tablename__ = "kpi_cycles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), default=1, index=True)
    name: Mapped[str] = mapped_column(String(200))          # "Năm 2026", "Q2 2026"
    cycle_type: Mapped[str] = mapped_column(String(20), default="yearly")  # yearly|quarterly|monthly
    start_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    end_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    is_locked: Mapped[bool] = mapped_column(Boolean, default=False)  # chot so — khong sua duoc
    locked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    locked_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    lock_reason: Mapped[str] = mapped_column(String(500), default="", server_default="")
    cloned_from_cycle_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    objectives: Mapped[list["Objective"]] = relationship(back_populates="cycle")


class Objective(Base):
    """Muc tieu lon trong chu ky (Objective) — moi KPI thuoc ve mot Objective."""

    __tablename__ = "objectives"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), default=1, index=True)
    cycle_id: Mapped[int | None] = mapped_column(ForeignKey("kpi_cycles.id"), nullable=True, index=True)
    name: Mapped[str] = mapped_column(String(300))
    description: Mapped[str] = mapped_column(Text, default="")
    weight: Mapped[float] = mapped_column(Float, default=0.0)  # trong so % (tong <= 100)
    year: Mapped[int] = mapped_column(Integer, default=2026)
    archived: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    cycle: Mapped["KPICycle | None"] = relationship(back_populates="objectives")
    kpis: Mapped[list["KPI"]] = relationship(back_populates="objective")


class KPI(Base):
    __tablename__ = "kpis"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), default=1, index=True)
    objective_id: Mapped[int | None] = mapped_column(
        ForeignKey("objectives.id"), nullable=True, index=True
    )
    name: Mapped[str] = mapped_column(String(300))
    description: Mapped[str] = mapped_column(Text, default="")
    target: Mapped[str] = mapped_column(Text, default="")  # mo ta chi tieu do luong
    weight: Mapped[float] = mapped_column(Float, default=0.0)  # trong so % TRONG objective (tong <= 100)
    year: Mapped[int] = mapped_column(Integer, default=2026)
    deadline: Mapped[date | None] = mapped_column(Date, nullable=True)
    # He do luong: % tien do = current_value / target_value * 100 (duoc phep vuot 100%)
    unit: Mapped[str] = mapped_column(String(50), default="%")  # don vi: %, khoa hoc, bao cao...
    target_value: Mapped[float] = mapped_column(Float, default=100.0)  # chi tieu (so)
    current_value: Mapped[float] = mapped_column(Float, default=0.0)  # thuc dat (so)
    # cot "progress" cu: khong dung nua nhung DB hien co rang buoc NOT NULL -> giu de insert khong loi
    progress_legacy: Mapped[float] = mapped_column("progress", Float, default=0.0)
    # Phan vung ngu canh: "Work" (cong viec) | "Personal" (ca nhan) — co lap hien thi/loc
    category: Mapped[str] = mapped_column(String(20), default="Work")
    archived: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    @property
    def progress(self) -> float:
        """% tien do, co the vuot 100% (vuot chi tieu)."""
        if not self.target_value:
            return 0.0
        return round(self.current_value / self.target_value * 100, 1)

    @property
    def progress_capped(self) -> float:
        """% dung de tong hop diem (cap 100% theo chuan OKR, chong sandbagging)."""
        return min(100.0, self.progress)

    user: Mapped["User"] = relationship(back_populates="kpis")
    objective: Mapped["Objective | None"] = relationship(back_populates="kpis")

    @property
    def objective_name(self) -> str | None:
        return self.objective.name if self.objective else None

    sub_goals: Mapped[list["SubGoal"]] = relationship(
        back_populates="kpi", cascade="all, delete-orphan", order_by="SubGoal.sort_order"
    )
    work_items: Mapped[list["WorkItem"]] = relationship(back_populates="kpi")
    change_logs: Mapped[list["KPIChangeLog"]] = relationship(
        back_populates="kpi", cascade="all, delete-orphan"
    )


class SubGoal(Base):
    """Muc tieu nho theo quy/thang sau khi phan ra SMART."""

    __tablename__ = "sub_goals"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    kpi_id: Mapped[int] = mapped_column(ForeignKey("kpis.id"), index=True)
    period_type: Mapped[str] = mapped_column(String(10))  # "quarter" | "month"
    period_label: Mapped[str] = mapped_column(String(20))  # "Q1" | "2026-03"
    description: Mapped[str] = mapped_column(Text)
    expected_progress: Mapped[float] = mapped_column(Float, default=0.0)  # % cong don ky vong
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    kpi: Mapped["KPI"] = relationship(back_populates="sub_goals")


class WorkItem(Base):
    """Mot dau viec da duoc tach/phan loai (tu chat hoac tu nguon ngoai)."""

    __tablename__ = "work_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), default=1, index=True)
    kpi_id: Mapped[int | None] = mapped_column(ForeignKey("kpis.id"), nullable=True, index=True)
    title: Mapped[str] = mapped_column(String(500))
    detail: Mapped[str] = mapped_column(Text, default="")
    # da_lam | dang_lam | se_lam | phat_sinh | loai_bo
    status: Mapped[str] = mapped_column(String(20), index=True)
    progress_delta: Mapped[float] = mapped_column(Float, default=0.0)  # % cong vao KPI
    source: Mapped[str] = mapped_column(String(30), default="chat")  # chat|csv|gmail|calendar|sheets|notion|slack|outlook
    source_ref: Mapped[str] = mapped_column(String(500), default="")  # email nao, dong nao...
    work_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    confirmed: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    kpi: Mapped["KPI | None"] = relationship(back_populates="work_items")

    @property
    def kpi_name(self) -> str | None:
        return self.kpi.name if self.kpi else None


class KPIChangeLog(Base):
    __tablename__ = "kpi_change_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    kpi_id: Mapped[int] = mapped_column(ForeignKey("kpis.id"), index=True)
    changed_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    field: Mapped[str] = mapped_column(String(50))
    old_value: Mapped[str] = mapped_column(Text, default="")
    new_value: Mapped[str] = mapped_column(Text, default="")
    reason: Mapped[str] = mapped_column(Text, default="")

    kpi: Mapped["KPI"] = relationship(back_populates="change_logs")

    @property
    def kpi_name(self) -> str | None:
        return self.kpi.name if self.kpi else None


class ChatSession(Base):
    """Mot phien hoi thoai voi Agent (kieu danh sach conversation cua ChatGPT)."""

    __tablename__ = "chat_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), default=1, index=True)
    title: Mapped[str] = mapped_column(String(200), default="Cuộc trò chuyện mới")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    messages: Mapped[list["ChatMessage"]] = relationship(
        back_populates="session", cascade="all, delete-orphan"
    )


class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), default=1, index=True)
    session_id: Mapped[int | None] = mapped_column(
        ForeignKey("chat_sessions.id"), nullable=True, index=True
    )
    role: Mapped[str] = mapped_column(String(10))  # user | assistant
    content: Mapped[str] = mapped_column(Text)
    meta: Mapped[dict | None] = mapped_column(JSON, nullable=True)  # proposed_items, intent...
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    session: Mapped["ChatSession | None"] = relationship(back_populates="messages")


class SavedReport(Base):
    """Bao cao ky (tuan/thang/quy/nam) do Agent viet, luu lai de xem lai."""

    __tablename__ = "saved_reports"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), default=1, index=True)
    period_type: Mapped[str] = mapped_column(String(10))  # week | month | quarter | year
    period_label: Mapped[str] = mapped_column(String(30))  # nhan hien thi: "Tuần 08/06–14/06/2026"
    period_key: Mapped[str] = mapped_column(String(20), default="")  # khoa chuan: "2026-06-08" | "2026-06" | "Q2/2026" | "2026"
    content: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class AppSetting(Base):
    """Cau hinh muc ung dung (app-level) co the doi luc chay tu UI — vd google_mock_mode.

    Khong luu secret/credentials o day (giu o file server cho an toan).
    """

    __tablename__ = "app_settings"

    key: Mapped[str] = mapped_column(String(60), primary_key=True)
    value: Mapped[str] = mapped_column(String(500), default="")
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class UserIntegration(Base):
    """Ket noi OAuth cua TUNG nguoi dung toi mot nguon du lieu ben ngoai.

    Provider-agnostic: "google" (Gmail/Calendar/Sheets) o Phase 1; Phase 3 them
    "notion" | "slack" | "outlook" — chi can them entry trong PROVIDERS + connector,
    khong doi schema. Moi (user_id, provider) chi co 1 ban ghi (unique).

    CANH BAO BAO MAT: token hien luu dang plaintext (du cho demo/hackathon).
    Khi deploy that nen ma hoa truong access_token/refresh_token (vd Fernet).
    """

    __tablename__ = "user_integrations"
    __table_args__ = (UniqueConstraint("user_id", "provider", name="uq_user_provider"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    provider: Mapped[str] = mapped_column(String(30), index=True)  # google|notion|slack|outlook
    account_email: Mapped[str] = mapped_column(String(254), default="")  # tai khoan da dang nhap
    account_name: Mapped[str] = mapped_column(String(200), default="")
    access_token: Mapped[str] = mapped_column(Text, default="")
    refresh_token: Mapped[str] = mapped_column(Text, default="")
    token_expiry: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    scopes: Mapped[str] = mapped_column(Text, default="")  # phan cach bang dau cach
    status: Mapped[str] = mapped_column(String(20), default="connected")  # connected|error
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)


class AgentMemory(Base):
    """Bo nho dai han cua Agent — tu hoc tu hoi thoai voi nguoi dung."""

    __tablename__ = "agent_memories"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    content: Mapped[str] = mapped_column(String(500))
    category: Mapped[str] = mapped_column(String(30), default="other")  # profile|alias|workflow|preference|other
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


# ---- D5: Share Report (read-only public link) ----

class ShareLink(Base):
    """Link chia se bao cao KPI — khong can dang nhap de xem."""

    __tablename__ = "share_links"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    cycle_id: Mapped[int] = mapped_column(ForeignKey("kpi_cycles.id"), index=True)
    created_by: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    token: Mapped[str] = mapped_column(String(36), unique=True, index=True)  # UUID v4
    expires_at: Mapped[datetime] = mapped_column(DateTime)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


# ---- D2: Email Notification Settings ----

class UserNotificationSettings(Base):
    """Cai dat thong bao email cua tung nguoi dung."""

    __tablename__ = "user_notification_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), unique=True, index=True)
    kpi_reminder_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    weekly_summary_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    sync_error_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    recipient_email: Mapped[str] = mapped_column(String(254), default="")  # override email, bo trong = dung account email


class NotificationLog(Base):
    """Lich su email da gui."""

    __tablename__ = "notification_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    type: Mapped[str] = mapped_column(String(30))  # kpi_reminder | weekly_summary | sync_error
    sent_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    status: Mapped[str] = mapped_column(String(20), default="sent")  # sent | failed
    error_msg: Mapped[str] = mapped_column(String(500), default="")
