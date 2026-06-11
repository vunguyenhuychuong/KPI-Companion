"""Ket noi Google API that. Chi duoc goi khi GOOGLE_MOCK_MODE=false va co credentials.json."""
from ..config import settings

SCOPES = [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/calendar.readonly",
    "https://www.googleapis.com/auth/spreadsheets.readonly",
]


def google_available() -> bool:
    return not settings.google_mock_mode and settings.google_credentials_path.exists()


def get_service(api: str, version: str):
    """Tao service Google API, tu mo trinh duyet de OAuth lan dau (luu token.json)."""
    from google.auth.transport.requests import Request
    from google.oauth2.credentials import Credentials
    from google_auth_oauthlib.flow import InstalledAppFlow
    from googleapiclient.discovery import build

    creds = None
    token_path = settings.google_token_path
    if token_path.exists():
        creds = Credentials.from_authorized_user_file(str(token_path), SCOPES)
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            flow = InstalledAppFlow.from_client_secrets_file(
                str(settings.google_credentials_path), SCOPES
            )
            creds = flow.run_local_server(port=0)
        token_path.write_text(creds.to_json(), encoding="utf-8")
    return build(api, version, credentials=creds)
