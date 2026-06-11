"""Logic tinh tien do, suc khoe KPI, dashboard va xac nhan dau viec."""
from datetime import date, datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import models, schemas


def expected_progress(kpi: models.KPI, today: date | None = None) -> float:
    """% tien do ky vong theo thoi gian troi qua (tu dau nam den deadline)."""
    today = today or datetime.now(timezone.utc).date()
    start = date(kpi.year, 1, 1)
    end = kpi.deadline or date(kpi.year, 12, 31)
    if today <= start:
        return 0.0
    if today >= end:
        return 100.0
    total = (end - start).days or 1
    return round((today - start).days / total * 100, 1)


def health_of(kpi: models.KPI, today: date | None = None) -> tuple[str, float]:
    exp = expected_progress(kpi, today)
    gap = round(kpi.progress - exp, 1)
    if gap >= -5:
        return "green", gap
    if gap >= -15:
        return "yellow", gap
    return "red", gap


def get_active_kpis(db: Session, user_id: int = 1) -> list[models.KPI]:
    return list(
        db.scalars(
            select(models.KPI).where(
                models.KPI.user_id == user_id, models.KPI.archived == False  # noqa: E712
            )
        )
    )


def build_dashboard(db: Session, user_id: int = 1) -> schemas.DashboardOut:
    kpis = get_active_kpis(db, user_id)
    today = datetime.now(timezone.utc).date()
    statuses: list[schemas.KPIStatus] = []
    warnings: list[str] = []
    total_weight = sum(k.weight for k in kpis) or len(kpis) or 1

    overall = 0.0
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
        w = k.weight if sum(x.weight for x in kpis) > 0 else 1
        overall += k.progress * w
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
    for status_value, cnt in db.execute(
        select(models.WorkItem.status, func.count())
        .where(models.WorkItem.user_id == user_id, models.WorkItem.confirmed == True)  # noqa: E712
        .group_by(models.WorkItem.status)
    ).all():
        counts[status_value] = cnt

    recent = list(
        db.scalars(
            select(models.WorkItem)
            .where(models.WorkItem.user_id == user_id, models.WorkItem.confirmed == True)  # noqa: E712
            .order_by(models.WorkItem.created_at.desc())
            .limit(10)
        )
    )

    statuses.sort(key=lambda s: {"red": 0, "yellow": 1, "green": 2}[s.health])
    return schemas.DashboardOut(
        year=kpis[0].year if kpis else today.year,
        overall_progress=round(overall / total_weight, 1),
        kpi_statuses=statuses,
        warnings=warnings,
        counts_by_status=counts,
        recent_items=[schemas.WorkItemOut.model_validate(w) for w in recent],
    )


def confirm_items(
    db: Session, items: list[schemas.ProposedWorkItem], user_id: int = 1
) -> list[models.WorkItem]:
    """Luu dau viec da xac nhan va cong tien do vao KPI tuong ung."""
    saved: list[models.WorkItem] = []
    for it in items:
        wi = models.WorkItem(
            user_id=user_id,
            kpi_id=it.kpi_id,
            title=it.title,
            detail=it.detail,
            status=it.status if it.status in schemas.WORK_STATUSES else "da_lam",
            progress_delta=it.progress_delta,
            source=it.source,
            source_ref=it.source_ref,
            work_date=it.work_date,
            confirmed=True,
        )
        db.add(wi)
        if it.kpi_id and it.progress_delta:
            kpi = db.get(models.KPI, it.kpi_id)
            if kpi:
                kpi.progress = min(100.0, round(kpi.progress + it.progress_delta, 1))
        saved.append(wi)
    db.commit()
    return saved


def kpi_list_text(kpis: list[models.KPI]) -> str:
    """Danh sach KPI dang text cho prompt."""
    if not kpis:
        return "(Chưa có KPI nào)"
    lines = []
    for k in kpis:
        lines.append(
            f"- id={k.id} | {k.name} | mục tiêu: {k.target or k.description or 'n/a'} | "
            f"trọng số {k.weight:.0f}% | deadline {k.deadline or f'{k.year}-12-31'} | "
            f"tiến độ hiện tại {k.progress:.0f}%"
        )
    return "\n".join(lines)


def full_context_text(db: Session, user_id: int = 1) -> str:
    """Toan bo boi canh KPI + dau viec gan day cho prompt tra loi cau hoi."""
    kpis = get_active_kpis(db, user_id)
    today = datetime.now(timezone.utc).date()
    parts = ["## KPI năm:"]
    for k in kpis:
        health, gap = health_of(k, today)
        exp = expected_progress(k, today)
        parts.append(
            f"- [{k.id}] {k.name}: tiến độ {k.progress:.0f}% / kỳ vọng {exp:.0f}% "
            f"(lệch {gap:+.0f}%, trạng thái {health}), trọng số {k.weight:.0f}%, "
            f"deadline {k.deadline or f'{k.year}-12-31'}"
        )
    items = list(
        db.scalars(
            select(models.WorkItem)
            .where(models.WorkItem.user_id == user_id, models.WorkItem.confirmed == True)  # noqa: E712
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
