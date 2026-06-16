# KPI Companion — CLAUDE.md

## Stack & Cổng
- Backend: FastAPI :8000 | Frontend: Vite/React :5173
- LLM: Qwen qua OpenAI-compatible endpoint (VNGCloud vLLM `qwen/qwen3-5-27b`)
- DB: SQLite (`backend/kpi_companion.db`)
- Chạy: `start.ps1` hoặc `start.bat`
- Python: `py` (3.14), venv tại `backend/.venv`
- Node: `C:\Program Files\nodejs` (KHÔNG trong PATH mặc định)

## Cấu hình LLM — đọc từ env, KHÔNG hardcode
- Model hiện tại: xem `LLM_MODEL` trong `.env` (ví dụ: `qwen/qwen3-5-27b`)
- Endpoint: xem `LLM_BASE_URL` trong `.env`
- Model có thể thay đổi bất kỳ lúc nào → KHÔNG hardcode tên model trong code
- Pattern chuẩn: đọc từ `os.getenv("LLM_MODEL")` hoặc config object
- Khi thêm call LLM mới: truyền model qua config, không tự điền cứng

## Kiến trúc Agent — KHÔNG được đảo ngược
- KHÔNG dùng native function-calling → dùng intent router + structured JSON
- 8 intents: `update_progress` / `sync_request` / `create_kpi` / `question` / `other` / `delete_kpi` / `coaching` / `weekly_summary`
- Bắt buộc gửi `chat_template_kwargs: {enable_thinking: false}` (thiếu → chậm ~24x)
- Human-in-the-loop tuyệt đối: agent KHÔNG tự ghi DB. Mọi thay đổi → proposal card → user xác nhận → endpoint confirm → ghi DB

## Luồng chuẩn thêm tính năng AI
`INTENT_SYSTEM` → extractor → proposal card → `POST /api/.../confirm` → ghi DB + KPIChangeLog

## KPI Schema — chuẩn dùng xuyên suốt (export, agent, DB)
```json
{
  "objective": "string",
  "period": "weekly | monthly",
  "kpis": [
    {
      "name": "string",
      "target": "number",
      "unit": "string",
      "weight": "number (tổng các KPI = 100)",
      "current": "number",
      "status": "on-track | at-risk | off-track"
    }
  ]
}
```
> KHÔNG thay đổi schema này mà không cập nhật đồng thời: `models.py`, `export_service.py`, và section này.

## Guardrail quan trọng
- KHÔNG ghi đè cả file `agent/prompts.py` (đã mất 4 prompt, khôi phục từ commit 829bfe5)
- KHÔNG dùng PowerShell Get-Content/Set-Content sửa file Python (hỏng UTF-8 tiếng Việt)
- Xóa = archive, KHÔNG hard-delete
- `utcnow()` trong `models.py` cố ý trả `datetime.now()` (giờ VN) — KHÔNG sửa về UTC
- Sau khi sửa prompts.py: `grep -o "prompts\.[A-Z_]*" agent.py memory.py` để đối chiếu
- Khi thêm/xoá/sửa/... dùng tiếng việt trên UI phải có đầy đủ dấu

## Bản đồ file — đọc theo task
| Task | File cần đọc |
|---|---|
| Sửa AI/intent | `backend/app/agent/agent.py`, `prompts.py` |
| Sửa KPI logic | `backend/app/services/kpi_service.py`, `models.py` |
| Thêm router/API | `backend/app/routers/<tên>.py`, `main.py` (migrate) |
| Sửa UI | `frontend/src/pages/<tên>.jsx`, `i18n.js` |
| Export | `backend/app/services/export_service.py` |
| Thêm text UI | `frontend/src/i18n.js` (thêm vào CẢ 2 block vi + en) |
| DB schema | `backend/app/models.py` + `migrate()` trong `main.py` |
| Quản lý Cycles | `backend/app/routers/cycles.py`, `frontend/src/CycleContext.jsx` |

