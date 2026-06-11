from fastapi import APIRouter, Depends
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
