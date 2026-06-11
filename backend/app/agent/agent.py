"""KPI Agent — vong lap agent: hieu y dinh -> goi tool -> phan hoi.

Dung LangChain (ChatOpenAI + LCEL) voi Qwen qua endpoint OpenAI-compatible.
Khong dua vao native function-calling de tuong thich moi endpoint Qwen
(DashScope / OpenRouter / vLLM noi bo) — thay vao do dung structured JSON output.
"""
from datetime import date, datetime, timezone

from sqlalchemy.orm import Session

from .. import models, schemas
from ..connectors import fetch_activities
from ..services import kpi_service
from . import prompts
from .llm import call_json, call_text


def _today() -> str:
    return datetime.now(timezone.utc).date().isoformat()


def classify_intent(text: str) -> str:
    try:
        data = call_json(prompts.INTENT_SYSTEM, text, temperature=0.0)
        intent = data.get("intent", "other")
        return intent if intent in {"update_progress", "sync_request", "question", "other"} else "other"
    except Exception:
        return "other"


def extract_work_items(
    text: str,
    kpis: list[models.KPI],
    source: str = "chat",
    activities: list[dict] | None = None,
) -> list[schemas.ProposedWorkItem]:
    """Tach van ban (hoac danh sach hoat dong tu nguon ngoai) thanh dau viec co cau truc."""
    system = prompts.EXTRACT_SYSTEM.format(
        kpi_list=kpi_service.kpi_list_text(kpis), today=_today()
    )
    if activities is not None:
        # danh so de giu nguon goc (source_ref) chinh xac sau khi LLM phan loai
        lines = [
            f"[{i}] ({a['source']}) {a['date']}: {a['text']}" for i, a in enumerate(activities)
        ]
        user_prompt = (
            "Dưới đây là danh sách hoạt động thu thập tự động từ các nguồn dữ liệu. "
            "Hãy phân loại từng hoạt động thành đầu việc. Thêm trường \"ref_index\" = số trong ngoặc vuông "
            "để giữ nguồn gốc:\n\n" + "\n".join(lines)
        )
    else:
        user_prompt = text

    data = call_json(system, user_prompt)
    raw_items = data.get("items", []) if isinstance(data, dict) else data
    kpi_by_id = {k.id: k for k in kpis}
    out: list[schemas.ProposedWorkItem] = []
    for r in raw_items:
        if not isinstance(r, dict) or not r.get("title"):
            continue
        kpi_id = r.get("kpi_id")
        kpi_id = kpi_id if isinstance(kpi_id, int) and kpi_id in kpi_by_id else None
        status = r.get("status", "da_lam")
        if status not in schemas.WORK_STATUSES:
            status = "da_lam"
        wd = None
        if r.get("work_date"):
            try:
                wd = date.fromisoformat(str(r["work_date"])[:10])
            except ValueError:
                wd = None
        src, src_ref = source, ""
        if activities is not None:
            idx = r.get("ref_index")
            if isinstance(idx, int) and 0 <= idx < len(activities):
                src = activities[idx]["source"]
                src_ref = activities[idx].get("ref", "")
                if wd is None and activities[idx].get("date"):
                    try:
                        wd = date.fromisoformat(str(activities[idx]["date"])[:10])
                    except ValueError:
                        pass
        try:
            delta = max(0.0, min(100.0, float(r.get("progress_delta") or 0)))
        except (TypeError, ValueError):
            delta = 0.0
        out.append(
            schemas.ProposedWorkItem(
                title=str(r["title"])[:500],
                detail=str(r.get("detail") or ""),
                status=status,
                kpi_id=kpi_id,
                kpi_name=kpi_by_id[kpi_id].name if kpi_id else None,
                progress_delta=delta,
                source=src,
                source_ref=src_ref,
                work_date=wd,
            )
        )
    return out


def parse_sync_command(text: str) -> tuple[list[str], date | None, date | None]:
    data = call_json(prompts.SYNC_PARSE_SYSTEM.format(today=_today()), text, temperature=0.0)
    sources = [s for s in data.get("sources", []) if s in {"gmail", "calendar", "sheets"}]
    if not sources:
        sources = ["gmail", "calendar", "sheets"]

    def _d(key: str) -> date | None:
        try:
            return date.fromisoformat(str(data.get(key))[:10])
        except (TypeError, ValueError):
            return None

    return sources, _d("start_date"), _d("end_date")


