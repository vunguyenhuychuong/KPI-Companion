from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from .. import models, schemas
from ..agent import agent as kpi_agent
from ..agent.llm import call_json
from ..agent.prompts import SMART_VALIDATE_SYSTEM
from ..auth import CurrentUser
from ..connectors.file_upload import parse_appraisal_file, parse_kpi_file
from ..database import get_db
from ..services import autonomous_agent, kpi_service

router = APIRouter(prefix="/api/kpis", tags=["kpis"])


def _cycle_locked_error(cycle: models.KPICycle):
    raise HTTPException(
        status_code=423,
        detail={
            "error": "CYCLE_LOCKED",
            "message": f'Chu kỳ "{cycle.name}" đã được chốt, không thể chỉnh sửa.',
            "locked_at": cycle.locked_at.isoformat() if cycle.locked_at else None,
        },
    )


def _check_cycle_not_locked(db: Session, cycle_id: int | None, user_id: int):
    if cycle_id is None:
        return None
    cycle = db.get(models.KPICycle, cycle_id)
    if not cycle or cycle.user_id != user_id:
        raise HTTPException(404, "Không tìm thấy chu kỳ")
    if cycle.is_locked:
        _cycle_locked_error(cycle)
    return cycle


def _get_objective_for_user(db: Session, objective_id: int, user_id: int) -> models.Objective:
    obj = db.get(models.Objective, objective_id)
    if not obj or obj.user_id != user_id or obj.archived:
        raise HTTPException(404, "Không tìm thấy mục tiêu")
    return obj


def _check_objective_cycle_not_locked(db: Session, objective_id: int | None, user_id: int):
    if objective_id is None:
        return None
    obj = _get_objective_for_user(db, objective_id, user_id)
    _check_cycle_not_locked(db, obj.cycle_id, user_id)
    return obj


def _check_kpi_cycle_not_locked(db: Session, kpi: models.KPI, user_id: int):
    if kpi.objective_id is None:
        return None
    return _check_objective_cycle_not_locked(db, kpi.objective_id, user_id)


