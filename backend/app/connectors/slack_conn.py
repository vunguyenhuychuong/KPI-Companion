"""Slack connector — tin nhan do chinh nguoi dung gui gan day.

Mock-first: chua ket noi -> doc mock_data/slack.json. Da ket noi -> goi search.messages.
Can user token co scope search:read.
"""
import json
from datetime import date

from ..config import settings


def _load_mock(start: date, end: date) -> list[dict]:
    path = settings.mock_data_dir / "slack.json"
    if not path.exists():
        return []
    rows = json.loads(path.read_text(encoding="utf-8"))
    out = []
    for r in rows:
        d = date.fromisoformat(r["date"])
        if start <= d <= end:
            out.append({
                "source": "slack",
                "date": r["date"],
                "text": f"Slack #{r.get('channel', '?')}: {r['text']}",
                "ref": f"tin nhắn Slack {r['date']}",
            })
    return out


def _connected(db, user_id) -> bool:
    if db is None or user_id is None:
        return False
    from ..services import oauth_service

    return oauth_service.is_connected(db, user_id, "slack")


def fetch_slack(start: date, end: date, db=None, user_id=None) -> list[dict]:
    if not _connected(db, user_id):
        return _load_mock(start, end)

    import requests

    from ..services import oauth_service

    token = oauth_service.get_access_token(db, user_id, "slack")
    query = f"from:me after:{start.isoformat()} before:{end.isoformat()}"
    resp = requests.get(
        "https://slack.com/api/search.messages",
        headers={"Authorization": f"Bearer {token}"},
        params={"query": query, "count": 30},
        timeout=20,
    )
    data = resp.json()
    out = []
    for m in (data.get("messages") or {}).get("matches", []):
        ts = m.get("ts", "0")
        try:
            from datetime import datetime, timezone

            d = datetime.fromtimestamp(float(ts), tz=timezone.utc).date()
        except (ValueError, OSError):
            continue
        if not (start <= d <= end):
            continue
        channel = (m.get("channel") or {}).get("name", "?")
        out.append({
            "source": "slack",
            "date": d.isoformat(),
            "text": f"Slack #{channel}: {m.get('text', '')[:200]}",
            "ref": f"tin nhắn Slack {d.isoformat()}",
        })
    return out
