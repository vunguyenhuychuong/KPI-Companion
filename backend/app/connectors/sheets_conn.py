import json
from datetime import date

from ..config import settings
from .google_base import get_service, google_available

# Cau hinh sheet timesheet khi dung API that (co the dua vao settings sau)
SHEET_ID = ""  # dien spreadsheet ID khi dung that
SHEET_RANGE = "A2:D200"  # cot: ngay | cong viec | trang thai | ghi chu


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


def fetch_sheets(start: date, end: date) -> list[dict]:
    if not google_available() or not SHEET_ID:
        return _load_mock(start, end)

    service = get_service("sheets", "v4")
    resp = (
        service.spreadsheets()
        .values()
        .get(spreadsheetId=SHEET_ID, range=SHEET_RANGE)
        .execute()
    )
    out = []
    for i, row in enumerate(resp.get("values", []), start=2):
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
    return out
