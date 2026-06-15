"""Logic tinh tien do, suc khoe KPI, dashboard va xac nhan dau viec."""
import calendar
from datetime import date, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import models, schemas


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
    if gap >= -5:
        return "green", gap
    if gap >= -15:
        return "yellow", gap
    return "red", gap


def get_active_kpis(
    db: Session, user_id: int = 1, cycle_id: int | None = None
) -> list[models.KPI]:
    q = select(models.KPI).where(
        models.KPI.user_id == user_id, models.KPI.archived == False  # noqa: E712
    )
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


def _group_progress(kpis: list[models.KPI]) -> float:
    """Tien do nhom = trung binh co trong so cua KPI con, moi KPI cap 100% (chuan OKR)."""
    kpis = [k for k in kpis if not k.archived]
    total_w = sum(k.weight for k in kpis)
    if total_w > 0:
        return round(sum(k.progress_capped * k.weight for k in kpis) / total_w, 1)
    if kpis:
        return round(sum(k.progress_capped for k in kpis) / len(kpis), 1)
    return 0.0


def objectives_with_progress(
    db: Session, user_id: int = 1, cycle_id: int | None = None
) -> list[schemas.ObjectiveOut]:
    """Danh sach Objective kem tien do tong hop tu KPI con."""
    q = select(models.Objective).where(
        models.Objective.user_id == user_id,
        models.Objective.archived == False,  # noqa: E712
    )
    if cycle_id is not None:
        q = q.where(models.Objective.cycle_id == cycle_id)
    objs = list(db.scalars(q))
    out = []
    for o in objs:
        item = schemas.ObjectiveOut.model_validate(o)
        item.progress = _group_progress(o.kpis)
        item.kpi_count = len([k for k in o.kpis if not k.archived])
        out.append(item)
    return out


def overall_progress(db: Session, user_id: int = 1, cycle_id: int | None = None) -> float:
    """Diem tong nam = trung binh co trong so theo Objective.

    KPI chua gan muc tieu duoc gop vao nhom ao "Khac" dung phan trong so con lai
    (100% - tong trong so Objective) de khong KPI nao bi bo sot.
    """
    objs = objectives_with_progress(db, user_id, cycle_id=cycle_id)
    ungrouped = [] if cycle_id is not None else [
        k for k in get_active_kpis(db, user_id) if k.objective_id is None
    ]
    total = sum(o.weight * o.progress for o in objs)
    denom = sum(o.weight for o in objs)
    if ungrouped:
        khac_weight = max(0.0, 100.0 - denom)
        if khac_weight > 0:
            total += khac_weight * _group_progress(ungrouped)
            denom += khac_weight
    if denom <= 0:
        # chua phan bo trong so nao -> trung binh don gian
        kpis = get_active_kpis(db, user_id, cycle_id=cycle_id)
        return _group_progress(kpis) if kpis else 0.0
    return round(total / denom, 1)


def build_dashboard(
    db: Session, user_id: int = 1, cycle_id: int | None = None
) -> schemas.DashboardOut:
    cycle = db.get(models.KPICycle, cycle_id) if cycle_id is not None else None
    kpis = get_active_kpis(db, user_id, cycle_id=cycle_id)
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

    # viec can lam: se lam (uu tien hien truoc) + dang lam
    todos = list(
        db.scalars(
            select(models.WorkItem)
            .where(
                models.WorkItem.user_id == user_id,
                models.WorkItem.confirmed == True,  # noqa: E712
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
            select(models.WorkItem).where(
                models.WorkItem.user_id == user_id, models.WorkItem.confirmed == True  # noqa: E712
            )
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
    return schemas.DashboardOut(
        year=(
            cycle.start_date.year
            if cycle and cycle.start_date
            else (kpis[0].year if kpis else today.year)
        ),
        overall_progress=overall_progress(db, user_id, cycle_id=cycle_id),
        objectives=objectives_with_progress(db, user_id, cycle_id=cycle_id),
        kpi_statuses=statuses,
        warnings=warnings,
        counts_by_status=counts,
        recent_items=[schemas.WorkItemOut.model_validate(w) for w in recent],
        todo_items=[schemas.WorkItemOut.model_validate(w) for w in todos],
        weekly_activity=weekly,
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


def confirm_items(
        db: Session, items: list[schemas.ProposedWorkItem], user_id: int = 1
) -> list[models.WorkItem]:
    """Luu dau viec da xac nhan va cong tien do vao KPI tuong ung."""
    saved: list[models.WorkItem] = []
    for it in items:
        kpi = None
        if it.kpi_id:
            candidate = db.get(models.KPI, it.kpi_id)
            if candidate and candidate.user_id == user_id and not candidate.archived:
                kpi = candidate
        wi = models.WorkItem(
            user_id=user_id,
            kpi_id=kpi.id if kpi else None,
            title=it.title,
            detail=it.detail,
            status=it.status if it.status in schemas.WORK_STATUSES else "da_lam",
            progress_delta=it.value_delta,  # luu theo don vi cua KPI
            source=it.source,
            source_ref=it.source_ref,
            work_date=it.work_date,
            confirmed=True,
        )
        db.add(wi)
        if kpi and it.value_delta:
            # cong vao THUC DAT theo don vi; cho phep vuot chi tieu (>100%)
            kpi.current_value = max(0.0, round(kpi.current_value + it.value_delta, 2))
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
            f"- id={k.id} | {k.name} | chỉ tiêu: {k.target or k.description or 'n/a'}{obj} | "
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
            f"- [{k.id}] {k.name}: thực đạt {k.current_value:g}/{k.target_value:g} {k.unit} "
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


def full_context_text(db: Session, user_id: int = 1) -> str:
    """Toan bo boi canh KPI + dau viec gan day cho prompt tra loi cau hoi."""
    kpis = get_active_kpis(db, user_id)
    today = date.today()
    parts = ["## KPI năm:"]
    for k in kpis:
        health, gap = health_of(k, today)
        exp = expected_progress(k, today)
        obj = f", thuộc mục tiêu \"{k.objective_name}\"" if k.objective_name else ""
        over = " — VƯỢT CHỈ TIÊU" if k.progress > 100 else ""
        parts.append(
            f"- [{k.id}] {k.name}: thực đạt {k.current_value:g}/{k.target_value:g} {k.unit} "
            f"= {k.progress:.0f}%{over} / kỳ vọng theo thời gian {exp:.0f}% "
            f"(lệch {gap:+.0f}%, trạng thái {health}){obj}, "
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
