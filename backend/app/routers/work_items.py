from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..services import kpi_service

router = APIRouter(prefix="/api/work-items", tags=["work-items"])


@router.get("", response_model=list[schemas.WorkItemOut])
def list_items(status: str | None = None, kpi_id: int | None = None, db: Session = Depends(get_db)):
    q = select(models.WorkItem).where(
        models.WorkItem.user_id == 1, models.WorkItem.confirmed == True  # noqa: E712
    )
    if status:
        q = q.where(models.WorkItem.status == status)
    if kpi_id:
        q = q.where(models.WorkItem.kpi_id == kpi_id)
    return list(db.scalars(q.order_by(models.WorkItem.created_at.desc()).limit(200)))


@router.post("/confirm", response_model=list[schemas.WorkItemOut])
def confirm(payload: schemas.ConfirmItemsRequest, db: Session = Depends(get_db)):
    """Nguoi dung xac nhan (co the da chinh sua) cac dau viec Agent de xuat."""
    return kpi_service.confirm_items(db, payload.items)


@router.put("/{item_id}/status", response_model=schemas.WorkItemOut)
def update_status(
        item_id: int, status: str, value_delta: float = 0.0, db: Session = Depends(get_db)
):
    """Doi trang thai dau viec; value_delta (tuy chon) cong them vao thuc dat KPI khi hoan thanh."""
    if status not in schemas.WORK_STATUSES:
        raise HTTPException(400, f"Trạng thái phải là một trong: {', '.join(schemas.WORK_STATUSES)}")
    item = db.get(models.WorkItem, item_id)
    if not item:
        raise HTTPException(404, "Không tìm thấy đầu việc")
    item.status = status
    if value_delta and item.kpi_id:
        kpi = db.get(models.KPI, item.kpi_id)
        if kpi:
            kpi.current_value = max(0.0, round(kpi.current_value + value_delta, 2))
            item.progress_delta = round((item.progress_delta or 0) + value_delta, 2)
    db.commit()
    db.refresh(item)
    return item
