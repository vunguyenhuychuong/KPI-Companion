# Spec: AI Help Panel – Screen-aware Onboarding Feature

> Tài liệu này là prompt/spec đầy đủ để AI code lại tính năng "Hướng dẫn sử dụng thông minh"
> cho ứng dụng KPI Companion. Đọc toàn bộ trước khi bắt đầu code.

---

## 1. Mục tiêu tính năng

Xây dựng một **floating Help Panel** tích hợp vào UI của KPI Companion.
Khi người dùng nhấn nút `?`, hệ thống sẽ:
1. Chụp ảnh màn hình hiện tại (vùng UI chính)
2. Gửi ảnh đó lên **Vision AI API** (Qwen-VL hoặc bất kỳ model vision nào)
3. AI phân tích giao diện → trả về hướng dẫn phù hợp với màn hình đó
4. Hiển thị hướng dẫn dạng step-by-step ngay trên UI

---

## 2. Stack & Dependencies

| Thành phần | Lựa chọn |
|---|---|
| Framework | React (hoặc Vue 3, Next.js) |
| Chụp màn hình | `html2canvas` (`npm install html2canvas`) |
| AI API | OpenAI-compatible Vision API |
| Styling | CSS inline (không dùng thư viện ngoài) |
| State | React `useState`, `useRef`, `useCallback` |

---

## 3. Cấu trúc file cần tạo

```
src/
  components/
    HelpPanel/
      index.jsx          ← component chính (xem section 5)
      captureScreen.js   ← helper chụp màn hình (xem section 6)
      callVisionAPI.js   ← helper gọi API (xem section 7)
```

---

## 4. Props của component `<HelpPanel />`

```ts
interface HelpPanelProps {
  targetRef:  React.RefObject<HTMLElement>  // element cần chụp (thường là div wrapper chính)
  apiKey:     string                        // API key của Vision model
  apiBase:    string                        // base URL của API endpoint
  model:      string                        // tên model vision
  position?:  "right" | "left" | "bottom"  // vị trí panel (mặc định: "right")
}
```

**Ví dụ sử dụng:**
```jsx
const mainRef = useRef(null);

<div ref={mainRef}>
  {/* ... UI chính của app ... */}
</div>

<HelpPanel
  targetRef={mainRef}
  apiKey={import.meta.env.VITE_VISION_API_KEY}
  apiBase="https://dashscope.aliyuncs.com/compatible-mode/v1"
  model="qwen-vl-max"
  position="right"
/>
```

---

## 5. Logic chính của component (index.jsx)

### 5.1 State cần quản lý

```js
const [isOpen,       setIsOpen]       = useState(false);   // panel đang mở/đóng
const [loading,      setLoading]      = useState(false);   // đang gọi API
const [guide,        setGuide]        = useState(null);    // kết quả từ AI { screen, summary, issue, steps, tip }
const [error,        setError]        = useState(null);    // thông báo lỗi
const [preview,      setPreview]      = useState(null);    // data URL ảnh đã chụp (để debug)
const [showPreview,  setShowPreview]  = useState(false);   // toggle hiện ảnh debug
```

### 5.2 Hàm handleOpen – luồng xử lý chính

```js
const handleOpen = async () => {
  setIsOpen(true);
  setLoading(true);
  setError(null);
  setGuide(null);

  try {
    // Bước 1: Xác định element cần chụp
    const target = targetRef?.current ?? document.body;

    // Bước 2: Chụp màn hình → base64
    const base64Image = await captureScreen(target);
    setPreview(`data:image/png;base64,${base64Image}`);

    // Bước 3: Gọi Vision API
    const result = await callVisionAPI({
      base64Image,
      apiBase,
      apiKey,
      model,
    });

    // Bước 4: Lưu kết quả
    setGuide(result);
  } catch (err) {
    setError(err.message);
  } finally {
    setLoading(false);
  }
};
```

### 5.3 UI cần render

Component render 2 phần độc lập:

**A. Nút trigger (luôn hiển thị):**
- Vị trí: `position: fixed`, `bottom: 24px`, `right: 24px`
- Hình: hình tròn, màu `#6C63FF`, chữ `?` khi đóng, `✕` khi mở
- Hover: scale lên 1.1x

**B. Panel nổi (chỉ hiển thị khi `isOpen === true`):**
- Vị trí: `position: fixed`, `top: 80px`, `right: 16px`, `width: 340px`
- Nền tối: `#1e2035`, border `rgba(108,99,255,0.3)`, border-radius `16px`
- Có 3 trạng thái nội dung:
  1. **Loading**: icon 📸 + text "Đang phân tích màn hình..."
  2. **Error**: hộp đỏ hiển thị `error.message`
  3. **Kết quả**: render `guide` object (xem section 5.4)

### 5.4 Render kết quả `guide`

Khi có `guide` object, hiển thị theo thứ tự:

```
┌─────────────────────────────────┐
│ [Màn hình hiện tại]             │  ← guide.screen (badge tím nhạt)
│ guide.summary                   │  ← mô tả 1 câu
├─────────────────────────────────┤
│ ⚠️ guide.issue                  │  ← CHỈ hiển thị nếu issue != ""
│   (nền vàng nhạt)               │
├─────────────────────────────────┤
│ HƯỚNG DẪN TỪNG BƯỚC             │
│ 1. guide.steps[0]               │
│ 2. guide.steps[1]               │
│ 3. guide.steps[2]               │
├─────────────────────────────────┤
│ 💡 guide.tip                    │  ← CHỈ hiển thị nếu tip != ""
│   (nền xanh lá nhạt)            │
├─────────────────────────────────┤
│ [Xem ảnh AI đã phân tích]       │  ← toggle, nếu có preview
│ [🔄 Phân tích lại]              │  ← gọi lại handleOpen
└─────────────────────────────────┘
```

