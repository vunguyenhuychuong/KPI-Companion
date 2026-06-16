"""Quản lý chu kỳ đánh giá KPI (KPI Cycles).

Chu kỳ là đơn vị tổ chức cao nhất: Objectives thuộc về Cycle.
Hỗ trợ: tạo/sửa/xóa cycle, chốt (lock), nhân bản từ cycle cũ.
"""
import re
from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, field_validator
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import models, schemas
from ..auth import CurrentUser
from ..database import get_db

router = APIRouter(prefix="/api/cycles", tags=["cycles"])


def _validate_cycle_dates(name: str, cycle_type: str | None, start_date: date | None, end_date: date | None):
    if start_date and end_date and start_date > end_date:
        raise HTTPException(400, "Ngày bắt đầu không được sau ngày kết thúc")

    if not (name and start_date and end_date):
        return

    years = [int(y) for y in re.findall(r"\b(20\d{2}|19\d{2})\b", name)]
    if not years:
        return

    expected_year = years[-1]
    is_yearly_name = (cycle_type == "yearly") or bool(re.search(r"\b(năm|nam|year)\b", name, re.IGNORECASE))
    if is_yearly_name and (start_date.year != expected_year or end_date.year != expected_year):
        raise HTTPException(
            400,
            f'Tên chu kỳ "{name}" đang nhắc tới năm {expected_year}, '
            f"nhưng khoảng ngày là {start_date:%d/%m/%Y} - {end_date:%d/%m/%Y}",
        )


def _get_cycle_or_404(db: Session, cycle_id: int, user_id: int) -> models.KPICycle:
    cycle = db.get(models.KPICycle, cycle_id)
    if not cycle or cycle.user_id != user_id:
        raise HTTPException(404, "Không tìm thấy chu kỳ")
    return cycle


@router.get("", response_model=list[schemas.CycleOut])
def list_cycles(current_user: CurrentUser, db: Session = Depends(get_db)):
    cycles = db.scalars(
        select(models.KPICycle)
        .where(models.KPICycle.user_id == current_user.id)
        .order_by(models.KPICycle.id.desc())
    ).all()
    result = []
    for c in cycles:
        count = db.scalar(
            select(func.count(models.Objective.id))
            .where(models.Objective.cycle_id == c.id, models.Objective.archived == False)  # noqa: E712
        ) or 0
        out = schemas.CycleOut.model_validate(c)
        out.objective_count = count
        result.append(out)
    return result


@router.post("", response_model=schemas.CycleOut, status_code=201)
def create_cycle(
    payload: schemas.CycleCreate,
    current_user: CurrentUser,
    db: Session = Depends(get_db),
):
    _validate_cycle_dates(payload.name, payload.cycle_type, payload.start_date, payload.end_date)
    cycle = models.KPICycle(user_id=current_user.id, **payload.model_dump())
    db.add(cycle)
    db.commit()
    db.refresh(cycle)
    out = schemas.CycleOut.model_validate(cycle)
    out.objective_count = 0
    return out


@router.get("/compare")
def compare_cycles(
    cycle_ids: str,
    current_user: CurrentUser,
    db: Session = Depends(get_db),
):
    """So sanh tien do giua nhieu chu ky.

    cycle_ids: danh sach id phan cach bang dau phay, VD: "1,2,3"
    Tra ve: [{id, name, avg_progress, objectives: [{name, progress}]}]
    """
    from ..services import kpi_service

    try:
        ids = [int(x.strip()) for x in cycle_ids.split(",") if x.strip()]
    except ValueError:
        raise HTTPException(400, "cycle_ids phai la danh sach so nguyen phan cach bang dau phay")
    if not ids:
        raise HTTPException(400, "Cần ít nhất 1 cycle_id")

    result = []
    for cid in ids:
        cycle = db.get(models.KPICycle, cid)
        if not cycle or cycle.user_id != current_user.id:
            continue
        objs = kpi_service.objectives_with_progress(db, current_user.id, cycle_id=cid)
        obj_data = [{"name": o.name, "progress": o.progress} for o in objs]
        avg = round(sum(o.progress for o in objs) / len(objs), 1) if objs else 0.0
        result.append({"id": cycle.id, "name": cycle.name, "avg_progress": avg, "objectives": obj_data})
    return result


@router.get("/{cycle_id}", response_model=schemas.CycleOut)
def get_cycle(cycle_id: int, current_user: CurrentUser, db: Session = Depends(get_db)):
    cycle = _get_cycle_or_404(db, cycle_id, current_user.id)
    count = db.scalar(_count_objectives_query(cycle_id)) or 0
    out = schemas.CycleOut.model_validate(cycle)
    out.objective_count = count
    return out


@router.put("/{cycle_id}", response_model=schemas.CycleOut)
def update_cycle(
    cycle_id: int,
    payload: schemas.CycleUpdate,
    current_user: CurrentUser,
    db: Session = Depends(get_db),
):
    cycle = _get_cycle_or_404(db, cycle_id, current_user.id)
    if cycle.is_locked:
        raise HTTPException(400, "Chu kỳ đã chốt — không thể chỉnh sửa")
    patch = payload.model_dump(exclude_unset=True)
    _validate_cycle_dates(
        patch.get("name", cycle.name),
        patch.get("cycle_type", cycle.cycle_type),
        patch.get("start_date", cycle.start_date),
        patch.get("end_date", cycle.end_date),
    )
    for field, value in patch.items():
        setattr(cycle, field, value)
    db.commit()
    db.refresh(cycle)
    count = db.scalar(_count_objectives_query(cycle_id)) or 0
    out = schemas.CycleOut.model_validate(cycle)
    out.objective_count = count
    return out


