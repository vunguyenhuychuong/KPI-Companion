from fastapi import APIRouter, Depends, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models, schemas
from ..agent import agent as kpi_agent
from ..auth import CurrentUser
from ..connectors.file_upload import parse_kpi_file
from ..database import get_db

router = APIRouter(prefix="/api/kpis", tags=["kpis"])


def _check_group_weight(
        db: Session,
        new_weight: float,
        objective_id: int | None,
        exclude_id: int | None = None,
        user_id: int = 1,
):
    """Tong trong so KPI TRONG CUNG MOT muc tieu (hoac nhom chua gan) khong vuot 100%."""
    q = select(models.KPI).where(
        models.KPI.user_id == user_id,
        models.KPI.archived == False,  # noqa: E712
    )
    q = q.where(
        models.KPI.objective_id == objective_id
        if objective_id is not None
        else models.KPI.objective_id.is_(None)
    )
    others = db.scalars(q)
    total = sum(k.weight for k in others if k.id != exclude_id) + new_weight
    if total > 100.001:
        group = "nhóm chưa gắn mục tiêu"
        if objective_id:
            obj = db.get(models.Objective, objective_id)
            group = f'mục tiêu "{obj.name}"' if obj else group
        raise HTTPException(
            400,
            f"Tổng trọng số KPI trong {group} sẽ là {total:.0f}%, vượt quá 100%. "
            f"Hãy giảm trọng số KPI khác trong cùng mục tiêu trước "
            f"(còn lại {100 - (total - new_weight):.0f}% khả dụng).",
        )


@router.get("", response_model=list[schemas.KPIOut])
def list_kpis(current_user: CurrentUser, db: Session = Depends(get_db)):
    return list(db.scalars(
        select(models.KPI).where(
            models.KPI.user_id == current_user.id,
            models.KPI.archived == False,  # noqa: E712
        )
    ))


@router.post("", response_model=schemas.KPIOut)
def create_kpi(payload: schemas.KPICreate, current_user: CurrentUser, db: Session = Depends(get_db)):
    _check_group_weight(db, payload.weight, payload.objective_id, user_id=current_user.id)
    kpi = models.KPI(user_id=current_user.id, **payload.model_dump())
    db.add(kpi)
    db.commit()
    db.refresh(kpi)
    return kpi


@router.post("/import", response_model=list[schemas.KPIOut])
async def import_kpis(file: UploadFile, current_user: CurrentUser, db: Session = Depends(get_db)):
    content = await file.read()
    parsed = parse_kpi_file(file.filename or "kpi.xlsx", content)
    if not parsed:
        raise HTTPException(400, "Không đọc được KPI nào từ file. Cần cột: Tên KPI, Mô tả, Chỉ tiêu, Trọng số, Deadline.")
    _check_group_weight(db, sum(p["weight"] for p in parsed), objective_id=None, user_id=current_user.id)
    created = []
    for p in parsed:
        kpi = models.KPI(user_id=current_user.id, **p)
        db.add(kpi)
        created.append(kpi)
    db.commit()
    for k in created:
        db.refresh(k)
    return created


