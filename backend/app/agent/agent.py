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
    return date.today().isoformat()


VALID_INTENTS = {"update_progress", "sync_request", "create_kpi", "question", "other"}


def _lang_suffix(lang: str) -> str:
    """Append to system prompts for LLM text responses when lang != vi."""
    if lang == "en":
        return "\n\nIMPORTANT: Your entire response MUST be written in English."
    return ""


def _history_block(history: list[dict] | None, max_msgs: int = 4) -> str:
    """Ghep lich su hoi thoai gan nhat thanh khoi van ban cho prompt."""
    if not history:
        return ""
    lines = []
    for h in history[-max_msgs:]:
        role = "Người dùng" if h.get("role") == "user" else "Trợ lý"
        content = str(h.get("content", ""))[:600]
        lines.append(f"{role}: {content}")
    return "NGỮ CẢNH HỘI THOẠI TRƯỚC ĐÓ:\n" + "\n".join(lines) + "\n\nTIN NHẮN MỚI CỦA NGƯỜI DÙNG:\n"


def classify_intent(text: str, history: list[dict] | None = None) -> str:
    try:
        data = call_json(prompts.INTENT_SYSTEM, _history_block(history) + text, temperature=0.0)
        intent = data.get("intent", "other")
        return intent if intent in VALID_INTENTS else "other"
    except Exception:
        return "other"


def extract_kpi_proposal(
    db: Session, text: str, kpis: list[models.KPI], user_id: int = 1
) -> tuple[list[schemas.ProposedKPI], list[schemas.WeightChange]]:
    """Trich xuat de xuat tao KPI moi (+ dieu chinh trong so KPI cu) tu yeu cau chat."""
    objectives = kpi_service.objectives_with_progress(db, user_id)
    obj_text = "\n".join(
        f"- id={o.id} | {o.name} | trọng số mục tiêu {o.weight:.0f}% | {o.kpi_count} KPI"
        for o in objectives
    ) or "(Chưa có mục tiêu nào)"
    system = prompts.KPI_CREATE_SYSTEM.format(
        objectives=obj_text, kpi_list=kpi_service.kpi_list_text(kpis), today=_today()
    )
    data = call_json(system, text)
    kpi_by_id = {k.id: k for k in kpis}
    obj_by_id = {o.id: o for o in objectives}

    proposed: list[schemas.ProposedKPI] = []
    for r in data.get("kpis", []):
        if not isinstance(r, dict) or not r.get("name"):
            continue
        obj_id = r.get("objective_id")
        obj_id = obj_id if isinstance(obj_id, int) and obj_id in obj_by_id else None
        dl = None
        if r.get("deadline"):
            try:
                dl = date.fromisoformat(str(r["deadline"])[:10])
            except ValueError:
                pass

        def _num(key, default):
            try:
                return float(r.get(key))
            except (TypeError, ValueError):
                return default

        proposed.append(
            schemas.ProposedKPI(
                name=str(r["name"])[:300],
                description=str(r.get("description") or ""),
                target=str(r.get("target") or ""),
                unit=str(r.get("unit") or "%")[:50],
                target_value=max(0.001, _num("target_value", 100.0)),
                weight=max(0.0, min(100.0, _num("weight", 0.0))),
                deadline=dl,
                objective_id=obj_id,
                objective_name=obj_by_id[obj_id].name if obj_id else None,
            )
        )

    changes: list[schemas.WeightChange] = []
    for r in data.get("weight_changes", []):
        if not isinstance(r, dict):
            continue
        kid = r.get("kpi_id")
        if not (isinstance(kid, int) and kid in kpi_by_id):
            continue
        try:
            nw = max(0.0, min(100.0, float(r["new_weight"])))
        except (TypeError, ValueError, KeyError):
            continue
        changes.append(
            schemas.WeightChange(
                kpi_id=kid, kpi_name=kpi_by_id[kid].name,
                old_weight=kpi_by_id[kid].weight, new_weight=nw,
            )
        )
    return proposed, changes


SEVERITY_ORDER = {"high": 0, "medium": 1, "low": 2}
SEVERITY_LABELS = {"high": "🔴 Nghiêm trọng", "medium": "🟠 Đáng kể", "low": "🟡 Lưu ý"}