def _check_group_weight(
        db: Session,
        new_weight: float,
        objective_id: int | None,
        category: str | None = None,
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
    if objective_id is None:
        q = q.where(models.KPI.category == schemas._normalize_category(category))
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


@router.get("/validate-weights")
def validate_kpi_weights(
    current_user: CurrentUser,
    db: Session = Depends(get_db),
    objective_id: int | None = Query(None),
    category: str | None = Query("Work"),
    new_weight: float = Query(0.0),
    exclude_id: int | None = Query(None),
):
    """Kiem tra trong so KPI (Layer 2) khong nem loi — dung cho real-time preview trong UI."""
    q = select(models.KPI).where(
        models.KPI.user_id == current_user.id,
        models.KPI.archived == False,  # noqa: E712
    )
    q = q.where(
        models.KPI.objective_id == objective_id
        if objective_id is not None
        else models.KPI.objective_id.is_(None)
    )
    if objective_id is None:
        q = q.where(models.KPI.category == schemas._normalize_category(category))
    current_total = sum(k.weight for k in db.scalars(q) if k.id != exclude_id)
    projected_total = current_total + new_weight
    valid = projected_total <= 100.001
    remaining = max(0.0, round(100 - current_total, 1))

    group = "nhóm chưa gắn mục tiêu"
    if objective_id:
        obj = db.get(models.Objective, objective_id)
        group = f'mục tiêu "{obj.name}"' if obj else group

    if not valid:
        message = (
            f"Tổng trọng số KPI trong {group} sẽ là {projected_total:.1f}%, "
            f"vượt quá 100%. Còn {remaining:.1f}% khả dụng."
        )
    else:
        after = round(100 - projected_total, 1)
        message = f"Còn {after:.1f}% trống trong {group}." if after < 100 else ""

    return {
        "valid": valid,
        "current_total": round(current_total, 1),
        "projected_total": round(projected_total, 1),
        "remaining": remaining,
        "message": message,
    }


@router.get("", response_model=list[schemas.KPIOut])
def list_kpis(
    current_user: CurrentUser,
    db: Session = Depends(get_db),
    cycle_id: int | None = Query(None),
):
    q = select(models.KPI).where(
        models.KPI.user_id == current_user.id,
        models.KPI.archived == False,  # noqa: E712
    )
    if cycle_id is not None:
        q = q.join(models.Objective, models.KPI.objective_id == models.Objective.id).where(
            models.Objective.cycle_id == cycle_id,
            models.Objective.archived == False,  # noqa: E712
        )
    return list(db.scalars(q))


@router.post("", response_model=schemas.KPIOut)
def create_kpi(payload: schemas.KPICreate, current_user: CurrentUser, db: Session = Depends(get_db)):
    _check_objective_cycle_not_locked(db, payload.objective_id, current_user.id)
    _check_group_weight(db, payload.weight, payload.objective_id, category=payload.category, user_id=current_user.id)
    data = payload.model_dump()
    # Manual create is always a manual source; integrations/imports set source internally.
    data["data_source_mode"] = "manual"
    kpi = models.KPI(user_id=current_user.id, **data)
    db.add(kpi)
    db.commit()
    db.refresh(kpi)
    autonomous_agent.run_category_guard_for_kpis(db, current_user.id, [kpi])
    return kpi


def _apply_ai_categories_to_appraisal(appraisal: dict) -> dict[str, dict]:
    candidates: list[dict] = []
    for oi, obj in enumerate(appraisal.get("objectives") or []):
        child_names = ", ".join(k.get("name", "") for k in obj.get("kpis") or [])
        candidates.append({
            "local_id": f"obj:{oi}",
            "type": "objective",
            "objective_name": obj.get("name") or "",
            "objective_description": obj.get("description") or "",
            "child_kpis": child_names,
            "provided_category": obj.get("category") or "Work",
        })
        for ki, kpi in enumerate(obj.get("kpis") or []):
            candidates.append({
                "local_id": f"kpi:{oi}:{ki}",
                "type": "kpi",
                "objective_name": obj.get("name") or "",
                "kpi_name": kpi.get("name") or "",
                "kpi_description": kpi.get("note") or kpi.get("description") or "",
                "target_text": kpi.get("target") or "",
                "provided_category": kpi.get("category") or obj.get("category") or "Work",
            })
    assignments = autonomous_agent.classify_category_candidates(candidates)
    for oi, obj in enumerate(appraisal.get("objectives") or []):
        obj_key = f"obj:{oi}"
        obj_assignment = assignments.get(obj_key, {})
        obj["category"] = schemas._normalize_category(obj_assignment.get("category"))
        obj["category_confidence"] = float(obj_assignment.get("confidence") or 0.0)
        obj["category_reason"] = str(obj_assignment.get("reason") or "")
        for ki, kpi in enumerate(obj.get("kpis") or []):
            kpi_key = f"kpi:{oi}:{ki}"
            k_assignment = assignments.get(kpi_key, {})
            kpi["category"] = schemas._normalize_category(k_assignment.get("category") or obj["category"])
            kpi["category_confidence"] = float(k_assignment.get("confidence") or 0.0)
            kpi["category_reason"] = str(k_assignment.get("reason") or "")
    return assignments


def _apply_ai_categories_to_flat(parsed: list[dict]) -> None:
    candidates = [
        {
            "local_id": f"kpi:{i}",
            "type": "kpi",
            "kpi_name": p.get("name") or "",
            "kpi_description": p.get("description") or p.get("target") or "",
            "target_text": p.get("target") or "",
            "provided_category": p.get("category") or "Work",
        }
        for i, p in enumerate(parsed)
    ]
    assignments = autonomous_agent.classify_category_candidates(candidates)
    for i, p in enumerate(parsed):
        assignment = assignments.get(f"kpi:{i}", {})
        p["category"] = schemas._normalize_category(assignment.get("category") or p.get("category"))


@router.post("/import/preview", response_model=schemas.ImportPreviewOut)
async def preview_import(
    file: UploadFile,
    current_user: CurrentUser,
    db: Session = Depends(get_db),
    cycle_id: int | None = Query(None),
):
    """Phan tich file import (chi dinh dang Performance Appraisal) va tra ve ket qua validation
    ma KHONG luu bat ky du lieu nao. Frontend dung de hien thi wizard truoc khi xac nhan.

    Kiem tra: RULE-01 (tong muc tieu >100%), RULE-02 (tong KPI >100%), RULE-03/04 (<100%),
    RULE-05 (KPI chua co trong so), RULE-06 (muc tieu moi se duoc tao).
    """
    content = await file.read()
    fname = file.filename or "kpi.xlsx"

    appraisal = parse_appraisal_file(fname, content)
    if not appraisal:
        raise HTTPException(
            400,
            detail={"type": "not_appraisal", "message": "File không phải định dạng Performance Appraisal."},
        )

    _apply_ai_categories_to_appraisal(appraisal)

    if cycle_id is not None:
        _check_cycle_not_locked(db, cycle_id, current_user.id)

    objective_query = select(models.Objective).where(
        models.Objective.user_id == current_user.id,
        models.Objective.archived == False,  # noqa: E712
    )
    if cycle_id is not None:
        objective_query = objective_query.where(models.Objective.cycle_id == cycle_id)
    existing_objectives = list(db.scalars(objective_query))
    existing_by_name = {o.name.lower().strip(): o for o in existing_objectives}
    existing_obj_totals_by_category = {
        cat: sum((o.weight or 0) for o in existing_objectives if (o.category or "Work") == cat)
        for cat in schemas.KPI_CATEGORIES
    }
    existing_obj_total = existing_obj_totals_by_category.get("Work", 0.0)

    messages: list[schemas.ImportValidationMessage] = []
    preview_objs: list[schemas.ImportPreviewObjective] = []
    new_obj_totals_by_category = {cat: 0.0 for cat in schemas.KPI_CATEGORIES}

    for o in appraisal["objectives"]:
        obj_key = o["name"].lower().strip()
        is_new = obj_key not in existing_by_name
        obj_weight = float(o.get("weight") or 0)
        existing_obj = existing_by_name.get(obj_key)
        obj_category = existing_obj.category if existing_obj else schemas._normalize_category(o.get("category"))

        if is_new:
            new_obj_totals_by_category[obj_category] += obj_weight
            messages.append(schemas.ImportValidationMessage(
                code="RULE-06",
                level="info",
                message=f"Sẽ tạo mục tiêu mới: \"{o['name']}\""
                        + (f" ({obj_weight:.0f}%)" if obj_weight > 0 else " — chưa có trọng số"),
                objective_name=o["name"],
            ))

        # Lay tong KPI hien co trong objective nay
        existing_kpi_total = 0.0
        if existing_obj:
            existing_kpi_total = sum(
                k.weight for k in db.scalars(
                    select(models.KPI).where(
                        models.KPI.user_id == current_user.id,
                        models.KPI.objective_id == existing_obj.id,
                        models.KPI.archived == False,  # noqa: E712
                    )
                )
            )

        kpis: list[schemas.ImportPreviewKpi] = []
        kpi_total = 0.0
        for k in o["kpis"]:
            w = float(k.get("weight") or 0)
            has_w = w > 0
            kpi_total += w
            if not has_w:
                messages.append(schemas.ImportValidationMessage(
                    code="RULE-05",
                    level="warning",
                    message=f"KPI \"{k['name']}\" chưa được gán trọng số",
                    objective_name=o["name"],
                ))
            kpis.append(schemas.ImportPreviewKpi(
                name=k["name"],
                weight=w,
                has_weight=has_w,
                note=k.get("note") or "",
                category=schemas._normalize_category(k.get("category") or obj_category),
                category_confidence=float(k.get("category_confidence") or 0.0),
                category_reason=str(k.get("category_reason") or ""),
            ))

        # RULE-02 / RULE-04: kiem tra tong KPI trong muc tieu
        projected_kpi_total = existing_kpi_total + kpi_total
        if projected_kpi_total > 100.001:
            messages.append(schemas.ImportValidationMessage(
                code="RULE-02",
                level="error",
                message=f"Mục tiêu \"{o['name']}\": tổng KPI sau import = {projected_kpi_total:.0f}% — vượt 100%",
                objective_name=o["name"],
            ))
        elif kpi_total > 0 and projected_kpi_total < 99.999:
            messages.append(schemas.ImportValidationMessage(
                code="RULE-04",
                level="warning",
                message=f"Mục tiêu \"{o['name']}\": tổng KPI sau import = {projected_kpi_total:.0f}% — chưa đủ 100%",
                objective_name=o["name"],
            ))

        preview_objs.append(schemas.ImportPreviewObjective(
            name=o["name"],
            weight=obj_weight,
            category=obj_category,
            category_confidence=float(o.get("category_confidence") or 0.0),
            category_reason=str(o.get("category_reason") or ""),
            is_new=is_new,
            objective_id=existing_obj.id if existing_obj else None,
            kpis=kpis,
            kpi_total=kpi_total,
            existing_kpi_total=existing_kpi_total,
        ))

    # RULE-01 / RULE-03: kiem tra tong trong so muc tieu (Lop 1) rieng Work/Personal
    for cat in ("Work", "Personal"):
        added = new_obj_totals_by_category.get(cat, 0.0)
        if added <= 0:
            continue
        existing_total = existing_obj_totals_by_category.get(cat, 0.0)
        projected_obj_total = existing_total + added
        label = "Công việc" if cat == "Work" else "Cá nhân"
        if projected_obj_total > 100.001:
            messages.insert(0, schemas.ImportValidationMessage(
                code="RULE-01",
                level="error",
                message=(
                    f"Tổng trọng số mục tiêu nhóm {label} sau import = {projected_obj_total:.0f}% — vượt 100% "
                    f"(hiện có {existing_total:.0f}%, file thêm {added:.0f}%)"
                ),
            ))
        elif projected_obj_total < 99.999:
            remaining = round(100 - projected_obj_total, 1)
            messages.append(schemas.ImportValidationMessage(
                code="RULE-03",
                level="warning",
                message=(
                    f"Tổng trọng số mục tiêu nhóm {label} sau import = {projected_obj_total:.0f}% — "
                    f"còn thiếu {remaining}%. Bạn có thể phân bổ phần còn lại sau."
                ),
            ))

    has_errors = any(m.level == "error" for m in messages)
    needs_weight_input = any(
        (o.is_new and o.weight == 0) or any(not k.has_weight for k in o.kpis)
        for o in preview_objs
    )

    return schemas.ImportPreviewOut(
        existing_obj_total=existing_obj_total,
        existing_obj_totals_by_category=existing_obj_totals_by_category,
        objectives=preview_objs,
        messages=messages,
        can_save=not has_errors,
        needs_weight_input=needs_weight_input,
    )


@router.post("/import", response_model=list[schemas.KPIOut])
async def import_kpis(
    file: UploadFile,
    current_user: CurrentUser,
    db: Session = Depends(get_db),
    mode: str = Query("auto"),  # "auto" | "ungrouped" | "agent_map"
    cycle_id: int | None = Query(None),
):
    content = await file.read()
    fname = file.filename or "kpi.xlsx"

    # Uu tien mau Performance Appraisal cua cong ty (Objective + KPI 2 tang)
    appraisal = parse_appraisal_file(fname, content)
    if appraisal:
        return _import_appraisal(appraisal, current_user, db, mode=mode, cycle_id=cycle_id)

    # Fallback: file phang (Ten KPI | Mo ta | Chi tieu | Trong so | Deadline)
    parsed = parse_kpi_file(fname, content)
    if not parsed:
        raise HTTPException(
            400,
            "Không đọc được KPI nào từ file. Hỗ trợ 2 định dạng: "
            "(1) mẫu Performance Appraisal của công ty (Objective | Tỷ trọng | KPI | Tỷ trọng); "
            "(2) bảng phẳng với cột: Tên KPI, Mô tả, Chỉ tiêu, Trọng số, Deadline.",
        )
    _apply_ai_categories_to_flat(parsed)
    for cat in schemas.KPI_CATEGORIES:
        total_weight = sum(p["weight"] for p in parsed if schemas._normalize_category(p.get("category")) == cat)
        if total_weight > 0:
            _check_group_weight(db, total_weight, objective_id=None, category=cat, user_id=current_user.id)
    created = []
    for p in parsed:
        kpi = models.KPI(user_id=current_user.id, **{**p, "data_source_mode": "export"})
        db.add(kpi)
        created.append(kpi)
    db.commit()
    for k in created:
        db.refresh(k)
    if created:
        autonomous_agent.run_category_guard_for_kpis(db, current_user.id, created)
    return created


def _import_appraisal(appraisal: dict, current_user, db: Session, mode: str = "auto", cycle_id: int | None = None) -> list:
    """Import file mau cong ty: tao Objective + KPI, ho tro merge vao objective san co.

    mode="auto"      : merge vao objective cu neu trung ten, tao moi neu chua co.
    mode="ungrouped" : tao tat ca KPI khong gan objective, weight=0.
    mode="agent_map" : match objective theo ten (case-insensitive):
                       - Trung ten → gan KPI thang vao objective do, weight=0, bo qua neu da ton tai.
                       - Khong trung → de unassigned, weight=0 (frontend se goi auto-map).
    """
    _apply_ai_categories_to_appraisal(appraisal)
    objs = appraisal["objectives"]

    # Fix 1: lay danh sach objective hien co, map theo ten (case-insensitive)
    if cycle_id is not None:
        _check_cycle_not_locked(db, cycle_id, current_user.id)

    objective_query = select(models.Objective).where(
        models.Objective.user_id == current_user.id,
        models.Objective.archived == False,  # noqa: E712
    )
    if cycle_id is not None:
        objective_query = objective_query.where(models.Objective.cycle_id == cycle_id)
    existing_objectives = list(db.scalars(objective_query))
    existing_by_name = {o.name.lower().strip(): o for o in existing_objectives}
    existing_totals_by_category = {
        cat: sum((o.weight or 0) for o in existing_objectives if (o.category or "Work") == cat)
        for cat in schemas.KPI_CATEGORIES
    }

    # Tinh tong trong so cac objective MOI (chua co trong he thong)
    new_obj_weights_by_category = {cat: 0.0 for cat in schemas.KPI_CATEGORIES}
    for o in objs:
        if o["name"].lower().strip() in existing_by_name:
            continue
        cat = schemas._normalize_category(o.get("category"))
        new_obj_weights_by_category[cat] += o["weight"]

    # Fix 2: Neu tong vuot 100%, tra 409 cho frontend xu ly (tru khi mode da duoc chon)
    overflow = []
    for cat in ("Work", "Personal"):
        projected_total = existing_totals_by_category.get(cat, 0.0) + new_obj_weights_by_category.get(cat, 0.0)
        if projected_total > 100.1:
            overflow.append((cat, projected_total))
    if overflow and mode == "auto":
        cat, projected_total = overflow[0]
        existing_total = existing_totals_by_category.get(cat, 0.0)
        new_obj_weight = new_obj_weights_by_category.get(cat, 0.0)
        label = "Cong viec" if cat == "Work" else "Ca nhan"
        raise HTTPException(
            409,
            detail={
                "type": "weight_conflict",
                "projected_total": round(projected_total, 1),
                "existing_total": round(existing_total, 1),
                "message": (
                    f"Tổng trọng số mục tiêu nhóm {label} sẽ là {projected_total:.1f}% (vượt 100%). "
                    f"Hiện có: {existing_total:.1f}%, file thêm: {new_obj_weight:.1f}%."
                ),
            },
        )

    # mode = ungrouped: tao tat ca KPI khong gan objective, trong so 0%
    if mode == "ungrouped":
        created = []
        for o in objs:
            for k in o["kpis"]:
                kpi = models.KPI(
                    user_id=current_user.id,
                    objective_id=None,
                    name=k["name"],
                    weight=0.0,
                    description=f"[{o['name']}] " + (k.get("note") or ""),
                    unit="%", target_value=100.0, current_value=0.0,
                    category=schemas._normalize_category(k.get("category") or o.get("category")),
                    data_source_mode="export",
                )
                db.add(kpi)
                created.append(kpi)
        db.commit()
        for k in created:
            db.refresh(k)
        if created:
            autonomous_agent.run_category_guard_for_kpis(db, current_user.id, created)
        return created

    # mode = agent_map: match objective theo ten, gan KPI vao objective cu neu trung ten;
    # KPI thuoc objective khong match → unassigned (weight=0).
    # KPI da ton tai trong objective dich → bo qua, tranh duplicate.
    if mode == "agent_map":
        created = []
        for o in objs:
            matched_obj = existing_by_name.get(o["name"].lower().strip())
            target_obj_id = matched_obj.id if matched_obj else None

            # Lay ten KPI da co trong objective dich de tranh tao trung
            existing_kpi_names: set[str] = set()
            if target_obj_id is not None:
                existing_kpi_names = {
                    k.name.lower().strip()
                    for k in db.scalars(
                        select(models.KPI).where(
                            models.KPI.user_id == current_user.id,
                            models.KPI.objective_id == target_obj_id,
                            models.KPI.archived == False,  # noqa: E712
                        )
                    )
                }

            for k in o["kpis"]:
                if k["name"].lower().strip() in existing_kpi_names:
                    continue  # da ton tai trong objective nay, bo qua
                kpi = models.KPI(
                    user_id=current_user.id,
                    objective_id=target_obj_id,
                    name=k["name"],
                    weight=0.0,
                    description=(f"[{o['name']}] " if target_obj_id is None else "") + (k.get("note") or ""),
                    unit="%", target_value=100.0, current_value=0.0,
                    category=schemas._normalize_category(k.get("category") or o.get("category")),
                    data_source_mode="export",
                )
                db.add(kpi)
                created.append(kpi)
        db.commit()
        for k in created:
            db.refresh(k)
        if created:
            autonomous_agent.run_category_guard_for_kpis(db, current_user.id, created)
        return created

    # Import binh thuong: merge vao objective cu neu trung ten, tao moi neu chua co
    created = []
    for o in objs:
        key = o["name"].lower().strip()
        if key in existing_by_name:
            obj = existing_by_name[key]
        else:
            obj = models.Objective(
                user_id=current_user.id,
                name=o["name"],
                weight=o["weight"],
                cycle_id=cycle_id,
                category=schemas._normalize_category(o.get("category")),
            )
            db.add(obj)
            db.flush()
        for k in o["kpis"]:
            kpi = models.KPI(
                user_id=current_user.id, objective_id=obj.id,
                name=k["name"], weight=k["weight"],
                description=k.get("note") or "",
                unit="%", target_value=100.0, current_value=0.0,
                category=schemas._normalize_category(k.get("category") or o.get("category")),
                data_source_mode="export",
            )
            db.add(kpi)
            created.append(kpi)
    db.commit()
    for k in created:
        db.refresh(k)
    if created:
        autonomous_agent.run_category_guard_for_kpis(db, current_user.id, created)
    return created


@router.post("/confirm-proposal", response_model=list[schemas.KPIOut])
def confirm_kpi_proposal(
    payload: schemas.KPIProposalConfirm, current_user: CurrentUser, db: Session = Depends(get_db)
):
    """Nguoi dung xac nhan de xuat tu chat: tao Objective MOI truoc -> KPI gan vao -> trong so.

    Toan bo ap dung trong 1 transaction; kiem tra tong trong so TUNG NHOM sau khi ap het —
    vuot 100% thi rollback va bao loi ro rang.
    """
    if not payload.kpis and not payload.weight_changes and not payload.objectives:
        raise HTTPException(400, "Đề xuất trống")
    try:
        if payload.cycle_id is not None:
            _check_cycle_not_locked(db, payload.cycle_id, current_user.id)

        touched_objective_ids: set[int | None] = set()
        # 1) Tao cac Objective MOI truoc (dung thu tu: muc tieu co truoc, KPI gan vao sau)
        new_obj_by_name: dict[str, models.Objective] = {}
        if payload.objectives:
            objective_query = select(models.Objective).where(
                models.Objective.user_id == current_user.id,
                models.Objective.archived == False,  # noqa: E712
            )
            if payload.cycle_id is not None:
                objective_query = objective_query.where(models.Objective.cycle_id == payload.cycle_id)
            existing_objectives = list(db.scalars(objective_query))
            existing_by_category = {
                cat: sum((o.weight or 0) for o in existing_objectives if (o.category or "Work") == cat)
                for cat in schemas.KPI_CATEGORIES
            }
            new_by_category = {cat: 0.0 for cat in schemas.KPI_CATEGORIES}
            for po in payload.objectives:
                new_by_category[po.category] += po.weight
            for cat in ("Work", "Personal"):
                existing_total = existing_by_category.get(cat, 0.0)
                new_total = existing_total + new_by_category.get(cat, 0.0)
                if new_total > 100.001:
                    label = "Work" if cat == "Work" else "Personal"
                    raise HTTPException(
                        400,
                        f"Total objective weight for {label} would be {new_total:.0f}% (over 100%). "
                        f"Remaining capacity is {max(0, 100 - existing_total):.0f}%.",
                    )
            for po in payload.objectives:
                if not po.name.strip():
                    continue
                obj = models.Objective(
                    user_id=current_user.id, name=po.name.strip(),
                    description=po.description, weight=po.weight,
                    category=po.category,
                    cycle_id=payload.cycle_id,
                )
                db.add(obj)
                new_obj_by_name[po.name.strip().lower()] = obj
            db.flush()

        for wc in payload.weight_changes:
            kpi = db.get(models.KPI, wc.kpi_id)
            if not kpi or kpi.archived or kpi.user_id != current_user.id:
                raise HTTPException(404, "Không tìm thấy KPI được chọn để điều chỉnh trọng số")
            _check_kpi_cycle_not_locked(db, kpi, current_user.id)
            if kpi.weight != wc.new_weight:
                touched_objective_ids.add(kpi.objective_id)
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
            # 2) Gan KPI: uu tien tham chieu muc tieu MOI theo ten (objective_ref)
            objective_id = p.objective_id
            if p.objective_ref:
                new_obj = new_obj_by_name.get(p.objective_ref.strip().lower())
                if not new_obj:
                    raise HTTPException(
                        400,
                        f'KPI "{p.name}" tham chiếu mục tiêu mới "{p.objective_ref}" '
                        f"nhưng mục tiêu này không có trong đề xuất.",
                    )
                objective_id = new_obj.id
            elif objective_id is not None:
                obj = _check_objective_cycle_not_locked(db, objective_id, current_user.id)
                if payload.cycle_id is not None and obj.cycle_id != payload.cycle_id:
                    raise HTTPException(400, f'Mục tiêu "{obj.name}" không thuộc chu kỳ đang import')
            touched_objective_ids.add(objective_id)
            kpi = models.KPI(
                user_id=current_user.id, name=p.name, description=p.description, target=p.target,
                unit=p.unit or "%", target_value=p.target_value or 100.0,
                weight=p.weight, deadline=p.deadline, objective_id=objective_id,
                category=p.category or "Work",
                data_source_mode=payload.source_mode,
            )
            db.add(kpi)
            created.append(kpi)
        db.flush()

        # Kiem tra tong trong so cac nhom bi tac dong sau khi ap het thay doi.
        # Khong chan giao dich moi chi vi mot nhom cu, khong lien quan, da vuot 100% tu truoc.
        groups: dict[tuple[int | None, str], float] = {}
        for k in db.scalars(
            select(models.KPI).where(
                models.KPI.user_id == current_user.id,
                models.KPI.archived == False,  # noqa: E712
            )
        ):
            if k.objective_id not in touched_objective_ids:
                continue
            group_category = schemas._normalize_category(k.category) if k.objective_id is None else ""
            key = (k.objective_id, group_category)
            groups[key] = groups.get(key, 0.0) + k.weight
        for (obj_id, group_category), total in groups.items():
            if total > 100.001:
                name = "nhóm chưa gắn mục tiêu"
                if obj_id:
                    obj = db.get(models.Objective, obj_id)
                    name = f'mục tiêu "{obj.name}"' if obj else name
                elif group_category:
                    name = f"{name} ({group_category})"
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
    if created:
        autonomous_agent.run_category_guard_for_kpis(db, current_user.id, created)
    return created


@router.post("/auto-map", response_model=list[schemas.KPIOut])
def auto_map_kpis(
    payload: schemas.AutoMapRequest,
    current_user: CurrentUser,
    db: Session = Depends(get_db),
):
    """LLM phan tich KPI chua gan muc tieu va tu dong gan vao Objective hop ly.

    Di chuyen (cap nhat objective_id) cac KPI da ton tai thay vi tao moi — tranh duplicate.
    Dat trong so = 0 cho tat ca de tranh overflow; nguoi dung tu chinh sau.
    """
    kpis_to_map = list(db.scalars(
        select(models.KPI).where(
            models.KPI.user_id == current_user.id,
            models.KPI.id.in_(payload.kpi_ids),
            models.KPI.archived == False,  # noqa: E712
        )
    ))
    if not kpis_to_map:
        return []
    for kpi in kpis_to_map:
        _check_kpi_cycle_not_locked(db, kpi, current_user.id)

    all_kpis = list(db.scalars(
        select(models.KPI).where(
            models.KPI.user_id == current_user.id,
            models.KPI.archived == False,  # noqa: E712
        )
    ))

    kpi_text = "\n".join(f"- {k.name}: {k.description or ''}" for k in kpis_to_map)
    objs = kpi_service.objectives_with_progress(db, current_user.id)
    obj_names = ", ".join(o.name for o in objs) or "chưa có"

    msg = (
        f"Phân tích {len(kpis_to_map)} KPI sau và tự động gán vào mục tiêu phù hợp "
        f"(tạo mục tiêu mới nếu cần). Mục tiêu hiện có: {obj_names}.\n\n{kpi_text}"
    )

    try:
        new_objs, proposed_kpis, _ = kpi_agent.extract_kpi_proposal(
            db, msg, all_kpis, current_user.id
        )
    except Exception as e:
        raise HTTPException(500, f"Lỗi phân tích LLM: {e}")

    if not new_objs and not proposed_kpis:
        return []

    # Map ten KPI (lowercase) -> doi tuong KPI unassigned can phan bo
    unassigned_by_name = {k.name.lower().strip(): k for k in kpis_to_map}

    # Tao Objective MOI (weight=0) neu LLM de xuat va chua ton tai
    existing_objectives = list(db.scalars(
        select(models.Objective).where(
            models.Objective.user_id == current_user.id,
            models.Objective.archived == False,  # noqa: E712
        )
    ))
    all_obj_by_name: dict[str, models.Objective] = {o.name.lower().strip(): o for o in existing_objectives}
    for po in new_objs:
        if not po.name.strip() or po.name.lower().strip() in all_obj_by_name:
            continue
        obj = models.Objective(
            user_id=current_user.id,
            name=po.name.strip(),
            description=po.description,
            weight=0.0,  # tranh weight overflow; nguoi dung chinh sau
        )
        db.add(obj)
        all_obj_by_name[po.name.lower().strip()] = obj
    db.flush()

    # Di chuyen cac KPI unassigned den objective de xuat (match theo ten)
    moved: list[models.KPI] = []
    for pk in proposed_kpis:
        # Xac dinh objective dich theo thu tu uu tien: ref moi > ten > id
        target_obj: models.Objective | None = None
        if pk.objective_ref:
            target_obj = all_obj_by_name.get(pk.objective_ref.lower().strip())
        elif pk.objective_name:
            target_obj = all_obj_by_name.get(pk.objective_name.lower().strip())
        elif pk.objective_id is not None:
            target_obj = db.get(models.Objective, pk.objective_id)

        if target_obj is None:
            continue  # khong xac dinh duoc objective dich, bo qua
        _check_objective_cycle_not_locked(db, target_obj.id, current_user.id)

        # Match KPI hien tai trong danh sach can phan bo theo ten
        existing_kpi = unassigned_by_name.get(pk.name.lower().strip())
        if existing_kpi is None:
            continue  # khong match, bo qua — tranh tao duplicate

        # Di chuyen KPI den objective dich
        db.add(
            models.KPIChangeLog(
                kpi_id=existing_kpi.id,
                field="objective",
                old_value="(chưa gắn mục tiêu)",
                new_value=target_obj.name,
                reason="Tự động phân bổ qua Agent (import)",
            )
        )
        existing_kpi.objective_id = target_obj.id
        target_category = schemas._normalize_category(target_obj.category)
        if (existing_kpi.category or "Work") != target_category:
            db.add(
                models.KPIChangeLog(
                    kpi_id=existing_kpi.id,
                    field="category",
                    old_value=existing_kpi.category or "Work",
                    new_value=target_category,
                    reason="Đồng bộ phân loại theo mục tiêu đích khi Agent phân bổ",
                )
            )
            existing_kpi.category = target_category
        moved.append(existing_kpi)

    db.commit()
    for k in moved:
        db.refresh(k)
    if moved:
        autonomous_agent.run_category_guard_for_kpis(db, current_user.id, moved)
    return moved


@router.post("/balance", response_model=list[schemas.KPIOut])
def balance_weights(
    payload: schemas.BalanceRequest, current_user: CurrentUser, db: Session = Depends(get_db)
):
    """Tu dong can bang trong so cac KPI trong 1 muc tieu ve dung tong 100%."""
    _check_objective_cycle_not_locked(db, payload.objective_id, current_user.id)
    q = select(models.KPI).where(
        models.KPI.user_id == current_user.id,
        models.KPI.archived == False,  # noqa: E712
    )
    q = q.where(
        models.KPI.objective_id == payload.objective_id
        if payload.objective_id is not None
        else models.KPI.objective_id.is_(None)
    )
    if payload.objective_id is None:
        q = q.where(models.KPI.category == payload.category)
    kpis = list(db.scalars(q))
    if not kpis:
        raise HTTPException(404, "Nhóm này không có KPI nào để cân bằng")
    total = sum(k.weight for k in kpis)
    if total <= 0:
        base = 100 // len(kpis)
        remainder = 100 - base * len(kpis)
        new_weights = [base + (1 if i < remainder else 0) for i in range(len(kpis))]
    else:
        raw = [(k.weight * 100 / total) for k in kpis]
        floors = [int(v) for v in raw]
        remainder = 100 - sum(floors)
        order = sorted(range(len(raw)), key=lambda i: raw[i] - floors[i], reverse=True)
        new_weights = floors[:]
        for i in order[:remainder]:
            new_weights[i] += 1
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
    _check_kpi_cycle_not_locked(db, kpi, current_user.id)
    changes = payload.model_dump(exclude_unset=True, exclude={"reason", "clear_objective"})
    # Source provenance is system-owned; manual edits must not rewrite it.
    changes.pop("data_source_mode", None)
    warning = changes.get("warning_threshold", kpi.warning_threshold)
    critical = changes.get("critical_threshold", kpi.critical_threshold)
    if warning is not None and critical is not None and float(critical) > float(warning):
        raise HTTPException(400, "Ngưỡng critical phải nhỏ hơn hoặc bằng warning")

    # xac dinh muc tieu va trong so SAU thay doi de kiem tra dung nhom dich
    new_obj_id = changes.pop("objective_id", None)
    if payload.clear_objective:
        new_obj_id = None
    moving = payload.clear_objective or new_obj_id is not None
    final_obj_id = new_obj_id if moving else kpi.objective_id
    _check_objective_cycle_not_locked(db, final_obj_id, current_user.id)
    final_weight = changes.get("weight") if changes.get("weight") is not None else kpi.weight
    final_category = changes.get("category") if changes.get("category") is not None else (kpi.category or "Work")
    _check_group_weight(
        db,
        final_weight,
        final_obj_id,
        category=final_category,
        exclude_id=kpi_id,
        user_id=current_user.id,
    )

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
    autonomous_agent.run_category_guard_for_kpis(db, current_user.id, [kpi])
    return kpi


@router.get("/{kpi_id}/period-metrics", response_model=list[schemas.KPIPeriodMetricOut])
def list_kpi_period_metrics(kpi_id: int, current_user: CurrentUser, db: Session = Depends(get_db)):
    kpi = db.get(models.KPI, kpi_id)
    if not kpi or kpi.user_id != current_user.id:
        raise HTTPException(404, "Không tìm thấy KPI")
    return kpi_service.list_period_metrics(db, kpi)


@router.post("/{kpi_id}/period-metrics", response_model=schemas.KPIPeriodMetricOut)
def upsert_kpi_period_metric(
    kpi_id: int,
    payload: schemas.KPIPeriodMetricUpsert,
    current_user: CurrentUser,
    db: Session = Depends(get_db),
):
    kpi = db.get(models.KPI, kpi_id)
    if not kpi or kpi.user_id != current_user.id:
        raise HTTPException(404, "Không tìm thấy KPI")
    _check_kpi_cycle_not_locked(db, kpi, current_user.id)
    return kpi_service.upsert_period_metric(db, kpi, payload)


@router.delete("/{kpi_id}")
def archive_kpi(kpi_id: int, current_user: CurrentUser, reason: str = "", db: Session = Depends(get_db)):
    kpi = db.get(models.KPI, kpi_id)
    if not kpi or kpi.user_id != current_user.id:
        raise HTTPException(404, "Không tìm thấy KPI")
    _check_kpi_cycle_not_locked(db, kpi, current_user.id)
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
    _check_kpi_cycle_not_locked(db, kpi, current_user.id)
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


@router.get("/{kpi_id}/forecast", response_model=schemas.KPIForecastOut)
def kpi_forecast(kpi_id: int, current_user: CurrentUser, db: Session = Depends(get_db)):
    """Du bao kha nang hoan thanh KPI theo van toc lich su (AI Predictive Runrate)."""
    kpi = db.get(models.KPI, kpi_id)
    if not kpi or kpi.user_id != current_user.id or kpi.archived:
        raise HTTPException(404, "Không tìm thấy KPI")
    return kpi_service.forecast_kpi(db, kpi)


@router.post("/{kpi_id}/coach", response_model=schemas.CoachingOut)
def coach_kpi_endpoint(
    kpi_id: int, current_user: CurrentUser, lang: str = "vi", db: Session = Depends(get_db)
):
    """Phân tích nguyên nhân gốc rễ (RCA) + đề xuất việc khắc phục cho 1 KPI (gọi LLM)."""
    kpi = db.get(models.KPI, kpi_id)
    if not kpi or kpi.user_id != current_user.id or kpi.archived:
        raise HTTPException(404, "Không tìm thấy KPI")
    health, gap = kpi_service.health_of(kpi)
    try:
        analysis, causes, proposed = kpi_agent.coach_kpi(db, kpi, current_user.id, lang)
    except Exception:
        raise HTTPException(502, "Agent không phân tích được lúc này, thử lại sau.")
    return schemas.CoachingOut(
        kpi_id=kpi.id, kpi_name=kpi.name, health=health, gap=gap,
        analysis=analysis, root_causes=causes, proposed_items=proposed,
    )


@router.post("/conflicts/analyze", response_model=schemas.ConflictAnalysisOut)
def analyze_conflicts(
    current_user: CurrentUser,
    db: Session = Depends(get_db),
    cycle_id: int | None = Query(None),
):
    """Phat hien cac KPI mau thuan nhau (goi LLM) va goi y cach can bang."""
    q = select(models.KPI).where(
            models.KPI.user_id == current_user.id,
            models.KPI.archived == False,  # noqa: E712
        )
    if cycle_id is not None:
        q = q.join(models.Objective, models.KPI.objective_id == models.Objective.id).where(
            models.Objective.cycle_id == cycle_id,
            models.Objective.archived == False,  # noqa: E712
        )
    kpis = list(db.scalars(q))
    if len(kpis) < 2:
        return schemas.ConflictAnalysisOut(conflicts=[], analyzed_kpis=len(kpis))
    try:
        conflicts = kpi_agent.detect_conflicts(kpis)
    except Exception:
        raise HTTPException(502, "Agent không phân tích được xung đột lúc này, thử lại sau.")
    return schemas.ConflictAnalysisOut(conflicts=conflicts, analyzed_kpis=len(kpis))


@router.get("/changelog/all")
def all_changelog(
    current_user: CurrentUser,
    limit: int = 300,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=5, le=100),
    field: str | None = Query(None),
    kpi_id: int | None = Query(None),
    search: str | None = Query(None),
    db: Session = Depends(get_db),
):
    """Toan bo lich su thay doi KPI — bao gom ca KPI da go bo."""
    q = (
        select(models.KPIChangeLog)
        .join(models.KPI)
        .where(models.KPI.user_id == current_user.id)
    )
    if field:
        q = q.where(models.KPIChangeLog.field == field)
    if kpi_id:
        q = q.where(models.KPIChangeLog.kpi_id == kpi_id)
    if search:
        like = f"%{search.strip()}%"
        q = q.where(
            or_(
                models.KPI.name.ilike(like),
                models.KPIChangeLog.field.ilike(like),
                models.KPIChangeLog.old_value.ilike(like),
                models.KPIChangeLog.new_value.ilike(like),
                models.KPIChangeLog.reason.ilike(like),
            )
        )
    total = db.scalar(select(func.count()).select_from(q.subquery())) or 0
    size = min(page_size, limit)
    logs = list(
        db.scalars(
            q.order_by(models.KPIChangeLog.changed_at.desc())
            .offset((page - 1) * size)
            .limit(size)
        )
    )
    return {"items": [schemas.ChangeLogOut.model_validate(l) for l in logs], "total": total, "page": page, "page_size": size}


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
    """Khoi phuc KPI da go bo. Neu objective cha da go bo thi khoi phuc objective do de KPI hien lai."""
    kpi = db.get(models.KPI, kpi_id)
    if not kpi or not kpi.archived or kpi.user_id != current_user.id:
        raise HTTPException(404, "Khong tim thay KPI da go bo")

    note = ""
    if kpi.objective_id is not None:
        obj = db.get(models.Objective, kpi.objective_id)
        if obj and obj.user_id == current_user.id:
            _check_cycle_not_locked(db, obj.cycle_id, current_user.id)
        if obj and obj.user_id == current_user.id and obj.archived:
            active_objectives = db.scalars(
                select(models.Objective).where(
                    models.Objective.user_id == current_user.id,
                    models.Objective.archived == False,  # noqa: E712
                    models.Objective.cycle_id == obj.cycle_id,
                )
            )
            available_obj_weight = max(0.0, 100.0 - sum(o.weight for o in active_objectives))
            if obj.weight > available_obj_weight:
                obj.weight = available_obj_weight
                note += f" (muc tieu cha khoi phuc voi trong so {available_obj_weight:g}%)"
            else:
                note += " (da khoi phuc muc tieu cha)"
            obj.archived = False

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
    if kpi.weight > available:
        db.add(
            models.KPIChangeLog(
                kpi_id=kpi.id, field="weight",
                old_value=str(kpi.weight), new_value=str(available),
                reason=f"Ha trong so khi khoi phuc (nhom chi con trong {available:g}%)",
            )
        )
        kpi.weight = available
        note += f" (trong so ha con {available:g}%)"
    kpi.archived = False
    db.add(
        models.KPIChangeLog(
            kpi_id=kpi.id, field="archived", old_value="True", new_value="False",
            reason="Khoi phuc KPI" + note,
        )
    )
    db.commit()
    db.refresh(kpi)
    return kpi


