import json
from datetime import date, datetime, time, timezone

from ..config import settings
from .google_base import get_service, google_available


def _load_mock(start: date, end: date) -> list[dict]:
    path = settings.mock_data_dir / "calendar.json"
    if not path.exists():
        return []
    events = json.loads(path.read_text(encoding="utf-8"))
    out = []
    for e in events:
        d = date.fromisoformat(e["date"])
        if start <= d <= end:
            out.append(
                {
                    "source": "calendar",
                    "date": e["date"],
                    "text": f"Cuộc họp: \"{e['title']}\" ({e.get('duration', '1h')}) — {e.get('description', '')}",
                    "ref": f"lịch họp {e['date']} {e.get('time', '')}".strip(),
                }
            )
    return out


def fetch_calendar(start: date, end: date, db=None, user_id=None) -> list[dict]:
    if not google_available(db, user_id):
        return _load_mock(start, end)

    service = get_service("calendar", "v3", db, user_id)
    time_min = datetime.combine(start, time.min, tzinfo=timezone.utc).isoformat()
    time_max = datetime.combine(end, time.max, tzinfo=timezone.utc).isoformat()
    resp = (
        service.events()
        .list(calendarId="primary", timeMin=time_min, timeMax=time_max,
              singleEvents=True, orderBy="startTime", maxResults=50)
        .execute()
    )
    out = []
    for e in resp.get("items", []):
        start_str = e.get("start", {}).get("dateTime") or e.get("start", {}).get("date", "")
        out.append(
            {
                "source": "calendar",
                "date": start_str[:10],
                "text": f"Cuộc họp: \"{e.get('summary', '(không tiêu đề)')}\" — {e.get('description', '')[:200]}",
                "ref": f"lịch họp {start_str[:16]}",
            }
        )
    return out
