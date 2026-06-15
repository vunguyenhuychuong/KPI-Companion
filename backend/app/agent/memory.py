"""Bo nho dai han cua Agent — tu hoc tu noi dung trao doi voi nguoi dung.

Co che: sau moi luot chat, mot tac vu CHAY NEN (BackgroundTasks — khong them
do tre phan hoi) goi LLM trich cac thong tin BEN VUNG dang ghi nho. Cac lan
chat sau, khoi ghi nho duoc tiem vao prompt de Agent hieu nguoi dung hon
(cach goi tat KPI, vai tro, thoi quen...). Loi o day KHONG duoc anh huong chat.
"""
import re

from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models
from ..database import SessionLocal
from . import prompts
from .llm import call_json

MAX_MEMORIES = 50  # gioi han moi user — vuot thi xoa ghi nho cu nhat


def _norm(text: str) -> str:
    return re.sub(r"\s+", " ", text.strip().lower())


def get_memories(db: Session, user_id: int, limit: int = MAX_MEMORIES) -> list[models.AgentMemory]:
    return list(
        db.scalars(
            select(models.AgentMemory)
            .where(models.AgentMemory.user_id == user_id)
            .order_by(models.AgentMemory.created_at.desc())
            .limit(limit)
        )
    )


def memories_text(db: Session, user_id: int) -> str:
    """Khoi van ban ghi nho de tiem vao prompt; chuoi rong neu chua hoc duoc gi."""
    mems = get_memories(db, user_id)
    if not mems:
        return ""
    return "\n".join(f"- [{m.category}] {m.content}" for m in reversed(mems))


def learn_from_exchange(user_id: int, user_msg: str, assistant_reply: str) -> None:
    """Chay NEN sau khi da tra loi nguoi dung — trich va luu thong tin moi."""
    db = SessionLocal()
    try:
        existing_mems = get_memories(db, user_id)
        existing = memories_text(db, user_id) or "(chưa có gì)"
        seen = {(m.category, _norm(m.content)) for m in existing_mems}
        data = call_json(
            prompts.MEMORY_EXTRACT_SYSTEM.format(existing=existing),
            f"Người dùng: {user_msg[:1500]}\n\nTrợ lý trả lời: {assistant_reply[:1500]}",
            temperature=0.0,
            max_tokens=320,
        )
        items = data.get("memories", []) if isinstance(data, dict) else []
        added = 0
        for it in items[:5]:
            if not isinstance(it, dict):
                continue
            content = str(it.get("content", "")).strip()
            if len(content) < 8:
                continue
            category = str(it.get("category") or "other")[:30]
            if category not in {"profile", "alias", "workflow", "preference", "other"}:
                category = "other"
            key = (category, _norm(content))
            if key in seen:
                continue
            db.add(models.AgentMemory(user_id=user_id, content=content[:500], category=category))
            seen.add(key)
            added += 1
        if not added:
            return
        db.commit()
        # giu toi da MAX_MEMORIES ghi nho moi nhat
        all_ids = [
            m.id
            for m in db.scalars(
                select(models.AgentMemory)
                .where(models.AgentMemory.user_id == user_id)
                .order_by(models.AgentMemory.created_at.desc())
            )
        ]
        for old_id in all_ids[MAX_MEMORIES:]:
            mem = db.get(models.AgentMemory, old_id)
            if mem:
                db.delete(mem)
        db.commit()
    except Exception:
        db.rollback()  # tu hoc la tinh nang nen — nuot loi de khong anh huong gi
    finally:
        db.close()
