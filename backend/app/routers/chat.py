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
from ..services import attachment_service, brain_layer

router = APIRouter(prefix="/api/chat", tags=["chat"])

AUTONOMOUS_SESSION_TITLE = "Agent tự chủ"
MAX_PRIOR_ATTACHMENT_CONTEXT_MESSAGES = 3


def _is_autonomous_session(session: models.ChatSession | None) -> bool:
    return bool(session and session.title == AUTONOMOUS_SESSION_TITLE)


def _clean_meta_attachment(raw: dict) -> dict | None:
    if not isinstance(raw, dict):
        return None
    url = str(raw.get("url") or "")
    if not url.startswith("/uploads/chat/"):
        url = ""
    kind = str(raw.get("kind") or "file")
    if kind not in {"image", "text", "spreadsheet", "document", "pdf", "file"}:
        kind = "file"
    return {
        "id": str(raw.get("id") or uuid.uuid4().hex)[:80],
        "name": Path(str(raw.get("name") or "attachment")).name[:180] or "attachment",
        "content_type": str(raw.get("content_type") or "")[:120],
        "size": int(raw.get("size") or 0),
        "kind": kind,
        "url": url,
        "extracted_text": attachment_service.limit_text(str(raw.get("extracted_text") or "")),
        "error": str(raw.get("error") or "")[:700],
    }


def _message_attachments(message: models.ChatMessage) -> list[dict]:
    meta = message.meta or {}
    attachments = meta.get("attachments") or []
    cleaned: list[dict] = []
    if not isinstance(attachments, list):
        return cleaned
    for raw in attachments:
        item = _clean_meta_attachment(raw)
        if item:
            cleaned.append(item)
    return cleaned


def _history_content_with_attachments(message: models.ChatMessage) -> str:
    content = message.content
    attachments = _message_attachments(message)
    if not attachments:
        return content
    names = ", ".join(att["name"] for att in attachments[:3])
    more = f", +{len(attachments) - 3}" if len(attachments) > 3 else ""
    return f"{content}\n[Uploaded file(s) in this message: {names}{more}]"


def _prior_attachment_context(
    recent_messages: list[models.ChatMessage],
    lang: str,
    exclude_ids: set[str] | None = None,
) -> str:
    exclude_ids = exclude_ids or set()
    picked: list[dict] = []
    seen: set[str] = set(exclude_ids)
    source_messages = 0
    for message in reversed(recent_messages):
        if message.role != "user":
            continue
        attachments = _message_attachments(message)
        if not attachments:
            continue
        source_messages += 1
        for att in attachments:
            key = att.get("id") or att.get("url") or att.get("name")
            if key in seen:
                continue
            seen.add(key)
            if att.get("extracted_text") or att.get("error"):
                picked.append(att)
        if source_messages >= MAX_PRIOR_ATTACHMENT_CONTEXT_MESSAGES:
            break
    if not picked:
        return ""
    return attachment_service.attachment_context(picked[: attachment_service.MAX_CHAT_ATTACHMENTS], lang)


def _assistant_meta(response: schemas.ChatResponse) -> dict:
    return {
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
    }


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
            .where(
                models.ChatSession.user_id == current_user.id,
                models.ChatSession.title != AUTONOMOUS_SESSION_TITLE,
            )
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


@router.post("/sessions/from-response", response_model=schemas.ChatResponse)
def create_session_from_response(
    payload: schemas.ChatPersistResponseRequest,
    current_user: CurrentUser,
    db: Session = Depends(get_db),
):
    text = payload.message.strip()
    attachments = attachment_service.clean_attachments(payload.attachments)
    if not text:
        raise HTTPException(400, "Tin nhan trong")

    session = models.ChatSession(user_id=current_user.id)
    session.title = text[:60] + ("..." if len(text) > 60 else "")
    db.add(session)
    db.flush()

    db.add(models.ChatMessage(
        user_id=current_user.id,
        session_id=session.id,
        role="user",
        content=text,
        meta={"attachments": attachments} if attachments else None,
    ))

    response = payload.response.model_copy(deep=True)
    response.session_id = session.id
    assistant_msg = models.ChatMessage(
        user_id=current_user.id,
        session_id=session.id,
        role="assistant",
        content=response.reply,
        meta=_assistant_meta(response),
    )
    db.add(assistant_msg)
    db.commit()
    response.message_id = assistant_msg.id
    return response


