"""Exercise official A2A clients against independent HTTP agent servers."""

import asyncio
import socket
import threading
import time
from collections.abc import AsyncGenerator, AsyncIterator, Iterator
from contextlib import contextmanager
from typing import cast, override

import httpx
import pytest
import uvicorn
from a2a.client import Client, ClientConfig, create_client
from a2a.server.agent_execution import RequestContext
from a2a.server.agent_execution.active_task import ActiveTask
from a2a.server.agent_execution.active_task_registry import ActiveTaskRegistry
from a2a.server.context import ServerCallContext
from a2a.server.events import Event
from a2a.server.events.event_queue_v2 import EventQueue, EventQueueSink
from a2a.server.tasks import TaskUpdater
from a2a.types import (
    Artifact,
    CancelTaskRequest,
    GetTaskRequest,
    ListTasksRequest,
    Message,
    Part,
    Role,
    SendMessageRequest,
    StreamResponse,
    SubscribeToTaskRequest,
    Task,
    TaskArtifactUpdateEvent,
    TaskState,
    TaskStatus,
)
from a2a.utils.errors import TaskNotCancelableError, TaskNotFoundError
from langchain_core.messages import AIMessageChunk, BaseMessage

from agent_playground.db.a2a_tasks import PostgresTaskStore
from agent_playground.db.connection import close_app_store, prepare_app_store
from agent_playground.services.a2a.agent import DemoAgentExecutor
from agent_playground.services.a2a.protocol import AgentRole, remote_task_id
from agent_playground.services.a2a.server import DurableRequestHandler, create_a2a_app


@pytest.fixture
def durable_store(
    postgres_database_url: str, monkeypatch: pytest.MonkeyPatch
) -> Iterator[PostgresTaskStore]:
    close_app_store()
    monkeypatch.setenv("APP_DATABASE_URL", postgres_database_url)
    monkeypatch.setenv("A2A_DEMO_MODE", "scripted")
    prepare_app_store()

    try:
        yield PostgresTaskStore("planner")
    finally:
        close_app_store()


@contextmanager
def running_server(
    store: PostgresTaskStore, executor: DemoAgentExecutor | None = None
) -> Iterator[str]:
    listener = socket.socket()
    listener.bind(("127.0.0.1", 0))
    url = f"http://127.0.0.1:{listener.getsockname()[1]}"
    app = create_a2a_app(store.role, url, task_store=store, executor=executor)
    server = uvicorn.Server(
        uvicorn.Config(app, log_level="error", timeout_graceful_shutdown=3)
    )
    thread = threading.Thread(target=server.run, kwargs={"sockets": [listener]})
    thread.start()
    deadline = time.monotonic() + 10

    while not server.started and thread.is_alive() and time.monotonic() < deadline:
        time.sleep(0.01)

    assert server.started

    try:
        yield url
    finally:
        server.should_exit = True
        thread.join(timeout=15)
        listener.close()
        assert not thread.is_alive(), "A2A shutdown must drain SDK workers"


def request(
    message_id: str,
    text: str,
    *,
    task_id: str = "",
    context_id: str = "",
    metadata: dict[str, bool] | None = None,
) -> SendMessageRequest:
    return SendMessageRequest(
        message=Message(
            message_id=message_id,
            role=Role.ROLE_USER,
            parts=[Part(text=text)],
            task_id=task_id,
            context_id=context_id,
        ),
        metadata=metadata,
    )


def task_text(task: Task) -> str:
    return "".join(part.text for artifact in task.artifacts for part in artifact.parts)


async def client_for(url: str, http: httpx.AsyncClient) -> Client:
    return await create_client(
        url,
        client_config=ClientConfig(
            httpx_client=http, supported_protocol_bindings=["JSONRPC"]
        ),
    )