---

## 6. Helper: captureScreen.js

```js
import html2canvas from "html2canvas";

/**
 * Chụp một DOM element và trả về base64 string (không có prefix data:image/png;base64,)
 * @param {HTMLElement} element
 * @returns {Promise<string>} base64 PNG
 */
export async function captureScreen(element) {
  const canvas = await html2canvas(element, {
    useCORS: true,
    allowTaint: true,
    scale: 1.5,                    // tăng độ phân giải để AI đọc rõ hơn
    backgroundColor: "#1a1b2e",    // màu nền app (tối)
  });
  return canvas.toDataURL("image/png").split(",")[1];
}
```

---

## 7. Helper: callVisionAPI.js

### 7.1 System prompt gửi cho AI

```
Bạn là trợ lý hướng dẫn sử dụng KPI Companion – ứng dụng quản lý mục tiêu cá nhân.

Khi nhận được ảnh chụp màn hình UI, hãy:
1. Nhận diện người dùng đang ở màn hình nào (Dashboard / KPI của tôi / Trợ lý AI / Báo cáo / Nhật ký / Cài đặt)
2. Phát hiện các vấn đề hoặc trạng thái nổi bật:
   - Tổng trọng số KPI vượt 100% (cảnh báo "Σ KPI: X/100%")
   - Có KPI nào đang ở 0% tiến độ gần deadline
   - Người dùng chưa có KPI nào
3. Đưa ra hướng dẫn cụ thể, ngắn gọn (tối đa 4 bước), phù hợp với màn hình đó
4. Dùng tiếng Việt, thân thiện, không dài dòng

Bắt buộc trả về JSON hợp lệ, không kèm markdown, không giải thích thêm:
{
  "screen": "tên màn hình ngắn gọn",
  "summary": "mô tả 1 câu về tình trạng hiện tại",
  "issue": "vấn đề phát hiện (để chuỗi rỗng nếu không có vấn đề)",
  "steps": ["bước 1", "bước 2", "bước 3"],
  "tip": "mẹo nhanh hữu ích (để chuỗi rỗng nếu không có)"
}
```

### 7.2 Cấu trúc API request

Dùng chuẩn **OpenAI Chat Completions** với `image_url`:

```js
POST {apiBase}/chat/completions
Authorization: Bearer {apiKey}
Content-Type: application/json

{
  "model": "{model}",
  "max_tokens": 800,
  "messages": [
    {
      "role": "system",
      "content": "{systemPrompt}"
    },
    {
      "role": "user",
      "content": [
        {
          "type": "image_url",
          "image_url": {
            "url": "data:image/png;base64,{base64Image}",
            "detail": "high"
          }
        },
        {
          "type": "text",
          "text": "Hãy phân tích màn hình này và hướng dẫn tôi. Trả về JSON theo đúng định dạng đã yêu cầu."
        }
      ]
    }
  ]
}
```

### 7.3 Xử lý response

```js
const raw = data.choices[0].message.content;

// Xử lý cả trường hợp model trả về ```json ... ```
const cleaned = raw.replace(/```json\n?|\n?```/g, "").trim();
return JSON.parse(cleaned);
```

### 7.4 Throw error rõ ràng nếu API thất bại

```js
if (!response.ok) {
  const errText = await response.text();
  throw new Error(`API ${response.status}: ${errText}`);
}
```

---

## 8. Cấu hình theo từng provider

| Provider | apiBase | model |
|---|---|---|
| DashScope (Alibaba Cloud) | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen-vl-max` hoặc `qwen2.5-vl-72b-instruct` |
| OpenRouter | `https://openrouter.ai/api/v1` | `qwen/qwen-2.5-vl-72b-instruct` |
| SiliconFlow | `https://api.siliconflow.cn/v1` | `Qwen/Qwen2.5-VL-72B-Instruct` |
| Ollama (local) | `http://localhost:11434/v1` | `qwen2.5-vl:7b` |
| OpenAI | `https://api.openai.com/v1` | `gpt-4o` |

---

## 9. Lưu ý khi code

1. **Không dùng thư viện CSS ngoài** – toàn bộ style viết inline (`style={{...}}`)
2. **Không dùng `<form>` tag** – dùng `onClick` handler thay thế
3. **Parse JSON an toàn** – bọc `JSON.parse` trong `try/catch`, nếu lỗi hiển thị error thân thiện
4. **Ảnh base64 chứa dữ liệu UI của người dùng** – không log ra console ở production
5. **html2canvas có giới hạn** – không chụp được `<iframe>` hay element cross-origin, cần `useCORS: true`
6. **Nên thêm debounce** – tránh người dùng nhấn `?` liên tục gây spam API call (tối thiểu 5 giây giữa các lần)

---

## 10. Checklist kiểm tra khi hoàn thành

- [ ] Nhấn `?` → panel mở, hiển thị trạng thái loading
- [ ] Sau ~3-5 giây → hiển thị hướng dẫn với đúng tên màn hình
- [ ] Nếu KPI tổng trọng số > 100% → panel hiển thị cảnh báo issue
- [ ] Nhấn "Xem ảnh AI đã phân tích" → hiện ảnh chụp màn hình
- [ ] Nhấn "🔄 Phân tích lại" → gọi API lại
- [ ] Nhấn `✕` → đóng panel, reset state
- [ ] API lỗi → hiển thị hộp đỏ với message lỗi, không crash app
