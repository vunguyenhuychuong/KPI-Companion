from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from .. import models, schemas
from ..auth import CurrentUser
from ..database import get_db
from ..services import kpi_service

router = APIRouter(prefix="/api/work-items", tags=["work-items"])


def _cycle_locked_error(cycle: models.KPICycle):
    raise HTTPException(
        status_code=423,
        detail={
            "error": "CYCLE_LOCKED",
            "message": f'Chu kỳ "{cycle.name}" đã được chốt, không thể chỉnh sửa đầu việc/KPI.',
            "locked_at": cycle.locked_at.isoformat() if cycle.locked_at else None,
        },
    )


def _check_kpi_cycle_not_locked(db: Session, kpi_id: int | None, user_id: int):
    if kpi_id is None:
        return
    kpi = db.get(models.KPI, kpi_id)
    if not kpi or kpi.user_id != user_id:
        raise HTTPException(404, "Không tìm thấy KPI")
    if not kpi.objective_id:
        return
    obj = db.get(models.Objective, kpi.objective_id)
    if not obj or obj.user_id != user_id or not obj.cycle_id:
        return
    cycle = db.get(models.KPICycle, obj.cycle_id)
    if cycle and cycle.is_locked:
        _cycle_locked_error(cycle)


@router.get("")
def list_items(
    current_user: CurrentUser,
    status: str | None = None,
    source: str | None = None,
    kpi_id: int | None = None,
    search: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=5, le=100),
    db: Session = Depends(get_db),
):
    q = select(models.WorkItem).where(
        models.WorkItem.user_id == current_user.id,
        models.WorkItem.confirmed == True,  # noqa: E712
    )
    if status:
        q = q.where(models.WorkItem.status == status)
    if source:
        q = q.where(models.WorkItem.source == source)
    if kpi_id:
        q = q.where(models.WorkItem.kpi_id == kpi_id)
    if date_from:
        q = q.where(models.WorkItem.work_date >= date_from)
    if date_to:
        q = q.where(models.WorkItem.work_date <= date_to)
    if search:
        like = f"%{search.strip()}%"
        q = q.outerjoin(models.KPI, models.WorkItem.kpi_id == models.KPI.id).where(
            or_(
                models.WorkItem.title.ilike(like),
                models.WorkItem.detail.ilike(like),
                models.WorkItem.source_ref.ilike(like),
                models.KPI.name.ilike(like),
            )
        )
    total = db.scalar(select(func.count()).select_from(q.subquery())) or 0
    items = list(
        db.scalars(
            q.order_by(models.WorkItem.created_at.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
    )
    return {"items": [schemas.WorkItemOut.model_validate(w) for w in items], "total": total, "page": page, "page_size": page_size}


@router.post("/confirm", response_model=list[schemas.WorkItemOut])
def confirm(
    payload: schemas.ConfirmItemsRequest, current_user: CurrentUser, db: Session = Depends(get_db)
):
    """Nguoi dung xac nhan (co the da chinh sua) cac dau viec Agent de xuat."""
    for item in payload.items:
        _check_kpi_cycle_not_locked(db, item.kpi_id, current_user.id)
    return kpi_service.confirm_items(db, payload.items, user_id=current_user.id)


@router.put("/{item_id}/status", response_model=schemas.WorkItemOut)
def update_status(
    item_id: int,
    current_user: CurrentUser,
    status: str,
    value_delta: float = 0.0,
    db: Session = Depends(get_db),
):
    """Doi trang thai dau viec; value_delta (tuy chon) cong them vao thuc dat KPI khi hoan thanh."""
    if status not in schemas.WORK_STATUSES:
        raise HTTPException(400, f"Trạng thái phải là một trong: {', '.join(schemas.WORK_STATUSES)}")
    item = db.get(models.WorkItem, item_id)
    if not item or item.user_id != current_user.id:
        raise HTTPException(404, "Không tìm thấy đầu việc")
    _check_kpi_cycle_not_locked(db, item.kpi_id, current_user.id)
    item.status = status
    if value_delta and item.kpi_id:
        kpi = db.get(models.KPI, item.kpi_id)
        if kpi:
            old_value = kpi.current_value
            new_value = max(0.0, round(kpi.current_value + value_delta, 2))
            kpi.current_value = new_value
            item.progress_delta = round((item.progress_delta or 0) + value_delta, 2)
            db.add(
                models.KPIChangeLog(
                    kpi_id=kpi.id,
                    field="current_value",
                    old_value=str(old_value),
                    new_value=str(new_value),
                    reason=f'Hoàn thành đầu việc "{item.title}"',
                )
            )
    db.commit()
    db.refresh(item)
    return item


@router.delete("/{item_id}", status_code=204)
def delete_item(item_id: int, current_user: CurrentUser, db: Session = Depends(get_db)):
    """Xoa vinh vien mot dau viec da ghi nhan va tru lai delta khoi KPI neu co."""
    item = db.get(models.WorkItem, item_id)
    if not item or item.user_id != current_user.id:
        raise HTTPException(404, "Không tìm thấy đầu việc")
    _check_kpi_cycle_not_locked(db, item.kpi_id, current_user.id)
    if item.kpi_id and item.progress_delta:
        kpi = db.get(models.KPI, item.kpi_id)
        if kpi and kpi.user_id == current_user.id:
            old_value = kpi.current_value
            new_value = max(0.0, round(kpi.current_value - item.progress_delta, 2))
            kpi.current_value = new_value
            db.add(
                models.KPIChangeLog(
                    kpi_id=kpi.id,
                    field="current_value",
                    old_value=str(old_value),
                    new_value=str(new_value),
                    reason=f'Xóa đầu việc "{item.title}"',
                )
            )
    db.delete(item)
    db.commit()
