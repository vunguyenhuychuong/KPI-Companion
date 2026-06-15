"""Endpoint ket noi nguon du lieu qua OAuth (theo tung nguoi dung).

- GET  /api/oauth/providers          -> danh sach nguon + trang thai ket noi cua user
- GET  /api/oauth/{provider}/start   -> tra auth_url (frontend chuyen huong trinh duyet)
- GET  /api/oauth/{provider}/callback-> provider goi ve; doi code lay token; redirect ve frontend
- DELETE /api/oauth/{provider}       -> ngat ket noi
"""
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

from .. import schemas
from ..auth import CurrentUser
from ..database import get_db
from ..services import oauth_service

router = APIRouter(prefix="/api/oauth", tags=["oauth"])


def _request_base(request: Request) -> str:
    # vd "http://localhost:8000" — bo phan duong dan/dau "/"
    return str(request.base_url).rstrip("/")


@router.get("/providers", response_model=list[schemas.IntegrationOut])
def list_providers(current_user: CurrentUser, db: Session = Depends(get_db)):
    connected = oauth_service.list_integrations(db, current_user.id)
    out = []
    for key, cfg in oauth_service.PROVIDERS.items():
        row = connected.get(key)
        out.append(
            schemas.IntegrationOut(
                provider=key,
                label=cfg.label,
                icon=cfg.icon,
                sources=cfg.sources,
                enabled=oauth_service.provider_enabled(key),
                connected=bool(row and row.status == "connected"),
                account_email=row.account_email if row else "",
                account_name=row.account_name if row else "",
                connected_at=row.created_at if row else None,
            )
        )
    return out


@router.get("/{provider}/start", response_model=schemas.OAuthStartOut)
def oauth_start(
    provider: str, request: Request, current_user: CurrentUser, db: Session = Depends(get_db)
):
    try:
        url = oauth_service.build_auth_url(provider, current_user.id, _request_base(request))
    except oauth_service.OAuthError as e:
        raise HTTPException(400, str(e))
    return schemas.OAuthStartOut(auth_url=url)


@router.get("/{provider}/callback")
def oauth_callback(
    provider: str,
    request: Request,
    db: Session = Depends(get_db),
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
):
    """Provider redirect ve day (trinh duyet, KHONG co Bearer) — danh tinh nam trong `state`."""
    if error:
        return RedirectResponse(oauth_service.frontend_return_url(provider, ok=False, error=error))
    if not code or not state:
        return RedirectResponse(
            oauth_service.frontend_return_url(provider, ok=False, error="missing_code")
        )
    try:
        oauth_service.handle_callback(db, provider, code, state, _request_base(request))
    except oauth_service.OAuthError as e:
        return RedirectResponse(oauth_service.frontend_return_url(provider, ok=False, error=str(e)))
    except Exception as e:  # loi doi token / mang -> bao ve frontend thay vi 500
        return RedirectResponse(
            oauth_service.frontend_return_url(provider, ok=False, error=f"exchange_failed: {e}")
        )
    return RedirectResponse(oauth_service.frontend_return_url(provider, ok=True))


@router.delete("/{provider}")
def oauth_disconnect(provider: str, current_user: CurrentUser, db: Session = Depends(get_db)):
    ok = oauth_service.disconnect(db, current_user.id, provider)
    return {"disconnected": ok}
