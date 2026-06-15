from fastapi import APIRouter, Depends, HTTPException, UploadFile
from sqlalchemy.orm import Session

from .. import schemas
from ..agent import agent as kpi_agent
from ..auth import CurrentUser
from ..config import settings
from ..connectors import fetch_activities
from ..connectors.file_upload import parse_worklog_file
from ..database import get_db
from ..services import kpi_service

router = APIRouter(prefix="/api/sources", tags=["sources"])


@router.get("/status")
def sources_status(current_user: CurrentUser, db: Session = Depends(get_db)):
    """Trang thai TUNG nguon cua nguoi dung hien tai: mock hay that (theo ket noi OAuth)."""
    from ..services import oauth_service

    modes = oauth_service.source_modes(db, current_user.id, settings.google_mock_mode)
    any_real = any(m == "real" for m in modes.values())
    note = (
        "Đang dùng dữ liệu thật từ (các) tài khoản đã kết nối."
        if any_real
        else "Đang dùng dữ liệu mô phỏng. Vào mục Kết nối để liên kết tài khoản thật."
    )
    return {**modes, "csv_upload": "real", "note": note}


@router.post("/sync", response_model=schemas.ChatResponse)
def sync(payload: schemas.SyncRequest, current_user: CurrentUser, db: Session = Depends(get_db)):
    """Quet nguon ngoai theo yeu cau (nut bam tren UI, khong qua chat)."""
    activities = fetch_activities(
        payload.sources, payload.start_date, payload.end_date, db=db, user_id=current_user.id
    )
    if not activities:
        return schemas.ChatResponse(
            reply="Không tìm thấy hoạt động nào trong khoảng thời gian này.", intent="sync_request"
        )
    kpis = kpi_service.get_active_kpis(db, user_id=current_user.id)
    try:
        items = kpi_agent.extract_work_items("", kpis, activities=activities)
    except Exception as e:
        raise HTTPException(502, f"Lỗi khi gọi AI model để phân loại: {e}. Kiểm tra cấu hình LLM trong .env.")
    return schemas.ChatResponse(
        reply=f"Đã quét {len(activities)} hoạt động từ {', '.join(payload.sources)}.",
        intent="sync_request",
        proposed_items=items,
    )


@router.post("/upload", response_model=schemas.ChatResponse)
async def upload_worklog(file: UploadFile, current_user: CurrentUser, db: Session = Depends(get_db)):
    """Upload file Excel/CSV log cong viec -> Agent phan loai -> de xuat dau viec."""
    content = await file.read()
    activities = parse_worklog_file(file.filename or "upload.csv", content)
    if not activities:
        raise HTTPException(400, "Không đọc được dòng dữ liệu nào từ file.")
    kpis = kpi_service.get_active_kpis(db, user_id=current_user.id)
    try:
        items = kpi_agent.extract_work_items("", kpis, activities=activities)
    except Exception as e:
        raise HTTPException(502, f"Lỗi khi gọi AI model để phân loại: {e}. Kiểm tra cấu hình LLM trong .env.")
    return schemas.ChatResponse(
        reply=f"Đã đọc {len(activities)} dòng từ file {file.filename}.",
        intent="upload",
        proposed_items=items,
    )
