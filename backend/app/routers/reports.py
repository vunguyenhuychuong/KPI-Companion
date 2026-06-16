import hashlib
import json
from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models, schemas
from ..agent import agent as kpi_agent
from ..agent import prompts
from ..agent.llm import call_json
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


def _validate_cycle(db: Session, cycle_id: int | None, user_id: int) -> None:
    if cycle_id is None:
        return
    cycle = db.get(models.KPICycle, cycle_id)
    if not cycle or cycle.user_id != user_id:
        raise HTTPException(404, "Không tìm thấy chu kỳ")


def _dashboard_insight_payload(dash: schemas.DashboardOut) -> dict:
    obj_names = {o.id: o.name for o in dash.objectives}
    ranked_kpis = sorted(
        dash.kpi_statuses,
        key=lambda s: (
            0 if s.health == "red" else 1 if s.health == "yellow" else 2,
            s.gap,
            -(s.kpi.weight or 0),
        ),
    )
    return {
        "year": dash.year,
        "overall_progress": dash.overall_progress,
        "objectives": [
            {
                "id": o.id,
                "name": o.name,
                "weight": o.weight,
                "progress": o.progress,
                "kpi_count": o.kpi_count,
            }
            for o in dash.objectives
        ],
        "kpis": [
            {
                "id": s.kpi.id,
                "name": s.kpi.name,
                "category": s.kpi.category,
                "objective_id": s.kpi.objective_id,
                "objective_name": obj_names.get(s.kpi.objective_id, ""),
                "weight": s.kpi.weight,
                "unit": s.kpi.unit,
                "target_value": s.kpi.target_value,
                "current_value": s.kpi.current_value,
                "progress": s.kpi.progress,
                "expected_progress": s.expected_progress,
                "gap": s.gap,
                "health": s.health,
                "deadline": s.kpi.deadline.isoformat() if s.kpi.deadline else None,
            }
            for s in ranked_kpis[:12]
        ],
        "warnings": dash.warnings[:5],
        "recent_items": [
            {
                "id": w.id,
                "title": w.title,
                "status": w.status,
                "kpi_id": w.kpi_id,
                "progress_delta": w.progress_delta,
                "work_date": w.work_date.isoformat() if w.work_date else None,
                "created_at": w.created_at.isoformat() if w.created_at else None,
            }
            for w in dash.recent_items[:10]
        ],
        "todo_items": [
            {
                "id": w.id,
                "title": w.title,
                "status": w.status,
                "kpi_id": w.kpi_id,
                "work_date": w.work_date.isoformat() if w.work_date else None,
            }
            for w in dash.todo_items[:8]
        ],
        "weekly_activity": dash.weekly_activity[-6:],
    }


def _dashboard_signature(payload: dict) -> str:
    raw = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]


def _clean_str(value, fallback: str) -> str:
    text = str(value or "").strip()
    return text or fallback


def _clean_kpi_id(value, valid_ids: set[int]) -> int | None:
    try:
        candidate = int(value)
    except (TypeError, ValueError):
        return None
    return candidate if candidate in valid_ids else None


@router.get("/dashboard")
def dashboard(
    current_user: CurrentUser,
    cycle_id: int | None = Query(None),
    category: str = Query("Work"),
    db: Session = Depends(get_db),
):
    _validate_cycle(db, cycle_id, current_user.id)
    cat = None if category == "all" else schemas._normalize_category(category)
    return kpi_service.build_dashboard(db, user_id=current_user.id, cycle_id=cycle_id, category=cat)


@router.post("/dashboard-insight", response_model=schemas.DashboardInsightOut)
def dashboard_insight(
    current_user: CurrentUser,
    cycle_id: int | None = Query(None),
    category: str = Query("Work"),
    db: Session = Depends(get_db),
):
    """Sinh AI Insight cho Dashboard bằng LLM, chỉ đọc dữ liệu, không ghi DB."""
    _validate_cycle(db, cycle_id, current_user.id)
    cat = None if category == "all" else schemas._normalize_category(category)
    dash = kpi_service.build_dashboard(db, user_id=current_user.id, cycle_id=cycle_id, category=cat)
    payload = _dashboard_insight_payload(dash)
    signature = _dashboard_signature(payload)
    valid_ids = {item["id"] for item in payload["kpis"]}
    user_prompt = json.dumps(
        {
            "today": date.today().isoformat(),
            "data_signature": signature,
            "dashboard": payload,
        },
        ensure_ascii=False,
    )
    try:
        result = call_json(
            prompts.DASHBOARD_INSIGHT_SYSTEM,
            user_prompt,
            temperature=0.2,
            max_tokens=900,
        )
    except Exception as e:
        raise HTTPException(502, f"Lỗi khi gọi AI model: {e}")

    if not isinstance(result, dict):
        raise HTTPException(502, "AI model trả về JSON không đúng định dạng.")
    actions = result.get("suggested_actions") if isinstance(result, dict) else []
    if not isinstance(actions, list):
        actions = []
    actions = [str(a).strip() for a in actions if str(a).strip()][:4]
    return schemas.DashboardInsightOut(
        generated_at=models.utcnow(),
        data_signature=signature,
        top_strength=_clean_str(result.get("top_strength"), "Chưa đủ dữ liệu để xác định điểm mạnh rõ."),
        top_risk=_clean_str(result.get("top_risk"), "Không có rủi ro nổi bật trong dữ liệu hiện tại."),
        top_priority=_clean_str(result.get("top_priority"), "Tiếp tục cập nhật tiến độ đều để dashboard chính xác hơn."),
        correlation_insight=_clean_str(result.get("correlation_insight"), "Chưa đủ dữ liệu để kết luận pattern tương quan."),
        forecast_next_period=_clean_str(result.get("forecast_next_period"), "Chưa đủ dữ liệu lịch sử để dự báo kỳ tới."),
        kpi_adjustment=_clean_str(result.get("kpi_adjustment"), "Chưa cần điều chỉnh KPI lớn dựa trên dữ liệu hiện tại."),
        suggested_actions=actions,
        risk_kpi_id=_clean_kpi_id(result.get("risk_kpi_id"), valid_ids),
        priority_kpi_id=_clean_kpi_id(result.get("priority_kpi_id"), valid_ids),
        strength_category=_clean_str(result.get("strength_category"), "None"),
    )


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
def export_excel(
    current_user: CurrentUser,
    cycle_id: int | None = Query(None),
    db: Session = Depends(get_db),
):
    if cycle_id is not None:
        cycle = db.get(models.KPICycle, cycle_id)
        if not cycle or cycle.user_id != current_user.id:
            raise HTTPException(404, "Không tìm thấy chu kỳ")
    data = report_service.export_evaluation_excel(db, user_id=current_user.id, cycle_id=cycle_id)
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
def export_appraisal(
    current_user: CurrentUser,
    cycle_id: int | None = Query(None),
    db: Session = Depends(get_db),
):
    """Xuat dung mau Performance Appraisal cua cong ty (import nguoc lai duoc).

    Chua co KPI -> tra ve template trong de dien tay.
    """
    if cycle_id is not None:
        cycle = db.get(models.KPICycle, cycle_id)
        if not cycle or cycle.user_id != current_user.id:
            raise HTTPException(404, "Không tìm thấy chu kỳ")
    data = report_service.export_appraisal_excel(db, current_user, cycle_id=cycle_id)
    filename = f"performance-appraisal-{date.today().isoformat()}.xlsx"
    return Response(
        content=data,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
