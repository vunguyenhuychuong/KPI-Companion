"""Email service dùng SMTP để gửi báo cáo qua Gmail."""

import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from typing import Optional

from ..config import settings


def get_smtp_config() -> Optional[dict]:
    """Lấy cấu hình SMTP từ settings."""
    email = settings.smtp_email
    password = settings.smtp_password
    host = settings.smtp_host
    port = settings.smtp_port

    if not email or not password:
        return None

    return {"email": email, "password": password, "host": host, "port": port}


def is_smtp_configured() -> bool:
    """Kiểm tra đã cấu hình SMTP chưa."""
    return get_smtp_config() is not None


def send_email(
    to_email: str,
    subject: str,
    body: str,
    body_html: Optional[str] = None,
) -> dict:
    """Gửi email qua SMTP Gmail.

    Args:
        to_email: Địa chỉ email người nhận
        subject: Chủ đề email
        body: Nội dung plain text
        body_html: Nội dung HTML (tùy chọn)

    Returns:
        Dict với thông tin gửi thành công

    Raises:
        ValueError: Nếu chưa cấu hình SMTP
        Exception: Nếu gửi thất bại
    """
    config = get_smtp_config()
    if not config:
        raise ValueError("Chưa cấu hình SMTP. Vui lòng cấu hình SMTP_EMAIL và SMTP_PASSWORD trong .env")

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = config["email"]
    msg["To"] = to_email

    # Thêm plain text
    msg.attach(MIMEText(body, "plain", "utf-8"))

    # Thêm HTML nếu có
    if body_html:
        msg.attach(MIMEText(body_html, "html", "utf-8"))

    try:
        with smtplib.SMTP(config["host"], config["port"]) as server:
            server.starttls()
            server.login(config["email"], config["password"])
            server.sendmail(config["email"], to_email, msg.as_string())

        return {
            "success": True,
            "from": config["email"],
            "to": to_email,
            "subject": subject,
        }
    except Exception as e:
        raise Exception(f"Gửi email thất bại: {str(e)}")