def decompose_kpi_smart(kpi: models.KPI) -> list[dict]:
    system = prompts.SMART_SYSTEM.format(
        today=_today(),
        year=kpi.year,
        deadline=kpi.deadline.isoformat() if kpi.deadline else f"{kpi.year}-12-31",
    )
    user = (
        f"KPI: {kpi.name}\nMô tả: {kpi.description or 'n/a'}\n"
        f"Chỉ tiêu đo lường: {kpi.target or 'chưa có — hãy đề xuất'}\nTrọng số: {kpi.weight:.0f}%"
    )
    data = call_json(system, user)
    return data.get("sub_goals", [])


def _proposal_reply(items: list[schemas.ProposedWorkItem], from_sync: bool = False) -> str:
    if not items:
        return (
            "Tôi chưa tách được đầu việc nào từ nội dung này. "
            "Bạn mô tả cụ thể hơn giúp tôi nhé (đã làm gì, đang làm gì, kế hoạch gì)?"
        )
    by_status: dict[str, list[schemas.ProposedWorkItem]] = {}
    for it in items:
        by_status.setdefault(it.status, []).append(it)
    lines = []
    if from_sync:
        lines.append(f"Tôi đã quét dữ liệu và tách được **{len(items)} đầu việc**:")
    else:
        lines.append(f"Tôi đã tách được **{len(items)} đầu việc** từ mô tả của bạn:")
    for status in schemas.WORK_STATUSES:
        group = by_status.get(status)
        if not group:
            continue
        lines.append(f"\n**{schemas.STATUS_LABELS[status]}:**")
        for it in group:
            kpi_part = f" → KPI: *{it.kpi_name}*" if it.kpi_name else " → ⚡ chưa gắn KPI"
            delta_part = f" (+{it.progress_delta:.0f}%)" if it.progress_delta else ""
            ref_part = f" [{it.source_ref}]" if it.source_ref else ""
            lines.append(f"- {it.title}{kpi_part}{delta_part}{ref_part}")
    lines.append("\nVui lòng kiểm tra và bấm **Xác nhận** để tôi lưu và cập nhật tiến độ KPI. Bạn có thể chỉnh sửa từng mục trước khi xác nhận.")
    return "\n".join(lines)


def handle_message(db: Session, text: str, user_id: int = 1) -> schemas.ChatResponse:
    """Diem vao chinh cua Agent cho moi tin nhan chat."""
    kpis = kpi_service.get_active_kpis(db, user_id)
    intent = classify_intent(text)

    if intent == "update_progress":
        items = extract_work_items(text, kpis, source="chat")
        return schemas.ChatResponse(
            reply=_proposal_reply(items), intent=intent, proposed_items=items
        )

    if intent == "sync_request":
        sources, start, end = parse_sync_command(text)
        activities = fetch_activities(sources, start, end)
        if not activities:
            return schemas.ChatResponse(
                reply=f"Tôi đã quét {', '.join(sources)} trong khoảng {start} → {end} "
                "nhưng không tìm thấy hoạt động nào.",
                intent=intent,
            )
        items = extract_work_items("", kpis, activities=activities)
        reply = (
            f"🔍 Đã quét **{', '.join(sources)}** từ {start} đến {end}, "
            f"tìm thấy {len(activities)} hoạt động.\n\n" + _proposal_reply(items, from_sync=True)
        )
        return schemas.ChatResponse(reply=reply, intent=intent, proposed_items=items)

    if intent == "question":
        context = kpi_service.full_context_text(db, user_id)
        reply = call_text(
            prompts.ANSWER_SYSTEM.format(context=context, today=_today()), text
        )
        return schemas.ChatResponse(reply=reply, intent=intent)

    # other / chitchat
    brief = kpi_service.kpi_list_text(kpis)
    reply = call_text(prompts.CHITCHAT_SYSTEM.format(context_brief=brief), text, temperature=0.7)
    return schemas.ChatResponse(reply=reply, intent="other")


def weekly_report(db: Session, user_id: int = 1) -> str:
    context = kpi_service.full_context_text(db, user_id)
    return call_text(
        prompts.WEEKLY_REPORT_SYSTEM.format(context=context, today=_today()),
        "Viết bản tổng kết tuần này cho tôi.",
    )
