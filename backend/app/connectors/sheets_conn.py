import json
from datetime import date

from ..config import settings
from .google_base import get_service, google_available

# Doc tu settings / .env (GOOGLE_SHEET_ID, GOOGLE_SHEET_RANGE)
SHEET_ID = settings.google_sheet_id
SHEET_RANGE = settings.google_sheet_range


def _load_mock(start: date, end: date) -> list[dict]:
    path = settings.mock_data_dir / "timesheet.json"
    if not path.exists():
        return []
    rows = json.loads(path.read_text(encoding="utf-8"))
    out = []
    for r in rows:
        d = date.fromisoformat(r["date"])
        if start <= d <= end:
            out.append(
                {
                    "source": "sheets",
                    "date": r["date"],
                    "text": f"Timesheet: {r['task']} — trạng thái: {r.get('status', '')} — {r.get('note', '')}",
                    "ref": f"Google Sheet timesheet, dòng ngày {r['date']}",
                }
            )
    return out


def fetch_sheets(start: date, end: date, db=None, user_id=None) -> list[dict]:
    if not google_available(db, user_id) or not SHEET_ID:
        if db is not None and user_id is not None:
            return []
        return _load_mock(start, end)

    service = get_service("sheets", "v4", db, user_id)
    resp = (
        service.spreadsheets()
        .values()
        .get(spreadsheetId=SHEET_ID, range=SHEET_RANGE)
        .execute()
    )
    all_rows = resp.get("values", [])
    out = []
    for i, row in enumerate(all_rows, start=2):
        if not row:
            continue
        try:
            d = date.fromisoformat(str(row[0])[:10])
        except ValueError:
            continue
        if not (start <= d <= end):
            continue
        task = row[1] if len(row) > 1 else ""
        status = row[2] if len(row) > 2 else ""
        note = row[3] if len(row) > 3 else ""
        out.append(
            {
                "source": "sheets",
                "date": d.isoformat(),
                "text": f"Timesheet: {task} — trạng thái: {status} — {note}",
                "ref": f"Google Sheet dòng {i}",
            }
        )

    # Fallback: nếu không có dòng nào khớp date format, trả về raw data để LLM phân tích
    if not out and all_rows:
        preview_rows = all_rows[:40]
        raw_text = "\n".join(" | ".join(str(c) for c in row[:10]) for row in preview_rows)
        out.append(
            {
                "source": "sheets",
                "date": end.isoformat(),
                "text": f"Nội dung Google Sheet (raw):\n{raw_text}",
                "ref": "Google Sheet raw preview",
            }
        )
    return out


def read_sheet_raw(
    sheet_id: str,
    db,
    user_id: int,
    gid: str | None = None,
    sheet_range: str = "A1:Z100",
) -> list[list[str]]:
    """Đọc dữ liệu thô từ Google Sheet bất kỳ theo ID (không giả định cấu trúc cột).

    Nếu gid được cung cấp (và != 0), lấy tên tab từ metadata rồi dùng làm prefix range.
    """
    service = get_service("sheets", "v4", db, user_id)

    range_prefix = ""
    if gid and gid != "0":
        try:
            meta = service.spreadsheets().get(spreadsheetId=sheet_id).execute()
            for sheet in meta.get("sheets", []):
                props = sheet.get("properties", {})
                if str(props.get("sheetId")) == str(gid):
                    tab_name = props["title"]
                    range_prefix = f"'{tab_name}'!"
                    break
        except Exception:
            pass

    full_range = range_prefix + sheet_range
    resp = (
        service.spreadsheets()
        .values()
        .get(spreadsheetId=sheet_id, range=full_range)
        .execute()
    )
    return [[str(cell) for cell in row] for row in resp.get("values", [])]
