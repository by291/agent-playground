"""Durable A2A request reservation, replay and stream subscription."""

import asyncio
from collections.abc import AsyncGenerator
from contextlib import aclosing
from typing import cast, override

from a2a.server.agent_execution import RequestContext, RequestContextBuilder
from a2a.server.agent_execution.active_task import ActiveTask
from a2a.server.context import ServerCallContext
from a2a.server.events import Event
from a2a.server.request_handlers import DefaultRequestHandler
from a2a.types import (
    AgentCard,
    Message,
    SendMessageRequest,
    SubscribeToTaskRequest,
    Task,
    TaskArtifactUpdateEvent,
    TaskState,
    TaskStatusUpdateEvent,
)
from a2a.utils.errors import TaskNotFoundError, UnsupportedOperationError
from google.protobuf.json_format import MessageToDict

from agent_playground.db.a2a_tasks import PostgresTaskStore
from agent_playground.services.a2a.agent import DemoAgentExecutor
from agent_playground.services.a2a.contracts import TERMINAL_TASK_STATES, remote_task_id

INTERRUPTED_TASK_STATES = {
    TaskState.TASK_STATE_INPUT_REQUIRED,
    TaskState.TASK_STATE_AUTH_REQUIRED,
}


class DurableRequestContextBuilder(RequestContextBuilder):
    """Build SDK execution context from the task reserved before dispatch."""

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

        resolved_task_id = task_id or remote_task_id(params.message.message_id)
        persisted_task = await self.store.get(resolved_task_id, context)

        if persisted_task is None:
            raise ValueError("The request must be reserved before dispatch")

        return RequestContext(
            context,
            request=params,
            task_id=resolved_task_id,
            context_id=persisted_task.context_id,
            task=persisted_task,
        )


class DurableRequestHandler(DefaultRequestHandler):
    """Reserve one producer per request and serve persisted snapshots on replay."""

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
            is_request_replay = (
                previous is not None
                and params.message.message_id
                in MessageToDict(previous.metadata).get("requestFingerprints", {})
            )
            task = await self.store.reserve_request(params, context)
            active = await self._active_task_registry.get(task.id)

            replays_stopped_task = (
                is_request_replay
                and task.status.state in TERMINAL_TASK_STATES | INTERRUPTED_TASK_STATES
            )

            if replays_stopped_task:
                source = self._snapshot(task)
                first = await anext(source)
            elif is_request_replay and active is not None:
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
                should_return = (
                    params.configuration.return_immediately
                    or status
                    and status.state in TERMINAL_TASK_STATES | INTERRUPTED_TASK_STATES
                )

                if should_return:
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
                reached_stop_state = (
                    status
                    and status.state in TERMINAL_TASK_STATES | INTERRUPTED_TASK_STATES
                )

                if reached_stop_state:
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
                    reached_stop_state = (
                        status
                        and status.state
                        in TERMINAL_TASK_STATES | INTERRUPTED_TASK_STATES
                    )

                    if reached_stop_state:
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
