"""Bo nho dai han cua Agent.

Hai che do:
  - AgentBase Memory Service: khi AGENTBASE_MEMORY_ID + AGENTBASE_MEMORY_STRATEGY_ID duoc dat.
    Events duoc push len AgentBase sau moi luot chat; LTMS tu dong trich fact.
    memories_text() dung semantic search de lay ky uc phu hop nhat.
  - SQLite fallback: khi chua cau hinh AgentBase (che do mac dinh khi dev local).
    Hanh vi giong y het ban truoc.

Signature cac ham public KHONG doi -> agent.py va kpi_service.py khong can sua gi.
"""
import asyncio
import concurrent.futures
import re

from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models
from ..config import settings
from ..database import SessionLocal
from . import prompts
from .llm import call_json

MAX_MEMORIES_SQLITE = 50


# ─── helpers ────────────────────────────────────────────────────────

def _norm(text: str) -> str:
    return re.sub(r"\s+", " ", text.strip().lower())


def _agentbase_on() -> bool:
    return bool(settings.agentbase_memory_id and settings.agentbase_memory_strategy_id)


def _namespace(user_id: int) -> str:
    return f"/strategies/{settings.agentbase_memory_strategy_id}/actors/{user_id}"


def _get_client():
    """Tra ve MemoryClient. SDK tu doc .greennode.json hoac GREENNODE_CLIENT_ID/SECRET."""
    from greennode_agentbase.memory import MemoryClient
    return MemoryClient()


def _run(coro):
    """Chay coroutine dong bo, an toan tu ca thread pool lan event loop thread."""
    try:
        asyncio.get_running_loop()
        # Dang trong event loop thread -> chay trong thread rieng tranh nest
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as ex:
            return ex.submit(asyncio.run, coro).result(timeout=15)
    except RuntimeError:
        # Khong co running loop (background task thread) -> an toan dung truc tiep
        return asyncio.run(coro)


# ─── SQLite implementation (fallback) ───────────────────────────────

def _get_memories_sqlite(db: Session, user_id: int, limit: int = MAX_MEMORIES_SQLITE) -> list[models.AgentMemory]:
    return list(
        db.scalars(
            select(models.AgentMemory)
            .where(models.AgentMemory.user_id == user_id)
            .order_by(models.AgentMemory.created_at.desc())
            .limit(limit)
        )
    )


def _memories_text_sqlite(db: Session, user_id: int) -> str:
    mems = _get_memories_sqlite(db, user_id)
    if not mems:
        return ""
    return "\n".join(f"- [{m.category}] {m.content}" for m in reversed(mems))


