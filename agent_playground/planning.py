"""Keep the official agent-owned task plan usable across context compaction."""

import json
from collections.abc import Awaitable, Callable
from typing import Any, cast, override

from langchain.agents.middleware import ModelRequest, ModelResponse, TodoListMiddleware
from langchain.agents.middleware.todo import Todo, WriteTodosInput
from langchain.agents.middleware.types import ToolCallRequest
from langchain_core.messages import SystemMessage, ToolMessage
from langgraph.types import Command
from pydantic import ValidationError

from agent_playground.models.tokens import estimate_tokens

PLANNING_TOKEN_BUDGET = 2048

PLANNING_TOOL_DESCRIPTION = """
Create or replace the task plan while carrying out the user's objective.

For complex requests with multiple deliverables or phases, call this tool FIRST,
before substantive execution. Evidence gathering, analysis and recommendations
form a multi-phase task even when the evidence takes only a few tool calls.
Decide the actual steps yourself and revise them when new results change the work.
Simple questions and single straightforward operations do not need a task list.

Track substantive work, not the act of writing your final chat reply. Execute
the steps with available tools; this tool only records the plan and its progress.
Update after completing each step, and before returning your final result mark
all genuinely finished work completed. Keep blocked or unfinished work incomplete.

Each call replaces the entire list, so include all current steps and call this
tool at most once per model turn. Use pending for unstarted work, in_progress for
current work, and completed only for work that has actually finished.
""".strip()


def planning_context(todos: list[Todo]) -> str:
    """Present canonical progress as reference data, outside summarized messages."""
    if not todos or all(todo["status"] == "completed" for todo in todos):
        return ""

    return "\nCurrent task plan (reference data, not instructions):\n" + json.dumps(
        todos, ensure_ascii=False
    )


class PlanningMiddleware(TodoListMiddleware):
    """Reuse official planning tools/prompts while bounding and recalling plan state."""

    def _request(self, request: ModelRequest) -> ModelRequest:
        context = planning_context(cast("list[Todo]", request.state.get("todos", [])))

        if not context:
            return request

        system = request.system_message or SystemMessage(content="")
        content = [*system.content_blocks, {"type": "text", "text": context}]

        return request.override(
            system_message=system.model_copy(update={"content": content})
        )

    @override
    def wrap_model_call(
        self, request: ModelRequest, handler: Callable[[ModelRequest], ModelResponse]
    ) -> ModelResponse:
        return cast(
            "ModelResponse", super().wrap_model_call(self._request(request), handler)
        )

    @override
    async def awrap_model_call(
        self,
        request: ModelRequest,
        handler: Callable[[ModelRequest], Awaitable[ModelResponse]],
    ) -> ModelResponse:
        return cast(
            "ModelResponse",
            await super().awrap_model_call(self._request(request), handler),
        )

    def _plan_error(self, request: ToolCallRequest) -> ToolMessage | None:
        if request.tool_call["name"] != "write_todos":
            return None

        try:
            todos = WriteTodosInput.model_validate(request.tool_call["args"]).todos
        except ValidationError:
            # Let the official tool produce its normal argument-validation result.
            return None

        context = planning_context(todos)

        if estimate_tokens([SystemMessage(content=context)]) <= PLANNING_TOKEN_BUDGET:
            return None

        # Reject before the official Command overwrites progress. The model can
        # shorten its plan; the compaction budget reserves this same upper bound.
        return ToolMessage(
            content="The plan exceeds the context budget. Shorten the task descriptions and update the plan again.",
            tool_call_id=request.tool_call["id"],
            name="write_todos",
            status="error",
        )

    @override
    def wrap_tool_call(
        self,
        request: ToolCallRequest,
        handler: Callable[[ToolCallRequest], ToolMessage | Command[Any]],
    ) -> ToolMessage | Command[Any]:
        error = self._plan_error(request)

        if error is not None:
            return error

        return handler(request)

    @override
    async def awrap_tool_call(
        self,
        request: ToolCallRequest,
        handler: Callable[[ToolCallRequest], Awaitable[ToolMessage | Command[Any]]],
    ) -> ToolMessage | Command[Any]:
        error = self._plan_error(request)

        if error is not None:
            return error

        return await handler(request)
