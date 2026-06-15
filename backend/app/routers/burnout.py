"""Burnout Guardrail (M4): uoc tinh gio can vs quy thoi gian trong tren lich.

Tinh deterministic — KHONG goi LLM (tuong tu forecast).
Nguon lich: mock_data/calendar.json (mock-first; credits real sau).
"""
import json
import re
from datetime import date, timedelta
from pathlib import Path

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models, schemas
from ..auth import CurrentUser
from ..database import get_db
from ..services import kpi_service

router = APIRouter(prefix="/api/burnout", tags=["burnout"])

MOCK_CALENDAR_PATH = Path(__file__).parent.parent.parent / "mock_data" / "calendar.json"
HOURS_PER_WORK_ITEM = 2.0   # 2h cho moi dau viec dang cho
HOURS_PER_DAY = 8.0          # gio lam viec moi ngay thuong
HORIZON_DAYS = 14             # 2 tuan nhin toi
GAP_HOURS_PER_PCT = 0.2      # uoc tinh: 1h cho moi 5% tien do con lai tren KPI chua len ke hoach


def _parse_duration_hours(dur: str) -> float:
    """Parse '1h', '2h', '30m', '45m', '1h30m' thanh so gio thap phan."""
    dur = (dur or "").strip().lower()
    h_match = re.search(r"(\d+)h", dur)
    m_match = re.search(r"(\d+)m", dur)
    hours = int(h_match.group(1)) if h_match else 0
    minutes = int(m_match.group(1)) if m_match else 0
    if hours == 0 and minutes == 0:
        return 1.0  # fallback 1h neu khong parse duoc
    return round(hours + minutes / 60.0, 2)


def _load_calendar_events(start: date, end: date) -> list[schemas.CalendarEventOut]:
    """Tai su kien lich trong [start, end] tu mock_data (mock-first)."""
    try:
        raw = json.loads(MOCK_CALENDAR_PATH.read_text(encoding="utf-8"))
        result = []
        for e in raw:
            try:
                d = date.fromisoformat(e["date"])
                if start <= d <= end:
                    result.append(schemas.CalendarEventOut(
                        date=e["date"],
                        title=e.get("title", ""),
                        hours=_parse_duration_hours(e.get("duration", "1h")),
                    ))
            except (ValueError, KeyError):
                pass
        return sorted(result, key=lambda x: x.date)
    except Exception:
        return []


def _count_weekdays(start: date, end: date) -> int:
    """So ngay lam viec (Thu 2 – Thu 6) trong [start, end]."""
    count = 0
    d = start
    while d <= end:
        if d.weekday() < 5:
            count += 1
        d += timedelta(days=1)
    return count


@router.get("", response_model=schemas.BurnoutOut)
def check_burnout(current_user: CurrentUser, db: Session = Depends(get_db)):
    today = date.today()
    horizon_end = today + timedelta(days=HORIZON_DAYS)

    # --- 1. Uoc tinh gio can ---
    kpis = kpi_service.get_active_kpis(db, current_user.id)

    # Dau viec dang cho / dang lam (da xac nhan)
    pending_items = list(db.scalars(
        select(models.WorkItem).where(
            models.WorkItem.user_id == current_user.id,
            models.WorkItem.confirmed == True,  # noqa: E712
            models.WorkItem.status.in_(["se_lam", "dang_lam"]),
        )
    ))
    pending_count = len(pending_items)
    pending_hours = round(pending_count * HOURS_PER_WORK_ITEM, 1)

    # KPI chua co dau viec pending: uoc tinh tu phan tram con lai
    kpi_ids_with_pending = {w.kpi_id for w in pending_items if w.kpi_id}
    gap_hours = 0.0
    for k in kpis:
        if k.id in kpi_ids_with_pending:
            continue
        remaining_pct = max(0.0, 100.0 - k.progress)
        gap_hours += remaining_pct * GAP_HOURS_PER_PCT
    gap_hours = round(gap_hours, 1)

    hours_needed = round(pending_hours + gap_hours, 1)

    # --- 2. Quy thoi gian trong ---
    calendar_events = _load_calendar_events(today, horizon_end)
    calendar_hours = round(sum(e.hours for e in calendar_events), 1)
    weekdays = _count_weekdays(today, horizon_end)
    total_work_hours = weekdays * HOURS_PER_DAY
    free_hours = round(max(0.0, total_work_hours - calendar_hours), 1)

    # --- 3. Muc rui ro ---
    if hours_needed <= free_hours * 0.6:
        risk_level = "safe"
    elif hours_needed <= free_hours:
        risk_level = "warning"
    else:
        risk_level = "danger"

    # --- 4. Chi tiet ---
    detail = [
        f"{pending_count} đầu việc đang chờ (~{pending_hours}h ước tính)",
        f"{len(kpis)} KPI đang theo dõi, ước tính thêm ~{gap_hours}h cho phần chưa lên kế hoạch",
        f"{weekdays} ngày làm việc trong {HORIZON_DAYS} ngày tới — {total_work_hours}h tổng quỹ giờ",
        f"{len(calendar_events)} sự kiện lịch chiếm ~{calendar_hours}h",
        f"Quỹ giờ còn trống ước tính: {free_hours}h",
    ]

    return schemas.BurnoutOut(
        risk_level=risk_level,
        hours_needed=hours_needed,
        free_hours=free_hours,
        horizon_days=HORIZON_DAYS,
        calendar_hours=calendar_hours,
        pending_items=pending_count,
        detail=detail,
        calendar_events=calendar_events,
    )
