"""Logic tinh tien do, suc khoe KPI, dashboard va xac nhan dau viec."""
import calendar
from datetime import date, timedelta

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from .. import models, schemas
from ..agent import memory as agent_memory


def normalize_cadence(cadence: str | None) -> str:
    return cadence if cadence in schemas.KPI_CADENCES else "monthly"


def period_window(day: date, cadence: str | None) -> tuple[str, str, date, date]:
    period_type = normalize_cadence(cadence)
    if period_type == "weekly":
        iso = day.isocalendar()
        start = day - timedelta(days=iso.weekday - 1)
        end = start + timedelta(days=6)
        return period_type, f"{iso.year}-W{iso.week:02d}", start, end
    if period_type == "quarterly":
        quarter = (day.month - 1) // 3 + 1
        start_month = (quarter - 1) * 3 + 1
        end_month = start_month + 2
        start = date(day.year, start_month, 1)
        end = date(day.year, end_month, calendar.monthrange(day.year, end_month)[1])
        return period_type, f"{day.year}-Q{quarter}", start, end
    start = date(day.year, day.month, 1)
    end = date(day.year, day.month, calendar.monthrange(day.year, day.month)[1])
    return "monthly", f"{day.year}-{day.month:02d}", start, end


def period_window_from_key(period_type: str | None, period_key: str | None, fallback: date | None = None) -> tuple[str, str, date, date]:
    fallback = fallback or date.today()
    period_type = normalize_cadence(period_type)
    key = (period_key or "").strip()
    if not key:
        return period_window(fallback, period_type)
    try:
        if period_type == "weekly":
            year, week = key.split("-W", 1)
            start = date.fromisocalendar(int(year), int(week), 1)
            return period_type, f"{int(year)}-W{int(week):02d}", start, start + timedelta(days=6)
        if period_type == "quarterly":
            year, quarter = key.split("-Q", 1)
            q = int(quarter)
            start_month = (q - 1) * 3 + 1
            end_month = start_month + 2
            start = date(int(year), start_month, 1)
            end = date(int(year), end_month, calendar.monthrange(int(year), end_month)[1])
            return period_type, f"{int(year)}-Q{q}", start, end
        year, month = key.split("-", 1)
        start = date(int(year), int(month), 1)
        end = date(int(year), int(month), calendar.monthrange(int(year), int(month))[1])
        return "monthly", f"{int(year)}-{int(month):02d}", start, end
    except Exception:
        return period_window(fallback, period_type)


def metric_source_from_work_source(source: str | None) -> str:
    source = (source or "").strip().lower()
    if source in {"gmail", "calendar", "sheets", "notion", "slack", "outlook"}:
        return "api_sync"
    if source in {"csv", "upload"}:
        return "import"
    if source in {"chat", "agent_loop"}:
        return "agent_auto"
    return "manual"


def attainment_pct(actual_value: float, target_value: float) -> float:
    if target_value <= 0:
        return 0.0
    return round(actual_value / target_value * 100, 1)


def _period_metric(
    db: Session,
    kpi: models.KPI,
    period_type: str,
    period_key: str,
    period_start: date,
    period_end: date,
) -> models.KPIPeriodMetric:
    metric = db.scalars(
        select(models.KPIPeriodMetric).where(
            models.KPIPeriodMetric.kpi_id == kpi.id,
            models.KPIPeriodMetric.period_key == period_key,
        )
    ).first()
    if metric:
        return metric
    metric = models.KPIPeriodMetric(
        user_id=kpi.user_id,
        kpi_id=kpi.id,
        period_type=period_type,
        period_key=period_key,
        period_start=period_start,
        period_end=period_end,
        target_value=kpi.target_value or 1.0,
        actual_value=0.0,
        attainment_pct=0.0,
        source_type="manual",
        confirmed=True,
    )
    db.add(metric)
    return metric


def record_period_delta(db: Session, kpi: models.KPI | None, work_item: models.WorkItem, delta: float | None = None) -> None:
    if not kpi:
        return
    value = work_item.progress_delta if delta is None else delta
    if not value:
        return
    ref_date = work_item.work_date or (work_item.created_at.date() if work_item.created_at else date.today())
    period_type, period_key, start, end = period_window(ref_date, kpi.cadence)
    metric = _period_metric(db, kpi, period_type, period_key, start, end)
    metric.actual_value = max(0.0, round((metric.actual_value or 0.0) + value, 2))
    if not metric.target_value:
        metric.target_value = kpi.target_value or 1.0
    metric.attainment_pct = attainment_pct(metric.actual_value, metric.target_value)
    metric.source_type = metric_source_from_work_source(work_item.source)
    if work_item.source_ref:
        metric.source_ref = work_item.source_ref[:500]
    metric.confirmed = True


def list_period_metrics(db: Session, kpi: models.KPI) -> list[models.KPIPeriodMetric]:
    return list(
        db.scalars(
            select(models.KPIPeriodMetric)
            .where(models.KPIPeriodMetric.kpi_id == kpi.id)
            .order_by(models.KPIPeriodMetric.period_start.desc())
        )
    )


