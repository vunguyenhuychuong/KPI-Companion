"""Khoi tao LLM Qwen qua endpoint OpenAI-compatible (base_url + api_key)."""
import json
import re

from langchain_core.messages import HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI

from ..config import settings


def get_llm(temperature: float | None = None) -> ChatOpenAI:
    return ChatOpenAI(
        base_url=settings.llm_base_url,
        api_key=settings.llm_api_key,
        model=settings.llm_model,
        temperature=settings.llm_temperature if temperature is None else temperature,
        timeout=60,
        max_retries=2,
    )


def extract_json(text: str):
    """Lay JSON tu output cua LLM — chiu duoc code fence, van ban thua truoc/sau."""
    text = text.strip()
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


def call_json(system_prompt: str, user_prompt: str, temperature: float | None = None):
    """Goi LLM va parse JSON, retry 1 lan neu parse loi."""
    llm = get_llm(temperature)
    messages = [SystemMessage(content=system_prompt), HumanMessage(content=user_prompt)]
    last_err: Exception | None = None
    for _ in range(2):
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


def call_text(system_prompt: str, user_prompt: str, temperature: float | None = None) -> str:
    llm = get_llm(temperature)
    result = llm.invoke(
        [SystemMessage(content=system_prompt), HumanMessage(content=user_prompt)]
    )
    return result.content