@router.delete("/sessions/{session_id}")
def delete_session(session_id: int, current_user: CurrentUser, db: Session = Depends(get_db)):
    session = db.get(models.ChatSession, session_id)
    if not session or session.user_id != current_user.id:
        raise HTTPException(404, "Không tìm thấy phiên chat")
    if _is_autonomous_session(session):
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
    current_attachment_context = attachment_service.attachment_context(attachments, payload.lang)
    if not payload.persist:
        agent_text = text + current_attachment_context
        try:
            return kpi_agent.handle_message(db, agent_text, user_id=current_user.id, history=[], lang=payload.lang)
        except Exception as e:
            return schemas.ChatResponse(
                reply=(
                    f"⚠️ Có lỗi khi xử lý yêu cầu bằng AI: {e}\n\n"
                    "Nếu lỗi lặp lại với mọi tin nhắn, hãy kiểm tra LLM_BASE_URL / LLM_API_KEY / LLM_MODEL. "
                    "Nếu chỉ xảy ra ở một thao tác cụ thể, đây có thể là lỗi prompt/parser trong ứng dụng."
                ),
                intent="error",
            )
    session = db.get(models.ChatSession, payload.session_id) if payload.session_id else None
    if session and session.user_id != current_user.id:
        session = None
    if _is_autonomous_session(session):
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
    history = [{"role": m.role, "content": _history_content_with_attachments(m)} for m in reversed(recent)]
    current_attachment_ids = {str(att.get("id") or "") for att in attachments if att.get("id")}
    agent_text = (
        text
        + current_attachment_context
        + _prior_attachment_context(recent, payload.lang, current_attachment_ids)
    )

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
        meta=_assistant_meta(response),
    )
    db.add(assistant_msg)
    db.commit()
    response.message_id = assistant_msg.id
    # Agent tu hoc: trich thong tin ben vung tu luot trao doi nay (chay NEN sau khi
    # da tra loi — khong them do tre; loi trong buoc nay khong anh huong chat)
    if response.intent != "error" and not response.proposed_items:
        background_tasks.add_task(
            agent_memory.learn_from_exchange, current_user.id, text, response.reply
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
    meta = msg.meta or {}
    msg.meta = {**meta, "proposal_status": payload.status}
    if payload.status in {"saved", "dismissed"}:
        proposed_items = meta.get("proposed_items") or []
        proposed_kpis = meta.get("proposed_kpis") or []
        category_suggestions = meta.get("category_suggestions") or []
        target_name = ""
        target_type = "proposal"
        if proposed_items and isinstance(proposed_items[0], dict):
            target_name = str(proposed_items[0].get("kpi_name") or proposed_items[0].get("title") or "")
            target_type = "work_item"
        elif proposed_kpis and isinstance(proposed_kpis[0], dict):
            target_name = str(proposed_kpis[0].get("name") or "")
            target_type = "kpi"
        elif category_suggestions and isinstance(category_suggestions[0], dict):
            target_name = str(category_suggestions[0].get("kpi_name") or "")
            target_type = "category"
        elif meta.get("delete_proposal"):
            target_name = str((meta.get("delete_proposal") or {}).get("target_name") or "")
            target_type = "delete"
        brain_layer.record_simple_feedback(
            db,
            current_user.id,
            event_type="proposal" if meta.get("intent") != "autonomous_agent" else "insight",
            action=payload.status,
            target_type=target_type,
            target_id=str(message_id),
            target_name=target_name,
            source=str(meta.get("intent") or "chat"),
            meta={"message_id": message_id, "intent": meta.get("intent")},
            commit=False,
        )
    db.commit()
    return {"ok": True}


@router.get("/history", response_model=list[schemas.ChatMessageOut])
def history(
    current_user: CurrentUser,
    session_id: int | None = None,
    limit: int = 100,
    db: Session = Depends(get_db),
):
    if session_id is not None:
        session = db.get(models.ChatSession, session_id)
        if not session or session.user_id != current_user.id or _is_autonomous_session(session):
            raise HTTPException(404, "Không tìm thấy phiên chat")
    q = select(models.ChatMessage).where(models.ChatMessage.user_id == current_user.id)
    if session_id is not None:
        q = q.where(models.ChatMessage.session_id == session_id)
    else:
        q = q.join(models.ChatSession, models.ChatMessage.session_id == models.ChatSession.id).where(
            models.ChatSession.title != AUTONOMOUS_SESSION_TITLE
        )
    msgs = list(db.scalars(q.order_by(models.ChatMessage.created_at.desc()).limit(limit)))
    return list(reversed(msgs))