## Khi thêm tính năng — checklist tối thiểu
1. Thêm migration idempotent vào `migrate()` trong `main.py`
2. Thêm i18n key vào CẢ 2 block `vi` và `en` trong `i18n.js`
3. Thêm changelog field label `field.<tên>` nếu field mới vào KPIChangeLog
4. Giữ mock fallback cho mọi integration ngoài
5. KHÔNG cap `max_tokens` nhỏ với call sinh JSON dài (conflict/extract/kpi_create)

## Biến môi trường — cập nhật khi thêm biến mới
| Biến | Bắt buộc | Mô tả |
|------|----------|-------|
| `LLM_BASE_URL` | Có | Endpoint vLLM (VNGCloud hoặc thay thế) |
| `LLM_MODEL` | Có | Tên model, ví dụ `qwen/qwen3-5-27b` |
| `LLM_API_KEY` | Có | API key cho endpoint |
| `VISION_BASE_URL` | Không | Endpoint Vision OpenAI-compatible cho Help Panel |
| `VISION_MODEL` | Không | Tên model vision, ví dụ `qwen-vl-max` |
| `VISION_API_KEY` | Không | API key Vision; để trống thì dùng hướng dẫn fallback |
| `TESSERACT_CMD` | Không | Đường dẫn Tesseract binary cho OCR local khi đọc ảnh/PDF scan trong Chat attachments; để trống nếu `tesseract` đã có trong PATH |
| `DATABASE_URL` | Không | Mặc định `backend/kpi_companion.db` |
| `AGENT_AUTONOMOUS_ENABLED` | Không | Bật/tắt vòng lặp Agent tự chủ nền; mặc định `true`; chỉ tạo insight/proposal, không tự ghi KPI |
| `AGENT_AUTONOMOUS_INTERVAL_SECONDS` | Không | Chu kỳ chạy nền của Agent tự chủ; mặc định `900`, tối thiểu thực thi 60 giây |

> Khi thêm biến mới: cập nhật bảng này **và** `.env.example` cùng lúc.

