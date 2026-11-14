"""Load bounded memory as transient model context, outside archived messages."""

import json
import logging
from collections.abc import Awaitable, Callable
from typing import Any, cast, override

from langchain.agents.middleware import (
    AgentMiddleware,
    AgentState,
    ModelRequest,
    ModelResponse,
)
from langchain_core.messages import SystemMessage
from langgraph.runtime import Runtime
from psycopg import Error as PostgresError

from agent_playground.context_state import ContextState
from agent_playground.memory.models import (
    MEMORY_TOKEN_BUDGET,
    MemoryScope,
    MemoryView,
    memory_namespace,
    memory_view,
)
from agent_playground.memory.service import MEMORY_RECALL_LIMIT, MemoryService
from agent_playground.models.tokens import estimate_tokens

logger = logging.getLogger(__name__)
RECALL_ERRORS = (
    PostgresError,
    ValueError,
    RuntimeError,
    TimeoutError,
)


def _recall_update(memories: list[MemoryView]) -> dict[str, str]:
    recent_memories = sorted(
        memories, key=lambda memory: memory.updated_at, reverse=True
    )

    return {"memory_context": memory_context(recent_memories)}


def memory_context(memories: list[MemoryView]) -> str:
    """Pack whole records into the recall budget without archiving model context."""
    selected: list[dict[str, object]] = []
    context = ""

    for memory in memories:
        item: dict[str, object] = {
            "id": memory.id,
            "category": memory.category,
            "project": memory.project,
            "text": memory.text,
            "revision": memory.revision,
        }

        candidate = (
            "\nSaved memory reference data (current instructions take priority):\n"
            + json.dumps([*selected, item], ensure_ascii=False)
        )

        exceeds_budget = (
            estimate_tokens([SystemMessage(content=candidate)]) > MEMORY_TOKEN_BUDGET
        )

        if exceeds_budget:
            # A smaller later record may still fit; never truncate a memory's content.
            continue

        selected.append(item)
        context = candidate

    return context


def memory_scopes(state: ContextState) -> list[MemoryScope]:
    """Include shared preferences and the explicitly selected project in recall."""
    project = state.get("memory_project")
    scopes = [MemoryScope(category="preference")]

    if project:
        scopes.append(MemoryScope(category="project", project=project))

    return scopes


class MemoryMiddleware(AgentMiddleware):
    state_schema = ContextState

    @override
    def before_model(
        self, state: AgentState[Any], runtime: Runtime[Any]
    ) -> dict[str, Any]:
        """Load scoped memory for a synchronous model call."""
        if runtime.store is None:
            return {"memory_context": ""}

        try:
            memories = []

            for scope in memory_scopes(cast("ContextState", state)):
                rows = runtime.store.search(
                    memory_namespace(scope),
                    filter={"content": {"$ne": None}},
                    limit=MEMORY_RECALL_LIMIT,
                )

                memories.extend(memory for row in rows if (memory := memory_view(row)))

            return _recall_update(memories)
        except RECALL_ERRORS:
            # Recall is optional; an unavailable Store must not block the turn.
            logger.warning("Memory recall unavailable for this model call")

            return {"memory_context": ""}

    @override
    async def abefore_model(
        self, state: AgentState[Any], runtime: Runtime[Any]
    ) -> dict[str, Any]:
        """Load scoped memory for an asynchronous model call."""
        if runtime.store is None:
            return {"memory_context": ""}

        try:
            service = MemoryService(runtime.store)
            memories: list[MemoryView] = []

            for scope in memory_scopes(cast("ContextState", state)):
                memories.extend(await service.recall(scope))

            return _recall_update(memories)
        except RECALL_ERRORS:
            # Match the synchronous path when the optional Store is unavailable.
            logger.warning("Memory recall unavailable for this model call")

            return {"memory_context": ""}

    def _request(self, request: ModelRequest) -> ModelRequest:
        context = request.state.get("memory_context", "")

        if not isinstance(context, str) or not context:
            return request

        system = request.system_message or SystemMessage(content="")

        if isinstance(system.content, str):
            content = system.content + context
        else:
            content = [*system.content, {"type": "text", "text": context}]

        return request.override(
            system_message=system.model_copy(update={"content": content})
        )

    @override
    def wrap_model_call(
        self,
        request: ModelRequest,
        handler: Callable[[ModelRequest], ModelResponse],
    ) -> ModelResponse:
        """Inject transient recall context into a synchronous request."""
        return handler(self._request(request))

    @override
    async def awrap_model_call(
        self,
        request: ModelRequest,
        handler: Callable[[ModelRequest], Awaitable[ModelResponse]],
    ) -> ModelResponse:
        """Inject transient recall context into an asynchronous request."""
        return await handler(self._request(request))
