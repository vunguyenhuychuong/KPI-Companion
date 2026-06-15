"""KPI Agent — vong lap agent: hieu y dinh -> goi tool -> phan hoi.

Dung LangChain (ChatOpenAI + LCEL) voi Qwen qua endpoint OpenAI-compatible.
Khong dua vao native function-calling de tuong thich moi endpoint Qwen
(DashScope / OpenRouter / vLLM noi bo) — thay vao do dung structured JSON output.
"""
import re
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models, schemas
from ..connectors import fetch_activities
from ..connectors.sheets_conn import read_sheet_raw
from ..services import kpi_service, oauth_service
from . import memory, prompts
from .llm import call_json, call_text

# Trích sheet ID và gid từ Google Sheets URL
_SHEET_ID_RE = re.compile(r"docs\.google\.com/spreadsheets/d/([A-Za-z0-9_-]+)")
_SHEET_GID_RE = re.compile(r"[?&#]gid=(\d+)")


def _today() -> str:
    return date.today().isoformat()


_GOOGLE_SOURCE_KEYWORDS: dict[str, list[str]] = {
    "calendar": [
        "lịch", "lich", "calendar", "cuộc họp", "cuoc hop", "meeting",
        "sự kiện", "su kien", "event", "lịch họp", "họp hôm", "họp tuần",
        "hôm nay có", "hôm qua có", "schedule",
    ],
    "gmail": [
        "email", "gmail", "thư", "mail", "inbox", "hộp thư", "hop thu",
        "tin nhắn email", "nhận được", "nhan duoc", "gửi cho tôi",
        "gửi mail", "có mail", "đọc mail", "unread",
    ],
    "sheets": [
        "timesheet", "google sheets", "google sheet", "spreadsheet",
        "sheets", "sheet của", "xem sheet", "đọc sheet", "doc sheet",
        "bảng tính", "bang tinh", "log công việc", "ghi công",
        "công việc đã log", "log giờ", "lịch làm việc", "lich lam viec",
    ],
}


def _google_sources_for_query(text: str) -> list[str]:
    """Trả về list Google sources phù hợp dựa trên keywords trong câu hỏi."""
    text_lower = text.lower()
    sources = [src for src, kws in _GOOGLE_SOURCE_KEYWORDS.items() if any(kw in text_lower for kw in kws)]
    # URL Google Sheets trong tin nhắn -> thêm "sheets" nếu chưa có
    if _SHEET_ID_RE.search(text) and "sheets" not in sources:
        sources.append("sheets")
    return sources


def _extract_gsheets_from_text(text: str) -> list[tuple[str, str | None]]:
    """Trích (sheet_id, gid?) từ Google Sheets URLs trong text. Giữ thứ tự, loại trùng.

    Dùng finditer theo vị trí để match đúng gid với từng sheet ID.
    """
    seen: set[str] = set()
    result: list[tuple[str, str | None]] = []
    for m in _SHEET_ID_RE.finditer(text):
        sid = m.group(1)
        if sid in seen:
            continue
        seen.add(sid)
        # Tìm gid trong ~200 ký tự ngay sau sheet ID (trước URL tiếp theo)
        segment = text[m.end(): m.end() + 200]
        gid_m = _SHEET_GID_RE.search(segment)
        gid = gid_m.group(1) if gid_m else None
        result.append((sid, gid))
    return result


def _date_range_for_query(text: str) -> tuple[date, date]:
    """Suy ra date range từ câu hỏi. Default: tuần trước + 2 tuần tới (phù hợp lịch họp)."""
    today = date.today()
    t = text.lower()

    # "tháng này" / "this month" / "tháng <số>"
    month_names = {
        "january": 1, "february": 2, "march": 3, "april": 4,
        "may": 4, "june": 6, "july": 7, "august": 8,
        "september": 9, "october": 10, "november": 11, "december": 12,
    }
    if "tháng này" in t or "this month" in t or f"tháng {today.month}" in t:
        y, m = today.year, today.month
        end_month = date(y, m + 1, 1) - timedelta(days=1) if m < 12 else date(y, 12, 31)
        return date(y, m, 1), end_month

    # "tháng trước" / "last month"
    if "tháng trước" in t or "last month" in t:
        first_this = today.replace(day=1)
        end_prev = first_this - timedelta(days=1)
        return end_prev.replace(day=1), end_prev

    # "tuần này" / "this week"
    if "tuần này" in t or "this week" in t or "tuần hiện tại" in t:
        start = today - timedelta(days=today.weekday())  # Monday
        return start, start + timedelta(days=6)

    # "tuần tới" / "next week"
    if "tuần tới" in t or "tuần sau" in t or "next week" in t:
        start = today - timedelta(days=today.weekday()) + timedelta(days=7)
        return start, start + timedelta(days=6)

    # "tuần trước" / "last week"
    if "tuần trước" in t or "last week" in t:
        start = today - timedelta(days=today.weekday() + 7)
        return start, start + timedelta(days=6)

    # "hôm nay" / "today"
    if "hôm nay" in t or "today" in t or "ngày hôm nay" in t:
        return today, today + timedelta(days=1)

    # "ngày mai" / "tomorrow"
    if "ngày mai" in t or "tomorrow" in t:
        return today + timedelta(days=1), today + timedelta(days=1)

    # default: 7 ngày trước + 14 ngày tới (bao phủ lịch họp sắp tới)
    return today - timedelta(days=7), today + timedelta(days=14)