def upsert_period_metric(
    db: Session,
    kpi: models.KPI,
    payload: schemas.KPIPeriodMetricUpsert,
) -> models.KPIPeriodMetric:
    period_type, period_key, start, end = period_window_from_key(
        payload.period_type or kpi.cadence,
        payload.period_key,
    )
    metric = _period_metric(db, kpi, period_type, period_key, start, end)
    metric.period_type = period_type
    metric.period_key = period_key
    metric.period_start = start
    metric.period_end = end
    metric.target_value = payload.target_value
    metric.actual_value = payload.actual_value
    metric.attainment_pct = attainment_pct(metric.actual_value, metric.target_value)
    # This endpoint is manual user input. Imported/API/agent sources are assigned by
    # record_period_delta so users cannot manually rewrite provenance.
    metric.source_type = "manual"
    metric.source_ref = ""
    metric.confirmed = payload.confirmed
    db.commit()
    db.refresh(metric)
    return metric


def expected_progress(kpi: models.KPI, today: date | None = None) -> float:
    """% tien do ky vong.

    Uu tien KE HOACH SMART: neu KPI da phan ra muc tieu thang, ky vong = noi suy
    giua % cong don cuoi thang truoc va cuoi thang nay theo so ngay da troi qua
    trong thang. Chua phan ra -> fallback tuyen tinh theo thoi gian (planned value).
    """
    today = today or date.today()
    start = date(kpi.year, 1, 1)
    end = kpi.deadline or date(kpi.year, 12, 31)
    if today <= start:
        return 0.0
    if today >= end:
        return 100.0

    # ke hoach thang tu phan ra SMART: {(nam, thang): % cong don cuoi thang}
    months: dict[tuple[int, int], float] = {}
    for sg in kpi.sub_goals:
        if sg.period_type != "month":
            continue
        try:
            y, m = int(sg.period_label[:4]), int(sg.period_label[5:7])
        except (ValueError, IndexError):
            continue
        months[(y, m)] = max(months.get((y, m), 0.0), sg.expected_progress)
    if months:
        cur_key = (today.year, today.month)
        prev_val = 0.0
        cur_val = None
        for k in sorted(months):
            if k < cur_key:
                prev_val = months[k]
            elif k == cur_key:
                cur_val = months[k]
        if cur_val is not None:
            days_in_month = calendar.monthrange(today.year, today.month)[1]
            frac = today.day / days_in_month
            return round(min(100.0, prev_val + (cur_val - prev_val) * frac), 1)
        # thang nay khong co trong ke hoach -> giu muc cong don cua thang gan nhat truoc do
        return round(min(100.0, prev_val), 1)

    total = (end - start).days or 1
    return round((today - start).days / total * 100, 1)


def health_of(kpi: models.KPI, today: date | None = None) -> tuple[str, float]:
    exp = expected_progress(kpi, today)
    gap = round(kpi.progress - exp, 1)
    warning = float(getattr(kpi, "warning_threshold", 80.0) or 80.0)
    critical = float(getattr(kpi, "critical_threshold", 70.0) or 70.0)
    if critical > warning:
        critical = warning
    if exp <= 0:
        return "green", gap
    expected_attainment = kpi.progress / exp * 100
    if expected_attainment < critical:
        return "red", gap
    if expected_attainment < warning:
        return "yellow", gap
    return "green", gap


def get_active_kpis(
    db: Session, user_id: int = 1, cycle_id: int | None = None, category: str | None = None
) -> list[models.KPI]:
    q = select(models.KPI).where(
        models.KPI.user_id == user_id, models.KPI.archived == False  # noqa: E712
    )
    if category in schemas.KPI_CATEGORIES:
        q = q.where(models.KPI.category == category)
    if cycle_id is not None:
        q = (
            q.join(models.Objective, models.KPI.objective_id == models.Objective.id)
            .where(
                models.Objective.user_id == user_id,
                models.Objective.archived == False,  # noqa: E712
                models.Objective.cycle_id == cycle_id,
            )
        )
    return list(db.scalars(q))


def _group_progress(kpis: list[models.KPI], category: str | None = None) -> float:
    """Tien do nhom = trung binh co trong so cua KPI con, moi KPI cap 100% (chuan OKR)."""
    kpis = [k for k in kpis if not k.archived]
    if category in schemas.KPI_CATEGORIES:
        kpis = [k for k in kpis if (k.category or "Work") == category]
    total_w = sum(k.weight for k in kpis)
    if total_w > 0:
        return round(sum(k.progress_capped * k.weight for k in kpis) / total_w, 1)
    if kpis:
        return round(sum(k.progress_capped for k in kpis) / len(kpis), 1)
    return 0.0


def objectives_with_progress(
    db: Session, user_id: int = 1, cycle_id: int | None = None, category: str | None = None
) -> list[schemas.ObjectiveOut]:
    """Danh sach Objective kem tien do tong hop tu KPI con."""
    q = select(models.Objective).where(
        models.Objective.user_id == user_id,
        models.Objective.archived == False,  # noqa: E712
    )
    if category in schemas.KPI_CATEGORIES:
        q = q.where(models.Objective.category == category)
    if cycle_id is not None:
        q = q.where(models.Objective.cycle_id == cycle_id)
    objs = list(db.scalars(q))
    out = []
    for o in objs:
        item = schemas.ObjectiveOut.model_validate(o)
        item.progress = _group_progress(o.kpis, category=category)
        item.kpi_count = len([
            k for k in o.kpis
            if not k.archived and (category not in schemas.KPI_CATEGORIES or (k.category or "Work") == category)
        ])
        out.append(item)
    return out


