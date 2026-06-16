"""D2: Notification email service — gửi các loại email thông báo."""
from datetime import datetime, timedelta
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models
from ..config import settings
from .email_service import is_smtp_configured, send_email


def _get_notification_settings(db: Session, user_id: int) -> models.UserNotificationSettings:
    obj = db.scalars(
        select(models.UserNotificationSettings).where(
            models.UserNotificationSettings.user_id == user_id
        )
    ).first()
    if not obj:
        obj = models.UserNotificationSettings(user_id=user_id)
        db.add(obj)
        db.commit()
        db.refresh(obj)
    return obj


def _log_notification(db: Session, user_id: int, ntype: str, status: str, error: str = ""):
    db.add(models.NotificationLog(user_id=user_id, type=ntype, status=status, error_msg=error))
    db.commit()


def send_worklog_draft_email(db: Session, user_id: int, draft_count: int) -> dict:
    """Thong bao cho user Gmail khi Agent tao nhap nhat ky cong viec moi."""
    if draft_count <= 0:
        return {"ok": True, "message": "Khong co nhap moi"}
    if not is_smtp_configured():
        return {"ok": False, "message": "Chua cau hinh SMTP"}

    user = db.get(models.User, user_id)
    to_email = (user.email if user else "") or ""
    if not to_email.lower().endswith("@gmail.com"):
        return {"ok": False, "message": "User khong dang nhap bang Gmail"}

    name = user.name or "ban"
    base_url = (settings.frontend_url or "http://localhost:5173").rstrip("/")
    journal_url = f"{base_url}/journal"
    body = f"""Xin chao {name},

AI Agent vua tao {draft_count} nhap nhat ky cong viec tu cac nguon da ket noi.

Hay vao KPI Companion de xem bang chung, sua KPI/trang thai/gia tri neu can, roi xac nhan trong Nhat ky cong viec:
{journal_url}

Chua co tien do KPI nao duoc cong cho den khi ban xac nhan.
"""

    body_html = f"""<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#0f172a">
<h2 style="color:#2563eb">Co nhap Nhat ky cong viec moi</h2>
<p>Xin chao <strong>{name}</strong>,</p>
<p>AI Agent vua tao <strong>{draft_count}</strong> nhap nhat ky cong viec tu cac nguon da ket noi.</p>
<p>Hay xem bang chung, sua KPI/trang thai/gia tri neu can, roi xac nhan trong Nhat ky cong viec.</p>
<p style="margin:20px 0">
  <a href="{journal_url}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;padding:10px 14px;border-radius:8px;font-weight:700">
    Mo Nhat ky cong viec
  </a>
</p>
<p style="color:#64748b;font-size:13px">Chua co tien do KPI nao duoc cong cho den khi ban xac nhan.</p>
</div>"""

    try:
        send_email(to_email, "[KPI Companion] Co nhap Nhat ky cong viec moi", body, body_html)
        _log_notification(db, user_id, "worklog_draft", "sent")
        return {"ok": True, "message": f"Da gui thong bao toi {to_email}"}
    except Exception as e:
        _log_notification(db, user_id, "worklog_draft", "failed", str(e))
        return {"ok": False, "message": str(e)}


