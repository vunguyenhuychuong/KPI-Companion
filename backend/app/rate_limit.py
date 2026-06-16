"""Rate-limit helpers dùng chung cho toàn app."""
from fastapi import Request
from jose import JWTError, jwt
from slowapi import Limiter
from slowapi.util import get_remote_address

from .config import settings


def _user_or_ip(request: Request) -> str:
    """Key function: user_id từ JWT (tránh chặn nhầm corporate NAT), fallback về IP."""
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        token = auth[7:].strip()
        try:
            payload = jwt.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])
            uid = payload.get("sub")
            if uid:
                return f"user:{uid}"
        except JWTError:
            pass
    return get_remote_address(request)


limiter = Limiter(key_func=get_remote_address)