## Tình trạng tính năng
- [x] Intent router (7 intents)
- [x] Tạo KPI qua chat (`create_kpi`)
- [x] Cập nhật tiến độ (`update_progress`)
- [x] Human-in-the-loop proposal card + confirm
- [x] KPIChangeLog
- [x] Export Excel
- [x] **KPI Cycles** — quản lý chu kỳ đánh giá (CRUD + lock + clone); cycle selector trong header; migration tự động tạo default cycles từ `year` cũ; `GET /api/objectives?cycle_id=` để lọc
- [x] **Weight Validation API** — `GET /api/kpis/validate-weights` + `POST /api/objectives/validate-weights`; `EditKpiModal` dùng debounced server validation (400ms) để hiển thị tổng trọng số cập nhật nhất từ DB
- [x] **Import flow 3 bước** — Preview → Gán trọng số → Xác nhận & Lưu; fix `cycle_id` cho objectives mới tạo qua import; `cycleId` truyền từ active cycle xuống `confirmKpiProposal`
- [x] **AI Weekly Summary** — intent `weekly_summary` (8th intent); sinh báo cáo tuần đầy đủ + tự động lưu vào `saved_reports`; từ khóa: "tổng kết tuần", "báo cáo tuần", "weekly summary"
- [x] **SMART Goal Validation** — `POST /api/kpis/{id}/validate-smart`; nút 🎯 trên KpiCard; panel hiển thị scores S/M/A/R/T + issues + suggestions; gọi LLM via `SMART_VALIDATE_SYSTEM`
- [x] **Self-review PDF + Excel** — `POST /api/reports/self-review` sinh bản tự đánh giá (upsert theo năm); `GET /api/reports/saved/{id}/export?format=xlsx|pdf` xuất file; tab "📝 Tự đánh giá" trong Reports với nút ⬇ Excel / ⬇ PDF khi đang xem; `SELF_REVIEW_SYSTEM` prompt; `export_self_review_excel()` + `export_report_pdf()` trong `report_service.py`
- [x] **AI Help Panel** — nút `?` nổi chụp vùng nội dung bằng `html2canvas`, gửi qua backend `/api/help/vision` tới Vision OpenAI-compatible nếu cấu hình `VISION_*`; chưa cấu hình thì hiển thị hướng dẫn fallback theo route; drawer desktop + bottom sheet mobile.
- [x] **Contact Support Panel** — floating button toàn app mở drawer hỗ trợ kỹ thuật; danh sách admin đọc từ `frontend/public/support-config.json` (fallback `supportConfig.js`); form không dùng `<form>`, tự lấy tên/email user và gửi bằng `mailto:` fallback.
- [x] **Chat attachments** — Trợ lý AI hỗ trợ đính kèm tối đa 5 file/tin nhắn, 10MB/file; lưu trong `uploads/chat`, preview ảnh/file trong lịch sử chat, trích nội dung TXT/MD/CSV/JSON/XLSX/XLSM/DOCX/PDF text; ảnh và PDF scan ưu tiên Vision (`VISION_*`), fallback OCR local qua `pytesseract` + Tesseract binary (`TESSERACT_CMD` hoặc PATH), đưa nội dung đọc được vào Agent như bằng chứng người dùng cung cấp.
- [x] **Autonomous Agent Loop** — service nền `services/autonomous_agent.py` chạy Perceive → Reason → Act → Remember theo chu kỳ; ghi `AgentCycleLog`, tạo chat session "Agent tự chủ" với insight/proposal cần xác nhận; không tự confirm hay ghi KPI/Objectives/Work items.
- [x] **Autonomous Agent Inbox** — nút Agent tự chủ trên header gọi `/api/agent/autonomous/refresh` khi mở app, hiển thị các proposal tạm đang pending ngoài Chat để user xác nhận/ẩn ngay.
- [x] **AI Category Guard** — Agent tự chủ gọi Qwen qua `call_json` để đọc ngữ cảnh Objective/KPI và phát hiện KPI có vẻ nằm sai nhóm Work/Personal; chạy khi mở app/quét nền và sau khi user tạo/sửa/xác nhận KPI; hiển thị thẻ gợi ý chuyển phân loại trong Autonomous Inbox, chỉ ghi `category` sau khi user xác nhận.

## Known Issues & TODO
<!-- Cập nhật liên tục — KHÔNG xóa mục đã fix, đổi sang [x] -->

| # | Ưu tiên | Loại | Mô tả | Trạng thái |
|---|---------|------|-------|------------|
| 1 | | | | |

> Khi Claude Code tìm thấy bug trong quá trình làm việc: thêm vào bảng này thay vì fix ngầm.

## Quy ước commit
```
feat: thêm tính năng X
fix: sửa lỗi Y tại file Z
refactor: tái cấu trúc module A
docs: cập nhật CLAUDE.md / README
chore: cập nhật dependency, env
test: thêm/sửa test cho B
```

## Quy tắc Claude Code sau mỗi thay đổi
1. Nếu thêm tính năng → tick vào "Tình trạng tính năng"
2. Nếu phát hiện bug mới → thêm vào "Known Issues & TODO"
3. Nếu thêm biến môi trường → cập nhật bảng "Biến môi trường" và `.env.example`
4. Nếu thay đổi KPI Schema → cập nhật section "KPI Schema" và các file liên quan
5. Nếu thêm file/thư mục lớn → cập nhật "Bản đồ file"
6. KHÔNG tự suy diễn tên model — luôn đọc từ env/config

## Không đọc (bỏ qua)
- `backend/.venv/` (toàn bộ)
- `backend/__pycache__/`, `frontend/node_modules/`, `frontend/dist/`
- `backend/kpi_companion.backup-*.db`
- `demo/*.csv` (chỉ đọc khi test demo)
- `frontend/src/pages/Dashboard_backup.jsx`
