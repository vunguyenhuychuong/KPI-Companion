from fastapi import APIRouter, Depends, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models, schemas
from ..agent import agent as kpi_agent
from ..connectors.file_upload import parse_kpi_file
from ..database import get_db

router = APIRouter(prefix="/api/kpis", tags=["kpis"])


@router.get("", response_model=list[schemas.KPIOut])
def list_kpis(db: Session = Depends(get_db)):
    return list(db.scalars(select(models.KPI).where(models.KPI.archived == False)))  # noqa: E712


@router.post("", response_model=schemas.KPIOut)
def create_kpi(payload: schemas.KPICreate, db: Session = Depends(get_db)):
    kpi = models.KPI(user_id=1, **payload.model_dump())
    db.add(kpi)
    db.commit()
    db.refresh(kpi)
    return kpi


@router.post("/import", response_model=list[schemas.KPIOut])
async def import_kpis(file: UploadFile, db: Session = Depends(get_db)):
    content = await file.read()
    parsed = parse_kpi_file(file.filename or "kpi.xlsx", content)
    if not parsed:
        raise HTTPException(400, "Không đọc được KPI nào từ file. Cần cột: Tên KPI, Mô tả, Chỉ tiêu, Trọng số, Deadline.")
    created = []
    for p in parsed:
        kpi = models.KPI(user_id=1, **p)
        db.add(kpi)
        created.append(kpi)
    db.commit()
    for k in created:
        db.refresh(k)
    return created


@router.put("/{kpi_id}", response_model=schemas.KPIOut)
def update_kpi(kpi_id: int, payload: schemas.KPIUpdate, db: Session = Depends(get_db)):
    kpi = db.get(models.KPI, kpi_id)
    if not kpi:
        raise HTTPException(404, "Không tìm thấy KPI")
    changes = payload.model_dump(exclude_unset=True, exclude={"reason"})
    for field, new_value in changes.items():
        old_value = getattr(kpi, field)
        if old_value != new_value:
            db.add(
                models.KPIChangeLog(
                    kpi_id=kpi.id,
                    field=field,
                    old_value=str(old_value),
                    new_value=str(new_value),
                    reason=payload.reason,
                )
            )
            setattr(kpi, field, new_value)
    db.commit()
    db.refresh(kpi)
    return kpi


@router.delete("/{kpi_id}")
def archive_kpi(kpi_id: int, reason: str = "", db: Session = Depends(get_db)):
    kpi = db.get(models.KPI, kpi_id)
    if not kpi:
        raise HTTPException(404, "Không tìm thấy KPI")
    kpi.archived = True
    db.add(
        models.KPIChangeLog(
            kpi_id=kpi.id, field="archived", old_value="False", new_value="True", reason=reason
        )
    )
    db.commit()
    return {"ok": True}


@router.post("/{kpi_id}/decompose", response_model=schemas.KPIOut)
def decompose_kpi(kpi_id: int, db: Session = Depends(get_db)):
    """Phan ra KPI thanh muc tieu quy/thang theo SMART (goi LLM)."""
    kpi = db.get(models.KPI, kpi_id)
    if not kpi:
        raise HTTPException(404, "Không tìm thấy KPI")
    sub_goals = kpi_agent.decompose_kpi_smart(kpi)
    if not sub_goals:
        raise HTTPException(502, "Agent không phân rã được KPI này, thử lại sau.")
    for sg in kpi.sub_goals:
        db.delete(sg)
    for i, sg in enumerate(sub_goals):
        if not isinstance(sg, dict) or not sg.get("description"):
            continue
        db.add(
            models.SubGoal(
                kpi_id=kpi.id,
                period_type=str(sg.get("period_type", "month")),
                period_label=str(sg.get("period_label", "")),
                description=str(sg["description"]),
                expected_progress=float(sg.get("expected_progress") or 0),
                sort_order=i,
            )
        )
    db.commit()
    db.refresh(kpi)
    return kpi


@router.get("/{kpi_id}/changelog", response_model=list[schemas.ChangeLogOut])
def kpi_changelog(kpi_id: int, db: Session = Depends(get_db)):
    return list(
        db.scalars(
            select(models.KPIChangeLog)
            .where(models.KPIChangeLog.kpi_id == kpi_id)
            .order_by(models.KPIChangeLog.changed_at.desc())
        )
    )
