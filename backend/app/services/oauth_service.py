"""Dich vu OAuth ket noi nguon du lieu ben ngoai theo TUNG nguoi dung.

Thiet ke provider-agnostic:
  - PROVIDERS khai bao tung nguon (label, icon, scopes, cac "source" no cung cap).
  - "google" dung thu vien google chinh thuc (Flow + Credentials, co refresh).
  - "notion"/"slack"/"outlook" dung OAuth2 chuan qua requests (_OAUTH2).
  - Them mot nguon moi = them entry vao PROVIDERS (+ _OAUTH2 neu khong phai google),
    KHONG phai sua connectors hay schema.

Luong (Authorization Code Flow chuan web):
  1. /api/oauth/{provider}/start  -> tao auth_url (kem `state` JWT ky boi server mang user_id)
  2. provider redirect ve /api/oauth/{provider}/callback?code=...&state=...
  3. server doi code lay token, lay thong tin tai khoan, luu UserIntegration (token DA MA HOA).

Token luu trong DB duoc ma hoa bang Fernet (xem _enc/_dec).
"""
import base64
import hashlib
import json
import os
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from urllib.parse import urlencode

from jose import JWTError, jwt
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models
from ..config import settings

# Google co the tra ve scope theo thu tu khac -> tranh loi "Scope has changed".
os.environ.setdefault("OAUTHLIB_RELAX_TOKEN_SCOPE", "1")

_STATE_TTL_MINUTES = 10
_ENC_PREFIX = "enc:"  # danh dau token da ma hoa (de tuong thich row plaintext cu)


@dataclass
class ProviderConfig:
    key: str
    label: str
    icon: str
    sources: list[str]  # cac "source" connector se quet khi provider nay duoc ket noi
    scopes: list[str] = field(default_factory=list)


# ---- Dang ky provider. Them mot dong la them mot nguon. ----
PROVIDERS: dict[str, ProviderConfig] = {
    "google": ProviderConfig(
        key="google", label="Google", icon="🔵",
        sources=["gmail", "calendar", "sheets"],
        scopes=[
            "https://www.googleapis.com/auth/gmail.readonly",
            "https://www.googleapis.com/auth/calendar.readonly",
            "https://www.googleapis.com/auth/spreadsheets.readonly",
            "https://www.googleapis.com/auth/userinfo.email",
            "https://www.googleapis.com/auth/userinfo.profile",
            "openid",
        ],
    ),
    "notion": ProviderConfig(
        key="notion", label="Notion", icon="📝", sources=["notion"], scopes=[],
    ),
    "slack": ProviderConfig(
        key="slack", label="Slack", icon="💬", sources=["slack"],
        scopes=["search:read"],  # user scope: doc tin nhan cua chinh nguoi dung
    ),
    "outlook": ProviderConfig(
        key="outlook", label="Outlook", icon="📧", sources=["outlook"],
        scopes=["offline_access", "Mail.Read", "Calendars.Read", "User.Read"],
    ),
}