def overall_progress(
    db: Session, user_id: int = 1, cycle_id: int | None = None, category: str | None = "Work"
) -> float:
    """Diem tong nam = trung binh co trong so theo Objective.

    KPI chua gan muc tieu duoc gop vao nhom ao "Khac" dung phan trong so con lai
    (100% - tong trong so Objective) de khong KPI nao bi bo sot.
    """
    objs = objectives_with_progress(db, user_id, cycle_id=cycle_id, category=category)
    ungrouped = [] if cycle_id is not None else [
        k for k in get_active_kpis(db, user_id, category=category) if k.objective_id is None
    ]
    total = sum(o.weight * o.progress for o in objs)
    denom = sum(o.weight for o in objs)
    if ungrouped:
        khac_weight = max(0.0, 100.0 - denom)
        if khac_weight > 0:
            total += khac_weight * _group_progress(ungrouped, category=category)
            denom += khac_weight
    if denom <= 0:
        # chua phan bo trong so nao -> trung binh don gian
        kpis = get_active_kpis(db, user_id, cycle_id=cycle_id, category=category)
        return _group_progress(kpis, category=category) if kpis else 0.0
    return round(total / denom, 1)


def _score_tone(score: float) -> str:
    if score < 70:
        return "red"
    if score < 90:
        return "yellow"
    return "green"


def _dashboard_period_label(period_type: str, period_key: str, period_start: date) -> str:
    if period_type == "weekly":
        return period_key.replace("-", " ")
    if period_type == "quarterly":
        return period_key.replace("-", " ")
    return period_start.strftime("%b")


def _dashboard_fallback_periods(
    current_score: float,
    limit: int = 6,
) -> list[schemas.DashboardPerformancePoint]:
    today = date.today()
    base = max(0.0, current_score - 18.0)
    out = []
    prev_score: float | None = None
    for i in range(limit - 1, -1, -1):
        month = today.month - i
        year = today.year
        while month <= 0:
            month += 12
            year -= 1
        start = date(year, month, 1)
        progress = 0 if limit <= 1 else (limit - 1 - i) / (limit - 1)
        score = round(max(0.0, min(100.0, base + (current_score - base) * progress)), 1)
        delta = None if prev_score is None else round(score - prev_score, 1)
        out.append(
            schemas.DashboardPerformancePoint(
                label=start.strftime("%b"),
                period_key=f"{year}-{month:02d}",
                actual=score,
                target=100.0,
                attainment_pct=score,
                weighted_score=score,
                delta_pct=delta,
                severity=_score_tone(score),
                is_estimated=True,
            )
        )
        prev_score = score
    return out


def _dashboard_performance_periods(
    db: Session,
    kpis: list[models.KPI],
    current_score: float,
    limit: int = 6,
) -> list[schemas.DashboardPerformancePoint]:
    if not kpis:
        return []
    ids = [k.id for k in kpis]
    weight_by_kpi = {k.id: (k.weight if k.weight > 0 else 1.0) for k in kpis}
    rows = list(
        db.scalars(
            select(models.KPIPeriodMetric)
            .where(
                models.KPIPeriodMetric.kpi_id.in_(ids),
                models.KPIPeriodMetric.confirmed == True,  # noqa: E712
            )
            .order_by(models.KPIPeriodMetric.period_start.asc())
        )
    )

    if rows:
        grouped: dict[str, list[models.KPIPeriodMetric]] = {}
        meta: dict[str, tuple[str, str, date]] = {}
        for m in rows:
            key = f"{m.period_type}:{m.period_key}"
            grouped.setdefault(key, []).append(m)
            cur = meta.get(key)
            if cur is None or m.period_start < cur[2]:
                meta[key] = (m.period_type, m.period_key, m.period_start)

        period_keys = sorted(grouped, key=lambda key: meta[key][2])[-limit:]
        if len(period_keys) < 2:
            return _dashboard_fallback_periods(current_score, limit)
        out: list[schemas.DashboardPerformancePoint] = []
        prev_score: float | None = None
        for key in period_keys:
            items = grouped[key]
            denom = sum(weight_by_kpi.get(m.kpi_id, 1.0) for m in items) or len(items) or 1.0
            score = round(
                sum((m.attainment_pct or 0.0) * weight_by_kpi.get(m.kpi_id, 1.0) for m in items) / denom,
                1,
            )
            period_type, period_key, start = meta[key]
            delta = None if prev_score is None else round(score - prev_score, 1)
            out.append(
                schemas.DashboardPerformancePoint(
                    label=_dashboard_period_label(period_type, period_key, start),
                    period_key=period_key,
                    actual=score,
                    target=100.0,
                    attainment_pct=score,
                    weighted_score=score,
                    delta_pct=delta,
                    severity=_score_tone(score),
                )
            )
            prev_score = score
        return out

    # Honest fallback for first-time users without enough period ledger yet.
    return _dashboard_fallback_periods(current_score, limit)


