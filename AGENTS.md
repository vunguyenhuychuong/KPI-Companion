# KPI Companion — Tài liệu hướng dẫn cho AI agent phát triển tiếp

> **Cách đọc:** Đọc CLAUDE.md trước (stack, bản đồ file, checklist). File này bổ sung 3 thứ CLAUDE.md không có: (1) quyết định kiến trúc đã chốt không được đảo ngược, (2) mô tả tính năng đã triển khai, (3) spec kiến trúc mở rộng tương lai.

---

## 1. Quyết định kiến trúc ĐÃ CHỐT (đừng đảo ngược)

1. **LLM**: Qwen qua endpoint OpenAI-compatible (`backend/.env`). Endpoint thật là VNGCloud vLLM `qwen/qwen3-5-27b` — **bắt buộc** gửi `chat_template_kwargs: {enable_thinking: false}` (đã làm trong `agent/llm.py`), thiếu nó mỗi call chậm ~24 lần.

2. **Agent KHÔNG dùng native function-calling** (để tương thích mọi endpoint Qwen) — dùng intent router + structured JSON. 7 intents trong `agent/agent.py`: `update_progress` / `sync_request` / `create_kpi` / `question` / `other` / `delete_kpi` / `coaching`. Tốc độ: `enable_thinking:false` là đòn bẩy chính; `get_llm`/`call_json` nhận `max_tokens` để cap các tác vụ đầu ra ngắn (intent=24, sync_parse=120) — ĐỪNG cap nhỏ cho call_json sinh JSON dài (conflict/extract/kpi_create) hay call_text báo cáo.

3. **Human-in-the-loop tuyệt đối**: Agent KHÔNG bao giờ tự ghi dữ liệu. Mọi thay đổi đi qua thẻ đề xuất (`proposed_items` / `proposed_objectives` / `proposed_kpis`) → người dùng bấm Xác nhận → endpoint confirm mới ghi DB. Prompt đã có guard chống "ảo tưởng hành động" — giữ nguyên các guard này.

4. **Mô hình OKR 2 tầng trọng số**: Objective có weight (tổng ≤100%), KPI weight tính TRONG objective (tổng ≤100%/nhóm). Validate ở cả frontend lẫn backend.

5. **Hệ đơn vị đo**: KPI = unit + target_value + current_value; `progress` = current/target (CHO PHÉP vượt 100%, badge ⭐), nhưng `progress_capped` (max 100) dùng khi tổng hợp điểm OKR. Work item lưu delta theo ĐƠN VỊ KPI, không phải %.

6. **Kỳ vọng (expected)**: ưu tiên kế hoạch SMART theo tháng (nội suy theo ngày), fallback tuyến tính theo thời gian — `kpi_service.expected_progress()`.

7. **Giờ ĐỊA PHƯƠNG**: hàm `utcnow()` trong `models.py` cố ý trả `datetime.now()` (giờ VN) — đừng "sửa" về UTC, dữ liệu cũ đã được shift.

8. **Google connectors**: mock mode mặc định (`GOOGLE_MOCK_MODE=true`, mock data trong `backend/mock_data/`); code API thật có sẵn, bật bằng credentials.json + đổi env.

9. **SQLite migration thủ công**: hàm `migrate()` trong `main.py` ALTER TABLE idempotent — thêm cột mới phải thêm vào đây, KHÔNG được làm mất dữ liệu. Cột `kpis.progress` cũ là legacy NOT NULL, model giữ `progress_legacy` map vào để INSERT không lỗi.

10. **Mọi thay đổi KPI ghi `KPIChangeLog`** kèm lý do (bắt buộc nhập trên UI); xóa = archive (khôi phục được), không hard-delete.

---

## 2. Cảnh báo kỹ thuật đã gặp

- ⚠️ KHÔNG dùng PowerShell `Get-Content`/`Set-Content` để sửa hàng loạt file Python — đã từng làm hỏng encoding UTF-8 tiếng Việt.
- ⚠️ KHÔNG ghi đè cả file `agent/prompts.py` — đã từng bị dán đè bằng bản nháp cũ làm mất 4 prompt (KPI_CREATE / SYNC_PARSE / SMART / CONFLICT_SYSTEM) gây AttributeError khi tạo KPI (đã khôi phục 13/06 từ commit 829bfe5). Chỉ edit từng block prompt; sau khi sửa, đối chiếu `grep -o "prompts\.[A-Z_]*" agent.py memory.py` với các hằng đã định nghĩa.

