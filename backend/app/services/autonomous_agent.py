"""Autonomous Agent loop: Perceive -> Reason -> Act -> Remember.

The loop is deliberately conservative:
- It observes KPI/work-item state on a timer.
- It reasons deterministically about the most urgent next nudge.
- It acts by writing a chat insight/proposal or an unconfirmed Journal draft.
- It remembers the cycle in AgentCycleLog to avoid repeating the same nudge.

It never confirms proposals, creates official work evidence, or mutates KPI/objective progress directly.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
from dataclasses import dataclass
from datetime import date, datetime, timedelta

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from .. import models, schemas
from ..agent.llm import call_json
from ..config import settings
from ..connectors import fetch_activities
from ..database import SessionLocal
from . import brain_layer, kpi_service, notification_email, oauth_service

logger = logging.getLogger(__name__)

AUTONOMOUS_SESSION_TITLE = "Agent tự chủ"
MIN_INTERVAL_SECONDS = 60
DAILY_SCAN_SOURCES = ["gmail", "calendar", "sheets", "notion", "slack", "outlook"]
SOURCE_SCAN_LOOKBACK_DAYS = 1
MIN_SOURCE_CONFIDENCE = 0.55


@dataclass
class AutonomousEvent:
    event_type: str
    fingerprint: str
    priority: int
    title: str
    perceive: str
    reason: str
    act: str
    remember: str
    kpi: models.KPI | None = None
    work_item: models.WorkItem | None = None
    category_suggestion: dict | None = None
    proposed_items: list[schemas.ProposedWorkItem] | None = None
    scan_summary: dict | None = None


CATEGORY_CLASSIFY_SYSTEM = """Bạn là trợ lý phân loại KPI theo ngữ cảnh.

Nhiệm vụ: đọc danh sách Objective/KPI và phát hiện KPI đang nằm sai nhóm Work/Personal.

Quy tắc phân loại:
- Work: mục tiêu phục vụ công việc, hiệu suất nghề nghiệp, KPI công ty/phòng ban, dự án, khách hàng, doanh thu, vận hành, chứng chỉ bắt buộc cho vai trò công việc.
- Personal: mục tiêu đời sống cá nhân, giải trí, sức khỏe, học tập cho bản thân, tài chính cá nhân, gia đình, du lịch, sở thích, âm nhạc, thể thao, phát triển bản thân không gắn trực tiếp với trách nhiệm công việc.
- Nếu lẫn cả hai, chọn nhóm chi phối theo mục đích chính của Objective/KPI.
- Nếu không đủ chắc, trả suggested_category là "uncertain".

Chỉ trả JSON hợp lệ:
{
  "items": [
    {
      "kpi_id": 123,
      "suggested_category": "Work|Personal|uncertain",
      "confidence": 0.0,
      "reason": "Một câu ngắn bằng tiếng Việt, không nhắc ID."
    }
  ]
}

Chỉ đưa vào "items" những KPI nên đổi nhóm hoặc cần kiểm tra lại. Không dùng native function calling."""


CATEGORY_ASSIGN_SYSTEM = """You classify unsaved Objective/KPI candidates into Work or Personal.

Product context: KPI Companion is work-first. However, when the content clearly describes
personal life goals, hobbies, travel, health, family, personal finance, entertainment, or
self-development not tied to job responsibility, classify it as Personal instead of leaving
it in the default Work bucket.

Rules:
- Work: job performance, company/team KPIs, professional delivery, customers, revenue,
  operations, work projects, role-required learning or certification.
- Personal: personal life goals, hobbies, travel, health, family, personal finance,
  entertainment, music, sports, or self-development not directly tied to work duties.
- If mixed, choose the category that dominates the candidate's main purpose.
- If uncertain, choose Work with low confidence because the product is work-first.

Return only valid JSON:
{
  "items": [
    {
      "local_id": "source_id",
      "category": "Work|Personal",
      "confidence": 0.0,
      "reason": "One short Vietnamese sentence."
    }
  ]
}