def _dashboard_output_metrics(
    statuses: list[schemas.KPIStatus],
    current_score: float,
    periods: list[schemas.DashboardPerformancePoint],
) -> list[schemas.DashboardMetricCard]:
    total = len(statuses)
    on_track = len([s for s in statuses if s.health == "green"])
    target_hits = len([s for s in statuses if s.kpi.progress >= 100])
    at_risk = len([s for s in statuses if s.health in {"yellow", "red"}])
    prev = periods[-2].weighted_score if len(periods) >= 2 else None
    delta = None if prev is None else round(current_score - prev, 1)
    on_track_pct = round(on_track / total * 100, 1) if total else 0.0
    target_achievement = round(target_hits / total * 100, 1) if total else 0.0
    at_risk_pct = round(at_risk / total * 100, 1) if total else 0.0
    return [
        schemas.DashboardMetricCard(
            key="overall_score",
            value=current_score,
            value_text=f"{current_score:g}%",
            unit="%",
            delta_pct=delta,
            tone=_score_tone(current_score),
            detail="weighted_attainment",
            action="reports",
        ),
        schemas.DashboardMetricCard(
            key="on_track",
            value=on_track_pct,
            value_text=f"{on_track}/{total}",
            unit="kpis",
            delta_pct=None,
            tone="green" if on_track_pct >= 70 else "yellow" if on_track_pct >= 45 else "red",
            detail="on_track_count",
            action="filter_on_track",
        ),
        schemas.DashboardMetricCard(
            key="target_achievement",
            value=target_achievement,
            value_text=f"{target_achievement:g}%",
            unit="%",
            delta_pct=None,
            tone=_score_tone(target_achievement),
            detail="target_hits",
            action="kpis",
        ),
        schemas.DashboardMetricCard(
            key="at_risk",
            value=at_risk_pct,
            value_text=f"{at_risk}",
            unit="kpis",
            delta_pct=None,
            tone="red" if at_risk else "green",
            detail="at_risk_count",
            action="open_risks",
        ),
    ]


def _dashboard_category_progress(
    objectives: list[schemas.ObjectiveOut],
    statuses: list[schemas.KPIStatus],
) -> list[schemas.DashboardCategoryPoint]:
    rows: list[schemas.DashboardCategoryPoint] = []
    for o in objectives:
        kids = [s for s in statuses if s.kpi.objective_id == o.id]
        risk_count = len([s for s in kids if s.health in {"yellow", "red"}])
        rows.append(
            schemas.DashboardCategoryPoint(
                key=f"objective:{o.id}",
                name=o.name,
                attainment_pct=round(o.progress or 0.0, 1),
                kpi_count=len(kids),
                at_risk_count=risk_count,
                tone=_score_tone(o.progress or 0.0),
                objective_id=o.id,
            )
        )
    if not rows and statuses:
        avg = round(sum(s.kpi.progress_capped for s in statuses) / len(statuses), 1)
        rows.append(
            schemas.DashboardCategoryPoint(
                key="all",
                name="All KPIs",
                attainment_pct=avg,
                kpi_count=len(statuses),
                at_risk_count=len([s for s in statuses if s.health in {"yellow", "red"}]),
                tone=_score_tone(avg),
                objective_id=None,
            )
        )
    return sorted(rows, key=lambda r: (r.attainment_pct, -r.at_risk_count))[:6]


def _dashboard_at_risk_items(
    db: Session,
    statuses: list[schemas.KPIStatus],
) -> list[schemas.DashboardRiskItem]:
    risk_statuses = [
        s for s in statuses
        if s.health in {"yellow", "red"} or s.gap < 0
    ]
    risk_statuses.sort(
        key=lambda s: (
            {"red": 0, "yellow": 1, "green": 2}.get(s.health, 3),
            -abs(s.gap) * max(1.0, s.kpi.weight or 0.0),
        )
    )
    ids = [s.kpi.id for s in risk_statuses]
    metric_by_kpi: dict[int, list[models.KPIPeriodMetric]] = {}
    if ids:
        for m in db.scalars(
            select(models.KPIPeriodMetric)
            .where(
                models.KPIPeriodMetric.kpi_id.in_(ids),
                models.KPIPeriodMetric.confirmed == True,  # noqa: E712
            )
            .order_by(models.KPIPeriodMetric.period_start.asc())
        ):
            metric_by_kpi.setdefault(m.kpi_id, []).append(m)

    out: list[schemas.DashboardRiskItem] = []
    for s in risk_statuses[:8]:
        history = metric_by_kpi.get(s.kpi.id, [])
        if len(history) >= 2:
            velocity = round((history[-1].attainment_pct or 0.0) - (history[-2].attainment_pct or 0.0), 1)
        else:
            velocity = round(s.kpi.progress - s.expected_progress, 1)
        projected = round(max(0.0, min(200.0, s.kpi.progress + velocity)), 1)
        out.append(
            schemas.DashboardRiskItem(
                kpi_id=s.kpi.id,
                name=s.kpi.name,
                objective_name=s.kpi.objective_name or "",
                attainment_pct=round(s.kpi.progress, 1),
                expected_progress=round(s.expected_progress, 1),
                gap=round(s.gap, 1),
                velocity_pct=velocity,
                projected_progress=projected,
                conflict_score=None,
                deadline=s.kpi.deadline,
                severity=s.health,
            )
        )
    return out


