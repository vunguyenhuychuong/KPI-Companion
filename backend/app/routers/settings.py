"""Cau hinh app-level doi tu UI (khong chua secret). Hien tai: che do Mock/Real cua Google."""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from .. import schemas
from ..auth import CurrentUser
from ..config import settings
from ..database import get_db
from ..services import app_config

router = APIRouter(prefix="/api/settings", tags=["settings"])


def _connection_status() -> schemas.ConnectionSettingsOut:
    real_available = settings.google_credentials_path.exists()
    # che do thuc su: chi "real" khi tat mock VA co credentials
    effective = "real" if (not settings.google_mock_mode and real_available) else "mock"
    if settings.google_mock_mode:
        note = "Đang dùng dữ liệu mô phỏng (mock) — demo chạy được ngay, không cần credentials."
    elif not real_available:
        note = (
            "Đã chọn chế độ Thật nhưng chưa có credentials.json trong thư mục backend/ "
            "→ hệ thống tạm dùng mock. Đặt credentials.json vào server để kết nối Google thật."
        )
    else:
        note = "Đang kết nối Google API thật (credentials.json đã có)."
    return schemas.ConnectionSettingsOut(
        google_mock_mode=settings.google_mock_mode,
        real_available=real_available,
        effective_mode=effective,
        note=note,
    )


@router.get("/connections", response_model=schemas.ConnectionSettingsOut)
def get_connections(current_user: CurrentUser):
    return _connection_status()


@router.put("/connections", response_model=schemas.ConnectionSettingsOut)
def update_connections(
    payload: schemas.ConnectionSettingsUpdate, current_user: CurrentUser, db: Session = Depends(get_db)
):
    """Bat/tat che do mock cho Google connectors (app-level, luu DB, ap ngay)."""
    app_config.set_setting(db, "google_mock_mode", "true" if payload.google_mock_mode else "false")
    return _connection_status()
