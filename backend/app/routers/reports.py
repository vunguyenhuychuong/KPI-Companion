from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models, schemas
from ..agent import agent as kpi_agent
from ..auth import CurrentUser
from ..database import get_db
from ..services import kpi_service, report_service

router = APIRouter(prefix="/api/reports", tags=["reports"])


def _period_range(period_type: str, period_label: str | None) -> tuple[str, str, date, date]:
    """Tinh (nhan hien thi, khoa chuan period_key, ngay bat dau, ngay ket thuc) cua ky."""
    today = date.today()
    if period_type == "week":
        anchor = today
        if period_label:
            try:
                anchor = date.fromisoformat(period_label[:10])
            except ValueError:
                raise HTTPException(400, "period_label tuần phải là một ngày dạng YYYY-MM-DD")
        start = anchor - timedelta(days=anchor.weekday())
        end = start + timedelta(days=6)
        label = f"Tuần {start.strftime('%d/%m')}–{end.strftime('%d/%m/%Y')}"
        return label, start.isoformat(), start, end
    if period_type == "month":
        key = period_label or f"{today.year}-{today.month:02d}"
        try:
            y, m = int(key[:4]), int(key[5:7])
        except ValueError:
            raise HTTPException(400, "period_label tháng phải dạng YYYY-MM, vd 2026-06")
        start = date(y, m, 1)
        end = (date(y + (m // 12), m % 12 + 1, 1) - timedelta(days=1))
        return f"Tháng {m:02d}/{y}", f"{y}-{m:02d}", start, end
    if period_type == "quarter":
        if period_label:
            try:
                q = int(period_label[1])
                y = int(period_label[-4:])
            except (ValueError, IndexError):
                raise HTTPException(400, "period_label quý phải dạng Q2/2026")
        else:
            q, y = (today.month - 1) // 3 + 1, today.year
        start = date(y, (q - 1) * 3 + 1, 1)
        end_month = q * 3
        end = date(y + (end_month // 12), end_month % 12 + 1, 1) - timedelta(days=1)
        return f"Q{q}/{y}", f"Q{q}/{y}", start, end
    if period_type == "year":
        y = int(period_label) if period_label else today.year
        return f"Năm {y}", str(y), date(y, 1, 1), date(y, 12, 31)
    raise HTTPException(400, "period_type phải là week|month|quarter|year")


def _generate_and_save(
    db: Session, period_type: str, period_label: str | None, user_id: int
) -> models.SavedReport:
    """Sinh bao cao; neu da co bao cao CUNG KY thi cap nhat de (update content + thoi gian)."""
    label, key, start, end = _period_range(period_type, period_label)
    try:
        content = kpi_agent.period_report(db, period_type, label, start, end, user_id=user_id)
    except Exception as e:
        raise HTTPException(502, f"Lỗi khi gọi AI model: {e}")
    existing = db.scalars(
        select(models.SavedReport).where(
            models.SavedReport.user_id == user_id,
            models.SavedReport.period_type == period_type,
            models.SavedReport.period_key == key,
        )
    ).first()
    if existing:
        existing.content = content
        existing.created_at = models.utcnow()
        db.commit()
        db.refresh(existing)
        return existing
    report = models.SavedReport(
        user_id=user_id, period_type=period_type, period_label=label, period_key=key, content=content
    )
    db.add(report)
    db.commit()
    db.refresh(report)
    return report


@router.get("/dashboard")
def dashboard(current_user: CurrentUser, db: Session = Depends(get_db)):
    return kpi_service.build_dashboard(db, user_id=current_user.id)


@router.get("/weekly")
def weekly(current_user: CurrentUser, db: Session = Depends(get_db)):
    """Ban tong ket tuan nhanh (nut tren Dashboard)."""
    return {"report": kpi_agent.weekly_report(db, user_id=current_user.id)}


@router.post("/generate", response_model=schemas.SavedReportOut)
def generate_report(
    payload: schemas.ReportGenerateRequest, current_user: CurrentUser, db: Session = Depends(get_db)
):
    """Agent viet bao cao ky (so sanh voi ke hoach SMART). Cung ky -> cap nhat ban cu."""
    return _generate_and_save(db, payload.period_type, payload.period_label, user_id=current_user.id)


@router.post("/saved/{report_id}/regenerate", response_model=schemas.SavedReportOut)
def regenerate_report(report_id: int, current_user: CurrentUser, db: Session = Depends(get_db)):
    """Tao lai bao cao da co voi du lieu moi nhat (giu nguyen ky)."""
    report = db.get(models.SavedReport, report_id)
    if not report or report.user_id != current_user.id:
        raise HTTPException(404, "Không tìm thấy báo cáo")
    return _generate_and_save(db, report.period_type, report.period_key or None, user_id=current_user.id)


@router.get("/saved", response_model=list[schemas.SavedReportOut])
def list_saved(current_user: CurrentUser, db: Session = Depends(get_db)):
    return list(
        db.scalars(
            select(models.SavedReport)
            .where(models.SavedReport.user_id == current_user.id)
            .order_by(models.SavedReport.created_at.desc())
        )
    )


@router.delete("/saved/{report_id}")
def delete_saved(report_id: int, current_user: CurrentUser, db: Session = Depends(get_db)):
    report = db.get(models.SavedReport, report_id)
    if not report or report.user_id != current_user.id:
        raise HTTPException(404, "Không tìm thấy báo cáo")
    db.delete(report)
    db.commit()
    return {"ok": True}


@router.get("/export")
def export_excel(current_user: CurrentUser, db: Session = Depends(get_db)):
    data = report_service.export_evaluation_excel(db, user_id=current_user.id)
    filename = f"bao-cao-kpi-{date.today().isoformat()}.xlsx"
    return Response(
        content=data,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
