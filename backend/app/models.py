"""SQLAlchemy models. Co user_id tu dau de mo rong multi-user sau hackathon."""
from datetime import date, datetime, timezone

from sqlalchemy import JSON, Boolean, Date, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(100), default="Người dùng")

    kpis: Mapped[list["KPI"]] = relationship(back_populates="user")


class KPI(Base):
    __tablename__ = "kpis"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), default=1, index=True)
    name: Mapped[str] = mapped_column(String(300))
    description: Mapped[str] = mapped_column(Text, default="")
    target: Mapped[str] = mapped_column(Text, default="")  # chi tieu do luong
    weight: Mapped[float] = mapped_column(Float, default=0.0)  # trong so %
    year: Mapped[int] = mapped_column(Integer, default=2026)
    deadline: Mapped[date | None] = mapped_column(Date, nullable=True)
    progress: Mapped[float] = mapped_column(Float, default=0.0)  # 0-100
    archived: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    user: Mapped["User"] = relationship(back_populates="kpis")
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
    source: Mapped[str] = mapped_column(String(30), default="chat")  # chat|csv|gmail|calendar|sheets
    source_ref: Mapped[str] = mapped_column(String(500), default="")  # email nao, dong nao...
    work_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    confirmed: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    kpi: Mapped["KPI | None"] = relationship(back_populates="work_items")


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


class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), default=1, index=True)
    role: Mapped[str] = mapped_column(String(10))  # user | assistant
    content: Mapped[str] = mapped_column(Text)
    meta: Mapped[dict | None] = mapped_column(JSON, nullable=True)  # proposed_items, intent...
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
