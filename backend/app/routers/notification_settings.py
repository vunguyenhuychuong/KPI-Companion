"""D2: Email Notification Settings — cấu hình và gửi thông báo email."""
from sqlalchemy import select
from sqlalchemy.orm import Session
from fastapi import APIRouter, Depends

from .. import models, schemas
from ..auth import CurrentUser
from ..database import get_db
from ..services import email_service

router = APIRouter(prefix="/api/notification-settings", tags=["notification_settings"])


def _get_or_create_settings(db: Session, user_id: int) -> models.UserNotificationSettings:
    settings_obj = db.scalars(
        select(models.UserNotificationSettings).where(
            models.UserNotificationSettings.user_id == user_id
        )
    ).first()
    if not settings_obj:
        settings_obj = models.UserNotificationSettings(user_id=user_id)
        db.add(settings_obj)
        db.commit()
        db.refresh(settings_obj)
    return settings_obj


@router.get("", response_model=schemas.NotificationSettingsOut)
def get_notification_settings(current_user: CurrentUser, db: Session = Depends(get_db)):
    return _get_or_create_settings(db, current_user.id)


@router.put("", response_model=schemas.NotificationSettingsOut)
def update_notification_settings(
    payload: schemas.NotificationSettingsUpdate,
    current_user: CurrentUser,
    db: Session = Depends(get_db),
):
    settings_obj = _get_or_create_settings(db, current_user.id)
    for field, value in payload.model_dump(exclude_unset=True).items():
        if value is not None:
            setattr(settings_obj, field, value)
    db.commit()
    db.refresh(settings_obj)
    return settings_obj


@router.post("/send-test")
def send_test_email(current_user: CurrentUser, db: Session = Depends(get_db)):
    """Gửi email test để kiểm tra cấu hình SMTP."""
    if not email_service.is_smtp_configured():
        return {"ok": False, "message": "Chưa cấu hình SMTP. Thêm SMTP_EMAIL và SMTP_PASSWORD vào .env"}

    settings_obj = _get_or_create_settings(db, current_user.id)
    to_email = settings_obj.recipient_email or current_user.email
    if not to_email:
        return {"ok": False, "message": "Không có địa chỉ email để gửi"}

    try:
        email_service.send_email(
            to_email=to_email,
            subject="[KPI Companion] Email thử nghiệm",
            body="Đây là email thử nghiệm từ KPI Companion. Cấu hình SMTP của bạn hoạt động tốt!",
            body_html="<p>Đây là email thử nghiệm từ <strong>KPI Companion</strong>.</p><p>Cấu hình SMTP của bạn hoạt động tốt!</p>",
        )
        return {"ok": True, "message": f"Đã gửi email thử nghiệm tới {to_email}"}
    except Exception as e:
        return {"ok": False, "message": str(e)}


@router.post("/send-reminder")
def send_kpi_reminder(current_user: CurrentUser, db: Session = Depends(get_db)):
    """Gửi email nhắc nhở KPI (trigger thủ công, dùng cho cron job hoặc test)."""
    from ..services.notification_email import send_kpi_reminder_email
    return send_kpi_reminder_email(db, current_user.id)


@router.post("/send-weekly-summary")
def send_weekly_summary(current_user: CurrentUser, db: Session = Depends(get_db)):
    """Gửi email tóm tắt tuần (trigger thủ công)."""
    from ..services.notification_email import send_weekly_summary_email
    return send_weekly_summary_email(db, current_user.id)
