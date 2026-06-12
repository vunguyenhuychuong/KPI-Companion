"""Bo connector thu thap du lieu cong viec tu nguon ngoai.

Moi connector tra ve list hoat dong chuan hoa:
    {"source": "gmail|calendar|sheets", "date": "YYYY-MM-DD", "text": "...", "ref": "nguon goc"}

Neu GOOGLE_MOCK_MODE=true hoac chua co credentials.json -> dung mock data trong backend/mock_data/
de demo duoc ngay; kien truc giu nguyen, chi can doi config la chay API that.
"""
from datetime import date, datetime, timezone, timedelta

from .calendar_conn import fetch_calendar
from .gmail_conn import fetch_gmail
from .sheets_conn import fetch_sheets

_FETCHERS = {
    "gmail": fetch_gmail,
    "calendar": fetch_calendar,
    "sheets": fetch_sheets,
}


def fetch_activities(
    sources: list[str], start: date | None = None, end: date | None = None
) -> list[dict]:
    end = end or date.today()
    start = start or (end - timedelta(days=7))
    activities: list[dict] = []
    for src in sources:
        fetcher = _FETCHERS.get(src)
        if not fetcher:
            continue
        try:
            activities.extend(fetcher(start, end))
        except Exception as e:  # mot nguon loi khong lam hong ca dot quet
            activities.append(
                {
                    "source": src,
                    "date": end.isoformat(),
                    "text": f"(Lỗi khi quét nguồn {src}: {e})",
                    "ref": "error",
                }
            )
    # loai trung lap don gian theo (source, text)
    seen: set[tuple] = set()
    unique = []
    for a in activities:
        key = (a["source"], a["text"])
        if key not in seen:
            seen.add(key)
            unique.append(a)
    return unique