---

## 3. Tính năng đã triển khai

### 3.1 Tính năng cốt lõi

| Tính năng | File chính | Hành vi đặc biệt cần biết |
|---|---|---|
| Auth multi-user | `auth.py`, `routers/auth.py`, `Login.jsx` | Email + Google OAuth; 401 → tự logout; token Bearer trong localStorage `kpi_token` |
| Đa ngôn ngữ vi/en | `i18n.js`, `LangContext.jsx` | Dict phẳng key→chuỗi, 2 block vi/en; thêm text mới = thêm key vào CẢ 2 block |
| Agent tự học (memory) | `agent/memory.py` | Trích thông tin BỀN VỮNG (profile/alias/workflow/preference) sau mỗi lượt chat; cap 50/user; lỗi học nền phải nuốt — không được ảnh hưởng chat |
| Phát hiện xung đột KPI | `routers/kpis.py` | Tự rà soát 1 lần khi mở trang (≥2 KPI); panel tự bung khi có xung đột; CONFLICT_SYSTEM bắt LLM gọi KPI bằng TÊN trong ngoặc kép, không dùng id trong văn bản |
| Xóa KPI/Objective qua chat | `agent/agent.py` | Intent `delete_kpi` → extract → thẻ `delete_proposal` trên Chat.jsx → confirm → archive + KPIChangeLog; xóa objective archive luôn KPI con chưa archive |
| Trạng thái thẻ đề xuất bền vững | `routers/chat.py`, `Chat.jsx` | `meta.proposal_status`: `pending`→`saved`/`dismissed` qua PATCH; mở lại phiên: pending vẫn xác nhận được, saved/dismissed hiện ghi chú |

### 3.2 Tính năng mới (hoàn thành 2026-06-13)

| Tính năng | File chính | Hành vi đặc biệt cần biết |
|---|---|---|
| Thông báo chủ động | `routers/notifications.py`, `NotificationsBell.jsx` | 4 loại cảnh báo: `behind`/`deadline`/`runrate`/`overdue`; tính server-side, KHÔNG gọi LLM; id ổn định `type:ref:state`; đã-đọc/đã-ẩn lưu localStorage qua `prefs.js` |
| Biểu đồ Bar + Radar | `Dashboard.jsx` | SVG tay (không thư viện); BarByObjective: 2 thanh/Objective; StructureRadar: 4 trục cố định (cân nhắc đổi → báo lại trước) |
| Thiết lập + Cấu hình kết nối | `routers/settings.py`, `services/app_config.py`, `Settings.jsx` | App-level config ghi đè lúc chạy qua `AppSetting` model; KHÔNG lưu secret/credentials trên UI; chọn "Thật" thiếu credentials.json → tự fallback mock |
| Export đa định dạng | `services/export_service.py`, `Reports.jsx` | Formats: csv/md/json/xlsx/pdf/docx; 1 file → tải thẳng, nhiều file → .zip; XLSX luôn dùng `report_service.export_evaluation_excel` (đủ 4 sheet bất kể `sections` chọn gì — hành vi đã biết) |
| Accountability Proxy | `services/export_service.py` | `POST /api/reports/send-to-manager`; MOCK-FIRST, không gửi thật; chỉ gồm KPI Công việc, ẩn KPI Cá nhân |
| Work/Personal + Dark mode | `ViewContext.jsx`, `ThemeContext.jsx` | Cột `category` trên KPI; Import Excel/CSV luôn mặc định "Work"; `matchView()` lọc 4 chế độ; dark mode theo `data-theme` trên `<html>` |
| RCA + Coaching | `agent/agent.py` (intent `coaching`), `routers/kpis.py` | `POST /api/kpis/{id}/coach`; trả `analysis`/`root_causes`/`actions`; actions là `ProposedWorkItem` → tái dùng ProposalList/confirm; auto-trigger chỉ khi `kpi_autocoach==='1'` trong localStorage |
| Burnout Guardrail | `routers/burnout.py` | Deterministic, KHÔNG gọi LLM; giờ cần vs giờ trống từ calendar mock; 3 mức: safe/warning/danger |
| AI Predictive Runrate | `services/kpi_service.py` (`forecast_kpi`), `Dashboard.jsx` | Deterministic, KHÔNG gọi LLM; `has_history=false` → vận tốc 0, dự báo đi ngang — hành vi trung thực, không phải bug; ForecastChart vẽ SVG tay 4 đường, KHÔNG thêm thư viện chart |
| AI Category Guard | `services/autonomous_agent.py`, `routers/kpis.py`, `routers/objectives.py`, `AutonomousAgentInbox.jsx` | Gọi Qwen qua `call_json` để phân loại ngữ cảnh Work/Personal khi Agent tự chủ quét và sau khi user tạo/sửa/xác nhận KPI; nếu KPI có vẻ nằm sai nhóm thì tạo thẻ chuyển phân loại cần user xác nhận, không dùng rule từ khóa cứng và không tự ghi DB |

