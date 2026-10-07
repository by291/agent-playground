"""Serve one independent official A2A planner or reviewer agent."""

import argparse
import asyncio
from collections.abc import AsyncGenerator
from contextlib import aclosing, asynccontextmanager
from typing import cast, override
from urllib.parse import urlsplit

import uvicorn
from a2a.server.agent_execution import RequestContext, RequestContextBuilder
from a2a.server.agent_execution.active_task import ActiveTask
from a2a.server.context import ServerCallContext
from a2a.server.events import Event
from a2a.server.request_handlers import DefaultRequestHandler
from a2a.server.routes import (
    add_a2a_routes_to_fastapi,
    create_agent_card_routes,
    create_jsonrpc_routes,
)
from a2a.types import (
    AgentCapabilities,
    AgentCard,
    AgentInterface,
    AgentSkill,
    Message,
    SendMessageRequest,
    SubscribeToTaskRequest,
    Task,
    TaskArtifactUpdateEvent,
    TaskState,
    TaskStatusUpdateEvent,
)
from a2a.utils.errors import TaskNotFoundError, UnsupportedOperationError
from fastapi import FastAPI
from google.protobuf.json_format import MessageToDict

from agent_playground.config import load_agent_config
from agent_playground.db.a2a_tasks import PostgresTaskStore
from agent_playground.db.async_operations import run_database_operation
from agent_playground.db.connection import close_app_store, prepare_app_store
from agent_playground.services.a2a.agent import DemoAgentExecutor
from agent_playground.services.a2a.protocol import (
    TERMINAL_TASK_STATES,
    AgentRole,
    remote_task_id,
)

INTERRUPTED_TASK_STATES = {
    TaskState.TASK_STATE_INPUT_REQUIRED,
    TaskState.TASK_STATE_AUTH_REQUIRED,
}


class DurableRequestContextBuilder(RequestContextBuilder):
    def __init__(self, store: PostgresTaskStore) -> None:
        self.store = store

    async def build(
        self,
        context: ServerCallContext,
        params: SendMessageRequest | None = None,
        task_id: str | None = None,
        context_id: str | None = None,
        task: Task | None = None,
    ) -> RequestContext:
        if params is None:
            return RequestContext(
                context, task_id=task_id, context_id=context_id, task=task
            )

        resolved_id = task_id or remote_task_id(params.message.message_id)
        persisted = await self.store.get(resolved_id, context)

        if persisted is None:
            raise ValueError("The request must be reserved before dispatch")

        return RequestContext(
            context,
            request=params,
            task_id=resolved_id,
            context_id=persisted.context_id,
            task=persisted,
        )


