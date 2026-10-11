"""Preserve provider reasoning when replaying tool-call history."""

from typing import Any, override

from langchain_core.language_models import BaseChatModel
from langchain_core.language_models.base import LanguageModelInput
from langchain_core.messages import AIMessage, BaseMessage
from langchain_deepseek import ChatDeepSeek
from langchain_qwq import ChatQwen
from pydantic import SecretStr

from agent_playground.models.profiles import (
    NATIVE_REASONING_EFFORTS,
    ChatProvider,
    ThinkingLevel,
)

DEFAULT_BASE_URLS: dict[ChatProvider, str] = {
    "deepseek": "https://api.deepseek.com",
    "qwen": "https://maas.qianwenaiapi.com/compatible-mode/v1",
}


def restore_reasoning_history(
    messages: list[BaseMessage],
    payload: dict[str, Any],
    *,
    require_reasoning: bool = False,
) -> dict[str, Any]:
    """Restore provider-only fields omitted by the shared request serializer."""
    # Both integrations retain reasoning in responses, but their shared OpenAI
    # serializer omits this provider field when sending tool-call history.
    for message, serialized in zip(messages, payload["messages"], strict=True):
        if not isinstance(message, AIMessage):
            continue

        reasoning = message.additional_kwargs.get("reasoning_content")

        if isinstance(reasoning, str):
            serialized["reasoning_content"] = reasoning
        elif require_reasoning:
            # Nonthinking models and workflow replies have no reasoning to
            # replay. DeepSeek thinking tools still require the field.
            serialized["reasoning_content"] = ""

    return payload


class DeepSeekChatModel(ChatDeepSeek):
    """Preserve reasoning fields required by DeepSeek thinking tool calls."""

    @override
    def _get_request_payload(
        self,
        input_: LanguageModelInput,
        *,
        stop: list[str] | None = None,
        **kwargs: Any,
    ) -> dict[str, Any]:
        payload = super()._get_request_payload(input_, stop=stop, **kwargs)
        extra_body: dict[str, Any] = payload.get("extra_body") or {}
        thinking: dict[str, Any] = extra_body.get("thinking") or {}
        requires_reasoning = (
            bool(payload.get("tools")) and thinking.get("type") != "disabled"
        )

        return restore_reasoning_history(
            self._convert_input(input_).to_messages(),
            payload,
            require_reasoning=requires_reasoning,
        )


class QwenChatModel(ChatQwen):
    """Replay available Qwen reasoning without synthesizing absent history."""

    @override
    def _get_request_payload(
        self,
        input_: LanguageModelInput,
        *,
        stop: list[str] | None = None,
        **kwargs: Any,
    ) -> dict[str, Any]:
        payload = super()._get_request_payload(input_, stop=stop, **kwargs)

        return restore_reasoning_history(
            self._convert_input(input_).to_messages(), payload
        )


def create_provider_model(
    provider: ChatProvider,
    *,
    model: str,
    api_key: SecretStr,
    base_url: str | None,
    thinking: ThinkingLevel,
    output_tokens: int,
) -> BaseChatModel:
    thinking_enabled = thinking != "disabled"
    native_effort = NATIVE_REASONING_EFFORTS[provider].get(thinking)
    endpoint = base_url or DEFAULT_BASE_URLS[provider]

    if provider == "deepseek":
        return DeepSeekChatModel(
            model=model,
            api_key=api_key,
            base_url=endpoint,
            stream_usage=True,
            max_tokens=output_tokens,
            reasoning_effort=native_effort,
            extra_body={
                "thinking": {"type": "enabled" if thinking_enabled else "disabled"}
            },
        )

    return QwenChatModel(
        model=model,
        api_key=api_key,
        base_url=endpoint,
        stream_usage=True,
        use_responses_api=False,
        enable_thinking=thinking_enabled,
        reasoning_effort=native_effort,
        extra_body={"enable_thinking": thinking_enabled},
        model_kwargs={"max_completion_tokens": output_tokens},
    )
