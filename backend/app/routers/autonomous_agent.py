from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models, schemas
from ..auth import CurrentUser
from ..config import settings
from ..database import get_db
from ..services import autonomous_agent

router = APIRouter(prefix="/api/agent/autonomous", tags=["autonomous-agent"])


def _polish_agent_text(text: str) -> str:
    replacements = {
        "Agent tự chủ phát hiện: ": "",
        "Perceive-Reason-Act-Remember": "trợ lý chủ động",
        "Perceive": "",
        "Reason": "",
        "Act": "",
        "Remember": "",
        "đang ở trạng thái se_lam": "vẫn chưa bắt đầu",
        "đang ở trạng thái dang_lam": "đang thực hiện",
        "đang ở trạng thái da_lam": "đã hoàn tất",
        "đang ở trạng thái phat_sinh": "mới phát sinh",
        "đang ở trạng thái loai_bo": "đã loại bỏ",
        "trạng thái se_lam": "chưa bắt đầu",
        "trạng thái dang_lam": "đang thực hiện",
        "se_lam": "chưa bắt đầu",
        "dang_lam": "đang thực hiện",
        "work item": "đầu việc",
        "proposal": "đề xuất",
        "deadline": "hạn chót",
        "delta KPI mặc định là 0": "thẻ chưa cộng thêm kết quả KPI",
        "Tôi ": "Mình ",
    }
    out = text or ""
    for old, new in replacements.items():
        out = out.replace(old, new)
    return out


def _clean_content(content: str) -> str:
    raw = content or ""
    legacy_sections: dict[str, str] = {}
    title = ""
    for line in raw.splitlines():
        stripped = line.strip()
        if stripped.startswith("**Agent tự chủ phát hiện:"):
            title = stripped.strip("*").replace("Agent tự chủ phát hiện:", "").strip()
            continue
        for key in ("Perceive", "Reason", "Act"):
            prefix = f"- {key}:"
            if stripped.startswith(prefix):
                legacy_sections[key] = stripped[len(prefix) :].strip()
    if legacy_sections:
        title_part = f" {title}" if title else ""
        context = " ".join(
            _polish_agent_text(legacy_sections.get(key, ""))
            for key in ("Perceive", "Reason")
            if legacy_sections.get(key)
        ).strip()
        action = _polish_agent_text(legacy_sections.get("Act", "")).strip()
        for redundant in (
            "Mình chưa ghi thay đổi nào vào KPI.",
            "Mình chưa ghi thay đổi nào vào KPI",
        ):
            action = action.replace(redundant, "").strip()
        return (
            f"**Mình vừa nhận thấy{title_part}.**\n\n"
            f"{context}\n\n"
            f"{action} Mình chưa ghi thay đổi nào vào KPI; dữ liệu chỉ được lưu khi bạn xác nhận."
        )

    lines = []
    for line in raw.splitlines():
        if "fingerprint" in line:
            lines.append("Mình đã ghi nhận tín hiệu này để lần sau không nhắc lặp cùng một việc.")
        else:
            lines.append(_polish_agent_text(line))
    return "\n".join(lines)


def _clean_proposed_items(items: list) -> list:
    cleaned = []
    for item in items:
        if not isinstance(item, dict):
            continue
        row = {**item}
        if row.get("source") == "agent_loop":
            row["source_ref"] = ""
            if row.get("mapping_reason"):
                row["mapping_reason"] = _polish_agent_text(str(row["mapping_reason"]))
            if row.get("detail"):
                row["detail"] = _polish_agent_text(str(row["detail"]))
        cleaned.append(row)
    return cleaned


def _clean_category_suggestions(items: list) -> list:
    cleaned = []
    for item in items:
        if not isinstance(item, dict):
            continue
        row = {**item}
        if row.get("suggested_category") not in {"Work", "Personal"}:
            continue
        if row.get("current_category") not in {"Work", "Personal"}:
            row["current_category"] = "Work"
        row["reason"] = _polish_agent_text(str(row.get("reason") or ""))
        cleaned.append(row)
    return cleaned


def _inbox_items(db: Session, user_id: int, limit: int = 20) -> list[schemas.AutonomousInboxItem]:
    rows = list(
        db.scalars(
            select(models.ChatMessage)
            .where(
                models.ChatMessage.user_id == user_id,
                models.ChatMessage.role == "assistant",
            )
            .order_by(models.ChatMessage.created_at.desc())
            .limit(100)
        )
    )
    out: list[schemas.AutonomousInboxItem] = []
    for msg in rows:
        meta = msg.meta or {}
        if meta.get("intent") != "autonomous_agent":
            continue
        if meta.get("proposal_status") != "pending":
            continue
        cycle_meta = meta.get("autonomous_cycle") or {}
        proposed = _clean_proposed_items(meta.get("proposed_items") or [])
        category_suggestions = _clean_category_suggestions(meta.get("category_suggestions") or [])
        out.append(
            schemas.AutonomousInboxItem(
                message_id=msg.id,
                session_id=msg.session_id,
                content=_clean_content(msg.content),
                event_type=str(cycle_meta.get("event_type") or ""),
                summary=str(cycle_meta.get("summary") or ""),
                proposed_items=proposed,
                category_suggestions=category_suggestions,
                proposal_status=meta.get("proposal_status"),
                created_at=msg.created_at,
            )
        )
        if len(out) >= limit:
            break
    return out


@router.get("/status", response_model=schemas.AutonomousAgentStatusOut)
def status(current_user: CurrentUser, db: Session = Depends(get_db)):
    logs = list(
        db.scalars(
            select(models.AgentCycleLog)
            .where(models.AgentCycleLog.user_id == current_user.id)
            .order_by(models.AgentCycleLog.created_at.desc())
            .limit(10)
        )
    )
    return schemas.AutonomousAgentStatusOut(
        enabled=settings.agent_autonomous_enabled,
        interval_seconds=max(
            autonomous_agent.MIN_INTERVAL_SECONDS,
            int(settings.agent_autonomous_interval_seconds or 0),
        ),
        running=autonomous_agent.runner.running,
        latest_logs=logs,
    )


@router.post("/run-now", response_model=schemas.AgentCycleLogOut | None)
def run_now(current_user: CurrentUser, db: Session = Depends(get_db)):
    """Chay thu mot vong cho user hien tai; van chi tao insight/proposal."""
    return autonomous_agent.run_once_for_user(db, current_user.id, force=True)


@router.get("/inbox", response_model=list[schemas.AutonomousInboxItem])
def inbox(current_user: CurrentUser, db: Session = Depends(get_db)):
    """Doc cac insight/proposal tu chu dang cho user xac nhan."""
    return _inbox_items(db, current_user.id)


@router.post("/refresh", response_model=list[schemas.AutonomousInboxItem])
def refresh(current_user: CurrentUser, db: Session = Depends(get_db)):
    """Chay mot vong neu co van de moi, roi tra inbox de UI hien ngay khi mo app."""
    autonomous_agent.run_once_for_user(db, current_user.id, force=False)
    return _inbox_items(db, current_user.id)
