"""Report model context and delegate compaction to LangChain."""

import os
from collections.abc import Iterable
from typing import Annotated, Any, NotRequired, TypedDict, cast, override

from langchain.agents.middleware import AgentState, SummarizationMiddleware
from langchain.agents.middleware.types import OmitFromInput, PrivateStateAttr
from langchain_core.language_models import BaseChatModel
from langchain_core.messages import (
    AIMessage,
    AnyMessage,
    HumanMessage,
    MessageLikeRepresentation,
    SystemMessage,
    ToolMessage,
)
from langchain_core.messages.utils import count_tokens_approximately
from langchain_core.tools import BaseTool
from langgraph.runtime import Runtime
from pydantic import BaseModel, Field


class ContextBreakdown(TypedDict):
    system: int
    tools: int
    conversation: int
    toolResults: int
    summary: int


class CompactionUsage(TypedDict):
    beforeTokens: int
    afterTokens: int


class ContextUsage(TypedDict):
    model: str
    usedTokens: int
    contextWindow: int
    triggerTokens: int
    breakdown: ContextBreakdown
    lastInputTokens: int | None
    compactions: int
    lastCompaction: CompactionUsage | None
    revision: int


class ContextState(AgentState[Any]):
    context_usage: NotRequired[Annotated[ContextUsage, OmitFromInput]]
    # Keep public replies and tool results recoverable across compaction and review.
    response_messages: NotRequired[
        Annotated[list[AIMessage | ToolMessage], PrivateStateAttr]
    ]


class ContextSettings(BaseModel):
    window: int = Field(gt=0)
    compact_ratio: float = Field(default=0.8, gt=0.2, lt=1)

    @classmethod
    def from_model(cls, model: BaseChatModel):
        profile = model.profile or {}
        window = os.getenv("CONTEXT_WINDOW_TOKENS")

        if window is None:
            model_window = profile.get("max_input_tokens")

            if isinstance(model_window, int):
                window = str(model_window)
            elif model.__class__.__module__.startswith("langchain_deepseek"):
                raise ValueError("Set CONTEXT_WINDOW_TOKENS for an unknown model")
            else:
                window = "1000000"

        return cls(
            window=int(window),
            compact_ratio=float(os.getenv("CONTEXT_COMPACT_RATIO", "0.8")),
        )


def estimate_tokens(messages: Iterable[MessageLikeRepresentation]) -> int:
    # A conservative character ratio also accommodates the playground's Chinese text.
    # DeepSeek caps each resized image at 1,024 tokens; base64 length is not tokens.
    return count_tokens_approximately(
        messages, chars_per_token=2.0, tokens_per_image=1024
    )


def recoverable_responses(state: ContextState) -> list[AIMessage | ToolMessage]:
    messages = state["messages"]
    start = 0

    for index, message in enumerate(messages):
        if isinstance(message, HumanMessage):
            start = index + 1

    responses = list(state.get("response_messages", []))
    saved_ids = {message.id for message in responses if message.id is not None}

    for message in messages[start:]:
        if not isinstance(message, (AIMessage, ToolMessage)):
            continue

        if message.additional_kwargs.get("lc_source") == "summarization":
            continue

        if message.id is not None and message.id in saved_ids:
            continue

        responses.append(message)

        if message.id is not None:
            saved_ids.add(message.id)

    return responses