# Cau hinh OAuth2 cho cac provider KHONG phai google.
_OAUTH2 = {
    "notion": {
        "authorize_url": "https://api.notion.com/v1/oauth/authorize",
        "token_url": "https://api.notion.com/v1/oauth/token",
    },
    "slack": {
        "authorize_url": "https://slack.com/oauth/v2/authorize",
        "token_url": "https://slack.com/api/oauth.v2.access",
    },
    "outlook": {
        "authorize_url": "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
        "token_url": "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    },
}


class OAuthError(Exception):
    """Loi nghiep vu OAuth (provider chua bat, state sai, doi token loi...)."""


# ---------------------------------------------------------------- helpers

def get_provider(provider: str) -> ProviderConfig:
    cfg = PROVIDERS.get(provider)
    if not cfg:
        raise OAuthError(f"Provider không hỗ trợ: {provider}")
    return cfg


def provider_enabled(provider: str) -> bool:
    """Provider da co cau hinh client (credentials) tren server chua."""
    if provider == "google":
        return settings.google_credentials_path.exists()
    cid = getattr(settings, f"{provider}_client_id", "")
    csec = getattr(settings, f"{provider}_client_secret", "")
    return bool(cid and csec)


def _client_creds(provider: str) -> tuple[str, str]:
    return (
        getattr(settings, f"{provider}_client_id", ""),
        getattr(settings, f"{provider}_client_secret", ""),
    )


def _google_client_config() -> dict:
    """Doc client_id/secret/token_uri tu credentials.json (loai 'Web application')."""
    path = settings.google_credentials_path
    if not path.exists():
        raise OAuthError(
            "Chưa có credentials.json trong thư mục backend/. Tải OAuth client loại "
            "'Web application' từ Google Cloud Console và đặt vào đây."
        )
    data = json.loads(path.read_text(encoding="utf-8"))
    node = data.get("web") or data.get("installed")
    if not node:
        raise OAuthError(
            "credentials.json không đúng định dạng OAuth client (thiếu khóa 'web'). "
            "Cần tạo client loại 'Web application'."
        )
    return node


# ---- ma hoa token (Fernet) -----------------------------------------------

def _fernet():
    from cryptography.fernet import Fernet

    key = settings.token_encryption_key.strip()
    if not key:
        # Suy ra key on dinh tu jwt_secret_key (chay duoc ngay khong can cau hinh them).
        digest = hashlib.sha256(settings.jwt_secret_key.encode("utf-8")).digest()
        key = base64.urlsafe_b64encode(digest).decode("ascii")
    return Fernet(key.encode("ascii") if isinstance(key, str) else key)


def _enc(value: str) -> str:
    if not value:
        return ""
    return _ENC_PREFIX + _fernet().encrypt(value.encode("utf-8")).decode("ascii")


def _dec(value: str) -> str:
    if not value:
        return ""
    if not value.startswith(_ENC_PREFIX):
        return value  # row cu luu plaintext -> tra nguyen
    token = value[len(_ENC_PREFIX):]
    try:
        return _fernet().decrypt(token.encode("ascii")).decode("utf-8")
    except Exception:
        return ""  # key doi / hong -> coi nhu chua ket noi


# ---- state (chong CSRF + mang user_id qua redirect, khong can luu DB) ----

def _make_state(user_id: int, provider: str, code_verifier: str = "") -> str:
    exp = datetime.utcnow() + timedelta(minutes=_STATE_TTL_MINUTES)
    payload: dict = {"uid": user_id, "provider": provider, "typ": "oauth_state", "exp": exp}
    if code_verifier:
        payload["cv"] = code_verifier
    return jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)


def _read_state(state: str, provider: str) -> tuple[int, str]:
    try:
        payload = jwt.decode(state, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])
    except JWTError:
        raise OAuthError("State không hợp lệ hoặc đã hết hạn. Vui lòng kết nối lại.")
    if payload.get("typ") != "oauth_state" or payload.get("provider") != provider:
        raise OAuthError("State không khớp provider.")
    return int(payload["uid"]), payload.get("cv", "")


def _redirect_uri(provider: str, request_base: str = "") -> str:
    base = (settings.oauth_redirect_base or request_base or "").rstrip("/")
    return f"{base}/api/oauth/{provider}/callback"


def frontend_return_url(provider: str, ok: bool = True, error: str = "") -> str:
    base = settings.frontend_url or "/sources"
    sep = "&" if "?" in base else "?"
    if ok:
        return f"{base}{sep}connected={provider}"
    from urllib.parse import quote
    return f"{base}{sep}oauth_error={quote(error)[:200]}"


# ---------------------------------------------------------------- auth url

def build_auth_url(provider: str, user_id: int, request_base: str = "") -> str:
    cfg = get_provider(provider)
    if not provider_enabled(provider):
        raise OAuthError(f"{cfg.label} chưa được cấu hình trên server (thiếu credentials).")
    state = _make_state(user_id, provider)
    redirect_uri = _redirect_uri(provider, request_base)

    if provider == "google":
        import base64, secrets as _secrets
        from google_auth_oauthlib.flow import Flow

        # Sinh code_verifier tuong minh va luu vao state JWT de dung lai trong callback
        code_verifier = base64.urlsafe_b64encode(_secrets.token_bytes(32)).decode("ascii").rstrip("=")
        state = _make_state(user_id, provider, code_verifier=code_verifier)

        flow = Flow.from_client_secrets_file(
            str(settings.google_credentials_path), scopes=cfg.scopes, redirect_uri=redirect_uri
        )
        flow.code_verifier = code_verifier
        auth_url, _ = flow.authorization_url(
            access_type="offline", include_granted_scopes="true", prompt="consent", state=state
        )
        return auth_url

    # --- Generic OAuth2 (notion / slack / outlook) ---
    cid, _ = _client_creds(provider)
    params = {"client_id": cid, "redirect_uri": redirect_uri, "response_type": "code", "state": state}
    if provider == "slack":
        params["user_scope"] = " ".join(cfg.scopes)  # token cua nguoi dung (khong phai bot)
    elif provider == "notion":
        params["owner"] = "user"
    else:  # outlook (Microsoft Graph)
        params["scope"] = " ".join(cfg.scopes)
        params["response_mode"] = "query"
    return _OAUTH2[provider]["authorize_url"] + "?" + urlencode(params)


