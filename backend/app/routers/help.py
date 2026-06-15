import json
import re

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..auth import CurrentUser
from ..config import settings

router = APIRouter(prefix="/api/help", tags=["help"])


class VisionHelpRequest(BaseModel):
    image: str
    screen_hint: str = ""
    lang: str = "vi"


SYSTEM_PROMPT = """Bạn là trợ lý hướng dẫn sử dụng KPI Companion - ứng dụng quản lý mục tiêu cá nhân.

Khi nhận được ảnh chụp màn hình UI, hãy:
1. Nhận diện người dùng đang ở màn hình nào (Dashboard / KPI của tôi / Trợ lý AI / Báo cáo / Nhật ký / Cài đặt / Nguồn dữ liệu).
2. Phát hiện vấn đề nổi bật nếu có: tổng trọng số KPI vượt 100%, KPI 0% gần deadline, hoặc chưa có KPI.
3. Đưa ra hướng dẫn cụ thể, ngắn gọn, tối đa 4 bước, phù hợp với màn hình đó.
4. Dùng tiếng Việt thân thiện, không dài dòng.

Bắt buộc trả về JSON hợp lệ, không kèm markdown:
{
  "screen": "tên màn hình ngắn gọn",
  "summary": "mô tả 1 câu về tình trạng hiện tại",
  "issue": "vấn đề phát hiện, để chuỗi rỗng nếu không có",
  "steps": ["bước 1", "bước 2", "bước 3"],
  "tip": "mẹo nhanh hữu ích, để chuỗi rỗng nếu không có"
}
"""


def _configured() -> bool:
    return bool(settings.vision_base_url and settings.vision_api_key and settings.vision_model)


def _parse_json(content: str) -> dict:
    cleaned = re.sub(r"```(?:json)?\s*|\s*```", "", content or "").strip()
    try:
        data = json.loads(cleaned)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=502, detail="Vision AI trả về JSON không hợp lệ.") from exc
    steps = data.get("steps")
    if not isinstance(steps, list):
        data["steps"] = []
    return {
        "screen": str(data.get("screen") or ""),
        "summary": str(data.get("summary") or ""),
        "issue": str(data.get("issue") or ""),
        "steps": [str(s) for s in data.get("steps", [])][:4],
        "tip": str(data.get("tip") or ""),
        "source": "vision",
    }


@router.get("/vision-config")
def vision_config(current_user: CurrentUser):
    return {
        "configured": _configured(),
        "model": settings.vision_model,
    }


@router.post("/vision")
async def analyze_screen(payload: VisionHelpRequest, current_user: CurrentUser):
    if not _configured():
        raise HTTPException(
            status_code=503,
            detail="Chưa cấu hình Vision AI. Thêm VISION_BASE_URL, VISION_API_KEY và VISION_MODEL trong backend/.env.",
        )

    base = settings.vision_base_url.rstrip("/")
    body = {
        "model": settings.vision_model,
        "max_tokens": 800,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {
                "role": "user",
                "content": [
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:image/png;base64,{payload.image}",
                            "detail": "high",
                        },
                    },
                    {
                        "type": "text",
                        "text": (
                            f"Màn hình gợi ý từ router: {payload.screen_hint or 'không rõ'}. "
                            "Hãy phân tích màn hình này và hướng dẫn tôi. "
                            "Trả về JSON theo đúng định dạng đã yêu cầu."
                        ),
                    },
                ],
            },
        ],
    }

    try:
        async with httpx.AsyncClient(timeout=45) as client:
            response = await client.post(
                f"{base}/chat/completions",
                headers={
                    "Authorization": f"Bearer {settings.vision_api_key}",
                    "Content-Type": "application/json",
                },
                json=body,
            )
    except httpx.TimeoutException as exc:
        raise HTTPException(status_code=504, detail="Vision AI phản hồi quá lâu, vui lòng thử lại.") from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail="Không kết nối được Vision AI.") from exc

    if response.status_code >= 400:
        raise HTTPException(status_code=response.status_code, detail=response.text[:1000])

    data = response.json()
    content = data.get("choices", [{}])[0].get("message", {}).get("content", "")
    return _parse_json(content)
