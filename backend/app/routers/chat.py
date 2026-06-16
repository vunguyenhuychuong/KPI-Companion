import uuid
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models, schemas
from ..agent import agent as kpi_agent
from ..agent import memory as agent_memory
from ..auth import CurrentUser
from ..config import settings
from ..database import get_db
from ..services import attachment_service

router = APIRouter(prefix="/api/chat", tags=["chat"])


@router.post("/attachments", response_model=schemas.ChatAttachment)
async def upload_attachment(current_user: CurrentUser, file: UploadFile = File(...)):
    filename = Path(file.filename or "attachment").name
    ext = Path(filename).suffix.lower()
    if ext not in attachment_service.ALLOWED_ATTACHMENT_EXTS:
        raise HTTPException(
            400,
            "Dinh dang file chua ho tro. Hay dung anh, TXT/MD/CSV/JSON, XLSX/XLSM, DOCX hoac PDF.",
        )

    content = await file.read()
    if not content:
        raise HTTPException(400, "File trong")
    if len(content) > attachment_service.MAX_ATTACHMENT_BYTES:
        raise HTTPException(400, "File qua lon, toi da 10MB")

    attachment_id = uuid.uuid4().hex
    folder = settings.uploads_dir / "chat" / str(current_user.id)
    folder.mkdir(parents=True, exist_ok=True)
    stored_name = f"{attachment_id}{ext}"
    (folder / stored_name).write_bytes(content)

    content_type = file.content_type or ""
    kind, extracted_text, error = await attachment_service.analyze_attachment(filename, content_type, content)
    return schemas.ChatAttachment(
        id=attachment_id,
        name=filename,
        content_type=content_type,
        size=len(content),
        kind=kind,
        url=f"/uploads/chat/{current_user.id}/{stored_name}",
        extracted_text=extracted_text,
        error=error,
    )


@router.get("/sessions", response_model=list[schemas.ChatSessionOut])
def list_sessions(current_user: CurrentUser, db: Session = Depends(get_db)):
    return list(
        db.scalars(
            select(models.ChatSession)
            .where(models.ChatSession.user_id == current_user.id)
            .order_by(models.ChatSession.created_at.desc())
        )
    )


@router.post("/sessions", response_model=schemas.ChatSessionOut)
def create_session(current_user: CurrentUser, db: Session = Depends(get_db)):
    session = models.ChatSession(user_id=current_user.id)
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


@router.delete("/sessions/{session_id}")
def delete_session(session_id: int, current_user: CurrentUser, db: Session = Depends(get_db)):
    session = db.get(models.ChatSession, session_id)
    if not session or session.user_id != current_user.id:
        raise HTTPException(404, "Không tìm thấy phiên chat")
    db.delete(session)  # cascade xoa tin nhan
    db.commit()
    return {"ok": True}


@router.get("/memories", response_model=list[schemas.AgentMemoryOut])
def list_memories(current_user: CurrentUser, db: Session = Depends(get_db)):
    """Nhung gi Agent da tu hoc ve nguoi dung (minh bach, xoa duoc)."""
    return agent_memory.get_memories(db, current_user.id)


@router.delete("/memories/{memory_id}")
def delete_memory(memory_id: int, current_user: CurrentUser, db: Session = Depends(get_db)):
    mem = db.get(models.AgentMemory, memory_id)
    if not mem or mem.user_id != current_user.id:
        raise HTTPException(404, "Không tìm thấy ghi nhớ")
    db.delete(mem)
    db.commit()
    return {"ok": True}