Return exactly one item for every local_id in the input. Do not use native function calling."""


def classify_category_candidates(candidates: list[dict]) -> dict[str, dict]:
    """Classify unsaved Objective/KPI candidates with the LLM.

    Returns local_id -> {category, confidence, reason}. Failure is non-blocking and
    defaults to Work so imports/proposals remain usable.
    """
    if not candidates:
        return {}
    defaults = {
        str(c.get("local_id")): {
            "category": "Work",
            "confidence": 0.0,
            "reason": "Khong du du lieu phan loai, tam xep vao nhom Cong viec.",
        }
        for c in candidates
        if c.get("local_id") is not None
    }
    try:
        data = call_json(
            CATEGORY_ASSIGN_SYSTEM,
            json.dumps({"items": candidates}, ensure_ascii=False),
            temperature=0.0,
            max_tokens=1600,
        )
    except Exception:
        logger.exception("AI category assignment failed for unsaved candidates")
        return defaults

    for item in data.get("items") or []:
        if not isinstance(item, dict):
            continue
        local_id = str(item.get("local_id") or "")
        if local_id not in defaults:
            continue
        category = schemas._normalize_category(item.get("category"))
        try:
            confidence = float(item.get("confidence", 0.0))
        except (TypeError, ValueError):
            confidence = 0.0
        defaults[local_id] = {
            "category": category,
            "confidence": max(0.0, min(1.0, confidence)),
            "reason": str(item.get("reason") or "").strip()[:260],
        }
    return defaults


def _recent_work_date(db: Session, kpi_id: int) -> datetime | None:
    return db.scalar(
        select(func.max(models.WorkItem.created_at)).where(
            models.WorkItem.kpi_id == kpi_id,
            models.WorkItem.confirmed == True,  # noqa: E712
        )
    )


def _already_remembered(db: Session, user_id: int, fingerprint: str) -> bool:
    return (
        db.scalars(
            select(models.AgentCycleLog)
            .where(
                models.AgentCycleLog.user_id == user_id,
                models.AgentCycleLog.event_fingerprint == fingerprint,
                models.AgentCycleLog.status == "acted",
            )
            .limit(1)
        ).first()
        is not None
    )


def _already_evaluated_category(db: Session, user_id: int, fingerprint: str) -> bool:
    return (
        db.scalars(
            select(models.AgentCycleLog)
            .where(
                models.AgentCycleLog.user_id == user_id,
                models.AgentCycleLog.event_fingerprint == fingerprint,
                models.AgentCycleLog.status.in_(["acted", "checked"]),
            )
            .limit(1)
        ).first()
        is not None
    )


def _already_checked(db: Session, user_id: int, fingerprint: str) -> bool:
    return (
        db.scalars(
            select(models.AgentCycleLog)
            .where(
                models.AgentCycleLog.user_id == user_id,
                models.AgentCycleLog.event_fingerprint == fingerprint,
                models.AgentCycleLog.status.in_(["acted", "checked"]),
            )
            .limit(1)
        ).first()
        is not None
    )


def _connected_sources(db: Session, user_id: int) -> list[str]:
    modes = oauth_service.source_modes(db, user_id, settings.google_mock_mode)
    return [src for src in DAILY_SCAN_SOURCES if modes.get(src) == "real"]


def _record_source_scan_check(
    db: Session,
    user_id: int,
    fingerprint: str,
    today: date,
    summary: str,
    meta: dict | None = None,
) -> None:
    db.add(
        models.AgentCycleLog(
            user_id=user_id,
            cycle_key=f"autonomous-source-scan:{today.isoformat()}",
            phase="source_scan",
            status="checked",
            event_fingerprint=fingerprint,
            summary=summary,
            meta={"event_type": "source_scan", **(meta or {})},
        )
    )
    db.commit()


def _source_scan_fingerprint(user_id: int, today: date, sources: list[str]) -> str:
    raw = f"{user_id}|{today.isoformat()}|{','.join(sorted(sources))}"
    digest = hashlib.sha1(raw.encode("utf-8")).hexdigest()[:16]
    return f"source_scan:{user_id}:{today.isoformat()}:{digest}"


def _source_activity_fingerprint(activity: dict) -> str:
    raw = json.dumps(
        {
            "source": activity.get("source") or "",
            "date": activity.get("date") or "",
            "ref": activity.get("ref") or "",
            "text": str(activity.get("text") or "")[:500],
        },
        ensure_ascii=False,
        sort_keys=True,
    )
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:16]


def _proposed_source_refs(db: Session, user_id: int) -> set[tuple[str, str]]:
    refs: set[tuple[str, str]] = set()
    rows = db.scalars(
        select(models.ChatMessage)
        .where(
            models.ChatMessage.user_id == user_id,
            models.ChatMessage.role == "assistant",
            models.ChatMessage.meta.isnot(None),
        )
        .order_by(models.ChatMessage.created_at.desc())
        .limit(200)
    )
    for msg in rows:
        meta = msg.meta or {}
        for item in meta.get("proposed_items") or []:
            if not isinstance(item, dict):
                continue
            source = str(item.get("source") or "").strip()
            ref = str(item.get("source_ref") or "").strip()
            if source and ref:
                refs.add((source, ref))
    return refs


def _already_has_source_item(
    db: Session,
    user_id: int,
    item: schemas.ProposedWorkItem,
    proposed_refs: set[tuple[str, str]],
) -> bool:
    source = (item.source or "").strip()
    ref = (item.source_ref or "").strip()
    if source and ref:
        if (source, ref) in proposed_refs:
            return True
        existing = db.scalars(
            select(models.WorkItem)
            .where(
                models.WorkItem.user_id == user_id,
                models.WorkItem.source == source,
                models.WorkItem.source_ref == ref,
            )
            .limit(1)
        ).first()
        return existing is not None
    existing = db.scalars(
        select(models.WorkItem)
        .where(
            models.WorkItem.user_id == user_id,
            models.WorkItem.source == source,
            models.WorkItem.title == item.title,
            models.WorkItem.work_date == item.work_date,
        )
        .limit(1)
    ).first()
    return existing is not None


def _source_item_confidence(item: schemas.ProposedWorkItem) -> float:
    if item.confidence is not None:
        return max(0.0, min(1.0, float(item.confidence)))
    return 0.72 if item.kpi_id else 0.0


def _filter_source_items(
    db: Session, user_id: int, items: list[schemas.ProposedWorkItem]
) -> tuple[list[schemas.ProposedWorkItem], dict[str, int]]:
    ignored = {
        "no_kpi": 0,
        "low_confidence": 0,
        "not_evidence": 0,
        "duplicate": 0,
    }
    proposed_refs = _proposed_source_refs(db, user_id)
    kept: list[schemas.ProposedWorkItem] = []
    seen_refs: set[tuple[str, str]] = set()
    for item in items:
        confidence = _source_item_confidence(item)
        ref_key = (item.source or "", item.source_ref or "")
        if ref_key[1] and ref_key in seen_refs:
            ignored["duplicate"] += 1
            continue
        if not item.kpi_id:
            ignored["no_kpi"] += 1
            continue
        if item.status in {"se_lam", "loai_bo"}:
            ignored["not_evidence"] += 1
            continue
        if confidence < MIN_SOURCE_CONFIDENCE:
            ignored["low_confidence"] += 1
            continue
        if _already_has_source_item(db, user_id, item, proposed_refs):
            ignored["duplicate"] += 1
            continue
        item.confidence = confidence
        if not item.mapping_reason:
            item.mapping_reason = (
                "AI tìm thấy bằng chứng từ nguồn đã kết nối và gán vào KPI này "
                "vì nội dung hoạt động khớp với mục tiêu đo lường."
            )
        kept.append(item)
        if ref_key[1]:
            seen_refs.add(ref_key)
    return kept, ignored


def _daily_source_scan_event(
    db: Session, user_id: int, kpis: list[models.KPI], today: date
) -> AutonomousEvent | None:
    if not kpis:
        return None
    sources = _connected_sources(db, user_id)
    if not sources:
        return None
    fingerprint = _source_scan_fingerprint(user_id, today, sources)
    if _already_checked(db, user_id, fingerprint):
        return None

    start = today - timedelta(days=SOURCE_SCAN_LOOKBACK_DAYS)
    activities = [
        a for a in fetch_activities(sources, start, today, db=db, user_id=user_id)
        if a.get("ref") != "error"
    ]
    if not activities:
        _record_source_scan_check(
            db,
            user_id,
            fingerprint,
            today,
            "Đã quét nguồn kết nối nhưng chưa có hoạt động mới.",
            {"sources": sources, "activity_count": 0, "proposed_items": 0},
        )
        return None

    # Import locally to avoid coupling the autonomous loop startup to the chat agent module.
    from ..agent import agent as kpi_agent

    try:
        extracted = kpi_agent.extract_work_items("", kpis, activities=activities)
    except Exception:
        logger.exception("Daily source scan extraction failed for user_id=%s", user_id)
        return None

    proposed, ignored = _filter_source_items(db, user_id, extracted)
    summary = {
        "sources": sources,
        "scan_start": start.isoformat(),
        "scan_end": today.isoformat(),
        "activity_count": len(activities),
        "extracted_items": len(extracted),
        "proposed_items": len(proposed),
        "ignored": ignored,
        "activity_fingerprints": [_source_activity_fingerprint(a) for a in activities[:50]],
    }
    if not proposed:
        _record_source_scan_check(
            db,
            user_id,
            fingerprint,
            today,
            "Đã quét nguồn kết nối nhưng không có bằng chứng KPI đủ tin cậy.",
            summary,
        )
        return None

    source_names = ", ".join(sources)
    return AutonomousEvent(
        event_type="source_scan",
        fingerprint=fingerprint,
        priority=120,
        title=f"có {len(proposed)} cập nhật mới từ nguồn đã kết nối",
        perceive=(
            f"Mình đã quét {len(activities)} hoạt động trong {source_names} "
            f"từ {start.isoformat()} đến {today.isoformat()}."
        ),
        reason=(
            f"Có {len(proposed)} hoạt động đủ liên quan KPI và đủ độ tin cậy để chuẩn bị thành nhật ký công việc; "
            f"{sum(ignored.values())} hoạt động còn lại đã được bỏ qua vì trùng lặp, chưa liên quan KPI, "
            "chỉ là kế hoạch, hoặc độ tin cậy thấp."
        ),
        act=(
            "Mình đã tạo các nháp trong Nhật ký công việc kèm nguồn, lý do gán KPI và độ tin cậy để bạn rà lại."
        ),
        remember="Đã ghi nhận lần quét nguồn hôm nay để tránh nhắc lặp cùng một loạt dữ liệu.",
        proposed_items=proposed,
        scan_summary=summary,
    )


def _schedule_time_reached(settings_obj: models.AgentUserSettings) -> bool:
    value = (settings_obj.daily_check_time or "08:00").strip()
    if len(value) != 5 or ":" not in value:
        value = "08:00"
    return datetime.now().strftime("%H:%M") >= value


def _status_counts(kpis: list[models.KPI], today: date) -> dict[str, int]:
    counts = {"green": 0, "yellow": 0, "red": 0}
    for kpi in kpis:
        health, _gap = kpi_service.health_of(kpi, today)
        counts[health] = counts.get(health, 0) + 1
    return counts


def _weekly_digest_event(
    db: Session,
    user_id: int,
    kpis: list[models.KPI],
    today: date,
    settings_obj: models.AgentUserSettings,
) -> AutonomousEvent | None:
    if not settings_obj.weekly_digest_enabled:
        return None
    if today.weekday() != int(settings_obj.weekly_digest_weekday or 0):
        return None
    if not _schedule_time_reached(settings_obj):
        return None
    iso = today.isocalendar()
    fingerprint = f"weekly_digest:{user_id}:{iso.year}-W{iso.week:02d}"
    if _already_checked(db, user_id, fingerprint):
        return None
    counts = _status_counts(kpis, today)
    risk = counts.get("red", 0) + counts.get("yellow", 0)
    summary = {
        "green": counts.get("green", 0),
        "yellow": counts.get("yellow", 0),
        "red": counts.get("red", 0),
        "kpi_count": len(kpis),
        "week": f"{iso.year}-W{iso.week:02d}",
    }
    return AutonomousEvent(
        event_type="weekly_digest",
        fingerprint=fingerprint,
        priority=68,
        title=f"tổng hợp tuần {summary['week']}",
        perceive=f"Tuần này có {len(kpis)} KPI đang hoạt động: {counts.get('green', 0)} xanh, {counts.get('yellow', 0)} vàng, {counts.get('red', 0)} đỏ.",
        reason=(
            "Đây là nhịp kiểm tra định kỳ để giữ bức tranh KPI không bị trôi khỏi kế hoạch."
            if risk
            else "Dữ liệu tuần này tương đối ổn định; vẫn nên giữ thói quen ghi nhận bằng chứng đều."
        ),
        act="Mình đã chuẩn bị digest ngắn để bạn xem lại, xác nhận là hữu ích hoặc bỏ qua để Agent học ngưỡng nhắc phù hợp hơn.",
        remember="Đã ghi nhận weekly digest của tuần này để không tạo lặp.",
        scan_summary=summary,
    )


def _monthly_report_event(
    db: Session,
    user_id: int,
    kpis: list[models.KPI],
    today: date,
    settings_obj: models.AgentUserSettings,
) -> AutonomousEvent | None:
    if not settings_obj.monthly_report_enabled:
        return None
    if today.day != int(settings_obj.monthly_report_day or 1):
        return None
    if not _schedule_time_reached(settings_obj):
        return None
    fingerprint = f"monthly_report:{user_id}:{today.year}-{today.month:02d}"
    if _already_checked(db, user_id, fingerprint):
        return None
    counts = _status_counts(kpis, today)
    summary = {
        "green": counts.get("green", 0),
        "yellow": counts.get("yellow", 0),
        "red": counts.get("red", 0),
        "kpi_count": len(kpis),
        "month": f"{today.year}-{today.month:02d}",
    }
    return AutonomousEvent(
        event_type="monthly_report",
        fingerprint=fingerprint,
        priority=67,
        title=f"báo cáo tháng {summary['month']}",
        perceive=f"Đầu tháng, Agent đã rà {len(kpis)} KPI để chuẩn bị nhịp báo cáo mới.",
        reason=f"Tình trạng hiện tại: {counts.get('green', 0)} xanh, {counts.get('yellow', 0)} vàng, {counts.get('red', 0)} đỏ.",
        act="Mình đã lưu lại insight tháng này; bạn có thể tạo báo cáo đầy đủ ở mục Báo cáo khi cần gửi đi.",
        remember="Đã ghi nhận monthly report check của tháng này để không tạo lặp.",
        scan_summary=summary,
    )


def _trend_velocity_event(
    db: Session,
    user_id: int,
    kpis: list[models.KPI],
    today: date,
    settings_obj: models.AgentUserSettings,
) -> AutonomousEvent | None:
    if not settings_obj.weekly_digest_enabled:
        return None
    if today.weekday() != int(settings_obj.weekly_digest_weekday or 0):
        return None
    if not _schedule_time_reached(settings_obj):
        return None
    iso = today.isocalendar()
    fingerprint = f"trend_velocity:{user_id}:{iso.year}-W{iso.week:02d}"
    if _already_checked(db, user_id, fingerprint):
        return None
    watched = []
    for kpi in kpis:
        try:
            forecast = kpi_service.forecast_kpi(db, kpi, today)
        except Exception:
            continue
        if forecast.has_history and not forecast.on_track:
            watched.append((kpi, forecast))
    if not watched:
        return None
    kpi, forecast = sorted(watched, key=lambda item: item[1].forecast_progress)[0]
    return AutonomousEvent(
        event_type="trend_velocity",
        fingerprint=fingerprint,
        priority=82,
        title=f'KPI "{kpi.name}" có vận tốc chưa đủ',
        perceive=f'KPI "{kpi.name}" được dự báo đạt khoảng {forecast.forecast_progress:.0f}% nếu giữ nhịp hiện tại.',
        reason="Dự báo dùng lịch sử đầu việc đã xác nhận, nên đây là tín hiệu tốt để rà lại nhịp thực thi của tuần tới.",
        act="Mình chuẩn bị insight vận tốc để bạn quyết định có cần tách thêm việc nhỏ hay điều chỉnh ngưỡng theo kỳ.",
        remember="Đã ghi nhận trend & velocity check của tuần này để không nhắc lặp.",
        kpi=kpi,
        scan_summary={
            "forecast_progress": forecast.forecast_progress,
            "daily_velocity": forecast.daily_velocity,
            "week": f"{iso.year}-W{iso.week:02d}",
        },
    )


def _work_status_label(status: str) -> str:
    labels = {
        "se_lam": "đã lên kế hoạch",
        "dang_lam": "đang thực hiện",
        "da_lam": "hoàn thành",
        "phat_sinh": "phát sinh ngoài kế hoạch",
        "loai_bo": "đã hủy bỏ",
    }
    return labels.get(status, "cần rà soát")


def _category_label(category: str) -> str:
    return "Cá nhân" if category == "Personal" else "Công việc"


def _category_fingerprint(kpi: models.KPI) -> str:
    raw = "|".join(
        [
            str(kpi.id),
            kpi.category or "",
            kpi.objective_name or "",
            kpi.name or "",
            kpi.description or "",
            kpi.target or "",
            kpi.unit or "",
        ]
    )
    digest = hashlib.sha1(raw.encode("utf-8")).hexdigest()[:16]
    return f"category:{kpi.id}:{digest}"


def _category_context(kpi: models.KPI) -> dict:
    obj = kpi.objective
    return {
        "kpi_id": kpi.id,
        "current_category": kpi.category or "Work",
        "objective_name": obj.name if obj else "",
        "objective_description": obj.description if obj else "",
        "kpi_name": kpi.name or "",
        "kpi_description": kpi.description or "",
        "target_text": kpi.target or "",
        "unit": kpi.unit or "",
        "target_value": kpi.target_value,
    }


def _ai_category_event(
    db: Session, user_id: int, kpis: list[models.KPI], today: date
) -> AutonomousEvent | None:
    candidates = [
        kpi
        for kpi in kpis
        if (kpi.category or "Work") in {"Work", "Personal"}
        and not _already_evaluated_category(db, user_id, _category_fingerprint(kpi))
    ]
    if not candidates:
        return None

    try:
        data = call_json(
            CATEGORY_CLASSIFY_SYSTEM,
            json.dumps({"today": today.isoformat(), "kpis": [_category_context(k) for k in candidates]}, ensure_ascii=False),
            temperature=0.0,
            max_tokens=900,
        )
    except Exception:
        logger.exception("AI category classification failed for user_id=%s", user_id)
        return None

    kpi_by_id = {k.id: k for k in candidates}
    suggestions: list[tuple[float, models.KPI, str, str]] = []
    suggested_ids: set[int] = set()
    for item in data.get("items") or []:
        if not isinstance(item, dict):
            continue
        try:
            kpi_id = int(item.get("kpi_id"))
        except (TypeError, ValueError):
            continue
        kpi = kpi_by_id.get(kpi_id)
        if not kpi:
            continue
        suggested = str(item.get("suggested_category") or "").strip()
        if suggested not in {"Work", "Personal"}:
            continue
        current = kpi.category or "Work"
        if suggested == current:
            continue
        suggested_ids.add(kpi.id)
        try:
            confidence = float(item.get("confidence", 0.75))
        except (TypeError, ValueError):
            confidence = 0.75
        reason = str(item.get("reason") or "").strip()
        if not reason:
            reason = (
                f'AI đánh giá KPI "{kpi.name}" phù hợp hơn với nhóm '
                f"{_category_label(suggested).lower()}."
            )
        suggestions.append((confidence, kpi, suggested, reason[:260]))

    for kpi in candidates:
        if kpi.id in suggested_ids:
            continue
        db.add(
            models.AgentCycleLog(
                user_id=user_id,
                cycle_key=f"autonomous-category:{today.isoformat()}",
                phase="category_check",
                status="checked",
                event_fingerprint=_category_fingerprint(kpi),
                summary=f'AI đã kiểm tra phân loại KPI "{kpi.name}"',
                meta={"event_type": "category_check", "suggestion": False},
            )
        )
    if candidates:
        db.flush()

    if not suggestions:
        return None

    confidence, kpi, suggested, reason = sorted(suggestions, key=lambda x: x[0], reverse=True)[0]
    current = kpi.category or "Work"
    suggestion = {
        "kpi_id": kpi.id,
        "kpi_name": kpi.name,
        "current_category": current,
        "suggested_category": suggested,
        "reason": reason,
        "confidence": max(0.0, min(1.0, confidence)),
    }
    return AutonomousEvent(
        event_type="category_mismatch",
        fingerprint=_category_fingerprint(kpi),
        priority=110,
        title=f'KPI "{kpi.name}" có vẻ thuộc nhóm {_category_label(suggested).lower()}',
        perceive=(
            f'KPI "{kpi.name}" hiện đang nằm trong nhóm {_category_label(current)}, '
            f"nhưng AI đánh giá ngữ cảnh phù hợp hơn với nhóm {_category_label(suggested)}."
        ),
        reason=reason,
        act=(
            f"Mình nghĩ nên đưa KPI này về nhóm {_category_label(suggested)} "
            "để dashboard và báo cáo không bị lẫn ngữ cảnh."
        ),
        remember="Đã ghi nhận lần đánh giá phân loại này để không nhắc lặp cùng một nội dung.",
        kpi=kpi,
        category_suggestion=suggestion,
    )


def _proposal_for_event(event: AutonomousEvent, today: date) -> list[schemas.ProposedWorkItem]:
    kpi = event.kpi
    if not kpi:
        return []
    title = f'Rà soát KPI "{kpi.name}"'
    if event.event_type == "deadline":
        title = f'Chốt bước còn thiếu cho KPI "{kpi.name}"'
    elif event.event_type == "overdue":
        title = f'Xử lý đầu việc quá hạn của KPI "{kpi.name}"'
    elif event.event_type == "stale":
        title = f'Cập nhật bằng chứng tiến độ cho KPI "{kpi.name}"'
    return [
        schemas.ProposedWorkItem(
            title=title[:500],
            detail=(
                f"{event.reason} "
                "Mình đã chuẩn bị thẻ này như một bước theo dõi tiếp theo. "
                "Nếu phù hợp, bạn có thể xác nhận; thẻ chưa cộng thêm kết quả KPI và có thể chỉnh trước khi lưu."
            ),
            status="se_lam",
            kpi_id=kpi.id,
            kpi_name=kpi.name,
            kpi_unit=kpi.unit,
            value_delta=0.0,
            source="agent_loop",
            source_ref="",
            work_date=today,
            mapping_reason="Đề xuất từ trợ lý chủ động dựa trên dữ liệu KPI và đầu việc hiện có.",
            confidence=0.9,
        )
    ]


def _event_message(event: AutonomousEvent, proposed: list[schemas.ProposedWorkItem]) -> str:
    if event.event_type == "source_scan":
        scan = event.scan_summary or {}
        ignored = scan.get("ignored") or {}
        ignored_count = sum(int(v or 0) for v in ignored.values()) if isinstance(ignored, dict) else 0
        action_note = (
            "Mình đã tạo nháp trong Nhật ký công việc kèm nguồn, lý do gán KPI và độ tin cậy. "
            "Bạn có thể vào Nhật ký để chỉnh lại KPI, trạng thái hoặc số tiến độ trước khi xác nhận."
        )
        return (
            f"**Mình vừa nhận thấy {event.title}.**\n\n"
            f"{event.perceive} {event.reason}\n\n"
            f"{event.act} {action_note} "
            f"Mình đã bỏ qua {ignored_count} mục chưa đủ liên quan hoặc chưa đủ tin cậy. "
            "Chưa có dữ liệu nào được ghi vào nhật ký chính thức; tiến độ KPI chỉ được cộng sau khi bạn xác nhận trong Nhật ký."
        )
    if event.event_type in {"weekly_digest", "monthly_report", "trend_velocity"}:
        return (
            f"**Mình vừa chuẩn bị {event.title}.**\n\n"
            f"{event.perceive} {event.reason}\n\n"
            f"{event.act} Đây chỉ là insight phân tích; mình không tự ghi thay đổi nào vào KPI. "
            "Bạn có thể xác nhận là hữu ích hoặc bỏ qua để Agent học cách nhắc phù hợp hơn."
        )
    if event.category_suggestion:
        action_note = (
            "Mình đã chuẩn bị sẵn nút xác nhận bên dưới. "
            "Bạn chỉ cần xem lại và bấm chuyển nhóm nếu đề xuất này đúng."
        )
    elif proposed:
        action_note = (
            "Mình đã chuẩn bị sẵn một thẻ đề xuất bên dưới. "
            "Bạn chỉ cần xem lại, chỉnh nếu cần, rồi xác nhận khi thấy phù hợp."
        )
    else:
        action_note = "Mình sẽ tiếp tục theo dõi và chỉ nhắc lại khi có tín hiệu mới đáng chú ý."
    return (
        f"**Mình vừa nhận thấy {event.title}.**\n\n"
        f"{event.perceive} {event.reason}\n\n"
        f"{event.act} {action_note} Mình chưa ghi thay đổi nào vào KPI; dữ liệu chỉ được lưu khi bạn xác nhận."
    )


def _get_or_create_session(db: Session, user_id: int) -> models.ChatSession:
    session = db.scalars(
        select(models.ChatSession)
        .where(
            models.ChatSession.user_id == user_id,
            models.ChatSession.title == AUTONOMOUS_SESSION_TITLE,
        )
        .order_by(models.ChatSession.created_at.desc())
        .limit(1)
    ).first()
    if session:
        return session
    session = models.ChatSession(user_id=user_id, title=AUTONOMOUS_SESSION_TITLE)
    db.add(session)
    db.flush()
    return session


def _choose_event(db: Session, user_id: int, today: date, force: bool = False) -> AutonomousEvent | None:
    all_kpis = kpi_service.get_active_kpis(db, user_id)
    kpis = [k for k in all_kpis if (k.category or "Work") == "Work"]
    if not all_kpis:
        return AutonomousEvent(
            event_type="empty",
            fingerprint=f"empty:{user_id}:{today.isoformat()}",
            priority=10,
            title="chưa có KPI hoạt động",
            perceive="Không tìm thấy KPI hoạt động nào trong hệ thống.",
            reason="Mình chưa có đủ dữ liệu để đánh giá tiến độ hoặc đề xuất bước tiếp theo.",
            act="Mình tạm thời chỉ ghi nhận trạng thái này.",
            remember="Vòng sau sẽ kiểm tra lại khi đã có KPI mới.",
        )

    events: list[AutonomousEvent] = []
    agent_settings = brain_layer.get_or_create_settings(db, user_id)

    for scheduled in (
        _weekly_digest_event(db, user_id, all_kpis, today, agent_settings),
        _monthly_report_event(db, user_id, all_kpis, today, agent_settings),
        _trend_velocity_event(db, user_id, all_kpis, today, agent_settings),
    ):
        if scheduled:
            events.append(scheduled)

    daily_ready = force or (
        bool(agent_settings.daily_check_enabled) and _schedule_time_reached(agent_settings)
    )
    if not daily_ready:
        if events:
            events.sort(key=lambda e: e.priority, reverse=True)
            return events[0]
        return None

    source_scan_event = _daily_source_scan_event(db, user_id, all_kpis, today)
    if source_scan_event:
        events.append(source_scan_event)

    category_event = _ai_category_event(db, user_id, all_kpis, today)
    if category_event:
        events.append(category_event)

    overdue = db.scalars(
        select(models.WorkItem)
        .outerjoin(models.KPI, models.WorkItem.kpi_id == models.KPI.id)
        .where(
            models.WorkItem.user_id == user_id,
            models.WorkItem.confirmed == True,  # noqa: E712
            models.WorkItem.status.in_(["se_lam", "dang_lam"]),
            models.WorkItem.work_date.isnot(None),
            models.WorkItem.work_date < today,
            or_(models.WorkItem.kpi_id.is_(None), models.KPI.category == "Work"),
        )
        .order_by(models.WorkItem.work_date.asc())
        .limit(1)
    ).first()
    if overdue:
        kpi = db.get(models.KPI, overdue.kpi_id) if overdue.kpi_id else None
        days = (today - overdue.work_date).days if overdue.work_date else 0
        events.append(
            AutonomousEvent(
                event_type="overdue",
                fingerprint=f"overdue:{overdue.id}:{overdue.status}:{overdue.work_date}",
                priority=100,
                title=f"đầu việc quá hạn {days} ngày",
                perceive=(
                    f'Đầu việc "{overdue.title}" vẫn {_work_status_label(overdue.status)} '
                    f"và đã quá hạn {days} ngày."
                ),
                reason="Việc này có thể kéo KPI liên quan tiếp tục lệch nhịp nếu chưa được xử lý hoặc tái hẹn.",
                act="Mình đề xuất thêm một bước theo dõi nhỏ để bạn quyết định xử lý tiếp.",
                remember="Đã lưu dấu vết quá hạn này để không nhắc lặp cùng một trạng thái.",
                kpi=kpi,
                work_item=overdue,
            )
        )

    for kpi in kpis:
        health, gap = kpi_service.health_of(kpi, today)
        expected = kpi_service.expected_progress(kpi, today)
        end = kpi.deadline or date(kpi.year, 12, 31)
        days_left = (end - today).days
        if health in {"red", "yellow"}:
            events.append(
                AutonomousEvent(
                    event_type="behind",
                    fingerprint=f"behind:{kpi.id}:{health}",
                    priority=90 if health == "red" else 75,
                    title=f'KPI "{kpi.name}" lệch kỳ vọng',
                    perceive=(
                        f'KPI "{kpi.name}" đạt {kpi.progress:.0f}%, kỳ vọng khoảng {expected:.0f}%, '
                        f"lệch {gap:+.0f}%."
                    ),
                    reason="Mức lệch này đủ lớn để cần một bước xử lý rõ ràng trong kỳ hiện tại.",
                    act="Mình đề xuất một bước rà soát nguyên nhân và thống nhất việc cần làm tiếp theo.",
                    remember="Đã lưu dấu vết trạng thái lệch kỳ vọng này cho vòng sau.",
                    kpi=kpi,
                )
            )
        if 0 <= days_left <= 14 and kpi.progress < 100:
            events.append(
                AutonomousEvent(
                    event_type="deadline",
                    fingerprint=f"deadline:{kpi.id}:{end.isoformat()}",
                    priority=85 if days_left <= 7 else 70,
                    title=f'KPI "{kpi.name}" sắp tới hạn',
                    perceive=f'KPI "{kpi.name}" còn {days_left} ngày tới hạn chót và đang đạt {kpi.progress:.0f}%.',
                    reason="Hạn chót đã gần nhưng KPI chưa hoàn tất, nên cần chốt bước nhỏ nhất có thể xác nhận.",
                    act="Mình đề xuất một bước nhỏ để chốt phần còn thiếu trước hạn.",
                    remember="Đã lưu dấu vết deadline này cho vòng sau.",
                    kpi=kpi,
                )
            )
        last_work = _recent_work_date(db, kpi.id)
        if kpi.progress < 100 and (last_work is None or last_work < datetime.now() - timedelta(days=5)):
            last_key = last_work.date().isoformat() if last_work else "none"
            events.append(
                AutonomousEvent(
                    event_type="stale",
                    fingerprint=f"stale:{kpi.id}:{last_key}",
                    priority=55,
                    title=f'KPI "{kpi.name}" thiếu cập nhật gần đây',
                    perceive=(
                        f'KPI "{kpi.name}" chưa có đầu việc xác nhận trong hơn 5 ngày.'
                        if last_work
                        else f'KPI "{kpi.name}" chưa có đầu việc xác nhận nào.'
                    ),
                    reason="Thiếu bằng chứng tiến độ làm dự báo và nhắc việc kém chính xác.",
                    act="Mình đề xuất cập nhật một bằng chứng tiến độ để dữ liệu rõ hơn.",
                    remember="Đã lưu dấu vết thiếu cập nhật này cho vòng sau.",
                    kpi=kpi,
                )
            )

    if not events:
        return AutonomousEvent(
            event_type="idle",
            fingerprint=f"idle:{user_id}:{today.isoformat()}",
            priority=1,
            title="không có cảnh báo mới",
            perceive=f"Đã quét {len(kpis)} KPI hoạt động và các đầu việc liên quan.",
            reason="Không có KPI lệch kỳ vọng, hạn chót gấp, thiếu cập nhật, hoặc đầu việc quá hạn mới.",
            act="Mình không tạo đề xuất mới lúc này.",
            remember="Đã lưu trạng thái ổn định cho ngày hôm nay.",
        )

    events.sort(key=lambda e: e.priority, reverse=True)
    return events[0]


def _save_event(db: Session, user_id: int, event: AutonomousEvent, today: date) -> models.AgentCycleLog:
    if event.proposed_items is not None:
        proposed = event.proposed_items
    elif event.event_type in {"idle", "empty", "category_mismatch"}:
        proposed = []
    else:
        proposed = _proposal_for_event(event, today)
    draft_count = 0
    inbox_proposed = proposed
    insight_only = event.event_type in {"weekly_digest", "monthly_report", "trend_velocity"}
    if event.event_type == "source_scan" and proposed:
        drafts = kpi_service.create_draft_items(db, proposed, user_id=user_id, commit=False)
        draft_count = len(drafts)
        inbox_proposed = []
    category_suggestions = [event.category_suggestion] if event.category_suggestion else []
    session = _get_or_create_session(db, user_id)
    message = models.ChatMessage(
        user_id=user_id,
        session_id=session.id,
        role="assistant",
        content=_event_message(event, proposed),
        meta={
            "intent": "autonomous_agent",
            "autonomous_cycle": {
                "event_type": event.event_type,
                "priority": event.priority,
                "summary": event.title,
                "source_scan": event.scan_summary,
            },
            "proposed_items": [p.model_dump(mode="json") for p in inbox_proposed],
            "category_suggestions": category_suggestions,
            "proposed_objectives": [],
            "proposed_kpis": [],
            "weight_changes": [],
            "delete_proposal": None,
            "proposal_status": "pending" if (inbox_proposed or category_suggestions or insight_only) else None,
        },
    )
    db.add(message)
    if insight_only:
        brain_layer.save_insight_snapshot(
            db,
            user_id,
            insight_type=event.event_type,
            title=event.title,
            content=f"{event.perceive} {event.reason}",
            source="autonomous",
            data_signature=event.fingerprint,
            kpi_id=event.kpi.id if event.kpi else None,
            meta={"event_type": event.event_type, "summary": event.scan_summary or {}},
        )
    log = models.AgentCycleLog(
        user_id=user_id,
        cycle_key=f"autonomous:{today.isoformat()}",
        phase="complete",
        status="acted",
        event_fingerprint=event.fingerprint,
        summary=event.title,
        meta={
            "event_type": event.event_type,
            "message_session_id": session.id,
            "proposed_items": len(inbox_proposed),
            "journal_drafts": draft_count,
            "category_suggestions": len(category_suggestions),
            "source_scan": event.scan_summary,
        },
    )
    db.add(log)
    db.commit()
    db.refresh(log)
    if draft_count:
        try:
            notification_email.send_worklog_draft_email(db, user_id, draft_count)
        except Exception:
            logger.exception("Worklog draft email failed for user_id=%s", user_id)
    return log


def run_category_guard_for_kpis(
    db: Session, user_id: int, kpis: list[models.KPI]
) -> models.AgentCycleLog | None:
    """Run the AI Work/Personal classifier for freshly changed KPI context.

    This may create an Autonomous Inbox proposal, but never changes KPI data directly.
    """
    try:
        today = date.today()
        event = _ai_category_event(db, user_id, kpis, today)
        if not event:
            db.commit()
            return None
        return _save_event(db, user_id, event, today)
    except Exception:
        db.rollback()
        logger.exception("AI category guard failed for user_id=%s", user_id)
        return None


def run_once_for_user(db: Session, user_id: int, force: bool = False) -> models.AgentCycleLog | None:
    today = date.today()
    event = _choose_event(db, user_id, today, force=force)
    if not event:
        return None
    if not force and _already_remembered(db, user_id, event.fingerprint):
        return None
    return _save_event(db, user_id, event, today)


def run_once_all_users() -> int:
    db = SessionLocal()
    try:
        users = list(db.scalars(select(models.User).order_by(models.User.id.asc())))
        count = 0
        for user in users:
            try:
                if run_once_for_user(db, user.id):
                    count += 1
            except Exception:
                db.rollback()
                logger.exception("Autonomous Agent loop failed for user_id=%s", user.id)
        return count
    finally:
        db.close()


class AutonomousAgentRunner:
    def __init__(self) -> None:
        self._task: asyncio.Task | None = None
        self._stop = asyncio.Event()

    @property
    def running(self) -> bool:
        return self._task is not None and not self._task.done()

    async def start(self) -> None:
        if not settings.agent_autonomous_enabled or self.running:
            return
        self._stop.clear()
        self._task = asyncio.create_task(self._loop(), name="kpi-autonomous-agent")
        logger.info("Autonomous Agent loop started")

    async def stop(self) -> None:
        if not self._task:
            return
        self._stop.set()
        await self._task
        self._task = None
        logger.info("Autonomous Agent loop stopped")

    async def _loop(self) -> None:
        interval = max(MIN_INTERVAL_SECONDS, int(settings.agent_autonomous_interval_seconds or 0))
        await asyncio.sleep(5)
        while not self._stop.is_set():
            try:
                await asyncio.to_thread(run_once_all_users)
            except Exception:
                logger.exception("Autonomous Agent loop tick failed")
            try:
                await asyncio.wait_for(self._stop.wait(), timeout=interval)
            except asyncio.TimeoutError:
                pass


runner = AutonomousAgentRunner()