@pytest.mark.parametrize("role", ["planner", "reviewer"])
def test_official_http_stream_and_terminal_replay(
    durable_store: PostgresTaskStore, role: AgentRole
) -> None:
    store = PostgresTaskStore(role)

    async def verify(url: str) -> None:
        async with httpx.AsyncClient(timeout=10) as http:
            card_response = await http.get(f"{url}/.well-known/agent-card.json")
            assert card_response.status_code == 200
            assert card_response.json()["capabilities"]["streaming"]
            client = await client_for(url, http)
            events = [
                event
                async for event in client.send_message(
                    request("first", "Plan a team workshop")
                )
            ]
            assert events[0].HasField("task")
            chunks = [
                event.artifact_update
                for event in events
                if event.HasField("artifact_update")
            ]
            assert len(chunks) > 3
            assert not chunks[0].append
            assert all(chunk.append for chunk in chunks[1:])
            assert chunks[-1].last_chunk
            task = await client.get_task(GetTaskRequest(id=remote_task_id("first")))
            assert task.status.state == TaskState.TASK_STATE_COMPLETED
            assert task_text(task)
            replay = [
                event
                async for event in client.send_message(
                    request("first", "Plan a team workshop")
                )
            ]
            assert len(replay) == 1
            assert replay[0].task == task

            with pytest.raises(TaskNotFoundError):
                await client.get_task(GetTaskRequest(id="missing-task"))

            with pytest.raises(TaskNotCancelableError):
                await client.cancel_task(CancelTaskRequest(id=task.id))

            page = await client.list_tasks(
                ListTasksRequest(page_size=1, history_length=1)
            )
            assert page.total_size == 1
            assert len(page.tasks[0].history) == 1
            assert not page.tasks[0].artifacts

    with running_server(store) as url:
        asyncio.run(verify(url))


def test_clarification_resumes_same_task_and_preserves_history(
    durable_store: PostgresTaskStore,
) -> None:
    async def verify(url: str) -> None:
        async with httpx.AsyncClient(timeout=10) as http:
            client = await client_for(url, http)
            initial = request(
                "clarify", "Plan a workshop", metadata={"requireInput": True}
            )
            events = [event async for event in client.send_message(initial)]
            assert (
                events[-1].status_update.status.state
                == TaskState.TASK_STATE_INPUT_REQUIRED
            )
            task = await client.get_task(GetTaskRequest(id=remote_task_id("clarify")))
            assert "audience" in task.status.message.parts[0].text.lower()
            replay = [
                event
                async for event in client.send_message(
                    request(
                        "clarify", "Plan a workshop", metadata={"requireInput": True}
                    )
                )
            ]
            assert len(replay) == 1
            assert replay[0].task.status.state == TaskState.TASK_STATE_INPUT_REQUIRED
            followup = request(
                "answer",
                "The audience is new engineers",
                task_id=task.id,
                context_id=task.context_id,
            )
            _ = [event async for event in client.send_message(followup)]
            completed = await client.get_task(GetTaskRequest(id=task.id))
            assert completed.context_id == task.context_id
            assert completed.status.state == TaskState.TASK_STATE_COMPLETED
            assert {"clarify", "answer"}.issubset(
                {message.message_id for message in completed.history}
            )
            assert "new engineers" in task_text(completed)

    with running_server(durable_store) as url:
        asyncio.run(verify(url))


def test_active_duplicate_subscribes_without_second_execution(
    durable_store: PostgresTaskStore,
) -> None:
    class CountingExecutor(DemoAgentExecutor):
        calls = 0

        @override
        async def execute(
            self, context: RequestContext, event_queue: EventQueue
        ) -> None:
            self.calls += 1
            await super().execute(context, event_queue)

    executor = CountingExecutor("planner", mode="scripted", chunk_delay=0.04)

    async def verify(url: str) -> None:
        async with httpx.AsyncClient(timeout=10) as http:
            client = await client_for(url, http)
            stream = client.send_message(request("duplicate", "Plan a workshop"))
            assert (await anext(stream)).HasField("task")

            async def finish():
                return [event async for event in stream]

            original, duplicate = await asyncio.gather(
                finish(),
                collect(client.send_message(request("duplicate", "Plan a workshop"))),
            )
            assert original and duplicate
            assert executor.calls == 1
            task = await client.get_task(GetTaskRequest(id=remote_task_id("duplicate")))
            assert task.status.state == TaskState.TASK_STATE_COMPLETED

    with running_server(durable_store, executor) as url:
        asyncio.run(verify(url))


