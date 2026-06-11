from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models, schemas
from ..agent import agent as kpi_agent
from ..database import get_db

router = APIRouter(prefix="/api/chat", tags=["chat"])


@router.post("", response_model=schemas.ChatResponse)
def chat(payload: schemas.ChatRequest, db: Session = Depends(get_db)):
    text = payload.message.strip()
    if not text:
        raise HTTPException(400, "Tin nhắn trống")
    db.add(models.ChatMessage(user_id=1, role="user", content=text))
    db.commit()
    try:
        response = kpi_agent.handle_message(db, text)
    except Exception as e:
        response = schemas.ChatResponse(
            reply=f"⚠️ Có lỗi khi gọi AI model: {e}\n\nKiểm tra lại cấu hình LLM_BASE_URL / LLM_API_KEY / LLM_MODEL trong file .env.",
            intent="error",
        )
    db.add(
        models.ChatMessage(
            user_id=1,
            role="assistant",
            content=response.reply,
            meta={
                "intent": response.intent,
                "proposed_items": [i.model_dump(mode="json") for i in response.proposed_items],
            },
        )
    )
    db.commit()
    return response


@router.get("/history", response_model=list[schemas.ChatMessageOut])
def history(limit: int = 50, db: Session = Depends(get_db)):
    msgs = list(
        db.scalars(
            select(models.ChatMessage)
            .where(models.ChatMessage.user_id == 1)
            .order_by(models.ChatMessage.created_at.desc())
            .limit(limit)
        )
    )
    return list(reversed(msgs))