def build_dashboard(
    db: Session, user_id: int = 1, cycle_id: int | None = None, category: str | None = "Work"
) -> schemas.DashboardOut:
    cycle = db.get(models.KPICycle, cycle_id) if cycle_id is not None else None
    category = category if category in schemas.KPI_CATEGORIES else None
    kpis = get_active_kpis(db, user_id, cycle_id=cycle_id, category=category)
    today = date.today()
    statuses: list[schemas.KPIStatus] = []
    warnings: list[str] = []

    for k in kpis:
        health, gap = health_of(k, today)
        exp = expected_progress(k, today)
        statuses.append(
            schemas.KPIStatus(
                kpi=schemas.KPIOut.model_validate(k),
                expected_progress=exp,
                health=health,
                gap=gap,
            )
        )
        if k.objective_id is None:
            warnings.append(
                f"KPI \"{k.name}\" chưa được gắn vào mục tiêu (Objective) nào — "
                f"đang tính điểm qua nhóm \"Khác\"."
            )
        if health == "red":
            warnings.append(
                f"KPI \"{k.name}\" đang chậm {abs(gap):.0f}% so với kế hoạch "
                f"(thực tế {k.progress:.0f}% / kỳ vọng {exp:.0f}%)."
            )
        elif health == "yellow":
            warnings.append(
                f"KPI \"{k.name}\" cần chú ý: chậm {abs(gap):.0f}% so với kế hoạch."
            )

    counts: dict[str, int] = {s: 0 for s in schemas.WORK_STATUSES}
    item_filter = [
        models.WorkItem.user_id == user_id,
        models.WorkItem.confirmed == True,  # noqa: E712
    ]
    if category == "Work":
        item_filter.append(or_(models.WorkItem.kpi_id.is_(None), models.KPI.category == category))
    elif category == "Personal":
        item_filter.append(models.KPI.category == category)
    item_status_q = select(models.WorkItem.status, func.count()).outerjoin(
        models.KPI, models.WorkItem.kpi_id == models.KPI.id
    ).where(*item_filter).group_by(models.WorkItem.status)
    for status_value, cnt in db.execute(item_status_q).all():
        counts[status_value] = cnt

    recent = list(
        db.scalars(
            select(models.WorkItem)
            .outerjoin(models.KPI, models.WorkItem.kpi_id == models.KPI.id)
            .where(*item_filter)
            .order_by(models.WorkItem.created_at.desc())
            .limit(10)
        )
    )

    # viec can lam: se lam (uu tien hien truoc) + dang lam
    todos = list(
        db.scalars(
            select(models.WorkItem)
            .outerjoin(models.KPI, models.WorkItem.kpi_id == models.KPI.id)
            .where(
                *item_filter,
                models.WorkItem.status.in_(["se_lam", "dang_lam"]),
                )
            .order_by(models.WorkItem.work_date.asc().nullslast(), models.WorkItem.created_at.asc())
            .limit(20)
        )
    )
    todos.sort(key=lambda w: 0 if w.status == "se_lam" else 1)

    # nhip ghi nhan 8 tuan gan nhat (theo ngay thuc hien viec)
    all_items = list(
        db.scalars(
            select(models.WorkItem)
            .outerjoin(models.KPI, models.WorkItem.kpi_id == models.KPI.id)
            .where(*item_filter)
        )
    )
    this_monday = today - timedelta(days=today.weekday())
    weekly = []
    for i in range(7, -1, -1):
        wk_start = this_monday - timedelta(weeks=i)
        wk_end = wk_start + timedelta(days=6)
        count = sum(
            1 for w in all_items
            if wk_start <= (w.work_date or w.created_at.date()) <= wk_end
        )
        weekly.append({"label": wk_start.strftime("%d/%m"), "count": count})

    statuses.sort(key=lambda s: {"red": 0, "yellow": 1, "green": 2}[s.health])
    overall = overall_progress(db, user_id, cycle_id=cycle_id, category=category)
    objectives = objectives_with_progress(db, user_id, cycle_id=cycle_id, category=category)
    performance_periods = _dashboard_performance_periods(db, kpis, overall)
    output_metrics = _dashboard_output_metrics(statuses, overall, performance_periods)
    category_progress = _dashboard_category_progress(objectives, statuses)
    at_risk_items = _dashboard_at_risk_items(db, statuses)
    return schemas.DashboardOut(
        year=(
            cycle.start_date.year
            if cycle and cycle.start_date
            else (kpis[0].year if kpis else today.year)
        ),
        overall_progress=overall,
        objectives=objectives,
        kpi_statuses=statuses,
        warnings=warnings,
        counts_by_status=counts,
        recent_items=[schemas.WorkItemOut.model_validate(w) for w in recent],
        todo_items=[schemas.WorkItemOut.model_validate(w) for w in todos],
        weekly_activity=weekly,
        output_metrics=output_metrics,
        performance_periods=performance_periods,
        category_progress=category_progress,
        at_risk_items=at_risk_items,
    )


