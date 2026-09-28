"""A deterministic model for testing the real Aegra worker and HTTP adapters."""

import asyncio
from collections.abc import AsyncIterator, Sequence
from contextlib import asynccontextmanager
from typing import Any, override
from uuid import uuid4

from langchain_core.callbacks.manager import (
    AsyncCallbackManagerForLLMRun,
    CallbackManagerForLLMRun,
)
from langchain_core.language_models import BaseChatModel
from langchain_core.messages import AIMessage, AIMessageChunk, BaseMessage, ToolMessage
from langchain_core.outputs import ChatGeneration, ChatGenerationChunk, ChatResult
from langchain_core.runnables import RunnableConfig
from langgraph_sdk.runtime import ServerRuntime

from agent_playground.graph import make_graph
from agent_playground.observability import execution_trace
from agent_playground.workflow_outputs import prepare_output_store


class TraceModel(BaseChatModel):
    @property
    @override
    def _llm_type(self) -> str:
        return "controlled-trace-model"

    @override
    def bind_tools(self, tools: Sequence[object], **kwargs: Any):
        return self

    @override
    def _generate(
        self,
        messages: list[BaseMessage],
        stop: list[str] | None = None,
        run_manager: CallbackManagerForLLMRun | None = None,
        **kwargs: Any,
    ) -> ChatResult:
        if isinstance(messages[-1], ToolMessage):
            message = AIMessage(content="The clock was checked.")
        else:
            message = AIMessage(
                content="",
                tool_calls=[
                    {"id": str(uuid4()), "name": "get_current_time", "args": {}}
                ],
            )
        return ChatResult(generations=[ChatGeneration(message=message)])

    @override
    async def _agenerate(
        self,
        messages: list[BaseMessage],
        stop: list[str] | None = None,
        run_manager: AsyncCallbackManagerForLLMRun | None = None,
        **kwargs: Any,
    ) -> ChatResult:
        await asyncio.sleep(0.15)
        return self._generate(messages)

    @override
    async def _astream(
        self,
        messages: list[BaseMessage],
        stop: list[str] | None = None,
        run_manager: AsyncCallbackManagerForLLMRun | None = None,
        **kwargs: Any,
    ) -> AsyncIterator[ChatGenerationChunk]:
        await asyncio.sleep(0.15)
        if isinstance(messages[-1], ToolMessage):
            for text in ["The clock ", "was checked."]:
                yield ChatGenerationChunk(message=AIMessageChunk(content=text))
        else:
            call_id = str(uuid4())
            yield ChatGenerationChunk(
                message=AIMessageChunk(
                    content="",
                    tool_call_chunks=[
                        {
                            "id": call_id,
                            "name": "get_current_time",
                            "args": "",
                            "index": 0,
                        }
                    ],
                )
            )
            yield ChatGenerationChunk(
                message=AIMessageChunk(
                    content="",
                    tool_call_chunks=[
                        {"id": None, "name": None, "args": "{}", "index": 0}
                    ],
                )
            )


@asynccontextmanager
async def graph(config: RunnableConfig, runtime: ServerRuntime[dict[str, object]]):
    prepare_output_store()
    if runtime.execution_runtime is None:
        yield make_graph(model=TraceModel())
        return
    with execution_trace(config):
        yield make_graph(model=TraceModel())