def _learn_sqlite(user_id: int, user_msg: str, assistant_reply: str) -> None:
    db = SessionLocal()
    try:
        existing_mems = _get_memories_sqlite(db, user_id)
        existing = _memories_text_sqlite(db, user_id) or "(chưa có gì)"
        seen = {(m.category, _norm(m.content)) for m in existing_mems}
        data = call_json(
            prompts.MEMORY_EXTRACT_SYSTEM.format(existing=existing),
            f"Người dùng: {user_msg[:1500]}\n\nTrợ lý trả lời: {assistant_reply[:1500]}",
            temperature=0.0, max_tokens=320,
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
            if category not in {"profile", "alias", "workflow", "preference", "correction", "other"}:
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
        all_ids = [m.id for m in db.scalars(
            select(models.AgentMemory)
            .where(models.AgentMemory.user_id == user_id)
            .order_by(models.AgentMemory.created_at.desc())
        )]
        for old_id in all_ids[MAX_MEMORIES_SQLITE:]:
            mem = db.get(models.AgentMemory, old_id)
            if mem:
                db.delete(mem)
        db.commit()
    except Exception:
        db.rollback()
    finally:
        db.close()


def _remember_correction_sqlite(db: Session, user_id: int, content: str) -> None:
    existing_mems = _get_memories_sqlite(db, user_id)
    seen = {(m.category, _norm(m.content)) for m in existing_mems}
    key = ("correction", _norm(content))
    if key in seen:
        return
    db.add(models.AgentMemory(user_id=user_id, content=content[:500], category="correction"))
    db.flush()
    all_ids = [m.id for m in db.scalars(
        select(models.AgentMemory)
        .where(models.AgentMemory.user_id == user_id)
        .order_by(models.AgentMemory.created_at.desc())
    )]
    for old_id in all_ids[MAX_MEMORIES_SQLITE:]:
        mem = db.get(models.AgentMemory, old_id)
        if mem:
            db.delete(mem)


# ─── AgentBase Memory implementation ────────────────────────────────

async def _push_events_async(user_id: int, session_id: str, user_msg: str, assistant_reply: str) -> None:
    from greennode_agentbase.memory.models import EventCreateRequest, EventPayload
    client = _get_client()
    try:
        for role, content in [("user", user_msg[:3000]), ("assistant", assistant_reply[:3000])]:
            req = EventCreateRequest(
                payload=EventPayload(type="conversational", role=role, message=content)
            )
            await client.create_event_async(
                id=settings.agentbase_memory_id,
                actorId=str(user_id),
                sessionId=session_id,
                request=req,
            )
    finally:
        await client.close()


async def _search_records_async(user_id: int, query: str, limit: int = 20) -> str:
    from greennode_agentbase.memory.models import MemoryRecordSearchRequest
    client = _get_client()
    try:
        results = await client.search_memory_records_async(
            id=settings.agentbase_memory_id,
            namespace=_namespace(user_id),
            request=MemoryRecordSearchRequest(query=query, limit=limit),
        )
        records = results if isinstance(results, list) else getattr(results, "list_data", [])
        if not records:
            return ""
        return "\n".join(
            f"- {r['memory'] if isinstance(r, dict) else getattr(r, 'memory', str(r))}"
            for r in records
        )
    finally:
        await client.close()


async def _insert_record_async(user_id: int, content: str) -> None:
    from greennode_agentbase.memory.models import MemoryRecordInsertDirectlyRequest
    client = _get_client()
    try:
        await client.insert_memory_records_directly_async(
            id=settings.agentbase_memory_id,
            namespace=_namespace(user_id),
            request=MemoryRecordInsertDirectlyRequest(memory_records=[content]),
        )
    finally:
        await client.close()


# ─── Public API ─────────────────────────────────────────────────────

def get_memories(db: Session, user_id: int, limit: int = MAX_MEMORIES_SQLITE) -> list[models.AgentMemory]:
    """Tra ve AgentMemory SQLite (dung cho cac endpoint /api/memories). Khong doi."""
    return _get_memories_sqlite(db, user_id, limit)


def memories_text(db: Session, user_id: int) -> str:
    """Khoi van ban ky uc tiem vao prompt Agent.

    AgentBase: semantic search lay fact phu hop nhat.
    SQLite fallback: dump toan bo (hanh vi cu).
    """
    if not _agentbase_on():
        return _memories_text_sqlite(db, user_id)
    try:
        query = "user profile role kpi preferences aliases work patterns corrections"
        return _run(_search_records_async(user_id, query))
    except Exception:
        return _memories_text_sqlite(db, user_id)


def learn_from_exchange(user_id: int, user_msg: str, assistant_reply: str, session_id: str = "default") -> None:
    """Chay NEN sau khi tra loi — push events len AgentBase (LTMS tu sinh fact) hoac SQLite.

    session_id: truyen str(session.id) tu chat router de phan biet phien.
    """
    if not _agentbase_on():
        _learn_sqlite(user_id, user_msg, assistant_reply)
        return
    try:
        _run(_push_events_async(user_id, session_id, user_msg, assistant_reply))
    except Exception:
        _learn_sqlite(user_id, user_msg, assistant_reply)


def remember_correction(db: Session, user_id: int, content: str) -> None:
    """Luu correction ro rang cua user lam precedent."""
    content = re.sub(r"\s+", " ", content.strip())
    if len(content) < 8:
        return
    if not _agentbase_on():
        _remember_correction_sqlite(db, user_id, content)
        return
    try:
        _run(_insert_record_async(user_id, f"[correction] {content}"))
    except Exception:
        _remember_correction_sqlite(db, user_id, content)
