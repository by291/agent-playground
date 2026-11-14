"""Model context budgets and conservative input-token accounting."""

from collections.abc import Iterable
from math import ceil
from typing import Self

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import AIMessage, MessageLikeRepresentation
from langchain_core.messages.utils import (
    convert_to_messages,
    count_tokens_approximately,
)
from pydantic import BaseModel, Field

DEFAULT_CONTEXT_WINDOW = 1_000_000
DEFAULT_IMAGE_TOKENS = 1024
TOKEN_ESTIMATE_CHARS_PER_TOKEN = 2.0


class ContextSettings(BaseModel):
    """Resolved input window and compaction trigger for one selected model."""

    window: int = Field(gt=0)
    compact_ratio: float = Field(default=0.8, gt=0.2, lt=1)

    @classmethod
    def from_model(
        cls,
        model: BaseChatModel,
        *,
        window: int | None = None,
        compact_ratio: float = 0.8,
    ) -> Self:
        """Resolve an explicit window or fall back to the model's reported capacity."""
        profile = model.profile or {}

        if window is None:
            model_window = profile.get("max_input_tokens")

            if isinstance(model_window, int):
                window = model_window
            elif model.__class__.__module__.startswith("langchain_deepseek"):
                raise ValueError(
                    "Set max_input_tokens in models.yaml for an unknown model"
                )
            else:
                window = DEFAULT_CONTEXT_WINDOW

        return cls(
            window=window,
            compact_ratio=compact_ratio,
        )


def estimate_tokens(
    messages: Iterable[MessageLikeRepresentation],
    *,
    tokens_per_image: int = DEFAULT_IMAGE_TOKENS,
) -> int:
    """Estimate input history conservatively, including provider reasoning replay."""
    # A conservative character ratio also accommodates the playground's Chinese text.
    # Image pixels are charged by the provider; base64 length is not a token estimate.
    history = convert_to_messages(messages)
    tokens = count_tokens_approximately(
        history,
        chars_per_token=TOKEN_ESTIMATE_CHARS_PER_TOKEN,
        tokens_per_image=tokens_per_image,
    )

    # The library counter excludes additional_kwargs, while thinking tool calls
    # send reasoning_content back to the provider as part of the input history.
    for message in history:
        if not isinstance(message, AIMessage):
            continue

        reasoning = message.additional_kwargs.get("reasoning_content")

        if isinstance(reasoning, str):
            tokens += ceil(len(reasoning) / TOKEN_ESTIMATE_CHARS_PER_TOKEN)

    return tokens