async def collect(stream: AsyncIterator[StreamResponse]) -> list[StreamResponse]:
    return [event async for event in stream]


def test_cancel_stops_generation_promptly_and_remains_terminal(
    durable_store: PostgresTaskStore,
    caplog: pytest.LogCaptureFixture,
) -> None:
    executor = DemoAgentExecutor("planner", mode="scripted", chunk_delay=0.2)

    async def verify(url: str) -> None:
        async with httpx.AsyncClient(timeout=10) as http:
            client = await client_for(url, http)
            stream = client.send_message(request("cancel", "Plan a workshop"))
            await anext(stream)
            cancelled = await asyncio.wait_for(
                client.cancel_task(CancelTaskRequest(id=remote_task_id("cancel"))),
                timeout=2,
            )
            assert cancelled.status.state == TaskState.TASK_STATE_CANCELED
            await cast(AsyncGenerator[StreamResponse, None], stream).aclose()
            await asyncio.sleep(0.25)
            task = await client.get_task(GetTaskRequest(id=cancelled.id))
            assert task == cancelled
            assert not executor.active_task_ids

    with running_server(durable_store, executor) as url:
        asyncio.run(verify(url))

    assert "timeout graceful shutdown exceeded" not in caplog.text


def test_restart_recovers_unfinished_task_and_replaces_partial_artifact(
    durable_store: PostgresTaskStore,
) -> None:
    context = ServerCallContext()
    initial_request = request("restart", "Plan a team workshop")
    task = asyncio.run(durable_store.reserve_request(initial_request, context))
    task.status.state = TaskState.TASK_STATE_WORKING
    task.artifacts.append(
        Artifact(
            artifact_id=f"{task.id}:output",
            parts=[Part(text="obsolete partial content")],
        )
    )
    asyncio.run(durable_store.save(task, context))

    async def verify(url: str) -> None:
        async with httpx.AsyncClient(timeout=10) as http:
            client = await client_for(url, http)
            _ = [
                event
                async for event in client.send_message(
                    request("restart", "Plan a team workshop")
                )
            ]
            completed = await client.get_task(GetTaskRequest(id=task.id))
            assert completed.status.state == TaskState.TASK_STATE_COMPLETED
            assert completed.context_id == task.context_id
            assert len(completed.artifacts) == 1
            assert completed.artifacts[0].artifact_id == f"{task.id}:output"
            assert "obsolete" not in task_text(completed)

    with running_server(PostgresTaskStore("planner")) as url:
        asyncio.run(verify(url))


def test_store_role_scope_terminal_immutability_and_pagination(
    durable_store: PostgresTaskStore,
) -> None:
    async def verify():
        context = ServerCallContext()

        for task_id in ["a", "b", "c"]:
            await durable_store.save(
                Task(
                    id=task_id,
                    context_id="context",
                    status=TaskStatus(state=TaskState.TASK_STATE_COMPLETED),
                ),
                context,
            )

        await durable_store.save(
            Task(
                id="a",
                context_id="context",
                status=TaskStatus(state=TaskState.TASK_STATE_WORKING),
            ),
            context,
        )
        terminal_task = await durable_store.get("a", context)
        assert terminal_task is not None
        assert terminal_task.status.state == TaskState.TASK_STATE_COMPLETED
        assert await PostgresTaskStore("reviewer").get("a", context) is None
        first = await durable_store.list(ListTasksRequest(page_size=2), context)
        second = await durable_store.list(
            ListTasksRequest(page_size=2, page_token=first.next_page_token), context
        )
        assert first.total_size == 3
        assert len(first.tasks) == 2
        assert len(second.tasks) == 1
        assert {task.id for task in [*first.tasks, *second.tasks]} == {"a", "b", "c"}

    asyncio.run(verify())