@router.delete("/{cycle_id}")
def delete_cycle(cycle_id: int, current_user: CurrentUser, db: Session = Depends(get_db)):
    cycle = _get_cycle_or_404(db, cycle_id, current_user.id)
    if cycle.is_locked:
        raise HTTPException(400, "Chu kỳ đã chốt — không thể xóa")
    count = db.scalar(_count_objectives_query(cycle_id)) or 0
    if count > 0:
        raise HTTPException(
            400,
            f"Chu kỳ đang có {count} mục tiêu — hãy chuyển hoặc xóa mục tiêu trước",
        )
    db.delete(cycle)
    db.commit()
    return {"ok": True}


class LockRequest(BaseModel):
    reason: str = ""

    @field_validator("reason")
    @classmethod
    def _reason_required(cls, v: str) -> str:
        v = (v or "").strip()
        if not v:
            raise ValueError("Vui lòng nhập lý do chốt/mở khóa chu kỳ")
        return v


@router.post("/{cycle_id}/lock")
def lock_cycle(
    cycle_id: int,
    payload: LockRequest,
    current_user: CurrentUser,
    db: Session = Depends(get_db),
):
    """Chốt số chu kỳ — sau khi lock không sửa được objectives/KPIs trong chu kỳ này."""
    cycle = _get_cycle_or_404(db, cycle_id, current_user.id)
    if cycle.is_locked:
        raise HTTPException(400, "Chu kỳ đã được chốt rồi")
    cycle.is_locked = True
    cycle.locked_at = models.utcnow()
    cycle.locked_by = current_user.id
    cycle.lock_reason = payload.reason
    db.commit()
    return {"ok": True, "message": f'Đã chốt chu kỳ "{cycle.name}"'}


class UnlockRequest(BaseModel):
    reason: str = ""

    @field_validator("reason")
    @classmethod
    def _reason_required(cls, v: str) -> str:
        v = (v or "").strip()
        if not v:
            raise ValueError("Vui lòng nhập lý do chốt/mở khóa chu kỳ")
        return v


@router.post("/{cycle_id}/unlock")
def unlock_cycle(
    cycle_id: int,
    payload: UnlockRequest,
    current_user: CurrentUser,
    db: Session = Depends(get_db),
):
    cycle = _get_cycle_or_404(db, cycle_id, current_user.id)
    if not cycle.is_locked:
        raise HTTPException(400, "Chu kỳ chưa bị chốt")
    cycle.is_locked = False
    cycle.locked_at = None
    cycle.locked_by = None
    cycle.lock_reason = payload.reason
    db.commit()
    return {"ok": True, "message": f'Đã mở khoá chu kỳ "{cycle.name}"'}


@router.post("/{cycle_id}/clone", response_model=schemas.CycleOut, status_code=201)
def clone_cycle(
    cycle_id: int,
    payload: schemas.CycleCloneCreate,
    current_user: CurrentUser,
    db: Session = Depends(get_db),
):
    """Nhân bản chu kỳ: tạo chu kỳ mới với cùng cấu trúc Objectives + KPIs (không copy giá trị thực tế).

    exclude_objective_ids: danh sách objective_id cần bỏ qua khi clone.
    """
    src = _get_cycle_or_404(db, cycle_id, current_user.id)
    _validate_cycle_dates(payload.name, payload.cycle_type, payload.start_date, payload.end_date)

    new_cycle = models.KPICycle(
        user_id=current_user.id,
        name=payload.name,
        cycle_type=payload.cycle_type or src.cycle_type,
        start_date=payload.start_date,
        end_date=payload.end_date,
        is_active=True,
        is_locked=False,
        cloned_from_cycle_id=src.id,
    )
    db.add(new_cycle)
    db.flush()

    src_objectives = db.scalars(
        select(models.Objective).where(
            models.Objective.cycle_id == src.id,
            models.Objective.archived == False,  # noqa: E712
        )
    ).all()

    for src_obj in src_objectives:
        if src_obj.id in (payload.exclude_objective_ids or []):
            continue
        new_obj = models.Objective(
            user_id=current_user.id,
            cycle_id=new_cycle.id,
            name=src_obj.name,
            description=src_obj.description,
            weight=src_obj.weight,
            year=payload.start_date.year if payload.start_date else src_obj.year,
        )
        db.add(new_obj)
        db.flush()

        src_kpis = db.scalars(
            select(models.KPI).where(
                models.KPI.objective_id == src_obj.id,
                models.KPI.archived == False,  # noqa: E712
            )
        ).all()
        for src_kpi in src_kpis:
            new_kpi = models.KPI(
                user_id=current_user.id,
                objective_id=new_obj.id,
                name=src_kpi.name,
                description=src_kpi.description,
                target=src_kpi.target,
                weight=src_kpi.weight,
                year=new_obj.year,
                deadline=src_kpi.deadline,
                unit=src_kpi.unit,
                target_value=src_kpi.target_value,
                current_value=0.0,
                category=src_kpi.category,
            )
            db.add(new_kpi)

    db.commit()
    db.refresh(new_cycle)

    count = db.scalar(_count_objectives_query(new_cycle.id)) or 0
    out = schemas.CycleOut.model_validate(new_cycle)
    out.objective_count = count
    return out


def _count_objectives_query(cycle_id: int):
    return (
        select(func.count(models.Objective.id))
        .where(
            models.Objective.cycle_id == cycle_id,
            models.Objective.archived == False,  # noqa: E712
        )
    )