def forecast_kpi(
        db: Session, kpi: models.KPI, today: date | None = None
) -> schemas.KPIForecastOut:
    """Du bao kha nang hoan thanh KPI bang AI Predictive Runrate.

    Van toc = tong tien do thuc dat / so ngay da hoat dong (tu dau viec dau tien).
    Du bao = thuc dat hien tai + van toc * so ngay con lai den deadline.
    Tra ve them 3 chuoi de ve bieu do: thuc te / ky vong (ke hoach) / du bao.
    """
    today = today or date.today()
    start = date(kpi.year, 1, 1)
    end = kpi.deadline or date(kpi.year, 12, 31)
    target = kpi.target_value or 1.0

    def pct(v: float) -> float:
        return round(v / target * 100, 1)

    # dau viec da xac nhan, co thay doi gia tri, sap theo ngay thuc hien
    items = list(
        db.scalars(
            select(models.WorkItem).where(
                models.WorkItem.kpi_id == kpi.id,
                models.WorkItem.confirmed == True,  # noqa: E712
            )
        )
    )
    dated: list[tuple[date, float]] = []
    for w in items:
        d = w.work_date or (w.created_at.date() if w.created_at else None)
        if d and w.progress_delta:
            dated.append((d, w.progress_delta))
    dated.sort(key=lambda x: x[0])

    sum_items = round(sum(delta for _, delta in dated), 4)
    # gia tri dau ky khong den tu dau viec (vd nhap tay luc tao KPI)
    baseline = round(kpi.current_value - sum_items, 4)

    # chuoi thuc te tich luy: bat dau o baseline -> cong tung dau viec -> chot o current that
    actual_series = [schemas.ForecastPoint(date=start, value=max(0.0, pct(baseline)))]
    running = baseline
    for d, delta in dated:
        if d > today:
            continue
        running = round(running + delta, 4)
        actual_series.append(schemas.ForecastPoint(date=max(d, start), value=pct(running)))
    if actual_series[-1].date == today:
        actual_series[-1] = schemas.ForecastPoint(date=today, value=pct(kpi.current_value))
    else:
        actual_series.append(schemas.ForecastPoint(date=today, value=pct(kpi.current_value)))

    # van toc theo gia tri/ngay tren khoang da hoat dong
    has_history = len(dated) >= 1
    vel_start = max(start, dated[0][0]) if has_history else start
    gained = max(0.0, round(kpi.current_value - baseline, 4))  # tien do thuc su tao ra
    elapsed = max(1, (today - vel_start).days)
    daily_velocity = round(gained / elapsed, 4)

    days_remaining = max(0, (end - today).days)
    forecast_value = round(kpi.current_value + daily_velocity * days_remaining, 2)
    forecast_progress = pct(forecast_value)

    eta_date: date | None = None
    if kpi.current_value < target and daily_velocity > 0:
        days_to = (target - kpi.current_value) / daily_velocity
        if days_to >= 0:
            eta_date = today + timedelta(days=min(3650, int(round(days_to))))

    on_track = forecast_progress >= 99.5
    forecast_health = "green" if on_track else ("yellow" if forecast_progress >= 85 else "red")

    forecast_series = [
        schemas.ForecastPoint(date=today, value=pct(kpi.current_value)),
        schemas.ForecastPoint(date=end, value=forecast_progress),
    ]

    # duong ke hoach/ky vong: lay mau theo dau moi thang
    expected_series: list[schemas.ForecastPoint] = []
    cur = start
    while cur <= end:
        expected_series.append(schemas.ForecastPoint(date=cur, value=expected_progress(kpi, cur)))
        cur = date(cur.year + (1 if cur.month == 12 else 0), 1 if cur.month == 12 else cur.month + 1, 1)
    if not expected_series or expected_series[-1].date != end:
        expected_series.append(schemas.ForecastPoint(date=end, value=expected_progress(kpi, end)))

    return schemas.KPIForecastOut(
        kpi_id=kpi.id,
        kpi_name=kpi.name,
        unit=kpi.unit,
        target_value=kpi.target_value,
        current_value=kpi.current_value,
        current_progress=kpi.progress,
        daily_velocity=daily_velocity,
        forecast_value=forecast_value,
        forecast_progress=forecast_progress,
        days_remaining=days_remaining,
        eta_date=eta_date,
        on_track=on_track,
        forecast_health=forecast_health,
        has_history=has_history,
        actual_series=actual_series,
        expected_series=expected_series,
        forecast_series=forecast_series,
    )


def _valid_user_kpi(db: Session, kpi_id: int | None, user_id: int) -> models.KPI | None:
    if not kpi_id:
        return None
    candidate = db.get(models.KPI, kpi_id)
    if candidate and candidate.user_id == user_id and not candidate.archived:
        return candidate
    return None


def _alternative_kpis_payload(item: schemas.ProposedWorkItem) -> list[dict] | None:
    if not item.alternative_kpis:
        return None
    return [a.model_dump() for a in item.alternative_kpis]


def _status_or_default(status: str | None) -> str:
    return status if status in schemas.WORK_STATUSES else "da_lam"


def _apply_progress_from_work_item(db: Session, work_item: models.WorkItem, kpi: models.KPI | None):
    if not kpi or not work_item.progress_delta:
        return
    old_value = kpi.current_value
    new_value = max(0.0, round(kpi.current_value + work_item.progress_delta, 2))
    kpi.current_value = new_value
    db.add(
        models.KPIChangeLog(
            kpi_id=kpi.id,
            field="current_value",
            old_value=str(old_value),
            new_value=str(new_value),
            reason=f'Ghi nhận đầu việc "{work_item.title}"',
        )
    )
    record_period_delta(db, kpi, work_item)


