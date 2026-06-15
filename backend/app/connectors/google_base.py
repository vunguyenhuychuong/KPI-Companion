"""Ket noi Google API that — dung token OAuth cua TUNG nguoi dung (luu trong DB).

Token lay tu UserIntegration qua services.oauth_service (xem luong web OAuth o do).
Truoc day file nay dung InstalledAppFlow.run_local_server() (mo trinh duyet tren may chu,
token.json dung chung) — khong dung duoc qua web va khong tach duoc nguoi dung; da bo.
"""
from sqlalchemy.orm import Session

from ..config import settings

# Giu lai de cho cu tham chieu (vd doc scope) — nguon thuc su dat trong oauth_service.PROVIDERS.
SCOPES = [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/calendar.readonly",
    "https://www.googleapis.com/auth/spreadsheets.readonly",
]


def google_available(db: Session | None = None, user_id: int | None = None) -> bool:
    """True khi: KHONG bat mock mode VA nguoi dung da ket noi Google."""
    if settings.google_mock_mode or db is None or user_id is None:
        return False
    from ..services import oauth_service

    return oauth_service.is_connected(db, user_id, "google")


def get_service(api: str, version: str, db: Session, user_id: int):
    """Tao service Google API tu token OAuth da luu cua nguoi dung."""
    from googleapiclient.discovery import build

    from ..services import oauth_service

    creds = oauth_service.get_credentials(db, user_id, "google")
    if not creds:
        raise RuntimeError("Người dùng chưa kết nối Google.")
    return build(api, version, credentials=creds)
