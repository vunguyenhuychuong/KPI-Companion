"""Brain Layer support services: settings, feedback, insight snapshots.

This module intentionally keeps write behavior conservative. It records user
feedback and generated insights, but never mutates KPI progress or confirms
agent proposals on its own.
"""
from __future__ import annotations

from collections import Counter
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models, schemas


def get_or_create_settings(db: Session, user_id: int) -> models.AgentUserSettings:
    settings_obj = db.scalars(
        select(models.AgentUserSettings).where(models.AgentUserSettings.user_id == user_id)
    ).first()
    if settings_obj:
        return settings_obj
    settings_obj = models.AgentUserSettings(user_id=user_id)
    db.add(settings_obj)
    db.commit()
    db.refresh(settings_obj)
    return settings_obj


def update_settings(
    db: Session, user_id: int, payload: schemas.AgentUserSettingsUpdate
) -> models.AgentUserSettings:
    settings_obj = get_or_create_settings(db, user_id)
    for key, value in payload.model_dump(exclude_unset=True).items():
        if value is not None and hasattr(settings_obj, key):
            setattr(settings_obj, key, value)
    settings_obj.updated_at = models.utcnow()
    db.commit()
    db.refresh(settings_obj)
    return settings_obj


def _default_signal(action: str) -> float:
    if action == "saved":
        return 1.0
    if action == "dismissed":
        return -1.0
    if action in {"read", "seen"}:
        return 0.25
    return 0.0


def record_feedback(
    db: Session,
    user_id: int,
    payload: schemas.AgentFeedbackEventCreate,
    commit: bool = True,
) -> models.AgentFeedbackEvent:
    settings_obj = get_or_create_settings(db, user_id)
    if not settings_obj.feedback_learning_enabled:
        payload.signal = 0.0
    signal = payload.signal if payload.signal else _default_signal(payload.action)
    event = models.AgentFeedbackEvent(
        user_id=user_id,
        event_type=(payload.event_type or "proposal")[:40],
        target_type=(payload.target_type or "")[:40],
        target_id=str(payload.target_id or "")[:80],
        target_name=(payload.target_name or "")[:300],
        action=(payload.action or "")[:30],
        signal=max(-1.0, min(1.0, float(signal or 0.0))),
        source=(payload.source or "")[:40],
        reason=(payload.reason or "")[:500],
        confidence=payload.confidence,
        meta=payload.meta or None,
    )
    db.add(event)
    if commit:
        db.commit()
        db.refresh(event)
    return event


def record_simple_feedback(
    db: Session,
    user_id: int,
    event_type: str,
    action: str,
    target_type: str = "",
    target_id: str = "",
    target_name: str = "",
    source: str = "",
    reason: str = "",
    meta: dict | None = None,
    commit: bool = True,
) -> models.AgentFeedbackEvent:
    return record_feedback(
        db,
        user_id,
        schemas.AgentFeedbackEventCreate(
            event_type=event_type,
            target_type=target_type,
            target_id=target_id,
            target_name=target_name,
            action=action,
            source=source,
            reason=reason,
            meta=meta or {},
        ),
        commit=commit,
    )


def recent_feedback(db: Session, user_id: int, limit: int = 20) -> list[models.AgentFeedbackEvent]:
    return list(
        db.scalars(
            select(models.AgentFeedbackEvent)
            .where(models.AgentFeedbackEvent.user_id == user_id)
            .order_by(models.AgentFeedbackEvent.created_at.desc())
            .limit(limit)
        )
    )


def recent_insights(db: Session, user_id: int, limit: int = 10) -> list[models.AgentInsightSnapshot]:
    return list(
        db.scalars(
            select(models.AgentInsightSnapshot)
            .where(models.AgentInsightSnapshot.user_id == user_id)
            .order_by(models.AgentInsightSnapshot.created_at.desc())
            .limit(limit)
        )
    )