def detect_conflicts(
    kpis: list[models.KPI], proposed: list[schemas.ProposedKPI] | None = None
) -> list[schemas.KPIConflict]:
    """Phat hien xung dot giua cac KPI (va KPI dang de xuat neu co) bang LLM."""
    if len(kpis) + len(proposed or []) < 2:
        return []
    proposed_block = ""
    if proposed:
        lines = [
            f"- (ĐANG ĐỀ XUẤT, chưa có id) {p.name} | chỉ tiêu: {p.target or p.description or 'n/a'} | "
            f"{p.target_value:g} {p.unit} | deadline {p.deadline or 'cuối năm'}"
            for p in proposed
        ]
        proposed_block = "\nKPI ĐANG ĐƯỢC ĐỀ XUẤT TẠO MỚI (kiểm tra xung đột với KPI hiện có ở trên):\n" + "\n".join(lines) + "\n"
    system = prompts.CONFLICT_SYSTEM.format(
        today=_today(),
        kpi_list=kpi_service.kpi_list_text(kpis),
        proposed_block=proposed_block,
    )
    data = call_json(system, "Hãy rà soát và chỉ ra các xung đột giữa các KPI trên.", temperature=0.0)
    valid_ids = {k.id for k in kpis}
    out: list[schemas.KPIConflict] = []
    for r in data.get("conflicts", []) if isinstance(data, dict) else []:
        if not isinstance(r, dict) or not r.get("explanation"):
            continue
        ids = [i for i in r.get("kpi_ids", []) if isinstance(i, int) and i in valid_ids]
        names = [str(n) for n in r.get("kpi_names", []) if n]
        if not ids and not names:
            continue
        sev = r.get("severity")
        out.append(
            schemas.KPIConflict(
                kpi_ids=ids,
                kpi_names=names,
                type=r.get("type") if r.get("type") in schemas.CONFLICT_TYPES else "resource_tradeoff",
                severity=sev if sev in SEVERITY_ORDER else "medium",
                explanation=str(r["explanation"]),
                suggestion=str(r.get("suggestion") or ""),
            )
        )
    out.sort(key=lambda c: SEVERITY_ORDER[c.severity])
    return out


def _conflict_block(conflicts: list[schemas.KPIConflict]) -> str:
    """Khoi canh bao xung dot chen vao cau tra loi chat."""
    if not conflicts:
        return ""
    lines = [f"\n\n⚔️ **Phát hiện {len(conflicts)} xung đột KPI tiềm ẩn:**"]
    for c in conflicts:
        lines.append(f"\n{SEVERITY_LABELS[c.severity]} — **{' ↔ '.join(c.kpi_names)}**")
        lines.append(f"- Vì sao xung đột: {c.explanation}")
        if c.suggestion:
            lines.append(f"- 💡 Gợi ý cân bằng: {c.suggestion}")
    lines.append(
        "\nBạn vẫn có thể bấm **Xác nhận** nếu chấp nhận đánh đổi, "
        "hoặc mô tả lại KPI theo gợi ý cân bằng ở trên."
    )
    return "\n".join(lines)


def _kpi_proposal_reply(
    proposed: list[schemas.ProposedKPI], changes: list[schemas.WeightChange], lang: str = "vi"
) -> str:
    vi = lang != "en"
    if not proposed:
        return (
            "Tôi chưa trích xuất được KPI nào từ yêu cầu này. Bạn mô tả rõ hơn giúp tôi nhé — "
            "ví dụ: *\"Tạo KPI hoàn thành 3 khóa đào tạo nội bộ trong năm, trọng số 30%, "
            "thuộc mục tiêu Phát triển năng lực cá nhân\"*."
        ) if vi else (
            "I couldn't extract any KPIs from this request. Please describe more clearly — "
            "e.g.: *\"Create a KPI to complete 3 internal training courses this year, weight 30%, "
            "under the Personal Development objective\"*."
        )
    lines = [
        f"🆕 {'Tôi đề xuất tạo' if vi else 'I propose creating'} **{len(proposed)} {'KPI mới' if vi else 'new KPIs'}**:"
    ]
    for p in proposed:
        if vi:
            obj = f" → mục tiêu *{p.objective_name}*" if p.objective_name else " → ⚠️ chưa gắn mục tiêu"
            lines.append(
                f"- **{p.name}**: chỉ tiêu {p.target_value:g} {p.unit}, trọng số {p.weight:g}%"
                + (f", deadline {p.deadline}" if p.deadline else "") + obj
            )
        else:
            obj = f" → objective *{p.objective_name}*" if p.objective_name else " → ⚠️ no objective"
            lines.append(
                f"- **{p.name}**: target {p.target_value:g} {p.unit}, weight {p.weight:g}%"
                + (f", deadline {p.deadline}" if p.deadline else "") + obj
            )
    if changes:
        lines.append(
            f"\n⚖️ {'Kèm điều chỉnh trọng số KPI hiện có để tổng nhóm = 100%:' if vi else 'Also adjusting existing KPI weights so the group total = 100%:'}"
        )
        for c in changes:
            lines.append(f"- {c.kpi_name}: {c.old_weight:g}% → **{c.new_weight:g}%**")
    lines.append(
        "\n⚠️ **" + ("Chưa có gì được lưu." if vi else "Nothing saved yet.") + "** "
        + ("Kiểm tra/chỉnh sửa rồi bấm **Xác nhận** bên dưới để tôi ghi vào hệ thống (mọi điều chỉnh đều vào lịch sử thay đổi)."
           if vi else
           "Review/edit then click **Confirm** below to save to the system (all changes are logged to history).")
    )
    return "\n".join(lines)


