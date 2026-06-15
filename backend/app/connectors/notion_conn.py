"""Notion connector — cac trang/ghi chu nguoi dung sua gan day.

Mock-first: chua ket noi Notion -> doc mock_data/notion.json. Da ket noi -> goi Notion API that.
"""
import json
from datetime import date

from ..config import settings


def _load_mock(start: date, end: date) -> list[dict]:
    path = settings.mock_data_dir / "notion.json"
    if not path.exists():
        return []
    rows = json.loads(path.read_text(encoding="utf-8"))
    out = []
    for r in rows:
        d = date.fromisoformat(r["date"])
        if start <= d <= end:
            out.append({
                "source": "notion",
                "date": r["date"],
                "text": f"Notion: \"{r['title']}\" ({r.get('type', 'page')})",
                "ref": f"trang Notion sửa {r['date']}",
            })
    return out


def _connected(db, user_id) -> bool:
    if db is None or user_id is None:
        return False
    from ..services import oauth_service

    return oauth_service.is_connected(db, user_id, "notion")


def fetch_notion(start: date, end: date, db=None, user_id=None) -> list[dict]:
    if not _connected(db, user_id):
        return _load_mock(start, end)

    import requests

    from ..services import oauth_service

    token = oauth_service.get_access_token(db, user_id, "notion")
    resp = requests.post(
        "https://api.notion.com/v1/search",
        headers={
            "Authorization": f"Bearer {token}",
            "Notion-Version": "2022-06-28",
            "Content-Type": "application/json",
        },
        json={"sort": {"direction": "descending", "timestamp": "last_edited_time"}, "page_size": 30},
        timeout=20,
    )
    out = []
    for item in resp.json().get("results", []):
        edited = (item.get("last_edited_time") or "")[:10]
        if not edited:
            continue
        d = date.fromisoformat(edited)
        if not (start <= d <= end):
            continue
        title = _notion_title(item)
        out.append({
            "source": "notion",
            "date": edited,
            "text": f"Notion: \"{title}\" ({item.get('object', 'page')})",
            "ref": f"trang Notion sửa {edited}",
        })
    return out


def _notion_title(item: dict) -> str:
    """Rut tieu de tu cau truc properties cua Notion (kha long nhong)."""
    props = item.get("properties", {})
    for prop in props.values():
        if prop.get("type") == "title":
            parts = prop.get("title", [])
            if parts:
                return "".join(p.get("plain_text", "") for p in parts) or "(không tiêu đề)"
    return "(không tiêu đề)"
