"""Report model context and delegate compaction to LangChain."""

from collections.abc import Iterable
from math import ceil
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
from langchain_core.messages.utils import (
    convert_to_messages,
    count_tokens_approximately,
)
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


def latest_memory_project(_previous: str, project: str) -> str:
    # Parallel memory commands merge in tool-call order. The last explicitly
    # named project becomes the conversation's automatic-recall scope.
    return project


class ContextState(AgentState[Any]):
    memory_context: NotRequired[Annotated[str, OmitFromInput, PrivateStateAttr]]
    memory_project: NotRequired[
        Annotated[str, OmitFromInput, PrivateStateAttr, latest_memory_project]
    ]
    context_usage: NotRequired[Annotated[ContextUsage, OmitFromInput]]
    # Keep public replies and tool results recoverable across compaction and review.
    response_messages: NotRequired[
        Annotated[list[AIMessage | ToolMessage], PrivateStateAttr]
    ]


class ContextSettings(BaseModel):
    window: int = Field(gt=0)
    compact_ratio: float = Field(default=0.8, gt=0.2, lt=1)

    @classmethod
    def from_model(
        cls,
        model: BaseChatModel,
        *,
        window: int | None = None,
        compact_ratio: float = 0.8,
    ):
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
                window = 1000000

        return cls(
            window=window,
            compact_ratio=compact_ratio,
        )


def estimate_tokens(
    messages: Iterable[MessageLikeRepresentation], *, tokens_per_image: int = 1024
) -> int:
    # A conservative character ratio also accommodates the playground's Chinese text.
    # Image pixels are charged by the provider; base64 length is not a token estimate.
    history = convert_to_messages(messages)
    tokens = count_tokens_approximately(
        history, chars_per_token=2.0, tokens_per_image=tokens_per_image
    )

    # The library counter excludes additional_kwargs, while thinking tool calls
    # send reasoning_content back to the provider as part of the input history.
    for message in history:
        if not isinstance(message, AIMessage):
            continue

        reasoning = message.additional_kwargs.get("reasoning_content")

        if isinstance(reasoning, str):
            tokens += ceil(len(reasoning) / 2.0)

    return tokens


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
        settings: ContextSettings | None = None,
        tokens_per_image: int = 1024,
        memory_token_budget: int = 0,
    ):
        self.settings = settings or ContextSettings.from_model(model)
        self.tokens_per_image = tokens_per_image
        self.model_name = str(getattr(model, "model_name", model.__class__.__name__))
        self.system_tokens = estimate_tokens([SystemMessage(content=system_prompt)])
        self.tool_tokens = count_tokens_approximately(
            [], tools=[*tools], chars_per_token=2.0
        )
        self.trigger_tokens = int(self.settings.window * self.settings.compact_ratio)
        fixed_tokens = self.system_tokens + self.tool_tokens + memory_token_budget

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
            token_counter=self._estimate_tokens,
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
        usage = self._usage(context_state, state["messages"], include_input_usage=True)
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

    def _estimate_tokens(self, messages: Iterable[MessageLikeRepresentation]) -> int:
        return estimate_tokens(messages, tokens_per_image=self.tokens_per_image)

    def _usage(
        self,
        state: ContextState,
        messages: list[AnyMessage],
        *,
        include_input_usage: bool = False,
    ) -> ContextUsage:
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
            "system": self.system_tokens
            + estimate_tokens([SystemMessage(content=state["memory_context"])])
            if state.get("memory_context")
            else self.system_tokens,
            "tools": self.tool_tokens,
            "conversation": self._estimate_tokens(conversation),
            "toolResults": self._estimate_tokens(results),
            "summary": self._estimate_tokens(summaries),
        }
        previous = state.get("context_usage")
        last_input = (
            previous["lastInputTokens"]
            if previous and previous["model"] == self.model_name
            else None
        )

        if include_input_usage:
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
