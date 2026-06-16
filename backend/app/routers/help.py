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


HELP_MANUAL = """
Sổ tay thao tác KPI Companion:

Dashboard:
- Dùng để xem sức khỏe KPI tổng thể, cảnh báo chậm tiến độ, việc cần làm và dự báo hoàn thành.
- Người dùng có thể chọn chu kỳ ở combobox trên header.
- Người dùng có thể bấm KPI/cảnh báo/việc cần làm để đi vào chi tiết hoặc cập nhật tiến độ.

KPI của tôi:
- Dùng để tạo, xem, chỉnh sửa, archive và kiểm tra cấu trúc Objective/KPI.
- Objective có trọng số tầng 1; KPI có trọng số trong từng Objective. Tổng nên đạt 100%.
- Nút thêm KPI thường nằm trong từng nhóm Objective; nút sửa/archive nằm trên từng thẻ KPI.
- Nút cân bằng trọng số giúp phân bổ lại KPI trong một Objective.
- Nút SMART/AI Coach giúp kiểm tra chất lượng KPI hoặc gợi ý cách xử lý KPI rủi ro.

Trợ lý AI:
- Dùng để nhập cập nhật công việc bằng ngôn ngữ tự nhiên.
- Agent chỉ tạo thẻ đề xuất, người dùng phải rà soát và bấm xác nhận thì dữ liệu mới được lưu.
- Có thể hỏi KPI nào đang chậm, yêu cầu tổng kết tuần, tạo KPI mới, hoặc đồng bộ dữ liệu nguồn.

Báo cáo:
- Dùng để tạo báo cáo tuần/tháng/quý/năm, tự đánh giá và xuất PDF/Excel.
- Người dùng chọn kỳ báo cáo, bấm tạo báo cáo, xem trước/chỉnh sửa rồi mới gửi hoặc tải xuống.

Nhật ký:
- Dùng để tra cứu bằng chứng công việc, lịch sử thay đổi KPI và KPI đã archive.
- Người dùng dùng bộ lọc ngày, trạng thái, nguồn, KPI hoặc ô tìm kiếm để tìm bản ghi.
- Có thể khôi phục KPI đã archive từ khu vực KPI đã gỡ.

Nguồn dữ liệu:
- Dùng để kết nối hoặc quét Gmail/Calendar/Sheets/Notion/Slack/Outlook và upload file.
- Sau khi quét, người dùng vẫn phải xác nhận thẻ đề xuất trước khi ghi tiến độ.
- Mock mode dùng cho demo; real mode cần credentials/OAuth.

Cài đặt:
- Dùng để đổi giao diện/ngôn ngữ, hồ sơ, mật khẩu, cấu hình AI Coach, export và kết nối.
- Không lưu secret API trên UI.
"""


SYSTEM_PROMPT = """Bạn là trợ lý HƯỚNG DẪN SỬ DỤNG KPI Companion, không phải trợ lý đánh giá dữ liệu.

Khi nhận được ảnh chụp màn hình UI, hãy:
1. Nhận diện màn hình hiện tại.
2. Giải thích màn hình này dùng để làm gì bằng 1 câu ngắn.
3. Hướng dẫn người dùng thao tác cụ thể trên UI, tối đa 4 bước. Mỗi bước phải bắt đầu bằng động từ thao tác như "Bấm", "Chọn", "Nhập", "Mở", "Kiểm tra", "Dùng".
4. Nếu thấy một vấn đề cản trở thao tác (ví dụ tổng trọng số vượt 100%, chưa có KPI, lỗi cấu hình), ghi vào issue. Nếu chỉ là nhận xét dữ liệu bình thường thì để issue rỗng.
5. Không chỉ nói chung chung kiểu "kiểm tra mục tiêu"; hãy nêu người dùng cần bấm/chọn vùng nào và kết quả mong đợi.
6. Không khẳng định đã sửa/lưu/thay đổi dữ liệu. Ứng dụng này luôn cần người dùng bấm xác nhận.
7. Dùng tiếng Việt thân thiện, ngắn gọn.

Ưu tiên hướng dẫn sử dụng sản phẩm hơn phân tích KPI. Chỉ nhắc vấn đề KPI như thông tin phụ.

__HELP_MANUAL__

Bắt buộc trả về JSON hợp lệ, không kèm markdown:
{
  "screen": "tên màn hình ngắn gọn",
  "summary": "màn hình này dùng để làm gì và người dùng nên làm gì tiếp theo",
  "issue": "vấn đề cản trở thao tác, để chuỗi rỗng nếu không có",
  "steps": ["Bấm ...", "Chọn ...", "Nhập ..."],
  "tip": "mẹo sử dụng nhanh, để chuỗi rỗng nếu không có"
}
""".replace("__HELP_MANUAL__", HELP_MANUAL)


def _configured() -> bool:
    return bool(settings.vision_base_url and settings.vision_api_key and settings.vision_model)


def _parse_json(content: str) -> dict:
    cleaned = re.sub(r"<think>.*?</think>", "", content or "", flags=re.DOTALL | re.IGNORECASE)
    cleaned = re.sub(r"```(?:json)?\s*|\s*```", "", cleaned).strip()
    if "{" in cleaned and "}" in cleaned:
        cleaned = cleaned[cleaned.find("{"): cleaned.rfind("}") + 1]
    try:
        data = json.loads(cleaned)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=502, detail="Vision AI trả về JSON không hợp lệ. Hãy kiểm tra model có hỗ trợ instruction JSON không.") from exc
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
        "chat_template_kwargs": {"enable_thinking": False},
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
                            "Hãy hướng dẫn người dùng CÁCH SỬ DỤNG màn hình này, không chỉ nhận xét dữ liệu. "
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
    if isinstance(content, list):
        content = "\n".join(
            part.get("text", "") if isinstance(part, dict) else str(part)
            for part in content
        )
    return _parse_json(content)