@router.delete("/{kpi_id}/permanent", status_code=204)
def delete_kpi_permanent(kpi_id: int, current_user: CurrentUser, db: Session = Depends(get_db)):
    """Xoa vinh vien KPI da archive. KPI dang hoat dong van phai archive truoc."""
    kpi = db.get(models.KPI, kpi_id)
    if not kpi or kpi.user_id != current_user.id:
        raise HTTPException(404, "Không tìm thấy KPI")
    if not kpi.archived:
        raise HTTPException(400, "Chỉ có thể xoá vĩnh viễn KPI đã gỡ bỏ")
    for item in list(kpi.work_items):
        item.kpi_id = None
    db.delete(kpi)
    db.commit()


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

@router.post("/confirm-delete")
def confirm_delete(payload: schemas.ConfirmDeleteRequest, current_user: CurrentUser, db: Session = Depends(get_db)):
    """Xac nhan xoa KPI hoac Objective - archive thay vi hard delete."""
    target_type = payload.target_type
    target_id = payload.target_id
    reason = payload.reason
    
    if target_type == "kpi":
        kpi = db.get(models.KPI, target_id)
        if not kpi or kpi.user_id != current_user.id:
            raise HTTPException(404, "Khong tim thay KPI")
        _check_kpi_cycle_not_locked(db, kpi, current_user.id)
        kpi.archived = True
        db.add(
            models.KPIChangeLog(
                kpi_id=kpi.id, field="archived", old_value="False", new_value="True", reason=reason
            )
        )
        db.commit()
        return {"ok": True, "message": f"Da xoa KPI '{kpi.name}'"}
    
    elif target_type == "objective":
        obj = db.get(models.Objective, target_id)
        if not obj or obj.user_id != current_user.id:
            raise HTTPException(404, "Khong tim thay muc tieu")
        _check_cycle_not_locked(db, obj.cycle_id, current_user.id)
        # Archive all KPIs in this objective first
        kpis = db.query(models.KPI).filter(
            models.KPI.objective_id == target_id,
            models.KPI.user_id == current_user.id,
            models.KPI.archived == False,  # noqa: E712
        ).all()
        for kpi in kpis:
            kpi.archived = True
            log_reason = f"Lưu trữ theo mục tiêu đã xóa: {obj.name}"
            if reason:
                log_reason += f" — {reason}"
            db.add(
                models.KPIChangeLog(
                    kpi_id=kpi.id, field="archived", old_value="False", new_value="True",
                    reason=log_reason
                )
            )
        # Archive the objective
        obj.archived = True
        db.commit()
        return {"ok": True, "message": f"Da xoa muc tieu '{obj.name}' va {len(kpis)} KPI ben trong"}
    
    else:
        raise HTTPException(400, "Loai muc tieu khong hop le")


