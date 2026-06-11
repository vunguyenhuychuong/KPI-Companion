# 🎯 KPI Companion — AI Agent quản lý KPI cá nhân

> Biến việc báo cáo KPI hàng tháng từ 3 giờ thủ công thành 3 phút trò chuyện với Agent.

AI Agent giúp mỗi cá nhân quản lý toàn bộ KPI trong năm: kể công việc bằng **tiếng Việt tự nhiên**, Agent tự tách đầu việc, gán vào KPI tương ứng, phân loại 5 trạng thái (đã làm / đang làm / sẽ làm / phát sinh / loại bỏ), cập nhật tiến độ và vẽ bức tranh tổng thể cả năm trên một dashboard duy nhất.

## ✨ Tính năng

| Tính năng | Mô tả |
|---|---|
| 💬 Cập nhật bằng ngôn ngữ tự nhiên | Kể tuần làm việc → Agent tách việc, gán KPI, phân loại, đề xuất % tiến độ |
| 🔌 Thu thập tự động | Quét Gmail, Google Calendar, Google Sheets hoặc upload Excel/CSV — gõ 1 câu "Cập nhật tuần này từ Gmail và Calendar" là xong |
| ✅ Human-in-the-loop | Mọi đề xuất của Agent đều chờ người dùng kiểm tra/chỉnh sửa rồi mới lưu; dữ liệu nguồn ngoài luôn kèm nguồn gốc (email nào, dòng nào) |
| ✨ Phân rã SMART | Nhập KPI năm → Agent phân rã mục tiêu theo quý / tháng |
| 📊 Dashboard cảnh báo | Tiến độ thực tế vs kỳ vọng theo thời gian, màu xanh/vàng/đỏ, cảnh báo KPI rủi ro |
| 📝 Tổng kết tuần | Agent tự viết bản tổng kết đủ chất lượng gửi thẳng quản lý |
| 📥 Xuất Excel | 1 click ra file đánh giá: tổng quan KPI, bằng chứng công việc, việc phát sinh, lịch sử thay đổi |
| 🕒 Lịch sử thay đổi KPI | Mọi điều chỉnh giữa năm (trọng số, deadline, gỡ bỏ) đều ghi log kèm lý do |

## 🏗️ Kiến trúc

```
React (Vite) ── /api proxy ──► FastAPI ──► LangChain (ChatOpenAI) ──► Qwen (OpenAI-compatible)
   │                              │
   │                              ├─► SQLite (KPI, đầu việc, lịch sử, hội thoại)
   dashboard / chat / KPI         └─► Connectors: Gmail · Calendar · Sheets · Excel/CSV
                                       (mock fallback khi chưa có Google OAuth)
```

**Agent loop** (`backend/app/agent/agent.py`): mỗi tin nhắn đi qua bộ định tuyến ý định → `update_progress` (tách & phân loại việc) | `sync_request` (quét nguồn ngoài rồi phân loại) | `question` (trả lời từ dữ liệu KPI thật) | `other`. Dùng structured JSON output thay vì native function-calling để tương thích mọi endpoint Qwen (DashScope / OpenRouter / vLLM nội bộ).

## 🚀 Chạy dự án

### ⚡ Khởi động nhanh trên máy local (Windows) — hướng dẫn từng bước

> Hướng dẫn này dành cho lần đầu chạy trên máy Windows. Các bước đã được kiểm chứng thực tế; làm tuần tự từ trên xuống.

**Bước 0 — Kiểm tra công cụ.** Mở **PowerShell** (bấm `Win + R`, gõ `powershell`, Enter) rồi chạy:

```powershell
py --version    # cần Python 3.12 trở lên
node --version  # cần Node 20 trở lên — KHÔNG dùng Node 14
```

> ⚠️ **Lưu ý Node:** máy có thể có 2 bản Node song song — bản cũ ở `C:\Program Files\nodejs` và bản mới quản lý bởi **nvm** ở `C:\nvm4w\nodejs`. Vite (frontend) cần Node 20+. Nếu `node --version` ra v14, chuyển sang Node 20 bằng `nvm use 20.20.2` (hoặc bản 20.x đã cài). File `start.ps1` đã được cấu hình tự dùng Node ở `C:\nvm4w\nodejs`.