@router.post("/confirm-proposal", response_model=list[schemas.KPIOut])
def confirm_kpi_proposal(
    payload: schemas.KPIProposalConfirm, current_user: CurrentUser, db: Session = Depends(get_db)
):
    """Nguoi dung xac nhan de xuat tao KPI tu chat: ap dieu chinh trong so + tao KPI moi.

    Toan bo ap dung trong 1 transaction; kiem tra tong trong so TUNG NHOM sau khi ap het —
    vuot 100% thi rollback va bao loi ro rang.
    """
    if not payload.kpis and not payload.weight_changes:
        raise HTTPException(400, "Đề xuất trống")
    try:
        for wc in payload.weight_changes:
            kpi = db.get(models.KPI, wc.kpi_id)
            if not kpi or kpi.archived or kpi.user_id != current_user.id:
                raise HTTPException(404, f"Không tìm thấy KPI #{wc.kpi_id} để điều chỉnh trọng số")
            if kpi.weight != wc.new_weight:
                db.add(
                    models.KPIChangeLog(
                        kpi_id=kpi.id, field="weight",
                        old_value=str(kpi.weight), new_value=str(wc.new_weight),
                        reason="Điều chỉnh qua Trợ lý AI (người dùng đã xác nhận)",
                    )
                )
                kpi.weight = wc.new_weight

        created: list[models.KPI] = []
        for p in payload.kpis:
            if p.objective_id is not None:
                obj = db.get(models.Objective, p.objective_id)
                if not obj or obj.user_id != current_user.id:
                    raise HTTPException(404, f"Không tìm thấy mục tiêu #{p.objective_id}")
            kpi = models.KPI(
                user_id=current_user.id, name=p.name, description=p.description, target=p.target,
                unit=p.unit or "%", target_value=p.target_value or 100.0,
                weight=p.weight, deadline=p.deadline, objective_id=p.objective_id,
            )
            db.add(kpi)
            created.append(kpi)
        db.flush()

        # kiem tra tong trong so tung nhom sau khi ap het thay doi
        groups: dict[int | None, float] = {}
        for k in db.scalars(
            select(models.KPI).where(
                models.KPI.user_id == current_user.id,
                models.KPI.archived == False,  # noqa: E712
            )
        ):
            groups[k.objective_id] = groups.get(k.objective_id, 0.0) + k.weight
        for obj_id, total in groups.items():
            if total > 100.001:
                name = "nhóm chưa gắn mục tiêu"
                if obj_id:
                    obj = db.get(models.Objective, obj_id)
                    name = f'mục tiêu "{obj.name}"' if obj else name
                raise HTTPException(
                    400,
                    f"Sau thay đổi, tổng trọng số KPI trong {name} là {total:.0f}% (vượt 100%). "
                    f"Hãy chỉnh lại trọng số trong đề xuất.",
                )
        db.commit()
    except HTTPException:
        db.rollback()
        raise
    for k in created:
        db.refresh(k)
    return created


@router.post("/balance", response_model=list[schemas.KPIOut])
def balance_weights(
    payload: schemas.BalanceRequest, current_user: CurrentUser, db: Session = Depends(get_db)
):
    """Tu dong can bang trong so cac KPI trong 1 muc tieu ve dung tong 100%."""
    q = select(models.KPI).where(
        models.KPI.user_id == current_user.id,
        models.KPI.archived == False,  # noqa: E712
    )
    q = q.where(
        models.KPI.objective_id == payload.objective_id
        if payload.objective_id is not None
        else models.KPI.objective_id.is_(None)
    )
    kpis = list(db.scalars(q))
    if not kpis:
        raise HTTPException(404, "Nhóm này không có KPI nào để cân bằng")
    total = sum(k.weight for k in kpis)
    new_weights = (
        [round(100 / len(kpis), 1)] * len(kpis)
        if total <= 0
        else [round(k.weight * 100 / total, 1) for k in kpis]
    )
    new_weights[-1] = round(100 - sum(new_weights[:-1]), 1)  # khu sai so lam tron
    for k, w in zip(kpis, new_weights):
        if k.weight != w:
            db.add(
                models.KPIChangeLog(
                    kpi_id=k.id, field="weight", old_value=str(k.weight), new_value=str(w),
                    reason="Cân bằng trọng số tự động trong nhóm về tổng 100%",
                )
            )
            k.weight = w
    db.commit()
    return kpis


