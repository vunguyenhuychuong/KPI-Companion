from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models, schemas
from ..agent import agent as kpi_agent
from ..auth import CurrentUser
from ..database import get_db
from ..services import email_service, export_service, kpi_service, report_service

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
def dashboard(
    current_user: CurrentUser,
    cycle_id: int | None = Query(None),
    db: Session = Depends(get_db),
):
    if cycle_id is not None:
        cycle = db.get(models.KPICycle, cycle_id)
        if not cycle or cycle.user_id != current_user.id:
            raise HTTPException(404, "KhÃ´ng tÃ¬m tháº¥y chu ká»³")
    return kpi_service.build_dashboard(db, user_id=current_user.id, cycle_id=cycle_id)


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


@router.get("/export-data")
def export_data(
    current_user: CurrentUser,
    formats: str = "csv",
    sections: str = "kpis",
    db: Session = Depends(get_db),
):
    """Xuat du lieu theo dinh dang + pham vi nguoi dung chon (comma-separated).

    formats: csv,md,json,xlsx,pdf,docx | sections: kpis,work_items,changelog,reports.
    1 file -> tai thang; nhieu file -> .zip.
    """
    fmt = [f.strip() for f in formats.split(",") if f.strip()]
    sec = [s.strip() for s in sections.split(",") if s.strip()]
    bad_fmt = [f for f in fmt if f not in export_service.VALID_FORMATS]
    if bad_fmt:
        raise HTTPException(400, f"Định dạng không hỗ trợ: {', '.join(bad_fmt)}")
    try:
        filename, content, media = export_service.build_export(db, current_user.id, sec, fmt)
    except Exception as e:
        raise HTTPException(500, f"Lỗi khi tạo file xuất: {e}")
    return Response(
        content=content,
        media_type=media,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/send-to-manager", response_model=schemas.ManagerSendResult)
def send_to_manager(
    payload: schemas.ManagerSendRequest, current_user: CurrentUser, db: Session = Depends(get_db)
):
    """Ủy quyền giám sát (Accountability Proxy): gửi báo cáo tiến độ cho quản lý/mentor.

    Nếu đã cấu hình SMTP trong .env -> gửi thật.
    Nếu chưa cấu hình -> trả về mock (xem trước nội dung).
    Báo cáo đã LỌC: chỉ gồm KPI công việc, ẩn KPI cá nhân (cô lập ngữ cảnh M5).
    """
    channel = payload.channel if payload.channel in {"email", "webhook"} else "email"
    recipient = (payload.recipient or "").strip()
    if not recipient:
        raise HTTPException(400, "Vui lòng nhập email hoặc URL webhook của người nhận.")
    if channel == "email" and "@" not in recipient:
        raise HTTPException(400, "Email người nhận không hợp lệ.")
    if channel == "webhook" and not recipient.startswith(("http://", "https://")):
        raise HTTPException(400, "URL webhook phải bắt đầu bằng http:// hoặc https://")

    body = payload.content or export_service.build_manager_report(db, current_user.id)
    subject = payload.subject or f"[KPI Companion] Báo cáo tiến độ — {current_user.name or 'Người dùng'} — {date.today().isoformat()}"

    # Gửi thật nếu đã cấu hình SMTP
    if channel == "email" and email_service.is_smtp_configured():
        try:
            result = email_service.send_email(
                to_email=recipient,
                subject=subject,
                body=body,
            )
            return schemas.ManagerSendResult(
                mocked=False,
                channel=channel,
                recipient=recipient,
                subject=subject,
                body=body,
                note=f"✅ Đã gửi thật đến {recipient}",
            )
        except Exception as e:
            # Nếu gửi thất bại vẫn trả về để người dùng biết
            return schemas.ManagerSendResult(
                mocked=True,
                channel=channel,
                recipient=recipient,
                subject=subject,
                body=body,
                note=f"⚠️ Gửi thất bại: {str(e)}",
            )

    # MOCK mode khi chưa cấu hình SMTP
    return schemas.ManagerSendResult(
        mocked=True,
        channel=channel,
        recipient=recipient,
        subject=subject,
        body=body,
        note=(
            "Chế độ mô phỏng: chưa gửi thật. Đây là nội dung sẽ được gửi (đã ẩn KPI cá nhân). "
            "Để gửi thật, cấu hình SMTP trong file .env"
        ),
    )


@router.post("/self-review", response_model=schemas.SavedReportOut)
def generate_self_review(current_user: CurrentUser, db: Session = Depends(get_db)):
    """Sinh ban tu danh gia cuoi ky bang LLM; upsert theo nam hien tai."""
    year = date.today().year
    period_label = f"Tự đánh giá {year}"
    period_key = f"self_review-{year}"
    try:
        content = kpi_agent.self_review(db, period_label, user_id=current_user.id)
    except Exception as e:
        raise HTTPException(502, f"Lỗi khi gọi AI model: {e}")

    existing = db.scalars(
        select(models.SavedReport).where(
            models.SavedReport.user_id == current_user.id,
            models.SavedReport.period_type == "self_review",
            models.SavedReport.period_key == period_key,
        )
    ).first()
    if existing:
        existing.content = content
        existing.created_at = models.utcnow()
        db.commit()
        db.refresh(existing)
        return existing

    report = models.SavedReport(
        user_id=current_user.id,
        period_type="self_review",
        period_label=period_label,
        period_key=period_key,
        content=content,
    )
    db.add(report)
    db.commit()
    db.refresh(report)
    return report


@router.get("/saved/{report_id}/export")
def export_saved_report(
    report_id: int,
    current_user: CurrentUser,
    db: Session = Depends(get_db),
    format: str = "pdf",
):
    """Xuat bao cao da luu ra PDF."""
    report = db.get(models.SavedReport, report_id)
    if not report or report.user_id != current_user.id:
        raise HTTPException(404, "Không tìm thấy báo cáo")
    if format != "pdf":
        raise HTTPException(400, "format phải là pdf")

    stamp = date.today().isoformat()
    data = report_service.export_report_pdf(report.period_label, report.content)
    return Response(
        content=data,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="tu-danh-gia-{stamp}.pdf"'},
    )


@router.post("/quick-send-email")
def quick_send_email(
    recipient: str,
    subject: str,
    content: str,
):
    """Gửi email nhanh qua SMTP đã cấu hình.

    Dùng để gửi báo cáo trực tiếp mà không cần qua bước chọn kênh.
    """
    if not email_service.is_smtp_configured():
        raise HTTPException(400, "Chưa cấu hình SMTP. Vui lòng cấu hình SMTP trong .env")

    if "@" not in recipient:
        raise HTTPException(400, "Email người nhận không hợp lệ")

    try:
        result = email_service.send_email(
            to_email=recipient,
            subject=subject,
            body=content,
        )
        return {"success": True, "message": f"✅ Đã gửi đến {recipient}", "data": result}
    except Exception as e:
        raise HTTPException(500, f"Gửi thất bại: {str(e)}")


@router.get("/export-appraisal")
def export_appraisal(current_user: CurrentUser, db: Session = Depends(get_db)):
    """Xuat dung mau Performance Appraisal cua cong ty (import nguoc lai duoc).

    Chua co KPI -> tra ve template trong de dien tay.
    """
    data = report_service.export_appraisal_excel(db, current_user)
    filename = f"performance-appraisal-{date.today().isoformat()}.xlsx"
    return Response(
        content=data,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