**Bước 1 — Cài backend (Python).** Tạo môi trường ảo và cài thư viện:

```powershell
cd D:\KPI-Compani\backend
py -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

> Mô tả: lệnh này tạo thư mục `.venv` (môi trường Python riêng cho dự án) rồi cài FastAPI, LangChain, SQLAlchemy… Chỉ cần làm **một lần**.

**Bước 2 — Cài frontend (Node).** Cài thư viện giao diện React/Vite:

```powershell
cd D:\KPI-Compani\frontend
npm install
```

> Mô tả: tải toàn bộ `node_modules`. Cũng chỉ làm **một lần**. Nếu báo lỗi liên quan Vite/engine, kiểm tra lại Node đang là v20 (Bước 0).

**Bước 3 — Cấu hình LLM.** Tạo file cấu hình rồi điền thông tin endpoint AI:

```powershell
cd D:\KPI-Compani\backend
Copy-Item .env.example .env   # nếu chưa có .env (start.ps1 cũng tự làm bước này)
```

Mở `backend\.env` bằng Notepad/VS Code và sửa 3 dòng cho khớp endpoint của bạn (ví dụ dùng **VNG Cloud / GreenNode MaaS**):

```env
LLM_BASE_URL=https://maas-llm-aiplatform-hcm.api.vngcloud.vn/v1
LLM_API_KEY=vn-xxxxxxxx          # key thật, KHÔNG để giá trị mẫu sk-your-key-here
LLM_MODEL=qwen/qwen3-5-27b       # tên model đúng như nhà cung cấp yêu cầu
```

> 🔒 **Bảo mật:** `backend\.env` đã nằm trong `.gitignore` nên **không bị commit lên git**. Tuyệt đối không dán API key vào chat AI hay nơi công cộng — chỉ sửa trực tiếp trong file trên máy.
>
> 💡 `LLM_BASE_URL` và `LLM_MODEL` lấy ở trang **API Keys / Model serving** trên console nhà cung cấp (đây không phải secret). Key phải khớp endpoint: key `vn-...` của VNG **không** dùng được với endpoint DashScope (`sk-...`) và ngược lại.

**Bước 4 — Khởi động.** Một lệnh duy nhất, lần nào cũng dùng:

```powershell
powershell -ExecutionPolicy Bypass -File "D:\KPI-Compani\start.ps1"
```

`start.ps1` sẽ tự động: dọn cổng 8000/5173 còn kẹt từ lần trước → mở cửa sổ backend (`:8000`, có auto-reload) → mở cửa sổ frontend (`:5173`) → sau 4 giây tự mở trình duyệt vào ứng dụng.

> Phần `-ExecutionPolicy Bypass` để tránh lỗi *"running scripts is disabled on this system"*. Muốn từ nay gõ gọn `.\start.ps1`, chạy **một lần duy nhất**: `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.

**Bước 5 — Kiểm tra.** Mở các địa chỉ:

- UI: <http://localhost:5173> — Dashboard hiện 5 KPI mẫu (DB trống sẽ tự seed).
- API docs: <http://127.0.0.1:8000/docs>
- Vào **Trợ lý AI**, gõ thử *"xin chào"* → nếu Agent trả lời tiếng Việt là LLM đã thông.

> ⏱️ Phản hồi có thể mất 20–60 giây tuỳ model (vd `qwen3-5-27b` trên MaaS khá chậm; câu hỏi phức tạp gọi LLM nhiều lần nên lâu hơn). Đây là độ trễ của model, không phải lỗi — muốn nhanh hơn, đổi `LLM_MODEL` sang model nhỏ/nhanh hơn.

**Dừng / khởi động lại.**

- Đóng app: đóng **cả 2** cửa sổ PowerShell (backend + frontend).
- Sửa `.env` xong: chạy lại `start.ps1` để nạp cấu hình mới (sửa `.env` **không** tự reload — `--reload` chỉ theo dõi file code `.py`).
- Gặp lỗi `address already in use` ở cổng 8000: cứ chạy lại `start.ps1` — bước dọn cổng tích hợp sẵn sẽ kill tiến trình mồ côi rồi mở lại.

---

### Yêu cầu
- Python 3.12+ · Node.js 20+
- API key của Qwen (endpoint OpenAI-compatible bất kỳ)

