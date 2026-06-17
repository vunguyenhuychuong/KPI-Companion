# KPI Companion — AI Agent quản lý KPI cá nhân

> Biến việc theo dõi, cập nhật và tổng hợp KPI từ thao tác thủ công thành một luồng trò chuyện có kiểm soát với AI Agent.

KPI Companion là ứng dụng quản lý KPI cá nhân/nhóm gồm dashboard, chat AI, import/export báo cáo, kết nối nguồn dữ liệu và cơ chế Agent đề xuất hành động. Người dùng có thể cập nhật tiến độ bằng tiếng Việt tự nhiên, nhập KPI, hỏi đáp tình hình, tạo báo cáo tuần, tự đánh giá, hoặc tạo lịch họp qua chat. Mọi thay đổi dữ liệu quan trọng đều đi qua bước xác nhận của người dùng trước khi ghi vào hệ thống.

---

## Mục lục

- [Tính năng chính](#tính-năng-chính)
- [Kiến trúc tổng quan](#kiến-trúc-tổng-quan)
- [Tech stack](#tech-stack)
- [Yêu cầu môi trường](#yêu-cầu-môi-trường)
- [Cài đặt và chạy local](#cài-đặt-và-chạy-local)
- [Cấu hình biến môi trường](#cấu-hình-biến-môi-trường)
- [Kết nối nguồn dữ liệu](#kết-nối-nguồn-dữ-liệu)
- [Cấu trúc thư mục](#cấu-trúc-thư-mục)
- [Luồng AI Agent](#luồng-ai-agent)
- [KPI schema chuẩn](#kpi-schema-chuẩn)
- [Quy tắc phát triển quan trọng](#quy-tắc-phát-triển-quan-trọng)
- [Kịch bản demo nhanh](#kịch-bản-demo-nhanh)
- [Troubleshooting](#troubleshooting)

---

## Tính năng chính

### Quản lý KPI/OKR

- Tạo, sửa, archive và khôi phục KPI/Objectives.
- Quản lý KPI theo chu kỳ đánh giá.
- Hỗ trợ Objective weight và KPI weight trong từng Objective.
- Validate tổng trọng số ở frontend và backend.
- Ghi lịch sử thay đổi KPI bằng `KPIChangeLog`.
- Xóa là archive, không hard-delete.

### Trợ lý AI bằng tiếng Việt

- Cập nhật tiến độ KPI bằng ngôn ngữ tự nhiên.
- Tạo KPI qua chat.
- Xóa KPI/Objective qua chat bằng thẻ đề xuất.
- Hỏi đáp tình trạng KPI từ dữ liệu thật trong hệ thống.
- Coaching/RCA cho KPI rủi ro.
- Tạo báo cáo tuần bằng AI.
- Tạo cuộc họp Google Calendar qua chat.
- Hỗ trợ file đính kèm trong chat: TXT, MD, CSV, JSON, XLSX/XLSM, DOCX, PDF text; ảnh/PDF scan ưu tiên Vision, fallback OCR nếu có cấu hình.

### Human-in-the-loop

Agent không tự ghi dữ liệu KPI trực tiếp. Các thay đổi đi theo luồng:

```text
Người dùng nhập yêu cầu
        ↓
Intent router
        ↓
Extractor / AI parser
        ↓
Proposal card
        ↓
Người dùng xác nhận
        ↓
Confirm endpoint
        ↓
Ghi DB + KPIChangeLog
```

Cơ chế này áp dụng cho cập nhật tiến độ, tạo KPI, xóa KPI, chuyển category, đề xuất work item và tạo cuộc họp.

### Dashboard và cảnh báo

- Dashboard tổng quan KPI theo tiến độ thực tế so với kỳ vọng.
- Trạng thái KPI: `on-track`, `at-risk`, `off-track`.
- Cảnh báo chủ động: behind, deadline, runrate, overdue.
- Biểu đồ Objective/KPI và radar cấu trúc.
- Dự báo runrate theo lịch sử hiện có.
- Burnout guardrail dựa trên workload và calendar.
- Conflict detection giữa các KPI bằng LLM semantic analysis.

### Báo cáo và export

- Export Excel đánh giá KPI.
- Export nhiều định dạng: CSV, Markdown, JSON, XLSX, PDF, DOCX.
- Self-review PDF/Excel.
- Weekly summary được lưu vào saved reports.
- Accountability proxy gửi báo cáo cho quản lý theo hướng mock-first.

### Nguồn dữ liệu và import

- Import KPI/worklog từ Excel/CSV.
- Import flow 3 bước: Preview → Gán trọng số → Xác nhận & Lưu.
- Mock data mặc định để demo nhanh.
- Hỗ trợ kiến trúc OAuth cho Google, Notion, Slack, Outlook.
- Daily connected source scan: Agent tự quét nguồn đã kết nối, tạo nháp evidence/work journal, chỉ cộng tiến độ sau khi người dùng xác nhận.

### Autonomous Agent

- Service nền chạy theo vòng `Perceive → Reason → Act → Remember`.
- Ghi log chu kỳ vào `AgentCycleLog`.
- Autonomous Inbox hiển thị proposal pending ngoài Chat.
- AI Category Guard phát hiện KPI có vẻ sai nhóm Work/Personal và tạo thẻ gợi ý chuyển nhóm.
- Agent tự chủ không tự confirm, không tự ghi KPI/Objectives/Work items.

---

## Kiến trúc tổng quan

```text
┌──────────────────────────┐
│ Frontend                 │
│ React + Vite             │
│ Dashboard / Chat / KPI   │
└────────────┬─────────────┘
             │ /api proxy
             ▼
┌──────────────────────────┐
│ Backend                  │
│ FastAPI                  │
│ Routers / Services       │
└───────┬─────────┬────────┘
        │         │
        │         ▼
        │   ┌──────────────────────┐
        │   │ AI Agent Core         │
        │   │ Intent router         │
        │   │ Structured JSON       │
        │   │ Proposal flow         │
        │   └──────────┬───────────┘
        │              │
        ▼              ▼
┌──────────────┐   ┌────────────────────────┐
│ SQLite DB    │   │ LLM OpenAI-compatible  │
│ KPI / Chat   │   │ Qwen via VNGCloud vLLM │
│ Logs / OAuth │   │ or compatible endpoint │
└──────┬───────┘   └────────────────────────┘
       │
       ▼
┌──────────────────────────┐
│ Connectors               │
│ Gmail / Calendar / Sheets│
│ Notion / Slack / Outlook │
│ Excel / CSV upload       │
└──────────────────────────┘
```

### 4 tầng Agent

1. **Input Layer** — KPI definitions, actual performance, historical context, user context, category hierarchy, thresholds.
2. **Brain Layer** — natural language interface, direction analyzer, insight generator, persistent memory, feedback loop, autonomy engine.
3. **Output/Dashboard** — metric cards, charts, KPI detail, alerts, reports.
4. **Agentic Actions** — auto update, smart alert, weekly/monthly report, natural language suggestions.

---

## Tech stack

| Thành phần | Công nghệ |
|---|---|
| Frontend | React, Vite |
| Backend | FastAPI, SQLAlchemy |
| Database | SQLite |
| LLM | Qwen qua OpenAI-compatible endpoint |
| LLM serving | VNGCloud vLLM hoặc endpoint tương thích |
| AI orchestration | Intent router + structured JSON output |
| Export | Excel/PDF/DOCX/CSV/Markdown/JSON |
| OAuth/connectors | Google, Notion, Slack, Outlook theo cấu hình |
| Local scripts | `start.ps1`, `start.bat` |

---

## Yêu cầu môi trường

- Windows local development.
- Python 3.12 trở lên.
- Node.js 20 trở lên.
- API key cho endpoint LLM OpenAI-compatible.
- PowerShell để chạy script khởi động nhanh.

> Lưu ý: Không hardcode model hoặc endpoint LLM trong code. Luôn đọc từ `.env`.

---

## Cài đặt và chạy local

### 1. Clone repository

```powershell
git clone <repo-url>
cd <repo-folder>
```

### 2. Cài backend

```powershell
cd backend
py -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
Copy-Item .env.example .env
```

Mở `backend\.env` và điền thông tin LLM:

```env
LLM_BASE_URL=https://your-openai-compatible-endpoint/v1
LLM_API_KEY=your-api-key
LLM_MODEL=your-model-name
```

### 3. Cài frontend

```powershell
cd ..\frontend
npm install
```

### 4. Khởi động bằng script

Từ thư mục gốc repo:

```powershell
powershell -ExecutionPolicy Bypass -File .\start.ps1
```

Script sẽ mở backend ở `:8000`, frontend ở `:5173` và tự mở trình duyệt nếu đã cấu hình.

### 5. Khởi động thủ công

Backend:

```powershell
cd backend
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

Frontend:

```powershell
cd frontend
npm run dev
```

Truy cập:

- UI: `http://localhost:5173`
- API docs: `http://127.0.0.1:8000/docs`

---

## Cấu hình biến môi trường

Tạo file `backend/.env` từ `backend/.env.example`.

| Biến | Bắt buộc | Mô tả |
|---|---:|---|
| `LLM_BASE_URL` | Có | Endpoint LLM OpenAI-compatible. |
| `LLM_MODEL` | Có | Tên model đang dùng. Không hardcode trong code. |
| `LLM_API_KEY` | Có | API key cho endpoint LLM. |
| `VISION_BASE_URL` | Không | Endpoint Vision OpenAI-compatible cho Help Panel/chat attachments. |
| `VISION_MODEL` | Không | Tên model vision. |
| `VISION_API_KEY` | Không | API key Vision. Nếu trống, dùng hướng dẫn fallback. |
| `DATABASE_URL` | Không | Mặc định dùng SQLite `backend/kpi_companion.db`. |
| `GOOGLE_MOCK_MODE` | Không | `true` để dùng mock data, `false` để dùng OAuth thật. |
| `OAUTH_REDIRECT_BASE` | Không | Base URL backend cho OAuth callback. |
| `FRONTEND_URL` | Không | URL frontend sau khi OAuth callback. |
| `GOOGLE_CREDENTIALS_FILE` | Không | Tên file credentials Google, mặc định `credentials.json`. |
| `TOKEN_ENCRYPTION_KEY` | Không | Fernet key để mã hóa OAuth token. |
| `TESSERACT_CMD` | Không | Đường dẫn Tesseract OCR nếu cần fallback OCR local. |
| `NOTION_CLIENT_ID` / `NOTION_CLIENT_SECRET` | Không | OAuth Notion. |
| `SLACK_CLIENT_ID` / `SLACK_CLIENT_SECRET` | Không | OAuth Slack. |
| `OUTLOOK_CLIENT_ID` / `OUTLOOK_CLIENT_SECRET` | Không | OAuth Outlook/Microsoft Graph. |

Khi thêm biến môi trường mới, cần cập nhật đồng thời:

1. `.env.example`
2. bảng biến môi trường trong README
3. tài liệu hướng dẫn agent nội bộ nếu biến ảnh hưởng logic AI

---

## Kết nối nguồn dữ liệu

Mặc định hệ thống có thể chạy bằng mock data để demo nhanh.

### Google Gmail / Calendar / Sheets

Để dùng dữ liệu thật:

1. Tạo OAuth Client loại **Web application** trong Google Cloud Console.
2. Bật Gmail API, Google Calendar API, Google Sheets API.
3. Thêm redirect URI:

```text
http://localhost:8000/api/oauth/google/callback
```

4. Tải file credentials, đổi tên thành `credentials.json`.
5. Đặt file tại:

```text
backend/credentials.json
```

6. Cập nhật `backend/.env`:

```env
GOOGLE_MOCK_MODE=false
OAUTH_REDIRECT_BASE=http://localhost:8000
FRONTEND_URL=http://localhost:5173/sources
```

7. Khởi động lại backend và kết nối từ trang **Nguồn dữ liệu**.

### Notion / Slack / Outlook

Các provider này hoạt động theo cấu hình OAuth tương ứng. Khi chưa có client id/secret, giao diện nên hiển thị trạng thái chưa cấu hình hoặc fallback mock nếu có.

---

## Cấu trúc thư mục

```text
backend/
  app/
    agent/
      agent.py          # intent router, agent loop
      llm.py            # LLM client
      memory.py         # persistent memory
      prompts.py        # prompt tiếng Việt
    connectors/         # Google, Notion, Slack, Outlook, file upload
    routers/            # API routers
    services/           # business logic, export, reports, OAuth, autonomous agent
    models.py           # SQLAlchemy models
    main.py             # FastAPI app + migrate()
  mock_data/            # dữ liệu mock cho demo
  .env.example

frontend/
  src/
    components/         # UI components
    pages/              # Dashboard, Chat, KPI, Sources, Reports, Settings
    i18n.js             # vi/en dictionary
    *Context.jsx        # theme/view/language/cycle contexts
  public/
    support-config.json

demo/
  kpi-mau.csv
  worklog-mau.csv

start.ps1
start.bat
```

---

## Luồng AI Agent

### Intent router

Agent dùng intent router + structured JSON output, không dùng native function-calling.

Các intent chính:

- `update_progress`
- `sync_request`
- `create_kpi`
- `question`
- `other`
- `delete_kpi`
- `coaching`
- `weekly_summary`
- `create_meeting`

### Nguyên tắc gọi LLM

- Model đọc từ `LLM_MODEL`.
- Endpoint đọc từ `LLM_BASE_URL`.
- API key đọc từ `LLM_API_KEY`.
- Không hardcode model trong code.
- Với Qwen/vLLM, cần gửi `chat_template_kwargs: { enable_thinking: false }` để tránh độ trễ lớn.
- Không cap `max_tokens` quá nhỏ với các tác vụ sinh JSON dài như extract/conflict/kpi_create.

### Luồng thêm tính năng AI

```text
INTENT_SYSTEM
    ↓
extractor
    ↓
proposal card
    ↓
POST /api/.../confirm
    ↓
ghi DB
    ↓
KPIChangeLog
```

---

## KPI schema chuẩn

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

Nếu thay đổi schema này, cần cập nhật đồng thời:

- `backend/app/models.py`
- `backend/app/services/export_service.py`
- README
- tài liệu hướng dẫn agent nội bộ

---

## Quy tắc phát triển quan trọng

### Backend

- Migration SQLite phải idempotent trong `migrate()` của `main.py`.
- Không làm mất dữ liệu khi thêm/sửa schema.
- Xóa KPI/Objective là archive, không hard-delete.
- Mọi thay đổi KPI quan trọng phải ghi `KPIChangeLog`.
- `utcnow()` trong `models.py` đang cố ý trả `datetime.now()` theo giờ Việt Nam; không tự đổi về UTC nếu chưa migration dữ liệu cũ.
- Giữ mock fallback cho integration ngoài.

### Frontend

- Text UI mới phải thêm đủ ở cả block `vi` và `en` trong `frontend/src/i18n.js`.
- UI mới cần hỗ trợ dark mode, responsive desktop/mobile, loading/error/empty state.
- CRUD hoặc luồng xác nhận dữ liệu phải cập nhật cả UI và năng lực tương ứng cho Trợ lý AI.
- Không để Agent lộ internal ID trong nội dung hiển thị cho người dùng.

### Prompt và LLM

- Không ghi đè toàn bộ `agent/prompts.py`.
- Khi sửa prompt, chỉ sửa block cần thiết.
- Sau khi sửa prompt, đối chiếu các hằng prompt được gọi từ `agent.py` và `memory.py`.
- Không dùng PowerShell `Get-Content`/`Set-Content` để sửa hàng loạt file Python có tiếng Việt vì dễ hỏng UTF-8.

### Commit convention

```text
feat: thêm tính năng X
fix: sửa lỗi Y tại file Z
refactor: tái cấu trúc module A
docs: cập nhật README / CLAUDE / AGENTS
chore: cập nhật dependency, env
test: thêm/sửa test cho B
```

---

## Kịch bản demo nhanh

1. Mở Dashboard và xem KPI mẫu.
2. Vào Trợ lý AI, nhập:

```text
Tuần này tôi đã hoàn thành báo cáo ITGC quý 2, đang xử lý ticket workflow bị kẹt, tuần sau bắt đầu chuẩn bị tài liệu audit. Ngoài ra phát sinh thêm việc hỗ trợ dự án ISO.
```

3. Xem Agent tách đầu việc, gán KPI và tạo proposal.
4. Bấm xác nhận để lưu thay đổi.
5. Hỏi tiếp:

```text
KPI nào đang chậm tiến độ?
```

6. Tạo tổng kết tuần:

```text
Tổng kết tuần này giúp tôi
```

7. Thử import file demo trong thư mục `demo/`.
8. Xuất báo cáo Excel/PDF ở trang Reports.

---

## Troubleshooting

### Không chạy được PowerShell script

Chạy bằng:

```powershell
powershell -ExecutionPolicy Bypass -File .\start.ps1
```

Hoặc cho phép script trong user hiện tại:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

### Frontend lỗi do Node version

Kiểm tra:

```powershell
node --version
```

Cần Node.js 20 trở lên. Nếu máy có nhiều phiên bản Node, chuyển sang Node 20 bằng công cụ quản lý version đang dùng.

### Backend không gọi được LLM

Kiểm tra `backend/.env`:

```env
LLM_BASE_URL=...
LLM_API_KEY=...
LLM_MODEL=...
```

Sau khi sửa `.env`, cần restart backend hoặc chạy lại `start.ps1`.

### LLM phản hồi chậm

Với Qwen/vLLM, kiểm tra code gọi LLM đã gửi:

```json
{
  "chat_template_kwargs": {
    "enable_thinking": false
  }
}
```

Thiếu cấu hình này có thể làm thời gian phản hồi tăng rất mạnh.

### Cổng 8000 hoặc 5173 bị chiếm

Chạy lại `start.ps1` nếu script đã có bước dọn cổng, hoặc tự tắt tiến trình đang chiếm cổng rồi khởi động lại.

---

## Bảo mật dữ liệu

- Không commit `backend/.env`.
- Không commit API key, OAuth credentials hoặc token.
- `backend/credentials.json` cần nằm trong `.gitignore`.
- OAuth token cần được mã hóa bằng Fernet.
- Khi dùng LLM bên ngoài, cần cân nhắc ẩn danh hóa dữ liệu hoặc dùng endpoint nội bộ đã được phê duyệt.
- Demo nên dùng mock data hoặc dữ liệu đã được khử nhạy cảm.

---

## Trạng thái dự án

Dự án đang hỗ trợ các tính năng chính cho quản lý KPI cá nhân/nhóm, AI assistant, import/export, báo cáo, cảnh báo, autonomous proposal và connector mock/real theo cấu hình. Một số hướng mở rộng dài hạn gồm multi-tenant isolation hoàn chỉnh, vector memory, queue/event listener, webhook và triển khai production.

---

## Team

Team Human Override

- TinhHT
- ChuongVNH
- NamNH15

Event: Claw-a-thon AI Hackathon, 10–17/06/2026.
