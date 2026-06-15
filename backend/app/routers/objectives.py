from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models, schemas
from ..auth import CurrentUser
from ..database import get_db
from ..services import kpi_service

router = APIRouter(prefix="/api/objectives", tags=["objectives"])


def _check_objective_weight(
    db: Session,
    new_weight: float,
    cycle_id: int | None = None,
    exclude_id: int | None = None,
    user_id: int = 1,
):
    """Tong trong so cac Objective cua user trong cung cycle khong vuot 100%."""
    q = select(models.Objective).where(
        models.Objective.user_id == user_id,
        models.Objective.archived == False,  # noqa: E712
    )
    if cycle_id is not None:
        q = q.where(models.Objective.cycle_id == cycle_id)
    others = db.scalars(q)
    total = sum(o.weight for o in others if o.id != exclude_id) + new_weight
    if total > 100.001:
        raise HTTPException(
            400,
            f"Tổng trọng số các mục tiêu sẽ là {total:.0f}%, vượt quá 100%. "
            f"Còn lại {100 - (total - new_weight):.0f}% khả dụng.",
        )


def _check_cycle_not_locked(db: Session, cycle_id: int | None):
    """Bao loi neu chu ky da chot."""
    if cycle_id is None:
        return
    cycle = db.get(models.KPICycle, cycle_id)
    if cycle and cycle.is_locked:
        raise HTTPException(400, f'Chu kỳ "{cycle.name}" đã chốt — không thể thay đổi mục tiêu')


@router.get("", response_model=list[schemas.ObjectiveOut])
def list_objectives(
    current_user: CurrentUser,
    db: Session = Depends(get_db),
    cycle_id: Optional[int] = Query(None, description="Lọc theo chu kỳ"),
):
    return kpi_service.objectives_with_progress(db, user_id=current_user.id, cycle_id=cycle_id)


@router.post("", response_model=schemas.ObjectiveOut)
def create_objective(
    payload: schemas.ObjectiveCreate, current_user: CurrentUser, db: Session = Depends(get_db)
):
    _check_cycle_not_locked(db, payload.cycle_id)
    _check_objective_weight(db, payload.weight, cycle_id=payload.cycle_id, user_id=current_user.id)
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
    _check_cycle_not_locked(db, obj.cycle_id)
    data = payload.model_dump(exclude_unset=True)
    new_cycle_id = data.get("cycle_id", obj.cycle_id)
    if data.get("weight") is not None:
        _check_objective_weight(db, data["weight"], cycle_id=new_cycle_id, exclude_id=obj_id, user_id=current_user.id)
    for field, value in data.items():
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
    _check_cycle_not_locked(db, obj.cycle_id)
    for kpi in db.scalars(select(models.KPI).where(models.KPI.objective_id == obj_id)):
        kpi.objective_id = None
    obj.archived = True
    db.commit()
    return {"ok": True}


@router.post("/validate-weights")
def validate_objective_weights(
    current_user: CurrentUser,
    db: Session = Depends(get_db),
    cycle_id: Optional[int] = Query(None),
    new_weight: float = Query(..., description="Trọng số cần kiểm tra"),
    exclude_id: Optional[int] = Query(None, description="Bỏ qua objective này (khi sửa)"),
):
    """Kiểm tra trọng số Layer 1 — không thực sự lưu."""
    q = select(models.Objective).where(
        models.Objective.user_id == current_user.id,
        models.Objective.archived == False,  # noqa: E712
    )
    if cycle_id is not None:
        q = q.where(models.Objective.cycle_id == cycle_id)
    others = db.scalars(q)
    current_total = sum(o.weight for o in others if o.id != exclude_id)
    projected = current_total + new_weight
    return {
        "valid": projected <= 100.001,
        "current_total": round(current_total, 1),
        "projected_total": round(projected, 1),
        "remaining": round(100 - current_total, 1),
        "message": (
            f"Tổng sẽ là {projected:.1f}% — vượt 100%"
            if projected > 100.001
            else f"Còn {100 - projected:.1f}% trống"
        ),
    }
