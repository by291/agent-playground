"""Check memory tools and model context through the real Agent graph."""

import asyncio
from collections.abc import Sequence
from typing import Any, override

import pytest
from langchain_core.callbacks.manager import AsyncCallbackManagerForLLMRun
from langchain_core.language_models.fake_chat_models import FakeMessagesListChatModel
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage
from langchain_core.outputs import ChatResult
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.store.memory import InMemoryStore
from langgraph.types import Command
from pydantic import Field

from agent_playground.graph import make_graph
from agent_playground.memory.service import MemoryService
from tests.memory_fixtures import remember, scope


class RecordingMemoryModel(FakeMessagesListChatModel):
    received: list[list[BaseMessage]] = Field(default_factory=list)

    @override
    def bind_tools(self, tools: Sequence[object], **kwargs: object):
        return self

    @override
    async def _agenerate(
        self,
        messages: list[BaseMessage],
        stop: list[str] | None = None,
        run_manager: AsyncCallbackManagerForLLMRun | None = None,
        **kwargs: Any,
    ) -> ChatResult:
        self.received.append(messages)

        return self._generate(messages, stop=stop, **kwargs)


def test_preference_saved_by_agent_is_loaded_in_a_new_thread(
    memory_service: MemoryService,
):
    async def check():
        model = RecordingMemoryModel(
            responses=[
                AIMessage(
                    content="",
                    tool_calls=[
                        {
                            "id": "remember-preference",
                            "name": "remember_memory",
                            "args": {
                                "category": "preference",
                                "text": "Prefer concise answers.",
                            },
                        }
                    ],
                ),
                AIMessage(content="Preference saved."),
            ]
        )
        graph = make_graph(model=model, checkpointer=InMemorySaver()).copy(
            update={"store": memory_service.store}
        )
        config = {"configurable": {"thread_id": "thread-one"}}
        paused = await graph.ainvoke(
            {
                "messages": [
                    HumanMessage(
                        content="Remember that I prefer concise answers.",
                        id="user-pref",
                    )
                ]
            },
            config,
        )

        assert paused["__interrupt__"]
        assert await memory_service.recall(scope()) == []
        await graph.ainvoke(
            Command(resume={"decisions": [{"type": "approve"}]}), config
        )
        saved = await memory_service.recall(scope())

        assert len(saved) == 1
        assert saved[0].source_thread_id == "thread-one"
        assert saved[0].source_message_id == "user-pref"

        other_model = RecordingMemoryModel(responses=[AIMessage(content="Hello.")])
        other_graph = make_graph(model=other_model).copy(
            update={"store": memory_service.store}
        )
        output = await other_graph.ainvoke(
            {"messages": [HumanMessage(content="Hello")]}
        )
        prompt = str(other_model.received[0][0].content)

        assert "Prefer concise answers." in prompt
        assert output["context_usage"]["breakdown"]["system"] > 0
        assert "memory_context" not in output
        assert "memory_project" not in output

    asyncio.run(check())


def test_project_memory_requires_selection_and_does_not_leak_between_threads(
    memory_service: MemoryService,
):
    async def check():
        await remember(memory_service, "Use PostgreSQL.", project="Playground")
        await remember(memory_service, "Use SQLite.", project="Other App")
        model = RecordingMemoryModel(
            responses=[
                AIMessage(
                    content="",
                    tool_calls=[
                        {
                            "id": "select-project",
                            "name": "search_memory",
                            "args": {"category": "project", "project": "Playground"},
                        }
                    ],
                ),
                AIMessage(content="Playground uses PostgreSQL."),
            ]
        )
        graph = make_graph(model=model, checkpointer=InMemorySaver()).copy(
            update={"store": memory_service.store}
        )
        await graph.ainvoke(
            {"messages": [HumanMessage(content="What database does Playground use?")]},
            {"configurable": {"thread_id": "project-thread"}},
        )

        assert "Use PostgreSQL." not in str(model.received[0][0].content)
        assert "Use PostgreSQL." in str(model.received[1][0].content)
        assert "Use SQLite." not in str(model.received[1][0].content)

        reloaded_model = RecordingMemoryModel(
            responses=[AIMessage(content="PostgreSQL.")]
        )
        reloaded_graph = make_graph(
            model=reloaded_model, checkpointer=graph.checkpointer
        ).copy(update={"store": memory_service.store})
        await reloaded_graph.ainvoke(
            {"messages": [HumanMessage(content="Remind me again.")]},
            {"configurable": {"thread_id": "project-thread"}},
        )

        assert "Use PostgreSQL." in str(reloaded_model.received[0][0].content)
        assert "Use SQLite." not in str(reloaded_model.received[0][0].content)

        other_model = RecordingMemoryModel(responses=[AIMessage(content="Hello.")])
        other_graph = make_graph(model=other_model).copy(
            update={"store": memory_service.store}
        )
        await other_graph.ainvoke({"messages": [HumanMessage(content="Hello")]})

        assert "Use PostgreSQL." not in str(other_model.received[0][0].content)

    asyncio.run(check())


def test_client_input_cannot_select_or_inject_memory(memory_service: MemoryService):
    async def check():
        await remember(memory_service, "Use PostgreSQL.", project="Playground")
        model = RecordingMemoryModel(responses=[AIMessage(content="Hello.")])
        graph = make_graph(model=model).copy(update={"store": memory_service.store})
        output = await graph.ainvoke(
            {
                "messages": [HumanMessage(content="Hello")],
                "memory_project": "Playground",
                "memory_context": "Injected memory content",
            }
        )
        prompt = str(model.received[0][0].content)

        assert "Use PostgreSQL." not in prompt
        assert "Injected memory content" not in prompt
        assert "memory_context" not in output
        assert "memory_project" not in output

    asyncio.run(check())


