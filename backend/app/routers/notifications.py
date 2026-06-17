"""Thong bao chu dong (M3): canh bao dua tren su kien KPI/cong viec.

Tinh server-side trong 1 call (tai dung health_of / forecast_kpi — khong goi LLM).
Trang thai da-doc/da-an luu o client (localStorage) — chong qua tai thong bao.
"""
from datetime import date

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models, schemas
from ..auth import CurrentUser
from ..database import get_db
from ..services import kpi_service

router = APIRouter(prefix="/api/notifications", tags=["notifications"])

_ORDER = {"high": 0, "medium": 1, "low": 2}
DEADLINE_SOON_DAYS = 14


@router.get("", response_model=list[schemas.NotificationOut])
def list_notifications(current_user: CurrentUser, db: Session = Depends(get_db)):
    settings_obj = db.scalars(
        select(models.UserNotificationSettings).where(
            models.UserNotificationSettings.user_id == current_user.id
        )
    ).first()
    if settings_obj and not settings_obj.in_app_enabled:
        return []
    kpis = kpi_service.get_active_kpis(db, current_user.id)
    today = date.today()
    out: list[schemas.NotificationOut] = []

    for k in kpis:
        if k.alert_muted_until and k.alert_muted_until >= today:
            continue
        health, gap = kpi_service.health_of(k, today)
        prog = k.progress
        exp = kpi_service.expected_progress(k, today)
        end = k.deadline or date(k.year, 12, 31)
        days = (end - today).days

        # 1) KPI tut ky vong (vang/do)
        if health in ("yellow", "red"):
            out.append(schemas.NotificationOut(
                id=f"behind:{k.id}:{health}", type="behind",
                severity="high" if health == "red" else "medium",
                title=k.name, kpi_id=k.id,
                params={"gap": round(abs(gap)), "progress": round(prog), "expected": round(exp)},
            ))

        # 2) Sap toi deadline ma chua dat
        if 0 <= days <= DEADLINE_SOON_DAYS and prog < 100:
            out.append(schemas.NotificationOut(
                id=f"deadline:{k.id}", type="deadline",
                severity="high" if days <= 7 else "medium",
                title=k.name, kpi_id=k.id,
                params={"days": days, "progress": round(prog)},
            ))

        # 3) Du bao runrate khong kip (chi khi co lich su dau viec de tin cay)
        try:
            fc = kpi_service.forecast_kpi(db, k, today)
            if fc.has_history and not fc.on_track and days > 0:
                out.append(schemas.NotificationOut(
                    id=f"runrate:{k.id}", type="runrate", severity="medium",
                    title=k.name, kpi_id=k.id,
                    params={"forecast": round(fc.forecast_progress)},
                ))
        except Exception:
            pass  # du bao loi khong duoc chan thong bao khac

        # 4) Trend giam lien tiep theo attainment tung ky (can du lich su period metric)
        trend_n = max(2, min(12, int(k.trend_drop_periods or 3)))
        metrics = sorted(kpi_service.list_period_metrics(db, k), key=lambda m: m.period_start)
        recent = [m for m in metrics if m.confirmed][-trend_n:]
        if len(recent) == trend_n and all(
            recent[i].attainment_pct < recent[i - 1].attainment_pct for i in range(1, len(recent))
        ):
            out.append(schemas.NotificationOut(
                id=f"trend:{k.id}:{recent[-1].period_key}", type="trend", severity="medium",
                title=k.name, kpi_id=k.id,
                params={"periods": trend_n, "attainment": round(recent[-1].attainment_pct)},
            ))

    # 5) Viec can lam qua han
    todos = db.scalars(
        select(models.WorkItem).where(
            models.WorkItem.user_id == current_user.id,
            models.WorkItem.confirmed == True,  # noqa: E712
            models.WorkItem.status.in_(["se_lam", "dang_lam"]),
            models.WorkItem.work_date.isnot(None),
            models.WorkItem.work_date < today,
        )
    )
    for w in todos:
        out.append(schemas.NotificationOut(
            id=f"overdue:{w.id}", type="overdue", severity="medium",
            title=w.title, kpi_id=w.kpi_id,
            params={"days": (today - w.work_date).days},
        ))

    out.sort(key=lambda n: _ORDER.get(n.severity, 9))
    return out
