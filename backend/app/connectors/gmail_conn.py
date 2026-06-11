import base64
import json
from datetime import date, datetime

from ..config import settings
from .google_base import get_service, google_available


def _load_mock(start: date, end: date) -> list[dict]:
    path = settings.mock_data_dir / "emails.json"
    if not path.exists():
        return []
    emails = json.loads(path.read_text(encoding="utf-8"))
    out = []
    for e in emails:
        d = date.fromisoformat(e["date"])
        if start <= d <= end:
            out.append(
                {
                    "source": "gmail",
                    "date": e["date"],
                    "text": f"Email: \"{e['subject']}\" — {e['snippet']}",
                    "ref": f"email từ {e['from']}, {e['date']}",
                }
            )
    return out


def fetch_gmail(start: date, end: date) -> list[dict]:
    if not google_available():
        return _load_mock(start, end)

    service = get_service("gmail", "v1")
    query = f"after:{start.strftime('%Y/%m/%d')} before:{end.strftime('%Y/%m/%d')} -category:promotions"
    resp = service.users().messages().list(userId="me", q=query, maxResults=30).execute()
    out = []
    for m in resp.get("messages", []):
        msg = (
            service.users()
            .messages()
            .get(userId="me", id=m["id"], format="metadata", metadataHeaders=["Subject", "From", "Date"])
            .execute()
        )
        headers = {h["name"]: h["value"] for h in msg.get("payload", {}).get("headers", [])}
        ts = datetime.fromtimestamp(int(msg.get("internalDate", 0)) / 1000)
        out.append(
            {
                "source": "gmail",
                "date": ts.date().isoformat(),
                "text": f"Email: \"{headers.get('Subject', '(không tiêu đề)')}\" — {msg.get('snippet', '')}",
                "ref": f"email từ {headers.get('From', '?')}, {ts.date().isoformat()}",
            }
        )
    return out