def test_message_id_reuse_with_different_input_and_terminal_followup_rejected(
    durable_store: PostgresTaskStore,
) -> None:
    async def verify(url: str) -> None:
        async with httpx.AsyncClient(timeout=10) as http:
            client = await client_for(url, http)
            _ = [
                event
                async for event in client.send_message(
                    request("stable", "Plan a workshop")
                )
            ]

            with pytest.raises(Exception, match="different input"):
                _ = [
                    event
                    async for event in client.send_message(
                        request("stable", "Changed request")
                    )
                ]

            with pytest.raises(Exception, match="terminal"):
                _ = [
                    event
                    async for event in client.send_message(
                        request(
                            "novel", "Reopen task", task_id=remote_task_id("stable")
                        )
                    )
                ]

    with running_server(durable_store) as url:
        asyncio.run(verify(url))


def test_disconnected_http_stream_continues_and_retry_subscribes(
    durable_store: PostgresTaskStore,
) -> None:
    executor = DemoAgentExecutor("planner", mode="scripted", chunk_delay=0.06)

    async def verify(url: str) -> None:
        async with httpx.AsyncClient(timeout=10) as http:
            client = await client_for(url, http)
            stream = client.send_message(request("disconnect", "Plan a workshop"))

            for _ in range(3):
                await anext(stream)

            await cast(AsyncGenerator[StreamResponse, None], stream).aclose()
            _ = [
                event
                async for event in client.send_message(
                    request("disconnect", "Plan a workshop")
                )
            ]
            task = await client.get_task(
                GetTaskRequest(id=remote_task_id("disconnect"))
            )
            assert task.status.state == TaskState.TASK_STATE_COMPLETED
            assert len(task.artifacts) == 1
            assert task_text(task).count("## Practical plan") == 1

    with running_server(durable_store, executor) as url:
        asyncio.run(verify(url))


def test_configured_model_chunks_are_coalesced_and_stream_is_closed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    model_arguments: dict[str, object] = {}
    closed = False

    class StreamingModel:
        def __init__(self, **kwargs: object) -> None:
            model_arguments.update(kwargs)

        async def astream(
            self, messages: list[BaseMessage]
        ) -> AsyncGenerator[AIMessageChunk, None]:
            nonlocal closed

            try:
                for _ in range(45):
                    await asyncio.sleep(0.01)
                    yield AIMessageChunk(content="word ")
            finally:
                closed = True

    monkeypatch.setenv("DEEPSEEK_MODEL", "configured-model")
    monkeypatch.setattr(
        "agent_playground.services.a2a.agent.ChatDeepSeek", StreamingModel
    )
    executor = DemoAgentExecutor("planner", mode="model")

    async def verify() -> None:
        chunks = [chunk async for chunk in executor._stream_text("Plan a workshop")]
        assert "".join(chunks) == "word " * 45
        assert 2 < len(chunks) < 10
        assert model_arguments["model"] == "configured-model"
        assert model_arguments["extra_body"] == {"thinking": {"type": "disabled"}}
        assert closed

    asyncio.run(verify())


def test_planner_drafts_until_actual_reviewer_feedback_is_supplied() -> None:
    async def verify() -> None:
        planner = DemoAgentExecutor("planner", mode="scripted", chunk_delay=0)
        draft = "".join(
            [
                chunk
                async for chunk in planner._stream_text(
                    "Plan a workshop about peer review and feedback"
                )
            ]
        )
        assert draft.startswith("## Practical plan")
        assert "Review response:" not in draft
        assert "Revised plan" not in draft
        revision = "".join(
            [
                chunk
                async for chunk in planner._stream_text(
                    "Stage: Revise\nUpdate the proposal.\nReviewer feedback:\nName a backup facilitator."
                )
            ]
        )
        assert revision.startswith("## Revised plan")
        assert "Revision notes:" in revision

    asyncio.run(verify())