@router.put("/{kpi_id}", response_model=schemas.KPIOut)
def update_kpi(kpi_id: int, payload: schemas.KPIUpdate, current_user: CurrentUser, db: Session = Depends(get_db)):
    kpi = db.get(models.KPI, kpi_id)
    if not kpi or kpi.user_id != current_user.id:
        raise HTTPException(404, "Không tìm thấy KPI")
    changes = payload.model_dump(exclude_unset=True, exclude={"reason", "clear_objective"})

    # xac dinh muc tieu va trong so SAU thay doi de kiem tra dung nhom dich
    new_obj_id = changes.pop("objective_id", None)
    if payload.clear_objective:
        new_obj_id = None
    moving = payload.clear_objective or new_obj_id is not None
    final_obj_id = new_obj_id if moving else kpi.objective_id
    final_weight = changes.get("weight") if changes.get("weight") is not None else kpi.weight
    _check_group_weight(db, final_weight, final_obj_id, exclude_id=kpi_id, user_id=current_user.id)

    # doi muc tieu: ghi log bang TEN cho de doc; clear_objective=true -> go khoi muc tieu
    if moving:
        if kpi.objective_id != new_obj_id:
            old_name = kpi.objective_name or "(chưa gắn mục tiêu)"
            new_obj = db.get(models.Objective, new_obj_id) if new_obj_id else None
            if new_obj_id and (not new_obj or new_obj.user_id != current_user.id):
                raise HTTPException(404, "Không tìm thấy mục tiêu được chọn")
            db.add(
                models.KPIChangeLog(
                    kpi_id=kpi.id,
                    field="objective",
                    old_value=old_name,
                    new_value=new_obj.name if new_obj else "(chưa gắn mục tiêu)",
                    reason=payload.reason,
                )
            )
            kpi.objective_id = new_obj_id

    for field, new_value in changes.items():
        if new_value is None:
            continue
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
def archive_kpi(kpi_id: int, current_user: CurrentUser, reason: str = "", db: Session = Depends(get_db)):
    kpi = db.get(models.KPI, kpi_id)
    if not kpi or kpi.user_id != current_user.id:
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
def decompose_kpi(kpi_id: int, current_user: CurrentUser, db: Session = Depends(get_db)):
    """Phan ra KPI thanh muc tieu quy/thang theo SMART (goi LLM)."""
    kpi = db.get(models.KPI, kpi_id)
    if not kpi or kpi.user_id != current_user.id:
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


@router.get("/changelog/all", response_model=list[schemas.ChangeLogOut])
def all_changelog(current_user: CurrentUser, limit: int = 300, db: Session = Depends(get_db)):
    """Toan bo lich su thay doi KPI — bao gom ca KPI da go bo."""
    return list(
        db.scalars(
            select(models.KPIChangeLog)
            .join(models.KPI)
            .where(models.KPI.user_id == current_user.id)
            .order_by(models.KPIChangeLog.changed_at.desc())
            .limit(limit)
        )
    )


@router.get("/archived", response_model=list[schemas.KPIOut])
def archived_kpis(current_user: CurrentUser, db: Session = Depends(get_db)):
    """Danh sach KPI da go bo (de xem lai / khoi phuc)."""
    return list(db.scalars(
        select(models.KPI).where(
            models.KPI.user_id == current_user.id,
            models.KPI.archived == True,  # noqa: E712
        )
    ))


@router.post("/{kpi_id}/restore", response_model=schemas.KPIOut)
def restore_kpi(kpi_id: int, current_user: CurrentUser, db: Session = Depends(get_db)):
    """Khoi phuc KPI da go bo. Neu trong so cu lam nhom vuot 100% -> tu ha xuong phan con trong."""
    kpi = db.get(models.KPI, kpi_id)
    if not kpi or not kpi.archived or kpi.user_id != current_user.id:
        raise HTTPException(404, "Không tìm thấy KPI đã gỡ bỏ")
    others = db.scalars(
        select(models.KPI).where(
            models.KPI.user_id == current_user.id,
            models.KPI.archived == False,  # noqa: E712
            models.KPI.objective_id == kpi.objective_id
            if kpi.objective_id is not None
            else models.KPI.objective_id.is_(None),
        )
    )
    available = max(0.0, 100.0 - sum(k.weight for k in others))
    note = ""
    if kpi.weight > available:
        db.add(
            models.KPIChangeLog(
                kpi_id=kpi.id, field="weight",
                old_value=str(kpi.weight), new_value=str(available),
                reason=f"Hạ trọng số khi khôi phục (nhóm chỉ còn trống {available:g}%)",
            )
        )
        kpi.weight = available
        note = f" (trọng số hạ còn {available:g}%)"
    kpi.archived = False
    db.add(
        models.KPIChangeLog(
            kpi_id=kpi.id, field="archived", old_value="True", new_value="False",
            reason="Khôi phục KPI" + note,
        )
    )
    db.commit()
    db.refresh(kpi)
    return kpi


@router.get("/{kpi_id}/changelog", response_model=list[schemas.ChangeLogOut])
def kpi_changelog(kpi_id: int, current_user: CurrentUser, db: Session = Depends(get_db)):
    kpi = db.get(models.KPI, kpi_id)
    if not kpi or kpi.user_id != current_user.id:
        raise HTTPException(404, "Không tìm thấy KPI")
    return list(
        db.scalars(
            select(models.KPIChangeLog)
            .where(models.KPIChangeLog.kpi_id == kpi_id)
            .order_by(models.KPIChangeLog.changed_at.desc())
        )
    )
