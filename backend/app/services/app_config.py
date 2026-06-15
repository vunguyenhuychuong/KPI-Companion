"""Cau hinh app-level doi luc chay (override .env), luu ben trong bang app_settings.

Cach hoat dong: ghi de truc tiep len doi tuong `settings` (pydantic) -> moi code dang
doc `settings.<key>` (vd connectors doc settings.google_mock_mode) tu dong theo gia tri moi,
khong can refactor. Khoi dong app -> load lai tu DB de giu lua chon sau restart.

KHONG luu secret/credentials o day — chi cac co cau hinh khong nhay cam.
"""
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models
from ..config import settings

# Cac key bool duoc phep doi tu UI -> ap thang len `settings`
_BOOL_KEYS = {"google_mock_mode", "seed_demo_data"}


def _to_bool(v: str) -> bool:
    return str(v).strip().lower() in ("1", "true", "yes", "on")


def apply_to_settings(key: str, value: str) -> None:
    """Ap 1 cau hinh len doi tuong settings dang chay (neu la key da biet)."""
    if key in _BOOL_KEYS:
        setattr(settings, key, _to_bool(value))


def load_overrides(db: Session) -> None:
    """Doc toan bo app_settings tu DB va ap len settings (goi luc khoi dong)."""
    for row in db.scalars(select(models.AppSetting)):
        apply_to_settings(row.key, row.value)


def set_setting(db: Session, key: str, value: str) -> None:
    """Upsert 1 cau hinh + ap ngay len settings dang chay."""
    row = db.get(models.AppSetting, key)
    if row:
        row.value = value
        row.updated_at = models.utcnow()
    else:
        db.add(models.AppSetting(key=key, value=value))
    db.commit()
    apply_to_settings(key, value)
