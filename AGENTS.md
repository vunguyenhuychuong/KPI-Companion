# KPI Companion — Hướng dẫn cho AI agent phát triển tiếp

Dự án hackathon 7 ngày (10–17/06/2026): AI Agent quản lý KPI cá nhân. Đọc `README.md` trước (kiến trúc, cách chạy, demo script).

## Chạy & kiểm thử
- Chạy app: `start.bat` (backend FastAPI :8000 có --reload, frontend Vite :5173). API docs: http://127.0.0.1:8000/docs
- Python qua `py` (3.14), venv tại `backend/.venv`. Node tại `C:\Program Files\nodejs` (KHÔNG có trong PATH mặc định của shell).
- Không có test tự động — kiểm chứng bằng cách gọi API thật (uvicorn tự reload khi sửa code).
- ⚠️ KHÔNG dùng PowerShell `Get-Content`/`Set-Content` để sửa hàng loạt file Python — đã từng làm hỏng encoding UTF-8 tiếng Việt. Dùng tool edit chuẩn.

## Quyết định kiến trúc ĐÃ CHỐT với chủ dự án (đừng đảo ngược)
1. **LLM**: Qwen qua endpoint OpenAI-compatible (config `backend/.env`). Endpoint thật là VNGCloud vLLM `qwen/qwen3-5-27b` — **bắt buộc** gửi `chat_template_kwargs: {enable_thinking: false}` (đã làm trong `agent/llm.py`), thiếu nó mỗi call chậm ~24 lần.
2. **Agent KHÔNG dùng native function-calling** (để tương thích mọi endpoint Qwen) — dùng intent router + structured JSON: 5 intent trong `agent/agent.py`: update_progress / sync_request / create_kpi / question / other. Prompt tiếng Việt tập trung ở `agent/prompts.py`.
3. **Human-in-the-loop tuyệt đối**: Agent KHÔNG bao giờ tự ghi dữ liệu. Mọi thay đổi đi qua thẻ đề xuất (proposed_items / proposed_kpis) → người dùng bấm Xác nhận → endpoint confirm mới ghi DB. Prompt đã có guard chống "ảo tưởng hành động" (từng bị bug Agent tuyên bố "đã lưu thành công" khi chưa lưu) — giữ nguyên các guard này.
4. **Mô hình OKR 2 tầng trọng số**: Objective có weight (tổng ≤100%), KPI weight tính TRONG objective (tổng ≤100%/nhóm). Validate ở cả frontend lẫn backend.
5. **Hệ đơn vị đo**: KPI = unit + target_value + current_value; `progress` là property = current/target (CHO PHÉP vượt 100%, badge 🌟), nhưng `progress_capped` (max 100, chuẩn OKR) dùng khi tổng hợp điểm. Work item lưu delta theo ĐƠN VỊ KPI, không phải %.
6. **Kỳ vọng (expected)**: ưu tiên kế hoạch SMART theo tháng (nội suy theo ngày), fallback tuyến tính theo thời gian — `kpi_service.expected_progress()`.
7. **Giờ ĐỊA PHƯƠNG**: hàm `utcnow()` trong `models.py` cố ý trả `datetime.now()` (giờ VN) — đừng "sửa" về UTC, dữ liệu cũ đã được shift.
8. **Google connectors**: mock mode mặc định (`GOOGLE_MOCK_MODE=true`, mock data trong `backend/mock_data/`); code API thật có sẵn, bật bằng credentials.json + đổi env.
9. **SQLite migration thủ công**: hàm `migrate()` trong `main.py` ALTER TABLE idempotent — thêm cột mới phải thêm vào đây, KHÔNG được làm mất dữ liệu. Cột `kpis.progress` cũ là legacy NOT NULL, model giữ `progress_legacy` map vào để INSERT không lỗi.
10. **Mọi thay đổi KPI ghi `KPIChangeLog`** kèm lý do (bắt buộc nhập trên UI); xóa = archive (khôi phục được), không hard-delete.

## Tính năng bổ sung sau bản gốc (repo này)
- **Auth multi-user**: `backend/app/auth.py` + `routers/auth.py` (đăng ký/đăng nhập email + Google), frontend `Login.jsx`, token Bearer trong `api.js` (localStorage `kpi_token`, 401 → tự logout).
- **Đa ngôn ngữ vi/en**: `frontend/src/i18n.js` (dict phẳng key → chuỗi, 2 block vi/en) + `LangContext.jsx` (`tr(key, vars)`, fallback vi → key). Thêm chuỗi UI mới = thêm key vào CẢ 2 block.
- **Phát hiện xung đột KPI**: nút ⚔️ trên trang KPI → POST /api/kpis/conflicts/analyze (LLM phân tích cặp KPI mâu thuẫn, trả severity + giải thích + gợi ý).

## Bản đồ code- `backend/app/agent/` — llm.py (client + JSON parse), prompts.py (toàn bộ prompt VN), agent.py (intent router + extractors)
- `backend/app/services/` — kpi_service.py (tiến độ/kỳ vọng/dashboard/xác nhận), report_service.py (Excel 4 sheet)
- `backend/app/routers/` — kpis, objectives, chat (theo phiên), work_items, sources, reports (báo cáo kỳ có so sánh SMART, upsert theo period_key)
- `frontend/src/pages/` — Dashboard (drill-down, todo, 2 chart SVG), Chat (phiên + sửa/hỏi lại), Kpis (nhóm theo Objective, modal sửa đầy đủ), Reports, Journal (bằng chứng + lịch sử toàn cục), Sources
- UI toàn tiếng Việt, design system tech-gradient trong `styles.css` (3 biến màu đầu file)

## Nguyên tắc khi thêm tính năng
- Tính năng AI mới = thêm intent vào INTENT_SYSTEM + extractor + thẻ đề xuất + endpoint confirm (theo mẫu create_kpi).
- Mọi chỗ chờ LLM trên UI phải có đếm giây + timeout (mẫu: component Thinking trong Chat.jsx).
- Demo phải chạy được không cần credentials thật (mock fallback).
