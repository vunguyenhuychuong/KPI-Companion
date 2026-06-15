"""D5: Share Report — tạo/quản lý link chia sẻ báo cáo KPI (không cần đăng nhập để xem)."""
import uuid
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models, schemas
from ..auth import CurrentUser
from ..database import get_db

router = APIRouter(tags=["share_links"])
public_router = APIRouter(tags=["shared"])


@router.get("/api/cycles/{cycle_id}/share-links", response_model=list[schemas.ShareLinkOut])
def list_share_links(cycle_id: int, current_user: CurrentUser, db: Session = Depends(get_db)):
    """Liệt kê tất cả share links của một cycle."""
    cycle = db.get(models.KPICycle, cycle_id)
    if not cycle or cycle.user_id != current_user.id:
        raise HTTPException(404, "Không tìm thấy chu kỳ")
    links = db.scalars(
        select(models.ShareLink)
        .where(models.ShareLink.cycle_id == cycle_id)
        .order_by(models.ShareLink.created_at.desc())
    ).all()
    return list(links)


@router.post("/api/cycles/{cycle_id}/share-links", response_model=schemas.ShareLinkOut, status_code=201)
def create_share_link(
    cycle_id: int,
    payload: schemas.ShareLinkCreate,
    current_user: CurrentUser,
    db: Session = Depends(get_db),
):
    """Tạo link chia sẻ mới cho cycle."""
    cycle = db.get(models.KPICycle, cycle_id)
    if not cycle or cycle.user_id != current_user.id:
        raise HTTPException(404, "Không tìm thấy chu kỳ")

    token = str(uuid.uuid4())
    expires_at = datetime.now() + timedelta(days=payload.expires_in_days)
    link = models.ShareLink(
        cycle_id=cycle_id,
        created_by=current_user.id,
        token=token,
        expires_at=expires_at,
    )
    db.add(link)
    db.commit()
    db.refresh(link)
    return link


@router.delete("/api/share-links/{token}", status_code=204)
def revoke_share_link(token: str, current_user: CurrentUser, db: Session = Depends(get_db)):
    """Hủy (revoke) một share link."""
    link = db.scalars(
        select(models.ShareLink).where(models.ShareLink.token == token)
    ).first()
    if not link:
        raise HTTPException(404, "Không tìm thấy share link")
    # Kiểm tra quyền: chỉ người tạo mới được revoke
    if link.created_by != current_user.id:
        raise HTTPException(403, "Không có quyền hủy link này")
    link.revoked_at = datetime.now()
    db.commit()


@public_router.get("/api/shared/{token}")
def view_shared_report(token: str, db: Session = Depends(get_db)):
    """Xem báo cáo KPI qua share link — không cần đăng nhập."""
    link = db.scalars(
        select(models.ShareLink).where(models.ShareLink.token == token)
    ).first()
    if not link:
        raise HTTPException(410, "Link không tồn tại hoặc đã hết hạn")
    if link.revoked_at is not None:
        raise HTTPException(410, "Link đã bị hủy")
    if link.expires_at < datetime.now():
        raise HTTPException(410, "Link đã hết hạn")

    cycle = db.get(models.KPICycle, link.cycle_id)
    if not cycle:
        raise HTTPException(410, "Chu kỳ không còn tồn tại")

    # Lấy objectives + KPIs trực tiếp từ SQLAlchemy model (ObjectiveOut không có .kpis)
    raw_objectives = db.scalars(
        select(models.Objective)
        .where(
            models.Objective.user_id == cycle.user_id,
            models.Objective.cycle_id == cycle.id,
            models.Objective.archived == False,  # noqa: E712
        )
        .order_by(models.Objective.id)
    ).all()

    objs_out = []
    for obj in raw_objectives:
        kpis_out = []
        for kpi in obj.kpis:
            if kpi.archived:
                continue
            target = float(kpi.target_value) if kpi.target_value else 0.0
            current = float(kpi.current_value) if kpi.current_value else 0.0
            progress = round((current / target * 100) if target > 0 else 0.0, 1)
            kpis_out.append({
                "id": kpi.id,
                "name": kpi.name,
                "unit": kpi.unit or "",
                "target_value": target,
                "current_value": current,
                "progress": progress,
                "progress_capped": min(progress, 100.0),
                "deadline": kpi.deadline.isoformat() if kpi.deadline else None,
                "category": kpi.category or "",
            })
        # Tính progress của objective từ KPIs
        active_kpis = [k for k in obj.kpis if not k.archived]
        if active_kpis:
            total_w = sum(float(k.weight or 0) for k in active_kpis)
            if total_w > 0:
                obj_progress = sum(
                    float(k.weight or 0) * min((float(k.current_value or 0) / float(k.target_value) * 100 if float(k.target_value or 0) > 0 else 0.0), 100.0)
                    for k in active_kpis
                ) / total_w
            else:
                vals = [min((float(k.current_value or 0) / float(k.target_value) * 100 if float(k.target_value or 0) > 0 else 0.0), 100.0) for k in active_kpis]
                obj_progress = sum(vals) / len(vals)
        else:
            obj_progress = 0.0
        objs_out.append({
            "id": obj.id,
            "name": obj.name,
            "weight": float(obj.weight or 0),
            "progress": round(obj_progress, 1),
            "kpis": kpis_out,
        })

    return {
        "cycle": {
            "id": cycle.id,
            "name": cycle.name,
            "cycle_type": cycle.cycle_type,
            "start_date": cycle.start_date.isoformat() if cycle.start_date else None,
            "end_date": cycle.end_date.isoformat() if cycle.end_date else None,
            "is_locked": cycle.is_locked,
        },
        "objectives": objs_out,
        "share_link": {
            "token": token,
            "expires_at": link.expires_at.isoformat(),
        },
    }