@pytest.mark.parametrize(
    ("prompt", "revision"),
    [
        (
            "Original proposal:\nA workshop draft.\n\nRevise it using this review:\nName a backup facilitator.",
            True,
        ),
        (
            "Original proposal:\nA workshop draft.\n\nRevise it using this review:\n   \n",
            False,
        ),
        ("Original proposal:\nPlan a peer review and feedback workshop.", False),
        (
            "Plan a workshop.\n\nRevise it using this review:\nExplain peer feedback.",
            False,
        ),
    ],
)
def test_scripted_planner_recognizes_only_complete_legacy_revision_envelope(
    prompt: str, revision: bool
) -> None:
    async def generate() -> str:
        planner = DemoAgentExecutor("planner", mode="scripted", chunk_delay=0)

        return "".join([chunk async for chunk in planner._stream_text(prompt)])

    result = asyncio.run(generate())

    if revision:
        assert result.startswith("## Revised plan")
        assert "Revision notes:" in result
        assert "Handoff:" not in result
    else:
        assert result.startswith("## Practical plan")
        assert "Handoff:" in result
        assert "Revision notes:" not in result


def test_restart_resumes_answer_reserved_before_generation(
    durable_store: PostgresTaskStore,
) -> None:
    async def clarify(url: str) -> Task:
        async with httpx.AsyncClient(timeout=10) as http:
            client = await client_for(url, http)
            _ = [
                event
                async for event in client.send_message(
                    request(
                        "pending-question",
                        "Plan a workshop",
                        metadata={"requireInput": True},
                    )
                )
            ]

            return await client.get_task(
                GetTaskRequest(id=remote_task_id("pending-question"))
            )

    with running_server(durable_store) as url:
        task = asyncio.run(clarify(url))

    answer = request(
        "pending-answer",
        "The audience is new engineers",
        task_id=task.id,
        context_id=task.context_id,
    )
    reserved = asyncio.run(durable_store.reserve_request(answer, ServerCallContext()))
    assert reserved.status.state == TaskState.TASK_STATE_SUBMITTED

    async def resume(url: str) -> None:
        async with httpx.AsyncClient(timeout=10) as http:
            client = await client_for(url, http)
            _ = [event async for event in client.send_message(answer)]
            completed = await client.get_task(GetTaskRequest(id=task.id))
            assert completed.status.state == TaskState.TASK_STATE_COMPLETED
            assert "new engineers" in task_text(completed)

    with running_server(PostgresTaskStore("planner")) as url:
        asyncio.run(resume(url))


def test_retry_replays_when_completion_races_with_subscription(
    durable_store: PostgresTaskStore, monkeypatch: pytest.MonkeyPatch
) -> None:
    original_get = ActiveTaskRegistry.get

    async def delay_existing_task(
        registry: ActiveTaskRegistry, task_id: str
    ) -> ActiveTask | None:
        active = await original_get(registry, task_id)

        if active is not None:
            await asyncio.sleep(0.8)

        return active

    monkeypatch.setattr(ActiveTaskRegistry, "get", delay_existing_task)

    async def verify(url: str) -> None:
        async with httpx.AsyncClient(timeout=10) as http:
            client = await client_for(url, http)
            original = client.send_message(
                request("completion-race", "Plan a workshop")
            )
            await anext(original)
            _ = await asyncio.gather(
                collect(original),
                collect(
                    client.send_message(request("completion-race", "Plan a workshop"))
                ),
            )
            completed = await client.get_task(
                GetTaskRequest(id=remote_task_id("completion-race"))
            )
            assert completed.status.state == TaskState.TASK_STATE_COMPLETED
            assert len(completed.artifacts) == 1

    with running_server(durable_store) as url:
        asyncio.run(verify(url))