class ContextMiddleware(SummarizationMiddleware):
    state_schema = ContextState

    def __init__(
        self,
        model: BaseChatModel,
        summary_model: BaseChatModel,
        system_prompt: str,
        tools: list[BaseTool],
    ):
        self.settings = ContextSettings.from_model(model)
        self.model_name = str(getattr(model, "model_name", model.__class__.__name__))
        self.system_tokens = estimate_tokens([SystemMessage(content=system_prompt)])
        self.tool_tokens = count_tokens_approximately(
            [], tools=[*tools], chars_per_token=2.0
        )
        self.trigger_tokens = int(self.settings.window * self.settings.compact_ratio)
        fixed_tokens = self.system_tokens + self.tool_tokens

        if fixed_tokens >= self.trigger_tokens:
            raise ValueError(
                "System prompt and tools exceed the configured context window budget"
            )

        # Suppress internal summary text in Aegra's legacy event stream as well.
        summary_model = summary_model.model_copy(
            update={
                "metadata": {
                    **(summary_model.metadata or {}),
                    "emit-messages": False,
                    "emit-tool-calls": False,
                }
            }
        )

        super().__init__(
            model=summary_model,
            trigger=("tokens", self.trigger_tokens - fixed_tokens),
            keep=("tokens", max(1, int(self.settings.window * 0.2) - fixed_tokens)),
            token_counter=estimate_tokens,
            trim_tokens_to_summarize=None,
        )

    @override
    def before_agent(
        self, state: AgentState[Any], runtime: Runtime[Any]
    ) -> dict[str, Any]:
        return {"response_messages": []}

    @override
    def before_model(
        self, state: AgentState[Any], runtime: Runtime[Any]
    ) -> dict[str, Any]:
        responses = recoverable_responses(cast("ContextState", state))
        update = super().before_model(state, runtime)

        return {
            **self._context_update(cast("ContextState", state), update),
            "response_messages": responses,
        }

    @override
    async def abefore_model(
        self, state: AgentState[Any], runtime: Runtime[Any]
    ) -> dict[str, Any]:
        responses = recoverable_responses(cast("ContextState", state))
        update = await super().abefore_model(state, runtime)

        return {
            **self._context_update(cast("ContextState", state), update),
            "response_messages": responses,
        }

    @override
    def after_model(
        self, state: AgentState[Any], runtime: Runtime[Any]
    ) -> dict[str, Any]:
        context_state = cast("ContextState", state)
        usage = self._usage(context_state, state["messages"])
        return {
            "context_usage": usage,
            "response_messages": recoverable_responses(context_state),
        }

    def _context_update(
        self, state: ContextState, update: dict[str, Any] | None
    ) -> dict[str, Any]:
        previous_messages = state["messages"]
        messages = previous_messages

        if update is not None:
            # LangChain returns REMOVE_ALL_MESSAGES followed by the replacement history.
            messages = cast("list[AnyMessage]", update["messages"][1:])

        usage = self._usage(state, messages)

        if update is not None:
            usage["compactions"] += 1
            usage["lastCompaction"] = {
                "beforeTokens": self._usage(state, previous_messages)["usedTokens"],
                "afterTokens": usage["usedTokens"],
            }

        if usage["usedTokens"] >= self.settings.window:
            raise ValueError(
                "The latest messages exceed the configured context window after compaction"
            )

        return {**(update or {}), "context_usage": usage}

    def _usage(self, state: ContextState, messages: list[AnyMessage]) -> ContextUsage:
        conversation: list[AnyMessage] = []
        results: list[AnyMessage] = []
        summaries: list[AnyMessage] = []

        for message in messages:
            if message.additional_kwargs.get("lc_source") == "summarization":
                summaries.append(message)
            elif isinstance(message, ToolMessage):
                results.append(message)
            else:
                conversation.append(message)

        breakdown: ContextBreakdown = {
            "system": self.system_tokens,
            "tools": self.tool_tokens,
            "conversation": estimate_tokens(conversation),
            "toolResults": estimate_tokens(results),
            "summary": estimate_tokens(summaries),
        }
        previous = state.get("context_usage")
        last_input = previous["lastInputTokens"] if previous else None

        for message in reversed(messages):
            if isinstance(message, AIMessage) and message.usage_metadata:
                last_input = message.usage_metadata["input_tokens"]
                break

        return {
            "model": self.model_name,
            "usedTokens": sum(cast("dict[str, int]", breakdown).values()),
            "contextWindow": self.settings.window,
            "triggerTokens": self.trigger_tokens,
            "breakdown": breakdown,
            "lastInputTokens": last_input,
            "compactions": previous["compactions"] if previous else 0,
            "lastCompaction": previous["lastCompaction"] if previous else None,
            "revision": previous["revision"] + 1 if previous else 1,
        }