VALID_INTENTS = {"update_progress", "sync_request", "create_kpi", "delete_kpi", "coaching", "question", "weekly_summary", "other"}


def _lang_suffix(lang: str) -> str:
    """Append to system prompts for LLM text responses when lang != vi."""
    if lang == "en":
        return "\n\nIMPORTANT: Your entire response MUST be written in English."
    return ""


def _language_name(lang: str) -> str:
    return "English" if lang == "en" else "Vietnamese"


def _render_work_items_for_llm(items: list[schemas.ProposedWorkItem]) -> str:
    if not items:
        return "(none)"
    lines = []
    for i, it in enumerate(items, 1):
        lines.append(
            f"{i}. title={it.title!r}; detail={it.detail!r}; status={it.status}; "
            f"kpi={it.kpi_name or '(unlinked)'}; unit={it.kpi_unit or '%'}; "
            f"value_delta={it.value_delta:g}; source={it.source or 'chat'}; "
            f"source_ref={it.source_ref or ''}; work_date={it.work_date or ''}"
        )
    return "\n".join(lines)


def _render_kpi_proposals_for_llm(
    proposed: list[schemas.ProposedKPI],
    changes: list[schemas.WeightChange],
    new_objectives: list[schemas.ProposedObjective] | None = None,
) -> str:
    lines: list[str] = []
    if new_objectives:
        lines.append("New objectives:")
        for i, o in enumerate(new_objectives, 1):
            lines.append(f"{i}. name={o.name!r}; description={o.description!r}; weight={o.weight:g}%")
    if proposed:
        lines.append("New KPIs:")
        for i, p in enumerate(proposed, 1):
            lines.append(
                f"{i}. name={p.name!r}; description={p.description!r}; target={p.target!r}; "
                f"target_value={p.target_value:g}; unit={p.unit}; weight={p.weight:g}%; "
                f"deadline={p.deadline or ''}; category={p.category}; objective={p.objective_name or '(unassigned)'}"
            )
    if changes:
        lines.append("Existing KPI weight changes:")
        for i, c in enumerate(changes, 1):
            lines.append(f"{i}. {c.kpi_name}: {c.old_weight:g}% -> {c.new_weight:g}%")
    return "\n".join(lines) if lines else "(none)"


def _render_conflicts_for_llm(conflicts: list[schemas.KPIConflict]) -> str:
    if not conflicts:
        return "(none)"
    lines = []
    for i, c in enumerate(conflicts, 1):
        lines.append(
            f"{i}. severity={c.severity}; type={c.type}; kpis={', '.join(c.kpi_names)}; "
            f"explanation={c.explanation}; suggestion={c.suggestion}"
        )
    return "\n".join(lines)


def _proposal_reply(
    items: list[schemas.ProposedWorkItem],
    from_sync: bool = False,
    lang: str = "vi",
    history: list[dict] | None = None,
    user_text: str = "",
) -> str:
    return call_text(
        prompts.PROPOSAL_REPLY_SYSTEM.format(
            language=_language_name(lang),
            source="external data sync" if from_sync else "user message",
            item_count=len(items),
            items=_render_work_items_for_llm(items),
        ) + _lang_suffix(lang),
        user_text or "Draft the assistant reply for these proposed work items.",
        history=history,
        max_tokens=700,
    )


def _kpi_proposal_reply(
    proposed: list[schemas.ProposedKPI],
    changes: list[schemas.WeightChange],
    lang: str = "vi",
    new_objectives: list[schemas.ProposedObjective] | None = None,
    conflicts: list[schemas.KPIConflict] | None = None,
    history: list[dict] | None = None,
    user_text: str = "",
) -> str:
    return call_text(
        prompts.KPI_PROPOSAL_REPLY_SYSTEM.format(
            language=_language_name(lang),
            proposal_count=len(proposed) + len(new_objectives or []),
            proposal_data=_render_kpi_proposals_for_llm(proposed, changes, new_objectives),
            conflicts=_render_conflicts_for_llm(conflicts or []),
        ) + _lang_suffix(lang),
        user_text or "Draft the assistant reply for these KPI proposals.",
        history=history,
        max_tokens=900,
    )


def _status_reply(
    text: str,
    facts: str,
    intent: str,
    lang: str = "vi",
    history: list[dict] | None = None,
) -> str:
    return call_text(
        prompts.STATUS_REPLY_SYSTEM.format(
            language=_language_name(lang), facts=facts, intent=intent, today=_today()
        ) + _lang_suffix(lang),
        text,
        history=history,
        max_tokens=500,
    )


def _coaching_reply(
    analysis: str,
    causes: list[schemas.RootCause],
    proposed: list[schemas.ProposedWorkItem],
    text: str,
    lang: str = "vi",
    history: list[dict] | None = None,
) -> str:
    causes_text = "\n".join(
        f"- cause={c.cause}; question={c.question}" for c in causes
    ) or "(none)"
    facts = (
        f"LLM RCA analysis draft:\n{analysis}\n\n"
        f"LLM root-cause hypotheses:\n{causes_text}\n\n"
        f"Proposed remediation work items that will be shown as confirmable cards:\n"
        f"{_render_work_items_for_llm(proposed)}\n"
        "Nothing has been saved yet; remediation work items require the user to click Confirm."
    )
    return call_text(
        prompts.COACH_REPLY_SYSTEM.format(
            language=_language_name(lang), facts=facts, today=_today()
        ) + _lang_suffix(lang),
        text,
        history=history,
        max_tokens=900,
    )


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