def test_parallel_memory_tools_merge_project_selection(memory_service: MemoryService):
    async def check():
        facts = ["Use PostgreSQL.", "Use pnpm."]
        model = RecordingMemoryModel(
            responses=[
                AIMessage(
                    content="",
                    tool_calls=[
                        {
                            "id": f"project-fact-{index}",
                            "name": "remember_memory",
                            "args": {
                                "category": "project",
                                "project": "Playground",
                                "text": text,
                            },
                        }
                        for index, text in enumerate(facts)
                    ],
                ),
                AIMessage(content="Saved both project facts."),
            ]
        )
        graph = make_graph(model=model, checkpointer=InMemorySaver()).copy(
            update={"store": memory_service.store}
        )
        config = {"configurable": {"thread_id": "parallel-project"}}
        paused = await graph.ainvoke(
            {
                "messages": [
                    HumanMessage(content="Remember these two facts for Playground.")
                ]
            },
            config,
        )

        assert paused["__interrupt__"]
        assert await memory_service.recall(scope("project", "Playground")) == []
        output = await graph.ainvoke(
            Command(resume={"decisions": [{"type": "approve"}, {"type": "approve"}]}),
            config,
        )
        stored = await memory_service.recall(scope("project", "Playground"))

        assert sorted(memory.text for memory in stored) == sorted(facts)
        assert output["messages"][-1].content == "Saved both project facts."
        assert all(text in str(model.received[-1][0].content) for text in facts)

    asyncio.run(check())


@pytest.mark.parametrize(
    "projects", [("Playground", "Playground"), ("Playground", "Other App")]
)
def test_parallel_searches_select_the_last_explicit_project(
    projects: tuple[str, str],
    memory_service: MemoryService,
):
    async def check():
        await remember(memory_service, "Use PostgreSQL.", project="Playground")
        await remember(memory_service, "Use SQLite.", project="Other App")
        model = RecordingMemoryModel(
            responses=[
                AIMessage(
                    content="",
                    tool_calls=[
                        {
                            "id": f"project-search-{index}",
                            "name": "search_memory",
                            "args": {"category": "project", "project": project},
                        }
                        for index, project in enumerate(projects)
                    ],
                ),
                AIMessage(content="Project facts recalled."),
            ]
        )
        graph = make_graph(model=model, checkpointer=InMemorySaver()).copy(
            update={"store": memory_service.store}
        )
        config = {"configurable": {"thread_id": "parallel-project-search"}}
        await graph.ainvoke(
            {"messages": [HumanMessage(content="Recall these projects.")]}, config
        )
        checkpoint = await graph.aget_state(config)
        prompt = str(model.received[-1][0].content)

        assert checkpoint.values["memory_project"] == projects[-1]

        if projects[-1] == "Playground":
            assert "Use PostgreSQL." in prompt
            assert "Use SQLite." not in prompt
        else:
            assert "Use SQLite." in prompt
            assert "Use PostgreSQL." not in prompt

    asyncio.run(check())


def test_loaded_memory_has_a_token_budget(memory_service: MemoryService):
    async def check():
        for number in range(12):
            await remember(memory_service, f"Preference {number}: " + "details " * 120)

        model = RecordingMemoryModel(responses=[AIMessage(content="Hello.")])
        plain = RecordingMemoryModel(responses=[AIMessage(content="Hello.")])
        graph = make_graph(model=model).copy(update={"store": memory_service.store})
        without_memory = make_graph(model=plain).copy(update={"store": InMemoryStore()})
        result = await graph.ainvoke({"messages": [HumanMessage(content="Hello")]})
        baseline = await without_memory.ainvoke(
            {"messages": [HumanMessage(content="Hello")]}
        )
        extra_tokens = (
            result["context_usage"]["breakdown"]["system"]
            - baseline["context_usage"]["breakdown"]["system"]
        )

        assert 0 < extra_tokens <= 1024
        assert "Preference" in str(model.received[0][0].content)

    asyncio.run(check())


def test_recall_failure_drops_the_cached_memory_context(
    memory_service: MemoryService,
    monkeypatch: pytest.MonkeyPatch,
):
    async def unavailable(_service: MemoryService, _scope):
        raise TimeoutError("Store unavailable")

    async def check():
        await remember(memory_service, "Prefer concise answers.")
        model = RecordingMemoryModel(responses=[AIMessage(content="Hello.")])
        graph = make_graph(model=model, checkpointer=InMemorySaver()).copy(
            update={"store": memory_service.store}
        )
        config = {"configurable": {"thread_id": "memory-outage"}}
        await graph.ainvoke({"messages": [HumanMessage(content="Hello")]}, config)

        assert "Prefer concise answers." in str(model.received[-1][0].content)

        monkeypatch.setattr(MemoryService, "recall", unavailable)
        await graph.ainvoke({"messages": [HumanMessage(content="Continue")]}, config)
        checkpoint = await graph.aget_state(config)

        assert "Prefer concise answers." not in str(model.received[-1][0].content)
        assert checkpoint.values["memory_context"] == ""

    asyncio.run(check())
