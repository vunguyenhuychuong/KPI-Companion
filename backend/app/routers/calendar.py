from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import schemas
from ..auth import CurrentUser
from ..connectors.calendar_conn import create_calendar_event
from ..connectors.google_base import google_available
from ..database import get_db

router = APIRouter(prefix="/api/calendar", tags=["calendar"])


@router.post("/events/confirm")
def confirm_meeting(
    proposal: schemas.MeetingProposal,
    current_user: CurrentUser,
    db: Session = Depends(get_db),
):
    """Tao cuoc hop trong Google Calendar sau khi nguoi dung xac nhan de xuat."""
    if not google_available(db, current_user.id):
        raise HTTPException(
            status_code=400,
            detail="Chưa kết nối Google. Vào Nguồn dữ liệu → Kết nối Google để tạo cuộc họp.",
        )
    try:
        result = create_calendar_event(proposal, db, current_user.id)
        return {"status": "created", **result}
    except Exception as exc:
        err = str(exc)
        if "insufficientPermissions" in err or "forbidden" in err.lower():
            raise HTTPException(
                status_code=403,
                detail="Tài khoản Google chưa cấp quyền tạo sự kiện. Vào Nguồn dữ liệu → ngắt kết nối rồi kết nối lại Google để cấp quyền mới.",
            )
        raise HTTPException(status_code=500, detail=f"Không thể tạo cuộc họp: {exc}")