# ---------------------------------------------------------------- callback

def handle_callback(
    db: Session, provider: str, code: str, state: str, request_base: str = ""
) -> models.UserIntegration:
    cfg = get_provider(provider)
    user_id, code_verifier = _read_state(state, provider)
    redirect_uri = _redirect_uri(provider, request_base)

    if provider == "google":
        from google_auth_oauthlib.flow import Flow
        from googleapiclient.discovery import build

        flow = Flow.from_client_secrets_file(
            str(settings.google_credentials_path), scopes=cfg.scopes, redirect_uri=redirect_uri
        )
        if code_verifier:
            flow.code_verifier = code_verifier
        flow.fetch_token(code=code)
        creds = flow.credentials
        try:
            info = build("oauth2", "v2", credentials=creds).userinfo().get().execute()
        except Exception:
            info = {}
        return _upsert(
            db, user_id=user_id, provider=provider,
            account_email=info.get("email", ""), account_name=info.get("name", ""),
            access_token=creds.token or "", refresh_token=creds.refresh_token or "",
            token_expiry=creds.expiry, scopes=" ".join(creds.scopes or cfg.scopes),
        )

    # --- Generic OAuth2 ---
    return _generic_callback(db, provider, cfg, code, redirect_uri, user_id)


def _generic_callback(db, provider, cfg, code, redirect_uri, user_id):
    import requests

    cid, csec = _client_creds(provider)
    token_url = _OAUTH2[provider]["token_url"]
    access = refresh = ""
    expiry = None
    email = name = ""

    if provider == "notion":
        basic = base64.b64encode(f"{cid}:{csec}".encode()).decode()
        r = requests.post(
            token_url,
            json={"grant_type": "authorization_code", "code": code, "redirect_uri": redirect_uri},
            headers={"Authorization": f"Basic {basic}", "Content-Type": "application/json"},
            timeout=15,
        )
        data = r.json()
        if "access_token" not in data:
            raise OAuthError(f"Notion từ chối: {data.get('error', data)}")
        access = data["access_token"]
        owner = (data.get("owner") or {}).get("user") or {}
        email = (owner.get("person") or {}).get("email", "")
        name = owner.get("name") or data.get("workspace_name", "")

    elif provider == "slack":
        r = requests.post(
            token_url,
            data={"client_id": cid, "client_secret": csec, "code": code, "redirect_uri": redirect_uri},
            timeout=15,
        )
        data = r.json()
        if not data.get("ok"):
            raise OAuthError(f"Slack từ chối: {data.get('error', data)}")
        authed = data.get("authed_user") or {}
        access = authed.get("access_token") or data.get("access_token", "")
        name = (data.get("team") or {}).get("name", "")
        email = authed.get("id", "")  # Slack user id (email can scope users:read.email)

    else:  # outlook
        r = requests.post(
            token_url,
            data={
                "client_id": cid, "client_secret": csec, "code": code,
                "redirect_uri": redirect_uri, "grant_type": "authorization_code",
                "scope": " ".join(cfg.scopes),
            },
            timeout=15,
        )
        data = r.json()
        if "access_token" not in data:
            raise OAuthError(f"Outlook từ chối: {data.get('error_description', data)}")
        access = data["access_token"]
        refresh = data.get("refresh_token", "")
        if data.get("expires_in"):
            expiry = datetime.utcnow() + timedelta(seconds=int(data["expires_in"]))
        try:
            me = requests.get(
                "https://graph.microsoft.com/v1.0/me",
                headers={"Authorization": f"Bearer {access}"}, timeout=10,
            ).json()
            email = me.get("mail") or me.get("userPrincipalName", "")
            name = me.get("displayName", "")
        except Exception:
            pass

    return _upsert(
        db, user_id=user_id, provider=provider, account_email=email, account_name=name,
        access_token=access, refresh_token=refresh, token_expiry=expiry,
        scopes=" ".join(cfg.scopes),
    )


