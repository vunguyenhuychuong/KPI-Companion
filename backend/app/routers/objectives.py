from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models, schemas
from ..auth import CurrentUser
from ..database import get_db
from ..services import kpi_service

router = APIRouter(prefix="/api/objectives", tags=["objectives"])


def _check_objective_weight(
    db: Session, new_weight: float, exclude_id: int | None = None, user_id: int = 1
):
    """Tong trong so cac Objective cua user khong duoc vuot 100%."""
    others = db.scalars(
        select(models.Objective).where(
            models.Objective.user_id == user_id,
            models.Objective.archived == False,  # noqa: E712
        )
    )
    total = sum(o.weight for o in others if o.id != exclude_id) + new_weight
    if total > 100.001:
        raise HTTPException(
            400,
            f"Tổng trọng số các mục tiêu sẽ là {total:.0f}%, vượt quá 100%. "
            f"Còn lại {100 - (total - new_weight):.0f}% khả dụng.",
        )


@router.get("", response_model=list[schemas.ObjectiveOut])
def list_objectives(current_user: CurrentUser, db: Session = Depends(get_db)):
    return kpi_service.objectives_with_progress(db, user_id=current_user.id)


@router.post("", response_model=schemas.ObjectiveOut)
def create_objective(
    payload: schemas.ObjectiveCreate, current_user: CurrentUser, db: Session = Depends(get_db)
):
    _check_objective_weight(db, payload.weight, user_id=current_user.id)
    obj = models.Objective(user_id=current_user.id, **payload.model_dump())
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return schemas.ObjectiveOut.model_validate(obj)


@router.put("/{obj_id}", response_model=schemas.ObjectiveOut)
def update_objective(
    obj_id: int, payload: schemas.ObjectiveUpdate, current_user: CurrentUser, db: Session = Depends(get_db)
):
    obj = db.get(models.Objective, obj_id)
    if not obj or obj.archived or obj.user_id != current_user.id:
        raise HTTPException(404, "Không tìm thấy mục tiêu")
    data = payload.model_dump(exclude_unset=True)
    if data.get("weight") is not None:
        _check_objective_weight(db, data["weight"], exclude_id=obj_id, user_id=current_user.id)
    for field, value in data.items():
        if value is not None:
            setattr(obj, field, value)
    db.commit()
    db.refresh(obj)
    return schemas.ObjectiveOut.model_validate(obj)


@router.delete("/{obj_id}")
def archive_objective(obj_id: int, current_user: CurrentUser, db: Session = Depends(get_db)):
    """Go bo muc tieu: cac KPI con duoc giu lai, chuyen ve 'chua gan muc tieu'."""
    obj = db.get(models.Objective, obj_id)
    if not obj or obj.user_id != current_user.id:
        raise HTTPException(404, "Không tìm thấy mục tiêu")
    for kpi in db.scalars(select(models.KPI).where(models.KPI.objective_id == obj_id)):
        kpi.objective_id = None
    obj.archived = True
    db.commit()
    return {"ok": True}
