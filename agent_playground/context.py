"""Compact checkpoint model history without losing recoverable public responses."""

from collections.abc import Iterable
from dataclasses import dataclass
from typing import Any, cast, override

from langchain.agents.middleware import AgentState, SummarizationMiddleware
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

from agent_playground.context_state import (
    ContextBreakdown,
    ContextState,
    ContextUsage,
)
from agent_playground.models.tokens import (
    DEFAULT_IMAGE_TOKENS,
    TOKEN_ESTIMATE_CHARS_PER_TOKEN,
    ContextSettings,
    estimate_tokens,
)
from agent_playground.planning import planning_context

RETAINED_CONTEXT_RATIO = 0.2


@dataclass(frozen=True, kw_only=True)
class ContextMiddlewareOptions:
    """Group compaction models, prompt inputs and reserved token budgets."""

    model: BaseChatModel
    summary_model: BaseChatModel
    system_prompt: str
    tools: list[BaseTool]
    settings: ContextSettings | None = None
    tokens_per_image: int = DEFAULT_IMAGE_TOKENS
    memory_token_budget: int = 0
    planning_token_budget: int = 0


def recoverable_responses(state: ContextState) -> list[AIMessage | ToolMessage]:
    """Retain public replies independently of compacted model history."""
    messages = state["messages"]
    response_start = 0

    for index, message in enumerate(messages):
        if isinstance(message, HumanMessage):
            response_start = index + 1

    responses = list(state.get("response_messages", []))
    saved_ids = {message.id for message in responses if message.id is not None}

    # A checkpoint can contain replies already saved before a review or compaction.
    for message in messages[response_start:]:
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
    """Compact model history while preserving public replies and usage revisions."""

    state_schema = ContextState

    def __init__(self, options: ContextMiddlewareOptions) -> None:
        model = options.model
        self.settings = options.settings or ContextSettings.from_model(model)
        self.tokens_per_image = options.tokens_per_image
        self.model_name = str(getattr(model, "model_name", model.__class__.__name__))

        self.system_tokens = estimate_tokens(
            [SystemMessage(content=options.system_prompt)]
        )
        self.tool_tokens = count_tokens_approximately(
            [],
            tools=list(options.tools),
            chars_per_token=TOKEN_ESTIMATE_CHARS_PER_TOKEN,
        )

        self.trigger_tokens = int(self.settings.window * self.settings.compact_ratio)
        fixed_tokens = (
            self.system_tokens
            + self.tool_tokens
            + options.memory_token_budget
            + options.planning_token_budget
        )

        if fixed_tokens >= self.trigger_tokens:
            raise ValueError(
                "System prompt and tools exceed the configured context window budget"
            )

        # Suppress internal summary text in Aegra's legacy event stream as well.
        summary_model = options.summary_model
        quiet_summary_model = summary_model.model_copy(
            update={
                "metadata": {
                    **(summary_model.metadata or {}),
                    "emit-messages": False,
                    "emit-tool-calls": False,
                }
            }
        )

        retained_tokens = int(self.settings.window * RETAINED_CONTEXT_RATIO)
        super().__init__(
            model=quiet_summary_model,
            trigger=("tokens", self.trigger_tokens - fixed_tokens),
            keep=("tokens", max(1, retained_tokens - fixed_tokens)),
            token_counter=self._estimate_tokens,
            trim_tokens_to_summarize=None,
        )

    @override
    def before_agent(
        self, state: AgentState[Any], runtime: Runtime[Any]
    ) -> dict[str, Any]:
        """Start a fresh buffer for the run's public replies and tool results."""
        return {"response_messages": []}

    @override
    def before_model(
        self, state: AgentState[Any], runtime: Runtime[Any]
    ) -> dict[str, Any]:
        """Retain public replies before compaction can replace the model history."""
        context_state = cast("ContextState", state)
        responses = recoverable_responses(context_state)

        update = super().before_model(state, runtime)

        return {
            **self._context_update(context_state, update),
            "response_messages": responses,
        }

    @override
    async def abefore_model(
        self, state: AgentState[Any], runtime: Runtime[Any]
    ) -> dict[str, Any]:
        """Retain public replies before asynchronous compaction replaces history."""
        context_state = cast("ContextState", state)
        responses = recoverable_responses(context_state)

        update = await super().abefore_model(state, runtime)

        return {
            **self._context_update(context_state, update),
            "response_messages": responses,
        }

    @override
    def after_model(
        self, state: AgentState[Any], runtime: Runtime[Any]
    ) -> dict[str, Any]:
        """Checkpoint provider token usage and replies before a review can pause."""
        context_state = cast("ContextState", state)
        usage = self._usage(
            context_state, state["messages"], should_include_input_usage=True
        )

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
        should_include_input_usage: bool = False,
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

        system_tokens = self.system_tokens
        memory_context = state.get("memory_context")

        if memory_context:
            system_tokens += estimate_tokens([SystemMessage(content=memory_context)])

        plan = planning_context(state.get("todos", []))

        if plan:
            system_tokens += estimate_tokens([SystemMessage(content=plan)])

        breakdown: ContextBreakdown = {
            "system": system_tokens,
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

        if should_include_input_usage:
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
