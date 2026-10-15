"""Checkpoint state shared by planning, memory and context middleware."""

from typing import Annotated, Any, NotRequired, TypedDict

from langchain.agents.middleware.todo import PlanningState
from langchain.agents.middleware.types import OmitFromInput, PrivateStateAttr
from langchain_core.messages import AIMessage, ToolMessage


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


class ContextState(PlanningState[Any]):
    """Keep private recall/replies separate from client-writable conversation input."""

    memory_context: NotRequired[Annotated[str, OmitFromInput, PrivateStateAttr]]
    memory_project: NotRequired[
        Annotated[str, OmitFromInput, PrivateStateAttr, latest_memory_project]
    ]
    context_usage: NotRequired[Annotated[ContextUsage, OmitFromInput]]
    # Keep public replies and tool results recoverable across compaction and review.
    response_messages: NotRequired[
        Annotated[list[AIMessage | ToolMessage], PrivateStateAttr]
    ]
