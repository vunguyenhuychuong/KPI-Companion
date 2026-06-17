"""Khoi tao LLM Qwen qua endpoint OpenAI-compatible (base_url + api_key)."""
import json
import re
import threading

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI

from ..config import settings

# Giới hạn số LLM call chạy đồng thời — tránh quá tải VNGCloud vLLM endpoint.
_LLM_SEMAPHORE = threading.Semaphore(5)


def get_llm(temperature: float | None = None, max_tokens: int | None = None) -> ChatOpenAI:
    kwargs = {}
    if settings.llm_disable_thinking:
        # Tat thinking mode cua Qwen3 — giam latency tu ~12s xuong <1s moi call.
        # Gui ca 2 dang de tuong thich vLLM (chat_template_kwargs) lan DashScope (enable_thinking).
        kwargs["extra_body"] = {
            "enable_thinking": False,
            "chat_template_kwargs": {"enable_thinking": False},
        }
    if max_tokens is not None:
        # gioi han do dai sinh ra -> phan hoi nhanh hon cho tac vu dau ra ngan (intent, parse lenh)
        kwargs["max_tokens"] = max_tokens
    return ChatOpenAI(
        base_url=settings.llm_base_url,
        api_key=settings.llm_api_key,
        model=settings.llm_model,
        temperature=settings.llm_temperature if temperature is None else temperature,
        timeout=45,
        max_retries=1,
        **kwargs,
    )

def strip_think(text: str) -> str:
    """Bo block <think>...</think> neu model van tra ve reasoning."""
    return re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL).strip()

def extract_json(text: str):
    """Lay JSON tu output cua LLM — chiu duoc code fence, van ban thua truoc/sau."""
    text = strip_think(text)
    fence = re.search(r"```(?:json)?\s*(.*?)```", text, re.DOTALL)
    if fence:
        text = fence.group(1).strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    # tim object/array dau tien trong van ban
    for open_ch, close_ch in [("{", "}"), ("[", "]")]:
        start = text.find(open_ch)
        if start == -1:
            continue
        depth = 0
        for i in range(start, len(text)):
            if text[i] == open_ch:
                depth += 1
            elif text[i] == close_ch:
                depth -= 1
                if depth == 0:
                    try:
                        return json.loads(text[start : i + 1])
                    except json.JSONDecodeError:
                        break
    raise ValueError(f"Không trích xuất được JSON từ output LLM: {text[:300]}")


def call_json(
    system_prompt: str, user_prompt: str, temperature: float | None = None, max_tokens: int | None = None
):
    """Goi LLM va parse JSON, retry 1 lan neu parse loi."""
    llm = get_llm(temperature, max_tokens)
    messages = [SystemMessage(content=system_prompt), HumanMessage(content=user_prompt)]
    last_err: Exception | None = None
    for _ in range(2):
        with _LLM_SEMAPHORE:
            result = llm.invoke(messages)
        try:
            return extract_json(result.content)
        except ValueError as e:
            last_err = e
            messages.append(result)
            messages.append(
                HumanMessage(
                    content="Output trên không phải JSON hợp lệ. Hãy trả lời lại, CHỈ in ra JSON, không thêm chữ nào khác."
                )
            )
    raise last_err


def call_text(
        system_prompt: str,
        user_prompt: str,
        temperature: float | None = None,
        history: list[dict] | None = None,
        max_tokens: int | None = None,
) -> str:
    """Goi LLM tra ve text; history = [{"role": "user"|"assistant", "content": ...}] de hieu hoi thoai noi tiep."""
    llm = get_llm(temperature, max_tokens)
    messages: list = [SystemMessage(content=system_prompt)]
    for h in history or []:
        cls = HumanMessage if h.get("role") == "user" else AIMessage
        messages.append(cls(content=h.get("content", "")))
    messages.append(HumanMessage(content=user_prompt))
    with _LLM_SEMAPHORE:
        result = llm.invoke(messages)
    return strip_think(result.content)