@router.post("", response_model=schemas.ChatResponse)
def chat(
    payload: schemas.ChatRequest,
    current_user: CurrentUser,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    text = payload.message.strip()
    attachments = attachment_service.clean_attachments(payload.attachments)
    if not text and attachments:
        text = (
            "Hãy đọc và phân tích tệp đính kèm này. Nếu có dữ liệu công việc liên quan KPI, "
            "hãy chỉ rõ bằng chứng và đề xuất bước tiếp theo; không tự ghi dữ liệu."
        )
    if not text:
        raise HTTPException(400, "Tin nhắn trống")
    agent_text = text + attachment_service.attachment_context(attachments, payload.lang)

    session = db.get(models.ChatSession, payload.session_id) if payload.session_id else None
    if session and session.user_id != current_user.id:
        session = None
    if not session:
        session = models.ChatSession(user_id=current_user.id)
        db.add(session)
        db.flush()
    # dat ten phien theo tin nhan dau tien
    if session.title == "Cuộc trò chuyện mới":
        session.title = text[:60] + ("…" if len(text) > 60 else "")

    # ngu canh hoi thoai: chi lay tin nhan TRONG PHIEN nay
    recent = list(
        db.scalars(
            select(models.ChatMessage)
            .where(models.ChatMessage.session_id == session.id)
            .order_by(models.ChatMessage.created_at.desc())
            .limit(6)
        )
    )
    history = [{"role": m.role, "content": m.content} for m in reversed(recent)]

    db.add(models.ChatMessage(
        user_id=current_user.id,
        session_id=session.id,
        role="user",
        content=text,
        meta={"attachments": attachments} if attachments else None,
    ))
    db.commit()
    try:
        response = kpi_agent.handle_message(db, agent_text, user_id=current_user.id, history=history, lang=payload.lang)
    except Exception as e:
        response = schemas.ChatResponse(
            reply=(
                f"⚠️ Có lỗi khi xử lý yêu cầu bằng AI: {e}\n\n"
                "Nếu lỗi lặp lại với mọi tin nhắn, hãy kiểm tra LLM_BASE_URL / LLM_API_KEY / LLM_MODEL. "
                "Nếu chỉ xảy ra ở một thao tác cụ thể, đây có thể là lỗi prompt/parser trong ứng dụng."
            ),
            intent="error",
        )
    response.session_id = session.id
    assistant_msg = models.ChatMessage(
        user_id=current_user.id,
        session_id=session.id,
        role="assistant",
        content=response.reply,
        meta={
            "intent": response.intent,
            "proposed_items": [i.model_dump(mode="json") for i in response.proposed_items],
            "proposed_objectives": [i.model_dump(mode="json") for i in response.proposed_objectives],
            "proposed_kpis": [i.model_dump(mode="json") for i in response.proposed_kpis],
            "weight_changes": [i.model_dump(mode="json") for i in response.weight_changes],
            "delete_proposal": response.delete_proposal.model_dump(mode="json") if response.delete_proposal else None,
            "proposal_status": (
                "pending"
                if response.proposed_items
                or response.proposed_objectives
                or response.proposed_kpis
                or response.delete_proposal
                else None
            ),
        },
    )
    db.add(assistant_msg)
    db.commit()
    response.message_id = assistant_msg.id
    # Agent tu hoc: trich thong tin ben vung tu luot trao doi nay (chay NEN sau khi
    # da tra loi — khong them do tre; loi trong buoc nay khong anh huong chat)
    if response.intent != "error" and not response.proposed_items:
        background_tasks.add_task(
            agent_memory.learn_from_exchange, current_user.id, text, response.reply,
            str(session.id),
        )
    return response


@router.patch("/messages/{message_id}/proposal-status")
def set_proposal_status(
    message_id: int,
    payload: schemas.ProposalStatusUpdate,
    current_user: CurrentUser,
    db: Session = Depends(get_db),
):
    """Luu trang thai the de xuat (saved/dismissed) de hien dung khi mo lai phien."""
    if payload.status not in {"pending", "saved", "dismissed"}:
        raise HTTPException(400, "Trạng thái không hợp lệ")
    msg = db.get(models.ChatMessage, message_id)
    if not msg or msg.user_id != current_user.id or msg.role != "assistant":
        raise HTTPException(404, "Không tìm thấy tin nhắn")
    # gan dict moi (khong mutate) de SQLAlchemy nhan biet thay doi cot JSON
    msg.meta = {**(msg.meta or {}), "proposal_status": payload.status}
    db.commit()
    return {"ok": True}


@router.get("/history", response_model=list[schemas.ChatMessageOut])
def history(
    current_user: CurrentUser,
    session_id: int | None = None,
    limit: int = 100,
    db: Session = Depends(get_db),
):
    q = select(models.ChatMessage).where(models.ChatMessage.user_id == current_user.id)
    if session_id is not None:
        q = q.where(models.ChatMessage.session_id == session_id)
    msgs = list(db.scalars(q.order_by(models.ChatMessage.created_at.desc()).limit(limit)))
    return list(reversed(msgs))
