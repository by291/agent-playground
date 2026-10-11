"""Role-scoped durable task snapshots for the official A2A SDK."""

from typing import cast
from uuid import NAMESPACE_URL, uuid5

from a2a.server.context import ServerCallContext
from a2a.server.tasks import TaskStore
from a2a.types import (
    ListTasksRequest,
    ListTasksResponse,
    Role,
    SendMessageRequest,
    Task,
    TaskState,
    TaskStatus,
)
from a2a.utils.errors import (
    InvalidParamsError,
    TaskNotFoundError,
    UnsupportedOperationError,
)
from google.protobuf.json_format import MessageToDict, ParseDict
from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert

from agent_playground.db.async_operations import run_database_operation
from agent_playground.db.connection import app_engine
from agent_playground.db.schema import a2a_tasks
from agent_playground.services.a2a.contracts import (
    TERMINAL_TASK_STATES,
    AgentRole,
    remote_task_id,
    request_fingerprint,
)


class PostgresTaskStore(TaskStore):
    """Persist SDK task snapshots and reserve role-scoped message identities."""

    def __init__(self, role: str) -> None:
        if role not in {"planner", "reviewer"}:
            raise ValueError("A2A agent role must be planner or reviewer")

        self.role = cast(AgentRole, role)

    async def save(self, task: Task, context: ServerCallContext) -> None:
        await run_database_operation(self._save, task)

    def _save(self, task: Task) -> None:
        statement = insert(a2a_tasks).values(
            role=self.role,
            id=task.id,
            context_id=task.context_id,
            state=task.status.state,
            payload=MessageToDict(task),
        )
        accepts_snapshot = (~a2a_tasks.c.state.in_(TERMINAL_TASK_STATES)) & (
            a2a_tasks.c.context_id == task.context_id
        )

        # Delayed SDK events cannot reopen a terminal task or replace another
        # context's snapshot after a task identity has already been reserved.
        statement = statement.on_conflict_do_update(
            index_elements=[a2a_tasks.c.role, a2a_tasks.c.id],
            set_={
                "state": statement.excluded.state,
                "payload": statement.excluded.payload,
                "updated_at": func.now(),
            },
            where=accepts_snapshot,
        )

        with app_engine().begin() as connection:
            connection.execute(statement)

    async def get(self, task_id: str, context: ServerCallContext) -> Task | None:
        return await run_database_operation(self._get, task_id)

    def _get(self, task_id: str) -> Task | None:
        with app_engine().connect() as connection:
            payload = connection.execute(
                select(a2a_tasks.c.payload).where(
                    a2a_tasks.c.role == self.role, a2a_tasks.c.id == task_id
                )
            ).scalar_one_or_none()

        return ParseDict(payload, Task()) if payload is not None else None

    async def reserve_request(
        self, request: SendMessageRequest, context: ServerCallContext
    ) -> Task:
        """Reserve a new message or replay its existing task before dispatch."""
        return await run_database_operation(self._reserve_request, request)

    def _reserve_request(self, request: SendMessageRequest) -> Task:
        message = request.message

        invalid_user_message = (
            not message.message_id
            or message.role != Role.ROLE_USER
            or not any(part.text.strip() for part in message.parts)
        )

        if invalid_user_message:
            raise InvalidParamsError(
                message="A user message with a messageId and text is required"
            )

        task_id = message.task_id or remote_task_id(message.message_id)
        fingerprint = request_fingerprint(request)
        initial_context_id = message.context_id or str(
            uuid5(NAMESPACE_URL, f"a2a:{self.role}:{task_id}")
        )
        initial_task = Task(
            id=task_id,
            context_id=initial_context_id,
            status=TaskStatus(state=TaskState.TASK_STATE_SUBMITTED),
            history=[message],
            metadata={"requestFingerprints": {message.message_id: fingerprint}},
        )

        with app_engine().begin() as connection:
            if not message.task_id:
                # New requests derive a stable task identity. Concurrent
                # retries share the first insert instead of creating work twice.
                connection.execute(
                    insert(a2a_tasks)
                    .values(
                        role=self.role,
                        id=task_id,
                        context_id=initial_context_id,
                        state=initial_task.status.state,
                        payload=MessageToDict(initial_task),
                    )
                    .on_conflict_do_nothing()
                )

            # Keep fingerprint checks and interruption consumption under the
            # same task lock so only one new answer can reserve the transition.
            row = connection.execute(
                select(a2a_tasks.c.payload)
                .where(a2a_tasks.c.role == self.role, a2a_tasks.c.id == task_id)
                .with_for_update()
            ).scalar_one_or_none()

            if row is None:
                raise TaskNotFoundError(message=f"Task {task_id} does not exist")

            task = ParseDict(row, Task())

            if message.context_id and message.context_id != task.context_id:
                raise InvalidParamsError(
                    message="Message contextId does not match task contextId"
                )

            metadata = MessageToDict(task.metadata)
            fingerprints = metadata.setdefault("requestFingerprints", {})
            previous_fingerprint = fingerprints.get(message.message_id)

            if previous_fingerprint is not None:
                if previous_fingerprint != fingerprint:
                    raise InvalidParamsError(
                        message="The messageId was already used with different input"
                    )

                # A retry replays even if the task has since become terminal.
                return task

            if task.status.state in TERMINAL_TASK_STATES:
                raise UnsupportedOperationError(
                    message=f"Task {task.id} is in terminal state"
                )

            if task.status.state not in {
                TaskState.TASK_STATE_INPUT_REQUIRED,
                TaskState.TASK_STATE_AUTH_REQUIRED,
            }:
                raise UnsupportedOperationError(
                    message="Task is already running; subscribe to its existing stream"
                )

            if task.status.HasField("message"):
                task.history.append(task.status.message)
                task.status.ClearField("message")

            task.history.append(message)
            # Reserving an answer consumes the interruption. Persist that
            # transition before dispatch so a crash cannot strand the answer.
            task.status.state = TaskState.TASK_STATE_SUBMITTED
            fingerprints[message.message_id] = fingerprint
            task.metadata.Clear()
            task.metadata.update(metadata)
            connection.execute(
                a2a_tasks.update()
                .where(a2a_tasks.c.role == self.role, a2a_tasks.c.id == task_id)
                .values(
                    state=task.status.state,
                    payload=MessageToDict(task),
                    updated_at=func.now(),
                )
            )

        return task

    async def list(
        self, params: ListTasksRequest, context: ServerCallContext
    ) -> ListTasksResponse:
        unsupported_filters = params.tenant or params.HasField("status_timestamp_after")

        if unsupported_filters:
            raise UnsupportedOperationError(
                message="Tenant and timestamp filters are not supported by this demo task store"
            )

        page_size = params.page_size if params.HasField("page_size") else 50

        if not 1 <= page_size <= 100:
            raise InvalidParamsError(message="pageSize must be between 1 and 100")

        offset = 0

        if params.page_token:
            prefix = f"{self.role}:"
            value = params.page_token.removeprefix(prefix)
            invalid_page_token = (
                not params.page_token.startswith(prefix) or not value.isdecimal()
            )

            if invalid_page_token:
                raise InvalidParamsError(message="Invalid pageToken")

            offset = int(value)

        return await run_database_operation(self._list, params, page_size, offset)

    def _list(
        self, params: ListTasksRequest, page_size: int, offset: int
    ) -> ListTasksResponse:
        filters = [a2a_tasks.c.role == self.role]

        if params.context_id:
            filters.append(a2a_tasks.c.context_id == params.context_id)

        if params.status != TaskState.TASK_STATE_UNSPECIFIED:
            filters.append(a2a_tasks.c.state == params.status)

        with app_engine().connect() as connection:
            total = connection.execute(
                select(func.count()).select_from(a2a_tasks).where(*filters)
            ).scalar_one()
            rows = (
                connection.execute(
                    select(a2a_tasks.c.payload)
                    .where(*filters)
                    .order_by(a2a_tasks.c.updated_at.desc(), a2a_tasks.c.id)
                    .limit(page_size)
                    .offset(offset)
                )
                .scalars()
                .all()
            )

        next_token = (
            f"{self.role}:{offset + page_size}" if offset + page_size < total else ""
        )

        return ListTasksResponse(
            tasks=[ParseDict(payload, Task()) for payload in rows],
            next_page_token=next_token,
            total_size=total,
            page_size=page_size,
        )

    async def delete(self, task_id: str, context: ServerCallContext) -> None:
        await run_database_operation(self._delete, task_id)

    def _delete(self, task_id: str) -> None:
        with app_engine().begin() as connection:
            connection.execute(
                delete(a2a_tasks).where(
                    a2a_tasks.c.role == self.role, a2a_tasks.c.id == task_id
                )
            )