def _has_any(text: str, words: list[str]) -> bool:
    return any(w in text for w in words)


def _classify_intent_fast(text: str, history: list[dict] | None = None) -> str | None:
    """Nhan dien nhanh cac intent ro rang de tranh 1 call LLM moi tin nhan."""
    low = text.strip().lower()
    if not low:
        return "other"

    short_ack = {"ok", "oke", "yes", "ừ", "uh", "đồng ý", "dong y", "xác nhận", "xac nhan", "lưu", "luu"}
    if low in short_ack:
        return None  # can lich su de hieu dang dong y voi the de xuat nao

    if _has_any(low, ["mật khẩu", "mat khau", "password", "đổi mật khẩu", "doi mat khau", "quên mật khẩu", "quen mat khau", "reset mật khẩu", "reset mat khau", "đổi avatar", "doi avatar", "ảnh đại diện", "anh dai dien", "hồ sơ", "ho so", "cài đặt", "cai dat"]):
        return "question"
    if _has_any(low, ["weekly summary", "báo cáo tuần", "bao cao tuan", "tổng kết tuần", "tong ket tuan"]):
        return "weekly_summary"
    if _has_any(low, ["gmail", "calendar", "sheets", "email", "lịch", "lich", "timesheet"]) and _has_any(low, ["quét", "quet", "kéo", "keo", "đồng bộ", "dong bo", "cập nhật", "cap nhat", "sync"]):
        return "sync_request"
    if _has_any(low, ["xóa", "xoá", "xoa", "gỡ", "go ", "bỏ ", "bo "]) and _has_any(low, ["kpi", "objective", "mục tiêu", "muc tieu"]):
        return "delete_kpi"
    if _has_any(low, ["tạo", "tao", "thêm", "them", "kpi mới", "kpi moi", "mục tiêu mới", "muc tieu moi", "objective mới", "objective moi"]) and _has_any(low, ["kpi", "objective", "mục tiêu", "muc tieu", "trọng số", "trong so"]):
        return "create_kpi"
    if _has_any(low, ["coach", "coaching", "gỡ rối", "go roi", "nguyên nhân", "nguyen nhan", "cải thiện", "cai thien", "nên làm gì", "nen lam gi"]) and _has_any(low, ["kpi", "chậm", "cham", "trễ", "tre", "đỏ", "do "]):
        return "coaching"
    if _has_any(low, ["kpi nào", "kpi nao", "tiến độ", "tien do", "trạng thái", "trang thai", "đang chậm", "dang cham", "bao nhiêu", "bao nhieu", "dashboard", "báo cáo", "bao cao", "tổng quan", "tong quan"]):
        return "question"
    if _has_any(low, ["đã ", "da ", "đang ", "dang ", "sẽ ", "se ", "hoàn thành", "hoan thanh", "xong", "tuần này", "tuan nay", "hôm nay", "hom nay"]) and not low.endswith("?"):
        return "update_progress"
    if len(low) <= 20 and _has_any(low, ["xin chào", "xin chao", "hello", "hi", "chào", "chao"]):
        return "other"
    return None


def classify_intent(text: str, history: list[dict] | None = None) -> str:
    fast = _classify_intent_fast(text, history)
    if fast:
        return fast
    try:
        # intent chi tra {"intent": "..."} — cap token nho de phan loai nhanh (chay truoc moi cau tra loi)
        data = call_json(prompts.INTENT_SYSTEM, _history_block(history) + text, temperature=0.0, max_tokens=24)
        intent = data.get("intent", "other")
        return intent if intent in VALID_INTENTS else "other"
    except Exception:
        return "other"


def extract_kpi_proposal(
    db: Session, text: str, kpis: list[models.KPI], user_id: int = 1
) -> tuple[list[schemas.ProposedObjective], list[schemas.ProposedKPI], list[schemas.WeightChange]]:
    """Trich xuat de xuat tao Objective moi + KPI moi (+ dieu chinh trong so KPI cu)."""
    objectives = kpi_service.objectives_with_progress(db, user_id)
    total_obj_w = sum(o.weight for o in objectives)
    obj_text = (
        "\n".join(
            f"- id={o.id} | {o.name} | trọng số mục tiêu {o.weight:.0f}% | {o.kpi_count} KPI"
            for o in objectives
        )
        or "(Chưa có mục tiêu nào)"
    ) + f"\n=> Tổng trọng số mục tiêu hiện có: {total_obj_w:g}% (còn trống {max(0, 100 - total_obj_w):g}%)"
    system = prompts.KPI_CREATE_SYSTEM.format(
        objectives=obj_text, kpi_list=kpi_service.kpi_list_text(kpis), today=_today()
    )
    data = call_json(system, text)
    kpi_by_id = {k.id: k for k in kpis}
    obj_by_id = {o.id: o for o in objectives}
    existing_names = {o.name.strip().lower(): o for o in objectives}

    # muc tieu MOI Agent de xuat tao (truoc khi gan KPI vao)
    new_objs: list[schemas.ProposedObjective] = []
    new_obj_names: dict[str, str] = {}  # lower -> ten chuan
    for r in data.get("new_objectives", []) or []:
        if not isinstance(r, dict) or not str(r.get("name", "")).strip():
            continue
        name = str(r["name"]).strip()[:300]
        if name.lower() in existing_names or name.lower() in new_obj_names:
            continue  # trung ten muc tieu da co -> KPI se gan qua objective_id
        try:
            w = max(0.0, min(100.0, float(r.get("weight") or 0)))
        except (TypeError, ValueError):
            w = 0.0
        new_objs.append(
            schemas.ProposedObjective(name=name, description=str(r.get("description") or ""), weight=w)
        )
        new_obj_names[name.lower()] = name

    proposed: list[schemas.ProposedKPI] = []
    for r in data.get("kpis", []):
        if not isinstance(r, dict) or not r.get("name"):
            continue
        obj_id = r.get("objective_id")
        obj_id = obj_id if isinstance(obj_id, int) and obj_id in obj_by_id else None
        # KPI thuoc muc tieu MOI -> tham chieu qua ten (objective_ref)
        ref_raw = str(r.get("objective_name") or "").strip().lower()
        obj_ref = new_obj_names.get(ref_raw)
        if obj_ref is None and ref_raw and ref_raw in existing_names:
            obj_id = obj_id or existing_names[ref_raw].id  # LLM ghi ten muc tieu cu vao objective_name
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
                category=schemas._normalize_category(r.get("category")),
                deadline=dl,
                objective_id=obj_id if obj_ref is None else None,
                objective_name=(
                    obj_ref if obj_ref is not None
                    else (obj_by_id[obj_id].name if obj_id else None)
                ),
                objective_ref=obj_ref,
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
    return new_objs, proposed, changes


