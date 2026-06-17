"""
RAG Demo — Retrieval-Augmented Generation (không cần model embedding ngoài)
===========================================================================
Pipeline:
  1. Load tài liệu từ docs/
  2. Chunk văn bản thành đoạn nhỏ
  3. Index TF-IDF (thuần Python, không cần tải model)
  4. Câu hỏi → cosine similarity → top-k đoạn liên quan nhất
  5. Ghép vào prompt → gọi LLM (dùng endpoint từ backend/.env)

Chạy:
  cd rag_demo
  pip install openai python-dotenv
  python rag_demo.py
"""

import math
import os
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")

from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent / "backend" / ".env")

LLM_BASE_URL = os.getenv("LLM_BASE_URL", "")
LLM_API_KEY  = os.getenv("LLM_API_KEY", "")
LLM_MODEL    = os.getenv("LLM_MODEL", "")

if not all([LLM_BASE_URL, LLM_API_KEY, LLM_MODEL]):
    print("Thiếu LLM_BASE_URL / LLM_API_KEY / LLM_MODEL trong backend/.env")
    sys.exit(1)

from openai import OpenAI

llm = OpenAI(base_url=LLM_BASE_URL, api_key=LLM_API_KEY)

# ── 1. Chunk ──────────────────────────────────────────────────────────────────
CHUNK_SIZE    = 300
CHUNK_OVERLAP = 60


def chunk_text(text: str) -> list[str]:
    chunks, start = [], 0
    while start < len(text):
        end = start + CHUNK_SIZE
        chunks.append(text[start:end].strip())
        start += CHUNK_SIZE - CHUNK_OVERLAP
    return [c for c in chunks if len(c) > 30]


# ── 2. TF-IDF index (thuần Python) ────────────────────────────────────────────
def tokenize(text: str) -> list[str]:
    """Lowercase + tách từ; giữ dấu tiếng Việt."""
    return re.findall(r'[a-zA-ZÀ-ỹ0-9]+', text.lower())


class TFIDFIndex:
    def __init__(self):
        self.docs:   list[dict]          = []   # {"text", "source"}
        self.tfs:    list[dict[str,float]]= []
        self.idf:    dict[str, float]    = {}
        self._dirty  = True

    def add(self, text: str, source: str = ""):
        tokens = tokenize(text)
        tf = Counter(tokens)
        total = max(len(tokens), 1)
        self.docs.append({"text": text, "source": source})
        self.tfs.append({t: c / total for t, c in tf.items()})
        self._dirty = True

    def _build_idf(self):
        N = len(self.docs)
        df: dict[str, int] = defaultdict(int)
        for tf in self.tfs:
            for t in tf:
                df[t] += 1
        self.idf = {t: math.log((N + 1) / (cnt + 1)) + 1 for t, cnt in df.items()}
        self._dirty = False

    def _vec(self, tf: dict[str, float]) -> dict[str, float]:
        return {t: tf[t] * self.idf.get(t, 1.0) for t in tf}

    @staticmethod
    def _cosine(a: dict[str, float], b: dict[str, float]) -> float:
        common = set(a) & set(b)
        if not common:
            return 0.0
        dot   = sum(a[t] * b[t] for t in common)
        mag_a = math.sqrt(sum(v*v for v in a.values()))
        mag_b = math.sqrt(sum(v*v for v in b.values()))
        return dot / (mag_a * mag_b + 1e-9)

    def search(self, query: str, top_k: int = 3) -> list[dict]:
        if self._dirty:
            self._build_idf()
        q_tf  = Counter(tokenize(query))
        total = max(sum(q_tf.values()), 1)
        q_tf  = {t: c / total for t, c in q_tf.items()}
        q_vec = self._vec(q_tf)

        scores = [
            (self._cosine(q_vec, self._vec(tf)), i)
            for i, tf in enumerate(self.tfs)
        ]
        scores.sort(reverse=True)
        return [
            {**self.docs[i], "score": round(score, 4)}
            for score, i in scores[:top_k]
            if score > 0
        ]


# ── 3. Load & index docs ──────────────────────────────────────────────────────
DOCS_DIR = Path(__file__).parent / "docs"
index    = TFIDFIndex()


def load_docs():
    total = 0
    for path in sorted(DOCS_DIR.glob("*.txt")):
        text   = path.read_text(encoding="utf-8")
        chunks = chunk_text(text)
        for c in chunks:
            index.add(c, source=path.name)
        total += len(chunks)
    print(f"Đã index {total} chunk từ {len(list(DOCS_DIR.glob('*.txt')))} file trong docs/")


# ── 4. RAG pipeline ───────────────────────────────────────────────────────────
def rag_ask(question: str, top_k: int = 3, verbose: bool = True) -> str:
    chunks = index.search(question, top_k)

    if verbose:
        print(f"\n{'─'*55}")
        print(f"Câu hỏi : {question}")
        if chunks:
            print(f"\nTop {len(chunks)} đoạn retrieve được:")
            for i, c in enumerate(chunks, 1):
                print(f"  [{i}] score={c['score']:.3f} ({c['source']}) {c['text'][:70]}...")
        else:
            print("  (Không tìm thấy đoạn nào liên quan)")

    if chunks:
        context = "\n\n".join(
            f"[Nguồn: {c['source']}]\n{c['text']}" for c in chunks
        )
        system = (
            "Bạn là trợ lý chuyên về KPI và quản lý hiệu suất.\n"
            "Trả lời dựa VÀO ngữ cảnh dưới đây. "
            "Nếu ngữ cảnh không đủ để trả lời, hãy nói rõ điều đó.\n\n"
            f"NGỮ CẢNH:\n{context}"
        )
    else:
        system = (
            "Bạn là trợ lý chuyên về KPI và quản lý hiệu suất. "
            "Câu hỏi này không có trong tài liệu nội bộ. Hãy trả lời theo hiểu biết chung."
        )

    response = llm.chat.completions.create(
        model=LLM_MODEL,
        messages=[
            {"role": "system", "content": system},
            {"role": "user",   "content": question},
        ],
        temperature=0.2,
        extra_body={"chat_template_kwargs": {"enable_thinking": False}},
    )
    answer = response.choices[0].message.content

    if verbose:
        print(f"\nTrả lời:\n{answer}")
        print(f"{'─'*55}\n")

    return answer


# ── 5. Demo ───────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    load_docs()

    demo_questions = [
        "KPI SMART là gì? Cho ví dụ cụ thể.",
        "OKR khác KPI ở điểm nào?",
        "KPI của tôi đang bị trễ, tôi nên làm gì?",
        "Thời tiết Hà Nội hôm nay thế nào?",  # ngoài phạm vi tài liệu
    ]

    for q in demo_questions:
        rag_ask(q)

    print("Nhập câu hỏi (Enter trống để thoát):")
    while True:
        q = input("> ").strip()
        if not q:
            break
        rag_ask(q)