def _work_item_from_proposed(
    db: Session,
    item: schemas.ProposedWorkItem,
    user_id: int,
    confirmed: bool,
) -> models.WorkItem:
    kpi = _valid_user_kpi(db, item.kpi_id, user_id)
    return models.WorkItem(
        user_id=user_id,
        kpi_id=kpi.id if kpi else None,
        title=item.title,
        detail=item.detail,
        status=_status_or_default(item.status),
        progress_delta=item.value_delta,
        source=item.source,
        source_ref=item.source_ref,
        work_date=item.work_date,
        mapping_reason=item.mapping_reason or "",
        confidence=item.confidence,
        alternative_kpis=_alternative_kpis_payload(item),
        confirmed=confirmed,
    )


def create_draft_items(
    db: Session,
    items: list[schemas.ProposedWorkItem],
    user_id: int = 1,
    commit: bool = True,
) -> list[models.WorkItem]:
    """Luu nhap Work Journal tu agent/connector, chua cong tien do KPI."""
    saved: list[models.WorkItem] = []
    for item in items:
        wi = _work_item_from_proposed(db, item, user_id, confirmed=False)
        db.add(wi)
        saved.append(wi)
    if commit:
        db.commit()
        for wi in saved:
            db.refresh(wi)
    else:
        db.flush()
    return saved


def update_draft_item_from_proposed(
    db: Session,
    work_item: models.WorkItem,
    item: schemas.ProposedWorkItem,
    user_id: int = 1,
    commit: bool = True,
) -> models.WorkItem:
    """Cap nhat nhap truoc khi nguoi dung xac nhan."""
    kpi = _valid_user_kpi(db, item.kpi_id, user_id)
    work_item.kpi_id = kpi.id if kpi else None
    work_item.title = item.title
    work_item.detail = item.detail
    work_item.status = _status_or_default(item.status)
    work_item.progress_delta = item.value_delta
    work_item.source = item.source
    work_item.source_ref = item.source_ref
    work_item.work_date = item.work_date
    work_item.mapping_reason = item.mapping_reason or ""
    work_item.confidence = item.confidence
    work_item.alternative_kpis = _alternative_kpis_payload(item)
    if commit:
        db.commit()
        db.refresh(work_item)
    else:
        db.flush()
    return work_item


def confirm_draft_item(
    db: Session,
    work_item: models.WorkItem,
    user_id: int = 1,
    commit: bool = True,
) -> models.WorkItem:
    """Chuyen nhap Journal thanh bang chung chinh thuc va cong tien do KPI."""
    kpi = _valid_user_kpi(db, work_item.kpi_id, user_id)
    if kpi is None:
        work_item.kpi_id = None
    work_item.confirmed = True
    work_item.status = _status_or_default(work_item.status)
    _apply_progress_from_work_item(db, work_item, kpi)
    if commit:
        db.commit()
        db.refresh(work_item)
    else:
        db.flush()
    return work_item


def confirm_items(
        db: Session, items: list[schemas.ProposedWorkItem], user_id: int = 1
) -> list[models.WorkItem]:
    """Luu dau viec da xac nhan va cong tien do vao KPI tuong ung."""
    saved: list[models.WorkItem] = []
    for it in items:
        kpi = _valid_user_kpi(db, it.kpi_id, user_id)
        wi = _work_item_from_proposed(db, it, user_id, confirmed=True)
        db.add(wi)
        _apply_progress_from_work_item(db, wi, kpi)
        if it.original_kpi_id is not None and it.original_kpi_id != (kpi.id if kpi else None):
            old = db.get(models.KPI, it.original_kpi_id)
            old_name = old.name if old else "khong gan KPI"
            new_name = kpi.name if kpi else "khong gan KPI"
            agent_memory.remember_correction(
                db,
                user_id,
                f'Khi dau viec "{it.title}" duoc de xuat gan KPI "{old_name}" nhung user sua sang KPI "{new_name}", uu tien cach gan moi cho cac dau viec tuong tu.',
            )
        if it.original_status and it.original_status != wi.status:
            agent_memory.remember_correction(
                db,
                user_id,
                f'Khi dau viec "{it.title}" duoc de xuat trang thai "{it.original_status}" nhung user sua thanh "{wi.status}", ap dung correction nay cho cac dau viec tuong tu.',
            )
        saved.append(wi)
    db.commit()
    return saved


def kpi_list_text(kpis: list[models.KPI]) -> str:
    """Danh sach KPI dang text cho prompt."""
    if not kpis:
        return "(Chưa có KPI nào)"
    lines = []
    for k in kpis:
        obj = f" | thuộc mục tiêu: {k.objective_name}" if k.objective_name else ""
        lines.append(
            f"- internal_kpi_id={k.id} | display_name=\"{k.name}\" | chỉ tiêu: {k.target or k.description or 'n/a'}{obj} | "
            f"đơn vị đo: \"{k.unit}\" | chỉ tiêu số: {k.target_value:g} | "
            f"thực đạt hiện tại: {k.current_value:g} {k.unit} (= {k.progress:.0f}%) | "
            f"deadline {k.deadline or f'{k.year}-12-31'}"
        )
    return "\n".join(lines)


