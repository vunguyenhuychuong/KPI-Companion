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
        if db is not None and user_id is not None:
            return []
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


def create_calendar_event(proposal, db, user_id: int) -> dict:
    """Tao su kien moi trong Google Calendar tu MeetingProposal.

    Tra ve {"event_id": ..., "html_link": ...} khi thanh cong.
    attendees da duoc resolve thanh email boi _resolve_attendees() truoc khi den day;
    filter "@" giu lai de bao ve khi goi truc tiep (vd: test / curl).
    """
    service = get_service("calendar", "v3", db, user_id)

    event_body: dict = {
        "summary": proposal.title,
        "start": {"dateTime": proposal.start_datetime, "timeZone": proposal.timezone},
        "end": {"dateTime": proposal.end_datetime, "timeZone": proposal.timezone},
    }
    if proposal.description:
        event_body["description"] = proposal.description
    if proposal.location:
        event_body["location"] = proposal.location

    # Bao ve cuoi: chi truyen attendee hop le (co @)
    email_attendees = [{"email": a} for a in proposal.attendees if "@" in a]
    if email_attendees:
        event_body["attendees"] = email_attendees

    # Ghi chu ten khong tim duoc email vao description de chu hop biet
    if getattr(proposal, "unresolved_names", None):
        note = f"\n\n⚠️ Chưa tìm được email: {', '.join(proposal.unresolved_names)} — hãy chuyển tiếp lời mời thủ công."
        event_body["description"] = (event_body.get("description") or "") + note

    result = service.events().insert(
        calendarId="primary",
        body=event_body,
        sendUpdates="all" if email_attendees else "none",
    ).execute()

    return {
        "event_id": result.get("id", ""),
        "html_link": result.get("htmlLink", ""),
        "status": result.get("status", "confirmed"),
    }