def _upsert(db: Session, *, user_id: int, provider: str, **fields) -> models.UserIntegration:
    # ma hoa token truoc khi luu
    for k in ("access_token", "refresh_token"):
        if k in fields:
            fields[k] = _enc(fields[k] or "")
    row = db.scalars(
        select(models.UserIntegration).where(
            models.UserIntegration.user_id == user_id,
            models.UserIntegration.provider == provider,
        )
    ).first()
    if not row:
        row = models.UserIntegration(user_id=user_id, provider=provider)
        db.add(row)
    for k, v in fields.items():
        setattr(row, k, v)
    row.status = "connected"
    db.commit()
    db.refresh(row)
    return row


# ---------------------------------------------------------------- token use

def _get_row(db: Session, user_id: int, provider: str):
    return db.scalars(
        select(models.UserIntegration).where(
            models.UserIntegration.user_id == user_id,
            models.UserIntegration.provider == provider,
        )
    ).first()


def is_connected(db: Session, user_id: int, provider: str) -> bool:
    row = _get_row(db, user_id, provider)
    return bool(row and row.status == "connected" and row.access_token)


def get_credentials(db: Session, user_id: int, provider: str = "google"):
    """(Chi GOOGLE) tra ve google.oauth2.credentials.Credentials hop le (tu refresh + luu lai)."""
    row = _get_row(db, user_id, provider)
    if not row or not row.access_token:
        return None
    if provider != "google":
        raise OAuthError("get_credentials chỉ dùng cho Google; provider khác dùng get_access_token.")

    from google.auth.transport.requests import Request
    from google.oauth2.credentials import Credentials

    node = _google_client_config()
    creds = Credentials(
        token=_dec(row.access_token),
        refresh_token=_dec(row.refresh_token) or None,
        token_uri=node.get("token_uri", "https://oauth2.googleapis.com/token"),
        client_id=node["client_id"], client_secret=node.get("client_secret"),
        scopes=row.scopes.split() if row.scopes else None,
        expiry=row.token_expiry,  # offset-naive UTC, google-auth so sanh voi utcnow()
    )
    if creds.expired and creds.refresh_token:
        creds.refresh(Request())
        row.access_token = _enc(creds.token or "")
        row.token_expiry = creds.expiry
        db.commit()
    return creds


def get_access_token(db: Session, user_id: int, provider: str) -> str | None:
    """(KHONG google) tra ve bearer token hop le, tu refresh neu provider ho tro (outlook)."""
    row = _get_row(db, user_id, provider)
    if not row or not row.access_token:
        return None
    access = _dec(row.access_token)

    # Outlook: token het han ~1h -> refresh truoc khi dung neu sap het han.
    if provider == "outlook" and row.refresh_token and row.token_expiry:
        if row.token_expiry <= datetime.utcnow() + timedelta(seconds=60):
            import requests

            cid, csec = _client_creds(provider)
            r = requests.post(
                _OAUTH2[provider]["token_url"],
                data={
                    "client_id": cid, "client_secret": csec, "grant_type": "refresh_token",
                    "refresh_token": _dec(row.refresh_token),
                    "scope": " ".join(get_provider(provider).scopes),
                },
                timeout=15,
            )
            data = r.json()
            if "access_token" in data:
                access = data["access_token"]
                row.access_token = _enc(access)
                if data.get("refresh_token"):
                    row.refresh_token = _enc(data["refresh_token"])
                if data.get("expires_in"):
                    row.token_expiry = datetime.utcnow() + timedelta(seconds=int(data["expires_in"]))
                db.commit()
    return access


# ---------------------------------------------------------------- quan ly

def source_modes(db: Session, user_id: int, google_mock: bool) -> dict[str, str]:
    """Map moi source cua user: real neu da ket noi, disconnected neu chua."""
    connected = {p for p in PROVIDERS if is_connected(db, user_id, p)}
    modes: dict[str, str] = {}
    for key, cfg in PROVIDERS.items():
        real = key in connected and (key != "google" or not google_mock)
        for src in cfg.sources:
            modes[src] = "real" if real else "disconnected"
    return modes


def list_integrations(db: Session, user_id: int) -> dict[str, models.UserIntegration]:
    rows = db.scalars(
        select(models.UserIntegration).where(models.UserIntegration.user_id == user_id)
    )
    return {r.provider: r for r in rows}


def disconnect(db: Session, user_id: int, provider: str) -> bool:
    row = _get_row(db, user_id, provider)
    if not row:
        return False
    if provider == "google" and row.access_token:
        try:
            import requests

            requests.post(
                "https://oauth2.googleapis.com/revoke",
                params={"token": _dec(row.refresh_token) or _dec(row.access_token)},
                headers={"content-type": "application/x-www-form-urlencoded"}, timeout=5,
            )
        except Exception:
            pass
    db.delete(row)
    db.commit()
    return True