def send_kpi_reminder_email(db: Session, user_id: int) -> dict:
    """Gửi email nhắc nhở user cập nhật KPI chưa có actual value trong 5 ngày."""
    if not is_smtp_configured():
        return {"ok": False, "message": "Chưa cấu hình SMTP"}

    ns = _get_notification_settings(db, user_id)
    if not ns.kpi_reminder_enabled:
        return {"ok": False, "message": "Thông báo KPI reminder đã tắt"}

    user = db.get(models.User, user_id)
    to_email = ns.recipient_email or (user.email if user else None)
    if not to_email:
        return {"ok": False, "message": "Không có địa chỉ email"}

    # Tìm KPI chưa cập nhật trong 5 ngày (current_value == 0 hoặc không có work_item nào gần đây)
    threshold = datetime.now() - timedelta(days=5)
    kpis = list(db.scalars(
        select(models.KPI).where(
            models.KPI.user_id == user_id,
            models.KPI.archived == False,  # noqa: E712
        )
    ))

    # Lọc KPI chưa được cập nhật (không có work_item confirmed sau threshold)
    stale_kpis = []
    for kpi in kpis:
        recent = db.scalars(
            select(models.WorkItem).where(
                models.WorkItem.kpi_id == kpi.id,
                models.WorkItem.confirmed == True,  # noqa: E712
                models.WorkItem.created_at >= threshold,
            )
        ).first()
        if not recent and kpi.current_value == 0:
            stale_kpis.append(kpi)

    if not stale_kpis:
        return {"ok": True, "message": "Không có KPI nào cần nhắc nhở"}

    # Tạo nội dung email
    kpi_rows = "\n".join(
        f"  • {k.name} — {k.current_value}/{k.target_value} {k.unit} ({k.progress:.0f}%)"
        for k in stale_kpis[:10]
    )
    kpi_rows_html = "".join(
        f"<tr><td style='padding:4px 8px'>{k.name}</td>"
        f"<td style='padding:4px 8px;text-align:center'>{k.current_value}/{k.target_value} {k.unit}</td>"
        f"<td style='padding:4px 8px;text-align:center'>{k.progress:.0f}%</td></tr>"
        for k in stale_kpis[:10]
    )

    body = f"""Xin chào {user.name or 'bạn'},

Bạn có {len(stale_kpis)} KPI chưa được cập nhật trong 5 ngày qua:

{kpi_rows}

Hãy vào KPI Companion để cập nhật tiến độ nhé!

---
Để tắt thông báo loại này, vào Settings → Thông báo → tắt "Nhắc nhở KPI".
"""

    body_html = f"""<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto">
<h2 style="color:#2563eb">⏰ Nhắc nhở cập nhật KPI</h2>
<p>Xin chào <strong>{user.name or 'bạn'}</strong>,</p>
<p>Bạn có <strong>{len(stale_kpis)} KPI</strong> chưa được cập nhật trong 5 ngày qua:</p>
<table style="width:100%;border-collapse:collapse;margin:12px 0">
<tr style="background:#f1f5f9"><th style="padding:6px 8px;text-align:left">KPI</th>
<th style="padding:6px 8px">Tiến độ</th><th style="padding:6px 8px">%</th></tr>
{kpi_rows_html}
</table>
<p>Hãy vào <strong>KPI Companion</strong> để cập nhật tiến độ!</p>
<hr style="margin:24px 0;border:none;border-top:1px solid #e2e8f0"/>
<p style="color:#94a3b8;font-size:12px">Để tắt thông báo này, vào Settings → Thông báo → tắt "Nhắc nhở KPI".</p>
</div>"""

    try:
        send_email(to_email, "[KPI Companion] Nhắc nhở cập nhật KPI", body, body_html)
        _log_notification(db, user_id, "kpi_reminder", "sent")
        return {"ok": True, "message": f"Đã gửi nhắc nhở tới {to_email}", "kpi_count": len(stale_kpis)}
    except Exception as e:
        _log_notification(db, user_id, "kpi_reminder", "failed", str(e))
        return {"ok": False, "message": str(e)}