def period_context_text(
        db: Session, start: date, end: date, period_type: str, user_id: int = 1
) -> str:
    """Boi canh cho bao cao ky: KPI + dau viec TRONG KY + ke hoach sub-goals cua ky do."""
    kpis = get_active_kpis(db, user_id)
    today = date.today()
    parts = ["## Trạng thái KPI hiện tại:"]
    for k in kpis:
        health, gap = health_of(k, today)
        exp = expected_progress(k, today)
        obj = f", mục tiêu \"{k.objective_name}\"" if k.objective_name else ""
        over = " — VƯỢT CHỈ TIÊU" if k.progress > 100 else ""
        parts.append(
            f"- KPI \"{k.name}\": thực đạt {k.current_value:g}/{k.target_value:g} {k.unit} "
            f"= {k.progress:.0f}%{over}, kỳ vọng theo thời gian {exp:.0f}% (lệch {gap:+.0f}%, {health}){obj}"
        )

    # ke hoach da phan ra SMART roi vao ky bao cao
    month_labels = set()
    quarter_labels = set()
    cur = start
    while cur <= end:
        month_labels.add(f"{cur.year}-{cur.month:02d}")
        quarter_labels.add(f"Q{(cur.month - 1) // 3 + 1}")
        cur = date(cur.year + (cur.month // 12), cur.month % 12 + 1, 1)
    parts.append("\n## Kế hoạch đã phân rã SMART rơi vào kỳ này:")
    found_plan = False
    for k in kpis:
        for sg in k.sub_goals:
            label = sg.period_label.strip()
            hit = (
                    (sg.period_type == "month" and label in month_labels)
                    or (sg.period_type == "quarter" and any(q in label for q in quarter_labels))
            )
            if hit:
                found_plan = True
                parts.append(
                    f"- KPI \"{k.name}\" — {label}: {sg.description} "
                    f"(kỳ vọng cộng dồn {sg.expected_progress:.0f}%; thực tế hiện tại {k.progress:.0f}%)"
                )
    if not found_plan:
        parts.append("(Chưa có KPI nào được phân rã SMART cho kỳ này)")

    # dau viec trong ky
    items = list(
        db.scalars(
            select(models.WorkItem)
            .where(
                models.WorkItem.user_id == user_id,
                models.WorkItem.confirmed == True,  # noqa: E712
            )
            .order_by(models.WorkItem.created_at.desc())
            .limit(200)
        )
    )
    parts.append(f"\n## Đầu việc đã ghi nhận trong kỳ ({start} → {end}):")
    count = 0
    for w in items:
        d = w.work_date or w.created_at.date()
        if not (start <= d <= end):
            continue
        count += 1
        kpi_name = w.kpi.name if w.kpi else "không gắn KPI"
        parts.append(
            f"- [{schemas.STATUS_LABELS.get(w.status, w.status)}] {w.title} "
            f"(KPI: {kpi_name}; ngày {d}; nguồn: {w.source}"
            + (f" — {w.source_ref}" if w.source_ref else "")
            + ")"
        )
    if count == 0:
        parts.append("(Không có đầu việc nào trong kỳ)")
    return "\n".join(parts)


def full_context_text(db: Session, user_id: int = 1, category: str | None = None) -> str:
    """Toan bo boi canh KPI + dau viec gan day cho prompt tra loi cau hoi."""
    category = schemas._normalize_category(category) if category is not None else None
    kpis = get_active_kpis(db, user_id, category=category)
    today = date.today()
    parts = ["## KPI năm:"]
    for k in kpis:
        health, gap = health_of(k, today)
        exp = expected_progress(k, today)
        obj = f", thuộc mục tiêu \"{k.objective_name}\"" if k.objective_name else ""
        over = " — VƯỢT CHỈ TIÊU" if k.progress > 100 else ""
        parts.append(
            f"- KPI \"{k.name}\": thực đạt {k.current_value:g}/{k.target_value:g} {k.unit} "
            f"= {k.progress:.0f}%{over} / kỳ vọng theo thời gian {exp:.0f}% "
            f"(lệch {gap:+.0f}%, trạng thái {health}){obj}, "
            f"deadline {k.deadline or f'{k.year}-12-31'}"
        )
    items = list(
        db.scalars(
            select(models.WorkItem)
            .outerjoin(models.KPI, models.WorkItem.kpi_id == models.KPI.id)
            .where(
                models.WorkItem.user_id == user_id,
                models.WorkItem.confirmed == True,  # noqa: E712
                *(
                    [or_(models.WorkItem.kpi_id.is_(None), models.KPI.category == category)]
                    if category == "Work"
                    else ([models.KPI.category == category] if category == "Personal" else [])
                ),
            )
            .order_by(models.WorkItem.created_at.desc())
            .limit(40)
        )
    )
    parts.append("\n## Đầu việc gần đây (mới nhất trước):")
    if not items:
        parts.append("(Chưa có)")
    for w in items:
        kpi_name = w.kpi.name if w.kpi else "không gắn KPI"
        parts.append(
            f"- [{schemas.STATUS_LABELS.get(w.status, w.status)}] {w.title} "
            f"(KPI: {kpi_name}; nguồn: {w.source}"
            + (f" — {w.source_ref}" if w.source_ref else "")
            + (f"; ngày {w.work_date}" if w.work_date else "")
            + (f"; +{w.progress_delta:.0f}%" if w.progress_delta else "")
            + ")"
        )
    return "\n".join(parts)
