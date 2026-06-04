"""Amazon Bedrock Converse API client (API key auth)."""
import os
import logging

import httpx

log = logging.getLogger("bitsparx")


def _bedrock_config() -> tuple[str, str, str]:
    region = os.environ.get("AWS_REGION", "ap-south-1").strip()
    model_id = os.environ.get("BEDROCK_MODEL_ID", "apac.amazon.nova-micro-v1:0").strip()
    api_key = (
        os.environ.get("BEDROCK_API_KEY", "").strip()
        or os.environ.get("AWS_BEARER_TOKEN_BEDROCK", "").strip()
    )
    return region, model_id, api_key


async def bedrock_chat(
    *,
    system_message: str,
    messages: list[dict],
    max_tokens: int = 2048,
    temperature: float = 0.4,
) -> str:
    """Send a multi-turn conversation to Bedrock Converse and return assistant text."""
    region, model_id, api_key = _bedrock_config()
    if not api_key:
        raise ValueError("BEDROCK_API_KEY not configured")

    url = f"https://bedrock-runtime.{region}.amazonaws.com/model/{model_id}/converse"
    payload = {
        "messages": messages,
        "system": [{"text": system_message}],
        "inferenceConfig": {
            "maxTokens": max_tokens,
            "temperature": temperature,
        },
    }
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    async with httpx.AsyncClient(timeout=120.0) as client:
        response = await client.post(url, json=payload, headers=headers)
        if response.status_code >= 400:
            log.error("Bedrock error %s: %s", response.status_code, response.text[:500])
            response.raise_for_status()
        data = response.json()

    try:
        return data["output"]["message"]["content"][0]["text"]
    except (KeyError, IndexError, TypeError) as exc:
        log.error("Unexpected Bedrock response: %s", data)
        raise ValueError("Invalid Bedrock response") from exc
