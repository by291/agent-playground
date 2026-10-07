"""Normalize model capacities and defaults independently of user configuration."""

from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Literal

from langchain_core.language_models.model_profile import ModelProfile
from langchain_deepseek import ChatDeepSeek
from langchain_openai.chat_models.base import BaseChatOpenAI
from langchain_qwq import ChatQwen

ChatProvider = Literal["deepseek", "qwen"]
ThinkingLevel = Literal["disabled", "low", "medium", "high"]

NATIVE_REASONING_EFFORTS: dict[ChatProvider, dict[ThinkingLevel, str]] = {
    "deepseek": {"low": "low", "medium": "high", "high": "max"},
    "qwen": {"low": "low", "medium": "medium", "high": "xhigh"},
}


@dataclass(frozen=True)
class ModelInformation:
    label: str
    context_window: int
    max_input_tokens: int
    max_output_tokens: int
    thinking_levels: tuple[ThinkingLevel, ...] = ("disabled",)
    thinking_input_tokens: int | None = None
    output_defaults: Mapping[ThinkingLevel, int] = field(default_factory=dict)
    image_tokens: int = 1024

    def input_limit(self, thinking: ThinkingLevel) -> int:
        if thinking != "disabled" and self.thinking_input_tokens is not None:
            return self.thinking_input_tokens

        return self.max_input_tokens

    def output_budget(self, thinking: ThinkingLevel) -> int:
        return self.output_defaults.get(thinking, self.max_output_tokens)


# Verified on 2026-10-07. SDK profiles can omit capacities or lag native limits.
# https://api-docs.deepseek.com/api/create-chat-completion/
# https://www.qianwenai.com/models/qwen3.8-flash
# https://docs.qwencloud.com/api-reference/chat/openai-chat
VERIFIED_MODELS: dict[tuple[ChatProvider, str], ModelInformation] = {
    ("deepseek", "deepseek-flash"): ModelInformation(
        label="DeepSeek",
        context_window=1_000_000,
        max_input_tokens=1_000_000,
        max_output_tokens=393_216,
        thinking_levels=("disabled", "low", "medium", "high"),
        output_defaults={
            "disabled": 8192,
            "low": 65_536,
            "medium": 65_536,
            "high": 131_072,
        },
    ),
    ("qwen", "qwen3.8-flash"): ModelInformation(
        label="Qwen",
        context_window=1_000_000,
        max_input_tokens=991_808,
        max_output_tokens=131_072,
        thinking_levels=("disabled", "low", "medium", "high"),
        thinking_input_tokens=983_616,
        image_tokens=16_384,
    ),
}


def library_model_profile(provider: ChatProvider, model: str) -> ModelProfile:
    if (
        provider == "qwen"
        and ChatQwen._resolve_model_profile is BaseChatOpenAI._resolve_model_profile
    ):
        # ChatQwen currently inherits OpenAI's registry. A colliding model name
        # must not supply foreign capacities; only scoped SDK profiles are safe.
        return {}

    model_class = ChatDeepSeek if provider == "deepseek" else ChatQwen
    # The partner extension hook reads bundled metadata. Constructing without
    # validation avoids creating HTTP clients just to inspect model information.
    metadata_model = model_class.model_construct(model_name=model)

    return metadata_model._resolve_model_profile() or {}


def model_information(provider: ChatProvider, model: str) -> ModelInformation:
    verified = VERIFIED_MODELS.get((provider, model))

    if verified is not None:
        return verified

    profile = library_model_profile(provider, model)
    context_window = profile.get("max_input_tokens")
    output_limit = profile.get("max_output_tokens")

    if (
        not isinstance(context_window, int)
        or context_window <= 0
        or not isinstance(output_limit, int)
        or output_limit <= 0
    ):
        raise ValueError(
            "Missing model information: register verified context and output limits"
        )

    thinking_levels: list[ThinkingLevel] = ["disabled"]
    native_efforts = profile.get("reasoning_effort_levels") or []

    if profile.get("reasoning_output"):
        thinking_levels.extend(
            level
            for level, effort in NATIVE_REASONING_EFFORTS[provider].items()
            if effort in native_efforts
        )

    return ModelInformation(
        label=profile.get("name") or model,
        context_window=context_window,
        max_input_tokens=context_window,
        max_output_tokens=output_limit,
        thinking_levels=tuple(thinking_levels),
        image_tokens=16_384 if provider == "qwen" else 1024,
    )