def feedback_counts(db: Session, user_id: int) -> dict[str, int]:
    rows = recent_feedback(db, user_id, limit=200)
    counter = Counter(f"{r.event_type}:{r.action}" for r in rows)
    return dict(counter)


def calibration_suggestions(db: Session, user_id: int) -> list[str]:
    rows = recent_feedback(db, user_id, limit=80)
    if not rows:
        return []
    suggestions: list[str] = []
    dismissed_alerts = [r for r in rows if r.event_type == "alert" and r.action == "dismissed"]
    saved_proposals = [r for r in rows if r.event_type in {"proposal", "insight"} and r.action == "saved"]
    dismissed_proposals = [r for r in rows if r.event_type in {"proposal", "insight"} and r.action == "dismissed"]
    if len(dismissed_alerts) >= 5:
        suggestions.append(
            "Bạn đã ẩn khá nhiều cảnh báo gần đây; nên cân nhắc tăng warning threshold hoặc mute alert theo từng KPI hay gây nhiễu."
        )
    if len(dismissed_proposals) >= 4 and len(dismissed_proposals) > len(saved_proposals):
        suggestions.append(
            "Nhiều đề xuất của Agent bị bỏ qua hơn được xác nhận; nên giảm tần suất nhắc hoặc yêu cầu Agent chỉ đề xuất khi confidence cao hơn."
        )
    if len(saved_proposals) >= 5:
        suggestions.append(
            "Các đề xuất gần đây có tín hiệu tốt; có thể giữ lịch quét hiện tại và tiếp tục học từ các lần xác nhận."
        )
    return suggestions[:3]


def save_insight_snapshot(
    db: Session,
    user_id: int,
    insight_type: str,
    title: str,
    content: str,
    source: str,
    data_signature: str = "",
    kpi_id: int | None = None,
    confidence: float | None = None,
    meta: dict | None = None,
) -> models.AgentInsightSnapshot:
    existing = None
    if data_signature:
        existing = db.scalars(
            select(models.AgentInsightSnapshot).where(
                models.AgentInsightSnapshot.user_id == user_id,
                models.AgentInsightSnapshot.insight_type == insight_type,
                models.AgentInsightSnapshot.data_signature == data_signature,
            )
        ).first()
    if existing:
        existing.title = title[:300]
        existing.content = content
        existing.source = source[:40]
        existing.kpi_id = kpi_id
        existing.confidence = confidence
        existing.meta = meta or None
        existing.updated_at = models.utcnow()
        db.commit()
        db.refresh(existing)
        return existing
    snapshot = models.AgentInsightSnapshot(
        user_id=user_id,
        insight_type=insight_type[:40],
        title=title[:300],
        content=content,
        data_signature=data_signature[:80],
        source=source[:40],
        kpi_id=kpi_id,
        confidence=confidence,
        meta=meta or None,
    )
    db.add(snapshot)
    db.commit()
    db.refresh(snapshot)
    return snapshot


def cleanup_conversation_history(db: Session, user_id: int, retention_days: int | None = None) -> int:
    settings_obj = get_or_create_settings(db, user_id)
    days = int(retention_days or settings_obj.retention_days or 90)
    days = max(30, min(365, days))
    cutoff = datetime.now() - timedelta(days=days)
    rows = list(
        db.scalars(
            select(models.ChatMessage).where(
                models.ChatMessage.user_id == user_id,
                models.ChatMessage.created_at < cutoff,
            )
        )
    )
    for row in rows:
        db.delete(row)
    db.commit()
    return len(rows)


def brain_status(db: Session, user_id: int) -> schemas.AgentBrainStatusOut:
    settings_obj = get_or_create_settings(db, user_id)
    return schemas.AgentBrainStatusOut(
        settings=settings_obj,
        feedback_counts=feedback_counts(db, user_id),
        recent_feedback=recent_feedback(db, user_id, limit=12),
        recent_insights=recent_insights(db, user_id, limit=8),
        calibrations=calibration_suggestions(db, user_id),
    )