---

## 4. Kiến trúc mở rộng tương lai

### 4.1 Phân bổ thành phần dự kiến
- **Backend & Điều phối (Python):** LLM (LangChain/LangGraph), Semantic Search, RAG, Phân tích dữ liệu và Mô hình hóa dự báo.
- **Tầng Thực thi & Tích hợp (Node.js/TypeScript — hướng mở rộng dự kiến):** API Gateways, Event Listeners, Webhooks, Auth, Async Message Queuing.

### 4.2 Tầng dữ liệu hỗn hợp
- **SQLite (đang dùng):** Hồ sơ người dùng, Khung KPI, Trọng số, Metrics Logging, Audit Trails.
- **NoSQL / Vector Store (đề xuất mở rộng — Chroma/Qdrant/MongoDB):** Lịch sử chat không cấu trúc, Long-term memory fragments, Semantic context.
- **File (JSON/Markdown):** Exportable snapshots, Static templates, Local backups.

### 4.3 Kiến trúc tích hợp mở (Abstract Tool Broker)

Mọi connector ngoài phải implement interface:

```typescript
interface ExternalToolConnector {
  sourceName: string; // Ví dụ: "Google_Sheets", "Jira", "Notion"
  authType: 'OAuth2' | 'API_Key' | 'Bearer';
  fetchRawMetrics(userId: string, targetResourceId: string): Promise<any>;
  normalizeData(rawPayload: any): NormalizedKPILog;
}
```

**Quy tắc ánh xạ tích hợp:**
1. **Google (Calendar/Sheets/Drive/Gmail):** Đọc thời lượng sự kiện; quét ô chỉ định trong Spreadsheet.
2. **Notion:** Truy vấn database blocks theo thuộc tính vừa cập nhật (Trạng thái = "Done").
3. **ServiceDesk/Jira:** Tính ticket đã giải quyết/đóng trong Sprint.
4. **Tempo:** Tổng hợp số giờ đã log cho một Epic.

### 4.4 Schema đề xuất mở rộng (SQLite)

```sql
CREATE TABLE kpi_objectives (
    kpi_id TEXT PRIMARY KEY,
    user_id TEXT,
    title TEXT NOT NULL,
    description TEXT,
    category TEXT CHECK(category IN ('Work', 'Personal')),
    metric_unit TEXT NOT NULL,
    baseline_value REAL DEFAULT 0.0,
    target_value REAL NOT NULL,
    current_value REAL DEFAULT 0.0,
    weight_percentage REAL DEFAULT 100.0,
    status TEXT CHECK(status IN ('On Track', 'At Risk', 'Critical', 'Completed')) DEFAULT 'On Track',
    start_date TIMESTAMP,
    end_date TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(user_id)
);
```

**Schema vector (NoSQL/Chroma — đề xuất mở rộng):**
```json
{
  "id": "mem_log_88319",
  "document": "...",
  "metadata": {
    "user_id": "usr_01",
    "associated_kpi_id": "kpi_991",
    "sentiment": "negative",
    "timestamp": "2026-06-13T08:00:00Z",
    "context_tag": "coaching_session_notes"
  }
}
```

---

*Hackathon 7 ngày · Team: Tính, Chương, Nam*