SEVERITY_ORDER = {"high": 0, "medium": 1, "low": 2}
SEVERITY_LABELS = {"high": "🔴 Nghiêm trọng", "medium": "🟠 Đáng kể", "low": "🟡 Lưu ý"}


def extract_delete_request(
    text: str, objectives: list, kpis: list
) -> dict:
    """Trich xuat yeu cau xoa KPI/Objective tu tin nhan nguoi dung."""
    obj_text = "\n".join(
        f"- id={o.id} | {o.name} | trọng số {o.weight:.0f}%"
        for o in objectives
    ) or "(Chưa có mục tiêu nào)"
    kpi_text = "\n".join(
        f"- id={k.id} | {k.name} | {k.unit}"
        for k in kpis
    ) or "(Chưa có KPI nào)"

    system = prompts.DELETE_EXTRACT_SYSTEM.format(
        objectives=obj_text, kpis=kpi_text
    )
    data = call_json(system, text, temperature=0.0)

    target_type = data.get("target_type")
    if target_type not in {"kpi", "objective"}:
        target_type = "kpi"
    target_name = str(data.get("target_name") or "")
    # id do LLM tra ve phai ton tai that trong du lieu; neu sai -> thu khop theo ten
    pool = objectives if target_type == "objective" else kpis
    target_id = data.get("target_id")
    if not (isinstance(target_id, int) and any(p.id == target_id for p in pool)):
        match = next(
            (p for p in pool if p.name.strip().lower() == target_name.strip().lower()),
            None,
        ) if target_name.strip() else None
        target_id = match.id if match else None

    return {
        "target_type": target_type,
        "target_id": target_id,
        "target_name": target_name,
        "reason": str(data.get("reason") or ""),
    }


def coach_kpi(
    db: Session, kpi: models.KPI, user_id: int = 1, lang: str = "vi"
) -> tuple[str, list[schemas.RootCause], list[schemas.ProposedWorkItem]]:
    """Phan tich nguyen nhan goc re (RCA) + de xuat viec khac phuc cho mot KPI dang cham.

    Tra ve (analysis, root_causes, proposed_items). Toan bo van ban do LLM sinh.
    Viec khac phuc tra ve duoi dang ProposedWorkItem (se_lam, gan KPI) de tai dung
    luong xac nhan — nguoi dung bam Xac nhan moi ghi vao ke hoach.
    """
    today = date.today()
    health, gap = kpi_service.health_of(kpi, today)
    exp = kpi_service.expected_progress(kpi, today)
    obj = f', thuộc mục tiêu "{kpi.objective_name}"' if kpi.objective_name else ""
    kpi_block = (
        f'- Tên: "{kpi.name}"{obj}\n'
        f"- Thực đạt: {kpi.current_value:g}/{kpi.target_value:g} {kpi.unit} = {kpi.progress:.0f}%\n"
        f"- Kỳ vọng theo kế hoạch tới hôm nay: {exp:.0f}% (đang lệch {gap:+.0f}%, trạng thái {health})\n"
        f"- Deadline: {kpi.deadline or f'{kpi.year}-12-31'}\n"
        f"- Mô tả/chỉ tiêu: {kpi.target or kpi.description or 'n/a'}"
    )
    items = list(
        db.scalars(
            select(models.WorkItem)
            .where(models.WorkItem.kpi_id == kpi.id, models.WorkItem.confirmed == True)  # noqa: E712
            .order_by(models.WorkItem.created_at.desc())
            .limit(10)
        )
    )
    recent_text = "\n".join(
        f"- [{schemas.STATUS_LABELS.get(w.status, w.status)}] {w.title}"
        + (f" (+{w.progress_delta:g} {kpi.unit})" if w.progress_delta else "")
        + (f" — ngày {w.work_date}" if w.work_date else "")
        for w in items
    ) or "(Chưa có đầu việc nào gắn KPI này)"

    mem = memory.memories_text(db, user_id)
    mem_block = f"\n\nGHI NHỚ VỀ NGƯỜI DÙNG:\n{mem}" if mem else ""

    data = call_json(
        prompts.COACH_SYSTEM.format(
            kpi_block=kpi_block, recent_items=recent_text, today=_today(), memories=mem_block
        ) + _lang_suffix(lang),
        "Hãy phân tích nguyên nhân và đề xuất cách khắc phục KPI này.",
    )
    analysis = str(data.get("analysis") or "")
    root_causes: list[schemas.RootCause] = []
    for r in data.get("root_causes", []) or []:
        if isinstance(r, dict) and str(r.get("cause", "")).strip():
            root_causes.append(
                schemas.RootCause(cause=str(r["cause"]), question=str(r.get("question") or ""))
            )
    proposed: list[schemas.ProposedWorkItem] = []
    for r in data.get("actions", []) or []:
        if not isinstance(r, dict) or not str(r.get("title", "")).strip():
            continue
        try:
            delta = float(r.get("value_delta") or 0)
        except (TypeError, ValueError):
            delta = 0.0
        proposed.append(
            schemas.ProposedWorkItem(
                title=str(r["title"])[:500], detail=str(r.get("detail") or ""),
                status="se_lam", kpi_id=kpi.id, kpi_name=kpi.name, kpi_unit=kpi.unit,
                value_delta=delta, source="chat",
            )
        )
    return analysis, root_causes, proposed


