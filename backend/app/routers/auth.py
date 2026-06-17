from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token as google_id_token
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models, schemas
from ..auth import (
    CurrentUser,
    create_access_token,
    create_password_reset_token,
    hash_password,
    verify_password,
    verify_password_reset_token,
)
from ..config import settings
from ..database import get_db
from ..rate_limit import limiter
from ..services import email_service

router = APIRouter(prefix="/api/auth", tags=["auth"])

AVATAR_MAX_BYTES = 2 * 1024 * 1024
AVATAR_TYPES = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
}


@router.get("/config")
def auth_config():
    """Tra ve cau hinh public cho frontend (google_client_id de hien thi nut OAuth)."""
    return {"google_client_id": settings.google_client_id}


def _token_response(user: models.User) -> schemas.Token:
    return schemas.Token(
        access_token=create_access_token(user.id),
        user_id=user.id,
        name=user.name,
        picture=user.picture or "",
        email=user.email,
        role=user.role or "",
        department=user.department or "",
        employee_code=user.employee_code or "",
        preferred_language=user.preferred_language or "vi",
        onboarding_completed=user.onboarding_completed,
    )


@router.post("/register", response_model=schemas.Token)
@limiter.limit("5/minute")
def register(request: Request, payload: schemas.UserCreate, db: Session = Depends(get_db)):
    email = payload.email.strip().lower()
    if db.scalars(select(models.User).where(models.User.email == email)).first():
        raise HTTPException(400, "Email đã được đăng ký")
    user = models.User(
        name=payload.name.strip() or email.split("@")[0],
        email=email,
        hashed_password=hash_password(payload.password),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return _token_response(user)


@router.post("/forgot-password")
def forgot_password(payload: schemas.ForgotPasswordRequest, db: Session = Depends(get_db)):
    """Gui link reset mat khau neu co SMTP; local/demo tra token mock de test."""
    user = db.scalars(select(models.User).where(models.User.email == payload.email)).first()
    generic = {
        "ok": True,
        "message": "Nếu email tồn tại, hệ thống sẽ gửi hướng dẫn đặt lại mật khẩu.",
        "mocked": False,
    }
    if not user:
        return generic

    token = create_password_reset_token(user.id)
    frontend = (settings.frontend_url or "http://127.0.0.1:5173").rstrip("/")
    reset_url = f"{frontend}/login?reset_token={token}"
    subject = "[KPI Companion] Đặt lại mật khẩu"
    body = (
        f"Xin chào {user.name or 'bạn'},\n\n"
        "Bạn vừa yêu cầu đặt lại mật khẩu KPI Companion.\n"
        f"Mở link sau trong 30 phút để tạo mật khẩu mới:\n{reset_url}\n\n"
        "Nếu bạn không yêu cầu, vui lòng bỏ qua email này."
    )

    if email_service.is_smtp_configured():
        try:
            email_service.send_email(user.email, subject, body)
            return generic
        except Exception as exc:
            raise HTTPException(500, f"Khong gui duoc email reset: {exc}")

    return {
        **generic,
        "mocked": True,
        "message": "Chưa cấu hình SMTP. Môi trường demo trả token reset để test.",
        "reset_token": token,
        "reset_url": reset_url,
    }


@router.post("/reset-password")
def reset_password(payload: schemas.PasswordResetRequest, db: Session = Depends(get_db)):
    user_id = verify_password_reset_token(payload.token)
    user = db.get(models.User, user_id)
    if not user:
        raise HTTPException(400, "Token dat lai mat khau khong hop le hoac da het han")
    if user.hashed_password and verify_password(payload.new_password, user.hashed_password):
        raise HTTPException(400, "Mat khau moi khong duoc trung mat khau hien tai")
    user.hashed_password = hash_password(payload.new_password)
    db.commit()
    return {"ok": True}


@router.post("/login", response_model=schemas.Token)
@limiter.limit("5/minute")
def login(request: Request, payload: schemas.UserLogin, db: Session = Depends(get_db)):
    email = payload.email.strip().lower()
    user = db.scalars(select(models.User).where(models.User.email == email)).first()
    if not user or not user.hashed_password or not verify_password(payload.password, user.hashed_password):
        raise HTTPException(400, "Email hoặc mật khẩu không đúng")
    return _token_response(user)


@router.post("/google", response_model=schemas.Token)
def google_login(payload: schemas.GoogleTokenRequest, db: Session = Depends(get_db)):
    """Xac thuc Google ID token tu @react-oauth/google, tra ve JWT noi bo."""
    if not settings.google_client_id:
        raise HTTPException(503, "Google OAuth chưa được cấu hình (thiếu GOOGLE_CLIENT_ID)")
    try:
        id_info = google_id_token.verify_oauth2_token(
            payload.credential,
            google_requests.Request(),
            settings.google_client_id,
            clock_skew_in_seconds=10,
        )
    except ValueError as exc:
        raise HTTPException(400, f"Token Google không hợp lệ: {exc}")

    if not id_info.get("email_verified"):
        raise HTTPException(400, "Tài khoản Google chưa xác thực email")

    email: str = id_info["email"].lower()
    domain = email.split("@")[1]
    if domain not in {"gmail.com", "vng.com.vn"}:
        raise HTTPException(400, "Chỉ chấp nhận email @gmail.com hoặc @vng.com.vn")

    name: str = id_info.get("name") or email.split("@")[0]
    picture: str = id_info.get("picture") or ""

    user = db.scalars(select(models.User).where(models.User.email == email)).first()
    if not user:
        user = models.User(email=email, name=name, picture=picture)
        db.add(user)
        db.commit()
        db.refresh(user)
    else:
        # Do not overwrite profile fields the user changed inside KPI Companion.
        # Google is the identity provider here, not the source of truth for app profile data.
        pass

    return _token_response(user)


# ---------- D1: Onboarding ----------

@router.get("/me")
def get_me(current_user: CurrentUser, db: Session = Depends(get_db)):
    return {
        "id": current_user.id,
        "name": current_user.name,
        "email": current_user.email,
        "picture": current_user.picture or "",
        "role": current_user.role or "",
        "department": current_user.department or "",
        "employee_code": current_user.employee_code or "",
        "preferred_language": current_user.preferred_language or "vi",
        "onboarding_completed": current_user.onboarding_completed,
    }


@router.put("/me")
def update_me(
    payload: schemas.UserProfileUpdate,
    current_user: CurrentUser,
    db: Session = Depends(get_db),
):
    user = db.get(models.User, current_user.id)
    user.name = payload.name
    if payload.role is not None:
        user.role = payload.role
    if payload.department is not None:
        user.department = payload.department
    if payload.employee_code is not None:
        user.employee_code = payload.employee_code
    if payload.preferred_language is not None:
        user.preferred_language = payload.preferred_language
    if payload.picture is not None:
        user.picture = payload.picture
    db.commit()
    db.refresh(user)
    return {
        "id": user.id,
        "name": user.name,
        "email": user.email,
        "picture": user.picture or "",
        "role": user.role or "",
        "department": user.department or "",
        "employee_code": user.employee_code or "",
        "preferred_language": user.preferred_language or "vi",
        "onboarding_completed": user.onboarding_completed,
    }


@router.post("/me/avatar")
async def upload_avatar(
    current_user: CurrentUser,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    content_type = (file.content_type or "").lower()
    ext = AVATAR_TYPES.get(content_type)
    if not ext:
        raise HTTPException(400, "Chi ho tro anh JPG, PNG, WebP hoac GIF")

    data = await file.read()
    if not data:
        raise HTTPException(400, "File anh khong duoc de trong")
    if len(data) > AVATAR_MAX_BYTES:
        raise HTTPException(400, "Anh dai dien toi da 2MB")

    avatar_dir = settings.uploads_dir / "avatars"
    avatar_dir.mkdir(parents=True, exist_ok=True)
    for old in avatar_dir.glob(f"user-{current_user.id}.*"):
        try:
            old.unlink()
        except OSError:
            pass

    filename = f"user-{current_user.id}{ext}"
    path: Path = avatar_dir / filename
    path.write_bytes(data)

    user = db.get(models.User, current_user.id)
    user.picture = f"/uploads/avatars/{filename}"
    db.commit()
    db.refresh(user)
    return {
        "id": user.id,
        "name": user.name,
        "email": user.email,
        "picture": user.picture or "",
        "role": user.role or "",
        "department": user.department or "",
        "employee_code": user.employee_code or "",
        "preferred_language": user.preferred_language or "vi",
        "onboarding_completed": user.onboarding_completed,
    }


@router.put("/password")
def update_password(
    payload: schemas.PasswordUpdate,
    current_user: CurrentUser,
    db: Session = Depends(get_db),
):
    user = db.get(models.User, current_user.id)
    if user.hashed_password and not verify_password(payload.current_password, user.hashed_password):
        raise HTTPException(400, "Mat khau hien tai khong dung")
    if user.hashed_password and verify_password(payload.new_password, user.hashed_password):
        raise HTTPException(400, "Mat khau moi khong duoc trung mat khau hien tai")
    user.hashed_password = hash_password(payload.new_password)
    db.commit()
    return {"ok": True}


@router.post("/onboarding/complete")
def complete_onboarding(
    payload: schemas.OnboardingCompleteRequest,
    current_user: CurrentUser,
    db: Session = Depends(get_db),
):
    user = db.get(models.User, current_user.id)
    user.onboarding_completed = True
    if payload.role:
        user.role = payload.role
    db.commit()
    return {"ok": True}


@router.post("/onboarding/skip")
def skip_onboarding(current_user: CurrentUser, db: Session = Depends(get_db)):
    user = db.get(models.User, current_user.id)
    user.onboarding_completed = True
    user.onboarding_skipped_at = datetime.now()
    db.commit()
    return {"ok": True}