@pytest.mark.parametrize("reconnect_method", ["send", "subscribe"])
def test_reconnect_snapshot_does_not_duplicate_queued_artifact_delta(
    durable_store: PostgresTaskStore,
    monkeypatch: pytest.MonkeyPatch,
    reconnect_method: str,
) -> None:
    async def verify() -> None:
        produce = asyncio.Event()
        finish = asyncio.Event()
        blocked = asyncio.Event()
        release = asyncio.Event()

        class GatedExecutor(DemoAgentExecutor):
            @override
            async def execute(
                self, context: RequestContext, event_queue: EventQueue
            ) -> None:
                assert context.task_id is not None and context.context_id is not None
                updater = TaskUpdater(event_queue, context.task_id, context.context_id)
                await updater.start_work()
                await produce.wait()
                await updater.add_artifact(
                    [Part(text="A")], artifact_id="output", append=False
                )
                await updater.add_artifact(
                    [Part(text="B")], artifact_id="output", append=True
                )
                await finish.wait()
                await updater.add_artifact(
                    [Part(text="C")], artifact_id="output", append=True, last_chunk=True
                )
                await updater.complete()

        app = create_a2a_app(
            "planner",
            "http://unused",
            task_store=durable_store,
            executor=GatedExecutor("planner", mode="scripted"),
        )
        handler = cast(DurableRequestHandler, app.state.a2a_handler)
        context = ServerCallContext()
        original = handler.on_message_send_stream(
            request("snapshot-overlap", "Plan a workshop"), context
        )
        await anext(original)

        async def drain(stream: AsyncGenerator[Event, None]) -> list[Event]:
            return [event async for event in stream]

        original_reader = asyncio.create_task(drain(original))
        active = await handler._active_task_registry.get(
            remote_task_id("snapshot-overlap")
        )
        assert active is not None
        source = active._event_queue_subscribers
        original_delivery = source._deliver_to_sink

        async def delay_first_artifact(sink: EventQueueSink, event: object) -> None:
            if (
                isinstance(event, tuple)
                and isinstance(event[0], TaskArtifactUpdateEvent)
                and event[0].artifact.parts[0].text == "A"
            ):
                blocked.set()
                await release.wait()

            await original_delivery(sink, cast(Event, event))

        monkeypatch.setattr(source, "_deliver_to_sink", delay_first_artifact)
        produce.set()
        await asyncio.wait_for(blocked.wait(), timeout=2)
        deadline = time.monotonic() + 2

        while True:
            persisted = await durable_store.get(active.task_id, context)

            if persisted is not None and task_text(persisted) == "AB":
                break

            assert time.monotonic() < deadline
            await asyncio.sleep(0.005)

        if reconnect_method == "send":
            duplicate = handler.on_message_send_stream(
                request("snapshot-overlap", "Plan a workshop"), context
            )
        else:
            duplicate = handler.on_subscribe_to_task(
                SubscribeToTaskRequest(id=active.task_id), context
            )
        snapshot = await anext(duplicate)
        assert isinstance(snapshot, Task)
        rendered = task_text(snapshot)
        assert rendered == "AB"
        live_reader = asyncio.create_task(anext(duplicate))
        release.set()

        def render(text: str, event: Event) -> str:
            if isinstance(event, Task):
                return task_text(event)

            if isinstance(event, TaskArtifactUpdateEvent):
                delta = "".join(part.text for part in event.artifact.parts)

                return text + delta if event.append else delta

            return text

        try:
            live_event = await asyncio.wait_for(live_reader, timeout=2)
            rendered = render(rendered, live_event)
            assert rendered == "AB", "Reconnect must remain correct before completion"
            finish.set()

            async for event in duplicate:
                rendered = render(rendered, event)

            completed = await durable_store.get(active.task_id, context)
            assert completed is not None
            assert task_text(completed) == rendered == "ABC"
        finally:
            finish.set()
            release.set()
            await duplicate.aclose()
            await original_reader
            await handler.aclose()

    asyncio.run(verify())