def send_weekly_summary_email(db: Session, user_id: int) -> dict:
    """Gửi email tóm tắt tuần."""
    if not is_smtp_configured():
        return {"ok": False, "message": "Chưa cấu hình SMTP"}

    ns = _get_notification_settings(db, user_id)
    if not ns.weekly_summary_enabled:
        return {"ok": False, "message": "Thông báo weekly summary đã tắt"}

    user = db.get(models.User, user_id)
    to_email = ns.recipient_email or (user.email if user else None)
    if not to_email:
        return {"ok": False, "message": "Không có địa chỉ email"}

    # Tính tổng quan KPI
    kpis = list(db.scalars(
        select(models.KPI).where(
            models.KPI.user_id == user_id,
            models.KPI.archived == False,  # noqa: E712
        )
    ))
    if not kpis:
        return {"ok": True, "message": "Không có KPI để tóm tắt"}

    on_track = [k for k in kpis if k.progress >= 80]
    at_risk = [k for k in kpis if 50 <= k.progress < 80]
    behind = [k for k in kpis if k.progress < 50]

    summary_html = f"""
<div style="display:flex;gap:16px;margin:12px 0">
<div style="flex:1;padding:12px;background:#dcfce7;border-radius:8px;text-align:center">
  <div style="font-size:24px;font-weight:bold;color:#16a34a">{len(on_track)}</div>
  <div style="color:#15803d;font-size:13px">Đạt tiến độ</div>
</div>
<div style="flex:1;padding:12px;background:#fef9c3;border-radius:8px;text-align:center">
  <div style="font-size:24px;font-weight:bold;color:#ca8a04">{len(at_risk)}</div>
  <div style="color:#a16207;font-size:13px">Có nguy cơ</div>
</div>
<div style="flex:1;padding:12px;background:#fee2e2;border-radius:8px;text-align:center">
  <div style="font-size:24px;font-weight:bold;color:#dc2626">{len(behind)}</div>
  <div style="color:#b91c1c;font-size:13px">Chậm tiến độ</div>
</div>
</div>"""

    body_html = f"""<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto">
<h2 style="color:#2563eb">📊 Tóm tắt KPI tuần này</h2>
<p>Xin chào <strong>{user.name or 'bạn'}</strong>,</p>
<p>Đây là tóm tắt KPI của bạn trong tuần qua:</p>
{summary_html}
<p style="margin-top:16px">Tổng cộng <strong>{len(kpis)}</strong> KPI đang theo dõi.
Tiến độ trung bình: <strong>{sum(k.progress_capped for k in kpis)/len(kpis):.0f}%</strong></p>
<hr style="margin:24px 0;border:none;border-top:1px solid #e2e8f0"/>
<p style="color:#94a3b8;font-size:12px">Để tắt thông báo này, vào Settings → Thông báo → tắt "Tóm tắt tuần".</p>
</div>"""

    body = f"""Tóm tắt KPI tuần — {user.name or 'bạn'}

Đạt tiến độ: {len(on_track)} KPI
Có nguy cơ:  {len(at_risk)} KPI
Chậm tiến độ: {len(behind)} KPI
Tiến độ TB: {sum(k.progress_capped for k in kpis)/len(kpis):.0f}%
"""

    try:
        send_email(to_email, "[KPI Companion] Tóm tắt KPI tuần", body, body_html)
        _log_notification(db, user_id, "weekly_summary", "sent")
        return {"ok": True, "message": f"Đã gửi tóm tắt tuần tới {to_email}"}
    except Exception as e:
        _log_notification(db, user_id, "weekly_summary", "failed", str(e))
        return {"ok": False, "message": str(e)}


def send_sync_error_email(db: Session, user_id: int, error_code: str, description: str) -> dict:
    """Gửi email thông báo lỗi đồng bộ."""
    if not is_smtp_configured():
        return {"ok": False, "message": "Chưa cấu hình SMTP"}

    ns = _get_notification_settings(db, user_id)
    if not ns.sync_error_enabled:
        return {"ok": False, "message": "Thông báo lỗi đồng bộ đã tắt"}

    user = db.get(models.User, user_id)
    to_email = ns.recipient_email or (user.email if user else None)
    if not to_email:
        return {"ok": False, "message": "Không có địa chỉ email"}

    now_str = datetime.now().strftime("%d/%m/%Y %H:%M")
    body_html = f"""<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto">
<h2 style="color:#dc2626">⚠️ Lỗi đồng bộ dữ liệu</h2>
<p>Xin chào <strong>{user.name or 'bạn'}</strong>,</p>
<p>Job đồng bộ dữ liệu gặp lỗi liên tiếp:</p>
<table style="width:100%;border-collapse:collapse;margin:12px 0;background:#fef2f2;border-radius:8px">
<tr><td style="padding:8px 12px"><strong>Mã lỗi:</strong></td><td style="padding:8px 12px">{error_code}</td></tr>
<tr><td style="padding:8px 12px"><strong>Thời gian:</strong></td><td style="padding:8px 12px">{now_str}</td></tr>
<tr><td style="padding:8px 12px"><strong>Mô tả:</strong></td><td style="padding:8px 12px">{description}</td></tr>
</table>
<p>Vào <strong>Settings → Kết nối nguồn dữ liệu</strong> để kiểm tra và kết nối lại.</p>
<hr style="margin:24px 0;border:none;border-top:1px solid #e2e8f0"/>
<p style="color:#94a3b8;font-size:12px">Để tắt thông báo này, vào Settings → Thông báo → tắt "Lỗi đồng bộ".</p>
</div>"""

    body = f"Lỗi đồng bộ dữ liệu\nMã lỗi: {error_code}\nThời gian: {now_str}\n{description}"

    try:
        send_email(to_email, "[KPI Companion] Cảnh báo lỗi đồng bộ", body, body_html)
        _log_notification(db, user_id, "sync_error", "sent")
        return {"ok": True}
    except Exception as e:
        _log_notification(db, user_id, "sync_error", "failed", str(e))
        return {"ok": False, "message": str(e)}
