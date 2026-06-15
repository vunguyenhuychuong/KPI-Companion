"""Outlook connector (Microsoft Graph) — email gan day cua nguoi dung.

Mock-first: chua ket noi -> doc mock_data/outlook.json. Da ket noi -> goi Graph /me/messages.
"""
import json
from datetime import date

from ..config import settings


def _load_mock(start: date, end: date) -> list[dict]:
    path = settings.mock_data_dir / "outlook.json"
    if not path.exists():
        return []
    rows = json.loads(path.read_text(encoding="utf-8"))
    out = []
    for r in rows:
        d = date.fromisoformat(r["date"])
        if start <= d <= end:
            out.append({
                "source": "outlook",
                "date": r["date"],
                "text": f"Outlook: \"{r['subject']}\" — {r.get('snippet', '')}",
                "ref": f"email Outlook từ {r.get('from', '?')}, {r['date']}",
            })
    return out


def _connected(db, user_id) -> bool:
    if db is None or user_id is None:
        return False
    from ..services import oauth_service

    return oauth_service.is_connected(db, user_id, "outlook")


def fetch_outlook(start: date, end: date, db=None, user_id=None) -> list[dict]:
    if not _connected(db, user_id):
        return _load_mock(start, end)

    import requests

    from ..services import oauth_service

    token = oauth_service.get_access_token(db, user_id, "outlook")
    flt = (
        f"receivedDateTime ge {start.isoformat()}T00:00:00Z and "
        f"receivedDateTime le {end.isoformat()}T23:59:59Z"
    )
    resp = requests.get(
        "https://graph.microsoft.com/v1.0/me/messages",
        headers={"Authorization": f"Bearer {token}"},
        params={
            "$select": "subject,from,bodyPreview,receivedDateTime",
            "$top": 30,
            "$filter": flt,
            "$orderby": "receivedDateTime desc",
        },
        timeout=20,
    )
    out = []
    for m in resp.json().get("value", []):
        d_str = (m.get("receivedDateTime") or "")[:10]
        if not d_str:
            continue
        sender = ((m.get("from") or {}).get("emailAddress") or {}).get("address", "?")
        out.append({
            "source": "outlook",
            "date": d_str,
            "text": f"Outlook: \"{m.get('subject', '(không tiêu đề)')}\" — {m.get('bodyPreview', '')[:160]}",
            "ref": f"email Outlook từ {sender}, {d_str}",
        })
    return out