@router.post("/{kpi_id}/validate-smart")
def validate_smart(kpi_id: int, current_user: CurrentUser, db: Session = Depends(get_db)):
    """Danh gia KPI theo 5 tieu chi SMART bang LLM.
    Tra ve: {valid, scores: {S,M,A,R,T}, issues: [...], suggestions: [...]}
    """
    kpi = db.get(models.KPI, kpi_id)
    if not kpi or kpi.user_id != current_user.id or kpi.archived:
        raise HTTPException(404, "Không tìm thấy KPI")

    deadline_str = str(kpi.deadline) if kpi.deadline else f"{kpi.year}-12-31"
    kpi_block = (
        f"Tên: {kpi.name}\n"
        f"Mô tả: {kpi.description or '(chưa có)'}\n"
        f"Diễn giải chỉ tiêu: {kpi.target or '(chưa có)'}\n"
        f"Đơn vị đo: {kpi.unit}\n"
        f"Chỉ tiêu (số): {kpi.target_value}\n"
        f"Thực đạt hiện tại: {kpi.current_value}\n"
        f"Deadline: {deadline_str}"
    )

    system = SMART_VALIDATE_SYSTEM.format(kpi_block=kpi_block, today=date.today().isoformat())
    result = call_json(system, "Hãy đánh giá KPI theo tiêu chí SMART.")

    # Dam bao cau truc dau ra day du
    scores = result.get("scores", {})
    for k in ("S", "M", "A", "R", "T"):
        if k not in scores:
            scores[k] = 0
    result["scores"] = scores
    result.setdefault("valid", all(v >= 1 for v in scores.values()))
    result.setdefault("issues", [])
    result.setdefault("suggestions", [])
    return result
