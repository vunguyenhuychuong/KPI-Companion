from fastapi import APIRouter, Depends, HTTPException
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token as google_id_token
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models, schemas
from ..auth import create_access_token, hash_password, verify_password
from ..config import settings
from ..database import get_db

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.get("/config")
def auth_config():
    """Tra ve cau hinh public cho frontend (google_client_id de hien thi nut OAuth)."""
    return {"google_client_id": settings.google_client_id}


@router.post("/register", response_model=schemas.Token)
def register(payload: schemas.UserCreate, db: Session = Depends(get_db)):
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
    return schemas.Token(
        access_token=create_access_token(user.id),
        user_id=user.id,
        name=user.name,
        picture=user.picture or "",
    )


@router.post("/login", response_model=schemas.Token)
def login(payload: schemas.UserLogin, db: Session = Depends(get_db)):
    email = payload.email.strip().lower()
    user = db.scalars(select(models.User).where(models.User.email == email)).first()
    if not user or not user.hashed_password or not verify_password(payload.password, user.hashed_password):
        raise HTTPException(400, "Email hoặc mật khẩu không đúng")
    return schemas.Token(
        access_token=create_access_token(user.id),
        user_id=user.id,
        name=user.name,
        picture=user.picture or "",
    )


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
        # Cap nhat ten + anh neu Google tra ve moi hon
        changed = False
        if name and user.name != name:
            user.name = name
            changed = True
        if picture and user.picture != picture:
            user.picture = picture
            changed = True
        if changed:
            db.commit()

    return schemas.Token(
        access_token=create_access_token(user.id),
        user_id=user.id,
        name=user.name,
        picture=user.picture or "",
    )