def _match_kpi(text: str, kpis: list[models.KPI]) -> models.KPI | None:
    """Tim KPI nguoi dung nhac toi trong text (khop ten dai nhat)."""
    low = text.lower()
    best: models.KPI | None = None
    for k in kpis:
        if k.name and k.name.lower() in low and (best is None or len(k.name) > len(best.name)):
            best = k
    return best


def _causes_block(causes: list[schemas.RootCause], lang: str = "vi") -> str:
    """Render khoi nguyen nhan goc re vao cau tra loi chat (nhan UI; noi dung do LLM sinh)."""
    if not causes:
        return ""
    vi = lang != "en"
    head = (
        "\n\n**Một số nguyên nhân có thể (cùng kiểm chứng):**" if vi
        else "\n\n**Possible root causes (let's verify together):**"
    )
    lines = [head]
    for c in causes:
        lines.append(f"- {c.cause}" + (f" — *{c.question}*" if c.question else ""))
    return "\n".join(lines)


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



def extract_work_items(
    text: str,
    kpis: list[models.KPI],
    source: str = "chat",
    activities: list[dict] | None = None,
    history: list[dict] | None = None,
    memories: str = "",
) -> list[schemas.ProposedWorkItem]:
    """Tach van ban (hoac danh sach hoat dong tu nguon ngoai) thanh dau viec co cau truc."""
    system = prompts.EXTRACT_SYSTEM.format(
        kpi_list=kpi_service.kpi_list_text(kpis), today=_today()
    )
    if memories:
        system += (
            "\n\nGHI NHỚ VỀ NGƯỜI DÙNG (cách gọi tắt, quy ước — dùng để gán đúng KPI):\n" + memories
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


ALL_SYNC_SOURCES = {"gmail", "calendar", "sheets", "notion", "slack", "outlook"}


def parse_sync_command(
    text: str, history: list[dict] | None = None
) -> tuple[list[str], date | None, date | None]:
    data = call_json(prompts.SYNC_PARSE_SYSTEM.format(today=_today()), text, temperature=0.0, max_tokens=120)
    low = text.strip().lower()
    sources = [s for s in data.get("sources", []) if s in ALL_SYNC_SOURCES]
    if not sources:
        sources = ["gmail", "calendar", "sheets"]

    def _d(key: str) -> date | None:
        try:
            return date.fromisoformat(str(data.get(key))[:10])
        except (TypeError, ValueError):
            return None

    start, end = _d("start_date"), _d("end_date")
    if any(x in low for x in ["tất cả thời gian", "tat ca thoi gian", "toàn bộ", "toan bo", "all time"]):
        return sources, date(1970, 1, 1), date.today()
    if any(x in low for x in ["trước đó", "truoc do", "trước đấy", "truoc day", "earlier", "previous"]):
        prev_start, prev_end = _last_sync_range(history)
        if prev_start and prev_end:
            span = max(1, (prev_end - prev_start).days + 1)
            return sources, prev_start - timedelta(days=span), prev_start - timedelta(days=1)
    return sources, start, end


def _last_sync_range(history: list[dict] | None) -> tuple[date | None, date | None]:
    if not history:
        return None, None
    import re

    for h in reversed(history):
        text = str(h.get("content") or "")
        match = re.search(r"(\d{4}-\d{2}-\d{2})\s*(?:→|->|đến|den|to)\s*(\d{4}-\d{2}-\d{2})", text)
        if not match:
            continue
        try:
            return date.fromisoformat(match.group(1)), date.fromisoformat(match.group(2))
        except ValueError:
            continue
    return None, None


def _disconnected_sources(db: Session, user_id: int, sources: list[str]) -> list[str]:
    from ..config import settings

    modes = oauth_service.source_modes(db, user_id, settings.google_mock_mode)
    return [src for src in sources if modes.get(src) != "real"]


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



def _user_profile_context(db: Session, user_id: int, lang: str = "vi") -> str:
    """Thong tin ho so/cai dat an toan de Agent co the ho tro ngoai KPI."""
    user = db.get(models.User, user_id)
    if not user:
        return ""
    has_avatar = bool(user.picture)
    if lang == "en":
        return (
            "\n\n## USER PROFILE AND APP SETTINGS CONTEXT:\n"
            f"- Display name: {user.name or '(not set)'}\n"
            f"- Email: {user.email or '(not set)'}\n"
            f"- Role/job title: {user.role or '(not set)'}\n"
            f"- Avatar: {'configured' if has_avatar else 'not configured'}\n"
            f"- Onboarding: {'completed' if user.onboarding_completed else 'not completed'}\n"
            "- Profile settings are available in Settings > Account: display name, role, avatar URL/upload, and password.\n"
            "- Change password: Settings > Account > Password, enter current password, new password, confirmation, then Save password. Password must be 6-100 characters.\n"
            "- Forgot password: use Login > Forgot password; demo mode returns a reset URL/token if SMTP is not configured.\n"
            "- Change avatar: Settings > Account > Profile, paste an image URL or upload JPG/PNG/WebP/GIF up to 2MB, then save.\n"
            "- Other settings: theme, language, Auto Coach, export defaults, manager recipient, email notifications, and Google mock/real connection mode.\n"
            "- Never reveal or ask for secrets. Do not claim settings were changed unless the user actually used the UI/API."
        )
    return (
        "\n\n## NGU CANH HO SO VA CAI DAT NGUOI DUNG:\n"
        f"- Ten hien thi: {user.name or '(chua dat)'}\n"
        f"- Email: {user.email or '(chua dat)'}\n"
        f"- Vai tro/vi tri: {user.role or '(chua dat)'}\n"
        f"- Anh dai dien: {'da cau hinh' if has_avatar else 'chua cau hinh'}\n"
        f"- Onboarding: {'da hoan thanh' if user.onboarding_completed else 'chua hoan thanh'}\n"
        "- Ho so nam o Cai dat > Tai khoan: ten hien thi, vai tro, URL anh dai dien/upload avatar, va mat khau.\n"
        "- Doi mat khau: vao Cai dat > Tai khoan > Mat khau, nhap mat khau hien tai, mat khau moi, xac nhan, roi bam Luu mat khau. Mat khau dai 6-100 ky tu.\n"
        "- Quen mat khau: dung Login > Quen mat khau; che do demo tra reset URL/token neu SMTP chua cau hinh.\n"
        "- Doi avatar: vao Cai dat > Tai khoan > Ho so, dan URL anh hoac upload JPG/PNG/WebP/GIF toi da 2MB, roi luu.\n"
        "- Cai dat khac: theme, ngon ngu, Auto Coach, mac dinh export, nguoi nhan quan ly, thong bao email, va che do Google mock/real.\n"
        "- Khong hoi/lo secret. Khong noi da doi cai dat neu nguoi dung chua thao tac tren UI/API."
    )


def _is_account_help_question(text: str) -> bool:
    low = text.lower()
    return _has_any(low, [
        "m?t kh?u", "mat khau", "password", "avatar", "?nh ??i di?n", "anh dai dien",
        "h? s?", "ho so", "profile", "c?i ??t", "cai dat", "settings",
    ])


def handle_message(
    db: Session, text: str, user_id: int = 1, history: list[dict] | None = None, lang: str = "vi"
) -> schemas.ChatResponse:
    """Diem vao chinh cua Agent cho moi tin nhan chat. history giup hieu cau hoi noi tiep."""
    kpis = kpi_service.get_active_kpis(db, user_id)
    intent = classify_intent(text, history)
    profile_context = _user_profile_context(db, user_id, lang)

    # khoi ghi nho Agent da tu hoc — giup hieu cach goi tat, vai tro, thoi quen nguoi dung
    mem = memory.memories_text(db, user_id)
    mem_block = (
        f"\n\n## GHI NHỚ VỀ NGƯỜI DÙNG (Agent đã tự học từ các hội thoại trước — dùng để hiểu cách gọi tắt, bối cảnh):\n{mem}"
        if mem else ""
    )
    user_context = profile_context + mem_block

    if intent == "update_progress":
        items = extract_work_items(text, kpis, source="chat", history=history, memories=mem)
        return schemas.ChatResponse(
            reply=_proposal_reply(items, lang=lang, history=history, user_text=text), intent=intent, proposed_items=items
        )

    if intent == "sync_request":
        sources, start, end = parse_sync_command(text, history)
        disconnected = _disconnected_sources(db, user_id, sources)
        if disconnected and len(disconnected) == len(sources):
            facts = (
                f"Requested sources: {', '.join(sources)}\n"
                f"Disconnected sources: {', '.join(disconnected)}\n"
                "No scan was performed because every requested source is currently in mock/not-connected mode. "
                "User can connect real sources in Data Sources or upload Excel/CSV work logs."
            )
            msg = _status_reply(text, facts, intent, lang, history)
            return schemas.ChatResponse(reply=msg, intent=intent)
        activities = fetch_activities(sources, start, end, db=db, user_id=user_id)
        if not activities:
            facts = (
                f"Scanned sources: {', '.join(sources)}\n"
                f"Date range: {start} -> {end}\n"
                "Activities found: 0"
            )
            no_act = _status_reply(text, facts, intent, lang, history)
            return schemas.ChatResponse(reply=no_act, intent=intent)
        items = extract_work_items("", kpis, activities=activities)
        reply = _proposal_reply(items, from_sync=True, lang=lang, history=history, user_text=(
            f"Scanned sources: {', '.join(sources)}; date range: {start} -> {end}; "
            f"raw activities found: {len(activities)}. User request: {text}"
        ))
        return schemas.ChatResponse(reply=reply, intent=intent, proposed_items=items)

    if intent == "create_kpi":
        new_objs, proposed, changes = extract_kpi_proposal(
            db, _history_block(history) + text, kpis, user_id
        )
        conflicts: list[schemas.KPIConflict] = []
        if proposed:
            try:
                conflicts = detect_conflicts(kpis, proposed)
            except Exception:
                pass  # canh bao xung dot la tinh nang phu — khong duoc chan luong tao KPI
        return schemas.ChatResponse(
            reply=_kpi_proposal_reply(
                proposed, changes, lang=lang, new_objectives=new_objs,
                conflicts=conflicts, history=history, user_text=text,
            ),
            intent=intent,
            proposed_objectives=new_objs,
            proposed_kpis=proposed,
            weight_changes=changes,
            conflicts=conflicts,
        )

    if intent == "delete_kpi":
        objectives = kpi_service.objectives_with_progress(db, user_id)
        delete_req = extract_delete_request(
            _history_block(history) + text, objectives, kpis
        )

        target_type = delete_req["target_type"]
        target_id = delete_req["target_id"]
        target_name = delete_req["target_name"]
        reason = delete_req["reason"]

        # khoi du lieu that ve muc bi xoa de LLM tu soan phan hoi (khong hardcode cau tra loi)
        if target_id is None:
            pool_text = (
                kpi_service.kpi_list_text(kpis)
                if target_type == "kpi"
                else "\n".join(f"- {o.name} (trọng số {o.weight:g}%)" for o in objectives)
                or "(Chưa có mục tiêu nào)"
            )
            target_block = (
                f"KHÔNG TÌM THẤY {'KPI' if target_type == 'kpi' else 'mục tiêu'} nào khớp với "
                f"yêu cầu của người dùng (tên người dùng nhắc tới: \"{target_name or 'không rõ'}\").\n"
                f"Danh sách hiện có để gợi ý tên gần giống:\n{pool_text}"
            )
        elif target_type == "kpi":
            k = next(k for k in kpis if k.id == target_id)
            target_name = k.name
            obj = next((o for o in objectives if o.id == k.objective_id), None)
            target_block = (
                f"ĐÃ TÌM THẤY KPI cần xóa:\n"
                f"- Tên: {k.name}\n"
                f"- Tiến độ hiện tại: {k.current_value:g}/{k.target_value:g} {k.unit}\n"
                f"- Trọng số trong nhóm: {k.weight:g}%\n"
                f"- Thuộc mục tiêu: {obj.name if obj else '(chưa gắn mục tiêu)'}"
                + (f"\n- Lý do người dùng đưa ra: {reason}" if reason else "")
            )
        else:
            o = next(o for o in objectives if o.id == target_id)
            target_name = o.name
            inner = [k for k in kpis if k.objective_id == o.id]
            inner_text = "\n".join(
                f"  - {k.name} ({k.current_value:g}/{k.target_value:g} {k.unit}, trọng số {k.weight:g}%)"
                for k in inner
            ) or "  (không có KPI nào bên trong)"
            target_block = (
                f"ĐÃ TÌM THẤY MỤC TIÊU (Objective) cần xóa:\n"
                f"- Tên: {o.name}\n"
                f"- Trọng số mục tiêu: {o.weight:g}%\n"
                f"- {len(inner)} KPI bên trong sẽ bị lưu trữ cùng:\n{inner_text}"
                + (f"\n- Lý do người dùng đưa ra: {reason}" if reason else "")
            )

        reply = call_text(
            prompts.DELETE_REPLY_SYSTEM.format(
                target_block=target_block, today=_today(), memories=mem_block
            ) + _lang_suffix(lang),
            text, history=history,
        )
        return schemas.ChatResponse(
            reply=reply,
            intent=intent,
            delete_proposal=schemas.DeleteProposal(
                target_type=target_type,
                target_id=target_id,
                target_name=target_name,
                reason=reason,
            ) if target_id else None,
        )

    if intent == "coaching":
        # tim KPI nguoi dung nhac toi; khong ro -> chon KPI tut ky vong nhat
        target = _match_kpi(text, kpis)
        if target is None and kpis:
            target = min(kpis, key=lambda k: kpi_service.health_of(k)[1])
        if target is None:
            facts = "The user has no active KPIs, so coaching/RCA cannot be performed yet."
            no_kpi = _status_reply(text, facts, intent, lang, history)
            return schemas.ChatResponse(reply=no_kpi, intent=intent)
        analysis, causes, proposed = coach_kpi(db, target, user_id, lang)
        return schemas.ChatResponse(
            reply=_coaching_reply(analysis, causes, proposed, text, lang, history),
            intent=intent,
            proposed_items=proposed,
        )

    if intent == "weekly_summary":
        # Sinh bao cao tuan va luu vao saved_reports
        content = weekly_report(db, user_id, lang)
        today_d = date.today()
        start = today_d - timedelta(days=today_d.weekday())
        end = start + timedelta(days=6)
        period_key = start.isoformat()
        period_label = f"Tuần {start.strftime('%d/%m')}–{end.strftime('%d/%m/%Y')}"
        existing = db.scalars(
            select(models.SavedReport).where(
                models.SavedReport.user_id == user_id,
                models.SavedReport.period_type == "week",
                models.SavedReport.period_key == period_key,
            )
        ).first()
        if existing:
            existing.content = content
            existing.created_at = models.utcnow()
        else:
            db.add(models.SavedReport(
                user_id=user_id, period_type="week",
                period_label=period_label, period_key=period_key, content=content,
            ))
        db.commit()
        facts = (
            f"Weekly report was generated by the LLM and saved to Reports.\n"
            f"Saved period label: {period_label}\n"
            "Return the report content, and include a brief natural note that it has been saved."
        )
        saved_note = _status_reply(text, facts, "weekly_summary_saved", lang, history)
        return schemas.ChatResponse(reply=content + "\n\n---\n" + saved_note, intent="weekly_summary")

    if intent == "question":
        context = kpi_service.full_context_text(db, user_id) + user_context

        # Neu user hoi ve Google data (lich/email/sheets) -> fetch va inject vao context
        google_sources = _google_sources_for_query(text)
        if google_sources:
            g_start, g_end = _date_range_for_query(text)
            try:
                activities = fetch_activities(
                    google_sources,
                    g_start,
                    g_end,
                    db=db,
                    user_id=user_id,
                )
                real = [a for a in activities if a.get("ref") != "error"]
                errors = [a for a in activities if a.get("ref") == "error"]
                if real:
                    lines = [
                        f"[{a['source'].upper()} | {a['date']}] {a['text']}"
                        for a in real[:40]
                    ]
                    context += (
                        f"\n\n--- DỮ LIỆU TỪ TÀI KHOẢN GOOGLE ({g_start} → {g_end}) ---\n"
                        + "\n".join(lines)
                    )
                elif errors:
                    context += (
                        f"\n\n(Lỗi khi tải dữ liệu Google: {errors[0]['text']})"
                    )
                else:
                    context += (
                        f"\n\n(Đã truy vấn {', '.join(google_sources)} từ {g_start} đến {g_end}"
                        " nhưng không có sự kiện nào trong khoảng thời gian này.)"
                    )
            except Exception as exc:
                context += (
                    f"\n\n(Không thể tải dữ liệu Google [{', '.join(google_sources)}]: {exc})"
                )

        # Đọc trực tiếp các Google Sheet URL người dùng đề cập trong tin nhắn
        gsheet_refs = _extract_gsheets_from_text(text)
        if gsheet_refs:
            if oauth_service.is_connected(db, user_id, "google"):
                for sid, gid in gsheet_refs[:2]:  # giới hạn 2 sheet
                    try:
                        rows = read_sheet_raw(sid, db, user_id, gid=gid)
                        if rows:
                            preview = "\n".join(
                                " | ".join(cell for cell in row[:12])
                                for row in rows[:60]
                            )
                            context += (
                                f"\n\n--- NỘI DUNG GOOGLE SHEET (ID: ...{sid[-6:]}) ---\n"
                                + preview
                            )
                        else:
                            context += f"\n\n(Sheet {sid[-6:]}... trống hoặc không có dữ liệu.)"
                    except Exception as exc:
                        context += f"\n\n(Không thể đọc sheet {sid[-6:]}...: {exc})"
            else:
                context += (
                    "\n\n(Bạn đề cập đến Google Sheet nhưng chưa kết nối Google. "
                    "Vào Nguồn dữ liệu → Kết nối Google để đọc sheet.)"
                )

        has_google_data = bool(google_sources or gsheet_refs)
        reply = call_text(
            prompts.ANSWER_SYSTEM.format(context=context, today=_today()) + _lang_suffix(lang),
            text, history=history, max_tokens=1500 if has_google_data else 900,
        )
        return schemas.ChatResponse(reply=reply, intent=intent)

    # other / chitchat
    if _is_account_help_question(text):
        context = kpi_service.full_context_text(db, user_id) + user_context
        reply = call_text(
            prompts.ANSWER_SYSTEM.format(context=context, today=_today()) + _lang_suffix(lang),
            text, history=history, max_tokens=700,
        )
        return schemas.ChatResponse(reply=reply, intent="question")
    brief = kpi_service.kpi_list_text(kpis) + user_context
    reply = call_text(
        prompts.CHITCHAT_SYSTEM.format(context_brief=brief) + _lang_suffix(lang),
        text, temperature=0.7, history=history, max_tokens=500,
    )
    return schemas.ChatResponse(reply=reply, intent="other")


def weekly_report(db: Session, user_id: int = 1, lang: str = "vi") -> str:
    context = kpi_service.full_context_text(db, user_id)
    prompt_text = "Write the weekly summary for me." if lang == "en" else "Viết bản tổng kết tuần này cho tôi."
    return call_text(
        prompts.WEEKLY_REPORT_SYSTEM.format(context=context, today=_today()) + _lang_suffix(lang),
        prompt_text,
    )


def self_review(db: Session, period_label: str, user_id: int = 1) -> str:
    """Sinh ban tu danh gia cuoi ky bang LLM tu du lieu KPI hien tai."""
    context = kpi_service.full_context_text(db, user_id)
    system = prompts.SELF_REVIEW_SYSTEM.format(
        context=context, today=_today(), period_label=period_label
    )
    return call_text(system, f"Viết bản tự đánh giá cho kỳ {period_label}.")


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
