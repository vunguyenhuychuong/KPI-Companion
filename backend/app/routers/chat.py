from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models, schemas
from ..agent import agent as kpi_agent
from ..database import get_db

router = APIRouter(prefix="/api/chat", tags=["chat"])


@router.get("/sessions", response_model=list[schemas.ChatSessionOut])
def list_sessions(db: Session = Depends(get_db)):
    return list(
        db.scalars(
            select(models.ChatSession)
            .where(models.ChatSession.user_id == 1)
            .order_by(models.ChatSession.created_at.desc())
        )
    )


@router.post("/sessions", response_model=schemas.ChatSessionOut)
def create_session(db: Session = Depends(get_db)):
    session = models.ChatSession(user_id=1)
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


@router.delete("/sessions/{session_id}")
def delete_session(session_id: int, db: Session = Depends(get_db)):
    session = db.get(models.ChatSession, session_id)
    if not session:
        raise HTTPException(404, "Không tìm thấy phiên chat")
    db.delete(session)  # cascade xoa tin nhan
    db.commit()
    return {"ok": True}


@router.post("", response_model=schemas.ChatResponse)
def chat(payload: schemas.ChatRequest, db: Session = Depends(get_db)):
    text = payload.message.strip()
    if not text:
        raise HTTPException(400, "Tin nhắn trống")

    session = db.get(models.ChatSession, payload.session_id) if payload.session_id else None
    if not session:
        session = models.ChatSession(user_id=1)
        db.add(session)
        db.flush()
    # dat ten phien theo tin nhan dau tien
    if session.title == "Cuộc trò chuyện mới":
        session.title = text[:60] + ("…" if len(text) > 60 else "")

    # ngu canh hoi thoai: chi lay tin nhan TRONG PHIEN nay (tranh nhieu tu phien cu)
    recent = list(
        db.scalars(
            select(models.ChatMessage)
            .where(models.ChatMessage.session_id == session.id)
            .order_by(models.ChatMessage.created_at.desc())
            .limit(6)
        )
    )
    history = [{"role": m.role, "content": m.content} for m in reversed(recent)]

    db.add(models.ChatMessage(user_id=1, session_id=session.id, role="user", content=text))
    db.commit()
    try:
        response = kpi_agent.handle_message(db, text, history=history)
    except Exception as e:
        response = schemas.ChatResponse(
            reply=f"⚠️ Có lỗi khi gọi AI model: {e}\n\nKiểm tra lại cấu hình LLM_BASE_URL / LLM_API_KEY / LLM_MODEL trong file .env.",
            intent="error",
        )
    response.session_id = session.id
    db.add(
        models.ChatMessage(
            user_id=1,
            session_id=session.id,
            role="assistant",
            content=response.reply,
            meta={
                "intent": response.intent,
                "proposed_items": [i.model_dump(mode="json") for i in response.proposed_items],
                "proposed_kpis": [k.model_dump(mode="json") for k in response.proposed_kpis],
                "weight_changes": [w.model_dump(mode="json") for w in response.weight_changes],
            },
        )
    )
    db.commit()
    return response


@router.get("/history", response_model=list[schemas.ChatMessageOut])
def history(session_id: int | None = None, limit: int = 100, db: Session = Depends(get_db)):
    q = select(models.ChatMessage).where(models.ChatMessage.user_id == 1)
    if session_id is not None:
        q = q.where(models.ChatMessage.session_id == session_id)
    msgs = list(db.scalars(q.order_by(models.ChatMessage.created_at.desc()).limit(limit)))
    return list(reversed(msgs))