### Cài đặt lần đầu

```powershell
# Backend
cd backend
py -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
Copy-Item .env.example .env   # rồi điền LLM_BASE_URL / LLM_API_KEY / LLM_MODEL

# Frontend
cd ..\frontend
npm install
```

### Khởi động

```powershell
.\start.ps1   # mở 2 cửa sổ: backend :8000, frontend :5173, tự mở trình duyệt
```

Hoặc thủ công:

```powershell
cd backend; .\.venv\Scripts\python.exe -m uvicorn app.main:app --port 8000 --reload
cd frontend; npm run dev
```

- UI: http://localhost:5173 · API docs: http://127.0.0.1:8000/docs
- DB trống sẽ tự seed 5 KPI mẫu để demo ngay.

### Cấu hình LLM (backend/.env)

```env
LLM_BASE_URL=https://dashscope-intl.aliyuncs.com/compatible-mode/v1
LLM_API_KEY=sk-xxx
LLM_MODEL=qwen3.5-plus
```

Bất kỳ endpoint OpenAI-compatible nào cũng dùng được (DashScope, OpenRouter, vLLM/Ollama nội bộ).

### Google thật vs Mock

Mặc định `GOOGLE_MOCK_MODE=true` → Gmail/Calendar/Sheets trả về **mock data** trong `backend/mock_data/` (demo được ngay, không cần credentials). Để dùng thật:

1. Tạo OAuth Client ID (Desktop) trên Google Cloud Console, bật Gmail + Calendar + Sheets API.
2. Tải `credentials.json` vào thư mục `backend/`.
3. Đặt `GOOGLE_MOCK_MODE=false` trong `.env`. Lần quét đầu tiên sẽ mở trình duyệt để OAuth (token lưu vào `token.json`).

## 🎬 Kịch bản demo 5 phút

1. **Dashboard** — 5 KPI mẫu, có KPI vàng/đỏ cảnh báo chậm tiến độ.
2. **Moment wow** — vào Trợ lý AI, dán: *"Tuần này tôi đã hoàn thành báo cáo ITGC quý 2, đang xử lý ticket workflow bị kẹt, tuần sau bắt đầu chuẩn bị tài liệu audit. Ngoài ra phát sinh thêm việc hỗ trợ dự án ISO."* → Agent tách 4 đầu việc, gán KPI, phân loại → bấm Xác nhận → quay lại Dashboard thấy số nhảy.
3. **Thu thập tự động** — gõ *"Cập nhật tuần này từ Gmail và Calendar"* → Agent quét, kèm nguồn gốc từng email/cuộc họp.
4. **Hỏi đáp** — *"KPI nào đang chậm tiến độ?"*, bấm **Tổng kết tuần**.
5. **Chốt hạ** — bấm **Xuất Excel đánh giá**, mở file 4 sheet cho giám khảo xem.

File demo có sẵn trong `demo/`: `kpi-mau.csv` (import KPI), `worklog-mau.csv` (upload timesheet).

## 📁 Cấu trúc

```
backend/
  app/
    agent/        # llm.py (Qwen client), prompts.py (prompt tiếng Việt), agent.py (agent loop)
    connectors/   # gmail, calendar, sheets (real + mock), file_upload (Excel/CSV)
    routers/      # kpis, chat, work_items, sources, reports
    services/     # kpi_service (tiến độ/cảnh báo), report_service (xuất Excel)
    models.py     # SQLAlchemy: KPI, SubGoal, WorkItem, KPIChangeLog, ChatMessage
  mock_data/      # emails.json, calendar.json, timesheet.json
frontend/
  src/pages/      # Dashboard, Chat, Kpis, Sources
  src/components/ # ProposalList (xác nhận đề xuất của Agent)
demo/             # file mẫu cho demo
```

## 🔒 Lưu ý dữ liệu nhạy cảm

Demo dùng hoàn toàn dữ liệu giả lập. Bản production cần: ẩn danh hóa nội dung trước khi gửi LLM bên ngoài hoặc dùng hạ tầng AI nội bộ được phê duyệt; Gmail chỉ đọc metadata + email người dùng chọn lọc.

---
*Hackathon 7 ngày · Team: Tính, Chương, Nam*