class DurableRequestHandler(DefaultRequestHandler):
    def __init__(
        self, executor: DemoAgentExecutor, store: PostgresTaskStore, card: AgentCard
    ) -> None:
        super().__init__(
            executor,
            store,
            card,
            request_context_builder=DurableRequestContextBuilder(store),
        )
        self.store = store
        self._dispatch_lock = asyncio.Lock()

    @override
    async def on_message_send_stream(
        self, params: SendMessageRequest, context: ServerCallContext
    ) -> AsyncGenerator[Event, None]:
        # Hold dispatch only until the first persisted event, so simultaneous
        # retries see either the completed snapshot or the one existing producer.
        async with self._dispatch_lock:
            first_update: Event | None = None
            task_id = params.message.task_id or remote_task_id(
                params.message.message_id
            )
            previous = await self.store.get(task_id, context)
            replay = (
                previous is not None
                and params.message.message_id
                in MessageToDict(previous.metadata).get("requestFingerprints", {})
            )
            task = await self.store.reserve_request(params, context)
            active = await self._active_task_registry.get(task.id)

            if (
                replay
                and task.status.state in TERMINAL_TASK_STATES | INTERRUPTED_TASK_STATES
            ):
                source = self._snapshot(task)
                first = await anext(source)
            elif replay and active is not None:
                source = self._subscribe(active, context)
                first = await anext(source)
            else:
                source = cast(
                    AsyncGenerator[Event, None],
                    super().on_message_send_stream(params, context),
                )
                # The reservation already persisted this task, so the executor
                # emits updates rather than replacing the SDK's current task.
                first_update = await anext(source)
                first = task

        async with aclosing(source):
            yield first

            if first_update is not None:
                yield first_update

            async for event in source:
                yield event

    @override
    async def on_message_send(
        self, params: SendMessageRequest, context: ServerCallContext
    ) -> Message | Task:
        task_id = params.message.task_id or remote_task_id(params.message.message_id)

        async with aclosing(self.on_message_send_stream(params, context)) as events:
            async for event in events:
                status = getattr(event, "status", None)

                if (
                    params.configuration.return_immediately
                    or status
                    and status.state in TERMINAL_TASK_STATES | INTERRUPTED_TASK_STATES
                ):
                    break

        task = await self.store.get(task_id, context)

        if task is None:
            raise ValueError("The agent did not persist a task")

        return task

    @override
    async def on_subscribe_to_task(
        self, params: SubscribeToTaskRequest, context: ServerCallContext
    ) -> AsyncGenerator[Event, None]:
        source = super().on_subscribe_to_task(params, context)

        async with aclosing(source):
            async for event in source:
                snapshot = await self._current_snapshot(event, context)
                yield snapshot
                status = getattr(snapshot, "status", None)

                if (
                    status
                    and status.state in TERMINAL_TASK_STATES | INTERRUPTED_TASK_STATES
                ):
                    return

    async def _current_snapshot(
        self, event: Event, context: ServerCallContext
    ) -> Event:
        if isinstance(event, Task):
            task_id = event.id
        elif isinstance(event, TaskArtifactUpdateEvent | TaskStatusUpdateEvent):
            task_id = event.task_id
        else:
            return event

        # SDK taps can receive old queued deltas after their initial snapshot.
        # Serve the durable snapshot at every update so reconnects never append
        # an artifact chunk that the initial snapshot already contained.
        task = await self.store.get(task_id, context)

        if task is None:
            raise TaskNotFoundError(message=f"Task {task_id} does not exist")

        return task

    async def _snapshot(self, task: Task) -> AsyncGenerator[Event, None]:
        yield task

    async def _subscribe(
        self, active: ActiveTask, context: ServerCallContext
    ) -> AsyncGenerator[Event, None]:
        try:
            async with aclosing(active.subscribe(include_initial_task=True)) as events:
                async for event in events:
                    snapshot = await self._current_snapshot(event, context)
                    yield snapshot
                    status = getattr(snapshot, "status", None)

                    if (
                        status
                        and status.state
                        in TERMINAL_TASK_STATES | INTERRUPTED_TASK_STATES
                    ):
                        return
        except UnsupportedOperationError:
            # Completion can retire the local producer between the durable
            # snapshot read and opening its subscription. Replay that result.
            task = await self.store.get(active.task_id, context)

            if (
                task is None
                or task.status.state
                not in TERMINAL_TASK_STATES | INTERRUPTED_TASK_STATES
            ):
                raise

            yield task


def create_a2a_app(
    role: AgentRole,
    base_url: str,
    *,
    task_store: PostgresTaskStore | None = None,
    executor: DemoAgentExecutor | None = None,
) -> FastAPI:
    store = task_store or PostgresTaskStore(role)
    agent_executor = executor or DemoAgentExecutor(role)
    card = AgentCard(
        name=f"Demo {role.title()}",
        description=f"Independent {role} agent for the planner/reviewer A2A demonstration.",
        version="1.0.0",
        supported_interfaces=[
            AgentInterface(
                url=f"{base_url.rstrip('/')}/",
                protocol_binding="JSONRPC",
                protocol_version="1.0",
            )
        ],
        capabilities=AgentCapabilities(streaming=True),
        default_input_modes=["text/plain"],
        default_output_modes=["text/plain"],
        skills=[
            AgentSkill(
                id=role,
                name=role.title(),
                description="Create and revise practical plans"
                if role == "planner"
                else "Evaluate plans and return actionable feedback",
                tags=[role, "a2a-demo"],
            )
        ],
    )
    handler = DurableRequestHandler(agent_executor, store, card)
    owns_store = task_store is None

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        if owns_store:
            await run_database_operation(prepare_app_store)

        try:
            yield
        finally:
            try:
                await handler.aclose()
            finally:
                if owns_store:
                    await run_database_operation(close_app_store)

    app = FastAPI(title=f"A2A Demo {role.title()}", lifespan=lifespan)
    app.state.a2a_handler = handler
    add_a2a_routes_to_fastapi(
        app,
        agent_card_routes=create_agent_card_routes(card),
        jsonrpc_routes=create_jsonrpc_routes(handler, rpc_url="/"),
    )

    return app


def main() -> None:
    parser = argparse.ArgumentParser(description="Run one independent A2A demo agent")
    parser.add_argument("--role", choices=["planner", "reviewer"], required=True)
    parser.add_argument("--host")
    parser.add_argument("--port", type=int)
    args = parser.parse_args()
    settings = load_agent_config().a2a
    endpoint = settings.planner_url if args.role == "planner" else settings.reviewer_url
    address = urlsplit(endpoint)
    host = args.host or address.hostname
    port = args.port or address.port or (443 if address.scheme == "https" else 80)
    base_url = f"http://{host}:{port}" if args.host or args.port else endpoint
    app = create_a2a_app(args.role, base_url)
    uvicorn.run(app, host=host or "127.0.0.1", port=port, timeout_graceful_shutdown=5)


if __name__ == "__main__":
    main()