def extract_work_items(
    text: str,
    kpis: list[models.KPI],
    source: str = "chat",
    activities: list[dict] | None = None,
    history: list[dict] | None = None,
) -> list[schemas.ProposedWorkItem]:
    """Tach van ban (hoac danh sach hoat dong tu nguon ngoai) thanh dau viec co cau truc."""
    system = prompts.EXTRACT_SYSTEM.format(
        kpi_list=kpi_service.kpi_list_text(kpis), today=_today()
    )
    if activities is None and history:
        text = _history_block(history) + text
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
            delta = float(r.get("value_delta") or r.get("progress_delta") or 0)
        except (TypeError, ValueError):
            delta = 0.0
        # Nguoi dung neu muc thuc dat tich luy ("da hoc xong 2 khoa") -> quy ve delta
        set_val = r.get("value_set", r.get("progress_set"))
        if set_val is not None and kpi_id:
            try:
                delta = round(max(0.0, float(set_val)) - kpi_by_id[kpi_id].current_value, 2)
            except (TypeError, ValueError):
                pass
        out.append(
            schemas.ProposedWorkItem(
                title=str(r["title"])[:500],
                detail=str(r.get("detail") or ""),
                status=status,
                kpi_id=kpi_id,
                kpi_name=kpi_by_id[kpi_id].name if kpi_id else None,
                kpi_unit=kpi_by_id[kpi_id].unit if kpi_id else None,
                value_delta=delta,
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


_STATUS_LABELS_EN = {
    "da_lam": "Done", "dang_lam": "In Progress", "se_lam": "Planned",
    "phat_sinh": "Ad-hoc", "loai_bo": "Dropped",
}


def _proposal_reply(items: list[schemas.ProposedWorkItem], from_sync: bool = False, lang: str = "vi") -> str:
    vi = lang != "en"
    if not items:
        return (
            "Tôi chưa tách được đầu việc nào từ nội dung này. "
            "Bạn mô tả cụ thể hơn giúp tôi nhé (đã làm gì, đang làm gì, kế hoạch gì)?"
        ) if vi else (
            "I couldn't extract any work items from this. "
            "Please describe more specifically (what you did, what you're doing, what you plan to do)."
        )
    status_labels = schemas.STATUS_LABELS if vi else _STATUS_LABELS_EN
    by_status: dict[str, list[schemas.ProposedWorkItem]] = {}
    for it in items:
        by_status.setdefault(it.status, []).append(it)
    lines = []
    if vi:
        lines.append(f"{'Tôi đã quét dữ liệu và tách được' if from_sync else 'Tôi đã tách được'} **{len(items)} đầu việc**{'.' if from_sync else ' từ mô tả của bạn:'}")
        no_kpi = "⚡ chưa gắn KPI"
        confirm_note = "\nVui lòng kiểm tra và bấm **Xác nhận** để tôi lưu và cập nhật tiến độ KPI. Bạn có thể chỉnh sửa từng mục trước khi xác nhận."
    else:
        lines.append(f"{'I scanned and found' if from_sync else 'I extracted'} **{len(items)} work items**{'.' if from_sync else ' from your description:'}")
        no_kpi = "⚡ no KPI linked"
        confirm_note = "\nPlease review and click **Confirm** to save and update KPI progress. You can edit each item before confirming."
    for status in schemas.WORK_STATUSES:
        group = by_status.get(status)
        if not group:
            continue
        lines.append(f"\n**{status_labels[status]}:**")
        for it in group:
            kpi_part = f" → KPI: *{it.kpi_name}*" if it.kpi_name else f" → {no_kpi}"
            delta_part = (
                f" ({'+' if it.value_delta > 0 else ''}{it.value_delta:g} {it.kpi_unit or '%'})"
                if it.value_delta else ""
            )
            ref_part = f" [{it.source_ref}]" if it.source_ref else ""
            lines.append(f"- {it.title}{kpi_part}{delta_part}{ref_part}")
    lines.append(confirm_note)
    return "\n".join(lines)


def handle_message(
    db: Session, text: str, user_id: int = 1, history: list[dict] | None = None, lang: str = "vi"
) -> schemas.ChatResponse:
    """Diem vao chinh cua Agent cho moi tin nhan chat. history giup hieu cau hoi noi tiep."""
    kpis = kpi_service.get_active_kpis(db, user_id)
    intent = classify_intent(text, history)

    if intent == "update_progress":
        items = extract_work_items(text, kpis, source="chat", history=history)
        return schemas.ChatResponse(
            reply=_proposal_reply(items, lang=lang), intent=intent, proposed_items=items
        )

    if intent == "sync_request":
        sources, start, end = parse_sync_command(text)
        activities = fetch_activities(sources, start, end)
        if not activities:
            no_act = (
                f"Tôi đã quét {', '.join(sources)} trong khoảng {start} → {end} nhưng không tìm thấy hoạt động nào."
                if lang != "en" else
                f"I scanned {', '.join(sources)} from {start} to {end} but found no activities."
            )
            return schemas.ChatResponse(reply=no_act, intent=intent)
        items = extract_work_items("", kpis, activities=activities)
        if lang == "en":
            header = f"🔍 Scanned **{', '.join(sources)}** from {start} to {end}, found {len(activities)} activities.\n\n"
        else:
            header = f"🔍 Đã quét **{', '.join(sources)}** từ {start} đến {end}, tìm thấy {len(activities)} hoạt động.\n\n"
        reply = header + _proposal_reply(items, from_sync=True, lang=lang)
        return schemas.ChatResponse(reply=reply, intent=intent, proposed_items=items)

    if intent == "create_kpi":
        proposed, changes = extract_kpi_proposal(db, _history_block(history) + text, kpis, user_id)
        conflicts: list[schemas.KPIConflict] = []
        if proposed:
            try:
                conflicts = detect_conflicts(kpis, proposed)
            except Exception:
                pass  # canh bao xung dot la tinh nang phu — khong duoc chan luong tao KPI
        return schemas.ChatResponse(
            reply=_kpi_proposal_reply(proposed, changes, lang=lang) + _conflict_block(conflicts),
            intent=intent,
            proposed_kpis=proposed,
            weight_changes=changes,
            conflicts=conflicts,
        )

    if intent == "question":
        context = kpi_service.full_context_text(db, user_id)
        reply = call_text(
            prompts.ANSWER_SYSTEM.format(context=context, today=_today()) + _lang_suffix(lang),
            text, history=history,
        )
        return schemas.ChatResponse(reply=reply, intent=intent)

    # other / chitchat
    brief = kpi_service.kpi_list_text(kpis)
    reply = call_text(
        prompts.CHITCHAT_SYSTEM.format(context_brief=brief) + _lang_suffix(lang),
        text, temperature=0.7, history=history,
    )
    return schemas.ChatResponse(reply=reply, intent="other")


def weekly_report(db: Session, user_id: int = 1, lang: str = "vi") -> str:
    context = kpi_service.full_context_text(db, user_id)
    prompt_text = "Write the weekly summary for me." if lang == "en" else "Viết bản tổng kết tuần này cho tôi."
    return call_text(
        prompts.WEEKLY_REPORT_SYSTEM.format(context=context, today=_today()) + _lang_suffix(lang),
        prompt_text,
    )


PERIOD_NAMES = {"week": "TUẦN", "month": "THÁNG", "quarter": "QUÝ", "year": "NĂM"}


def period_report(
    db: Session,
    period_type: str,
    period_label: str,
    start: date,
    end: date,
    user_id: int = 1,
    lang: str = "vi",
) -> str:
    context = kpi_service.period_context_text(db, start, end, period_type, user_id)
    system = prompts.PERIOD_REPORT_SYSTEM.format(
        period_name=PERIOD_NAMES.get(period_type, "KỲ"),
        context=context,
        today=_today(),
        period_label=period_label,
        start=start.isoformat(),
        end=end.isoformat(),
    ) + _lang_suffix(lang)
    period_name_lower = PERIOD_NAMES.get(period_type, "kỳ").lower()
    prompt_text = (
        f"Write the {period_type} report for {period_label}."
        if lang == "en" else
        f"Viết báo cáo {period_name_lower} {period_label} cho tôi."
    )
    return call_text(system, prompt_text)
