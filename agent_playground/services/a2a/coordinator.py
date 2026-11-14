"""Follow real A2A streams and publish recoverable child output snapshots."""

import asyncio
import logging
from dataclasses import dataclass
from functools import partial
from http import HTTPStatus
from uuid import uuid4

import httpx
from a2a.client import Client, ClientConfig, create_client
from a2a.client.errors import A2AClientError
from a2a.helpers import get_artifact_text, get_message_text
from a2a.types import (
    CancelTaskRequest,
    GetTaskRequest,
    Message,
    Part,
    Role,
    SendMessageRequest,
    StreamResponse,
    Task,
    TaskState,
)
from a2a.utils.errors import TaskNotCancelableError, TaskNotFoundError

from agent_playground.config.agent import app_api_url, load_agent_config
from agent_playground.db.a2a_jobs import (
    DEFAULT_CLAIM_LIMIT,
    CollaborationJob,
    change_job,
    claim_jobs,
    mark_delivered,
    read_job,
    release_lease,
    renew_lease,
)
from agent_playground.db.async_operations import run_database_operation
from agent_playground.services.a2a.contracts import (
    MAX_OUTPUT_CHARACTERS,
    STEPS,
    ChildOutput,
    CollaborationState,
    TaskStatus,
    remote_task_id,
)

logger = logging.getLogger(__name__)
CALLBACK_TIMEOUT_SECONDS = 10
REMOTE_CONNECT_TIMEOUT_SECONDS = 15
REMOTE_READ_TIMEOUT_SECONDS = 90
CANCELLATION_POLL_SECONDS = 0.2
LEASE_RENEWAL_SECONDS = 10
JOB_POLL_SECONDS = 0.5
STOPPED_CHILD_STATUSES = {
    "input_required",
    "failed",
    "cancelled",
}
REMOTE_STATUSES: dict[int, TaskStatus] = {
    TaskState.TASK_STATE_SUBMITTED: "queued",
    TaskState.TASK_STATE_WORKING: "running",
    TaskState.TASK_STATE_INPUT_REQUIRED: "input_required",
    TaskState.TASK_STATE_COMPLETED: "succeeded",
    TaskState.TASK_STATE_FAILED: "failed",
    TaskState.TASK_STATE_REJECTED: "failed",
    TaskState.TASK_STATE_CANCELED: "cancelled",
    TaskState.TASK_STATE_AUTH_REQUIRED: "failed",
}


@dataclass(frozen=True, kw_only=True)
class _StageExecution:
    step: str
    message_id: str
    task_id: str
    owner: str
    callbacks: httpx.AsyncClient


def apply_remote_event(
    state: CollaborationState, event: StreamResponse
) -> CollaborationState:
    """Fold a child task snapshot or stream update into its current stage."""
    if state.terminal:
        return state

    step = STEPS[state.stage_index]
    output = next((item for item in state.outputs if item.step == step), None)

    if event.HasField("task"):
        task = event.task

        output = ChildOutput(
            agent="Reviewer" if step == "review" else "Planner",
            step=step,
            taskId=task.id,
            contextId=task.context_id,
            status=REMOTE_STATUSES[task.status.state],
            text="\n".join(get_artifact_text(artifact) for artifact in task.artifacts),
        )
        state.outputs = [item for item in state.outputs if item.step != step] + [output]
        message = get_message_text(task.status.message)
    elif output is not None and event.HasField("artifact_update"):
        update = event.artifact_update

        if update.task_id != output.task_id:
            raise ValueError("A2A artifact targets a different task")

        text = get_artifact_text(update.artifact)
        output.text = (output.text + text) if update.append else text

        if len(output.text) > MAX_OUTPUT_CHARACTERS:
            raise ValueError(
                f"A2A output exceeds the demo's {MAX_OUTPUT_CHARACTERS}-character limit"
            )

        message = f"{output.agent} is writing the {step}"
    elif output is not None and event.HasField("status_update"):
        update = event.status_update

        if update.task_id != output.task_id:
            raise ValueError("A2A status targets a different task")

        output.status = REMOTE_STATUSES[update.status.state]
        message = get_message_text(update.status.message)
    else:
        raise ValueError("A2A agent must return a task before its updates")

    state.status = "running"
    state.message = message or f"{output.agent}: {output.status}"

    if output.status in STOPPED_CHILD_STATUSES:
        state.status = output.status

    if output.status == "failed":
        state.error = state.message

    return state


def advance(state: CollaborationState) -> CollaborationState:
    """Move to the next stage or finish an acknowledged cancellation."""
    if state.terminal:
        return state

    if state.cancel_requested:
        state.status = "cancelled"
        state.message = "A2A collaboration cancelled"

        return state

    state.stage_index += 1
    state.status = "succeeded" if state.stage_index == len(STEPS) else "running"
    state.message = (
        "Planning, review and revision completed"
        if state.terminal
        else f"Handing the result to the {STEPS[state.stage_index]} agent"
    )

    return state


def prompt_for(job: CollaborationJob) -> str:
    """Build the current stage prompt from the original request and prior outputs."""
    step = STEPS[job.state.stage_index]
    task_description = job.request.task

    if job.state.user_input:
        task_description += f"\nAdditional information: {job.state.user_input}"

    if step == "review":
        return (
            "Stage: Review\nProduce the independent critique only. Evaluate the supplied "
            "Planner draft against the request, and give concrete feedback for the Planner. "
            "Leave the revised proposal to the Planner's next stage.\n\n"
            f"Original request:\n{task_description}\n\nPlanner draft:\n{job.state.outputs[0].text}"
        )

    if step == "revise":
        return (
            "Stage: Revise\nReturn one complete revised proposal using the supplied actual "
            "Reviewer feedback. Briefly identify the changes made in response to that "
            "feedback. Keep the independent critique attributed to the Reviewer.\n\n"
            f"Original request:\n{task_description}\n\nPlanner draft:\n{job.state.outputs[0].text}"
            f"\n\nReviewer feedback:\n{job.state.outputs[1].text}"
        )

    return (
        "Stage: Draft\nProduce the initial draft only. A separate Reviewer will critique "
        "this draft after you finish. Revision belongs to a later request containing "
        "the Reviewer's actual feedback.\n\n"
        f"Original request:\n{task_description}"
    )


def _stage_request(
    job: CollaborationJob,
    stage: _StageExecution,
    remote: Task | None,
) -> SendMessageRequest:
    """Reuse reserved message content before constructing a new stage request."""
    is_input_continuation = stage.step == "plan" and bool(job.state.user_input)
    outgoing_message_id = stage.message_id

    if is_input_continuation:
        outgoing_message_id += "-input"

    saved_message = None

    if remote is not None:
        saved_message = next(
            (
                message
                for message in remote.history
                if message.role == Role.ROLE_USER
                and message.message_id == outgoing_message_id
            ),
            None,
        )

    if saved_message is not None:
        # Reserved requests retain their original input fingerprint across
        # coordinator prompt upgrades, including message parts and metadata.
        message = Message()
        message.CopyFrom(saved_message)
    else:
        role = "reviewer" if stage.step == "review" else "planner"
        message = Message(
            role=Role.ROLE_USER,
            message_id=outgoing_message_id,
            task_id=stage.task_id if is_input_continuation else "",
            context_id=f"{job.request.id}-{role}",
            parts=[Part(text=prompt_for(job))],
        )

    return SendMessageRequest(
        message=message,
        metadata={
            "requireInput": job.request.require_input
            and stage.step == "plan"
            and not job.state.user_input
        },
    )


async def deliver(job: CollaborationJob, client: httpx.AsyncClient) -> bool:
    """Acknowledge a delivered revision or stop an orphaned collaboration."""
    if job.state.revision <= job.delivered_revision:
        return True

    response = await client.post(
        f"{app_api_url()}/external-tasks/{job.request.id}/events",
        headers={"Authorization": f"Bearer {job.request.callback_token}"},
        json=job.state.event(),
    )

    if response.status_code == HTTPStatus.NOT_FOUND:
        # The owning conversation disappeared; stop producing remote work and
        # acknowledge this revision so a missing callback cannot retry forever.
        if not job.state.terminal:
            job = await run_database_operation(
                change_job,
                job.request.id,
                lambda state: state.model_copy(update={"cancel_requested": True}),
            )

        await run_database_operation(mark_delivered, job.request.id, job.state.revision)

        return False

    response.raise_for_status()
    await run_database_operation(mark_delivered, job.request.id, job.state.revision)

    return True


async def watch_cancel(job_id: str, client: Client, task_id: str) -> None:
    """Relay a persisted cancellation until the remote task can acknowledge it."""
    while True:
        job = await run_database_operation(read_job, job_id)

        if job is None or job.state.terminal:
            return

        if job.state.cancel_requested:
            try:
                await client.cancel_task(CancelTaskRequest(id=task_id))
            except TaskNotFoundError:
                # A stage may still be dispatching its reserved task.
                pass
            except TaskNotCancelableError:
                return
            except (httpx.HTTPError, A2AClientError) as error:
                logger.warning("A2A cancellation %s will be retried: %s", job_id, error)
            else:
                return

        await asyncio.sleep(CANCELLATION_POLL_SECONDS)


async def _persist_stage_event(
    job: CollaborationJob, stage: _StageExecution, event: StreamResponse
) -> CollaborationJob:
    # The callback must reference a committed revision protected by our lease.
    updated_job = await run_database_operation(
        change_job,
        job.request.id,
        partial(apply_remote_event, event=event),
        stage.owner,
    )
    await deliver(updated_job, stage.callbacks)

    return updated_job


async def _reconcile_stage(
    job: CollaborationJob, stage: _StageExecution, client: Client
) -> CollaborationJob | None:
    try:
        remote = await client.get_task(GetTaskRequest(id=stage.task_id))
    except TaskNotFoundError:
        remote = None

    if remote is not None:
        has_new_input = (
            remote.status.state == TaskState.TASK_STATE_INPUT_REQUIRED
            and job.state.user_input
        )

        # New input belongs to the next dispatch. Applying the old remote
        # snapshot would restore its wait.
        if not has_new_input:
            job = await _persist_stage_event(job, stage, StreamResponse(task=remote))

    is_cancelled_before_dispatch = job.state.cancel_requested and remote is None
    is_remote_completed = (
        remote is not None and remote.status.state == TaskState.TASK_STATE_COMPLETED
    )
    is_waiting_for_input = (
        job.state.status == "input_required" and not job.state.cancel_requested
    )

    if is_cancelled_before_dispatch or is_remote_completed:
        return await run_database_operation(
            change_job, job.request.id, advance, stage.owner
        )

    if job.state.terminal or is_waiting_for_input:
        await deliver(job, stage.callbacks)

        return None

    request = _stage_request(job, stage, remote)

    async for event in client.send_message(request):
        job = await _persist_stage_event(job, stage, event)

    has_successful_output = (
        not job.state.terminal
        and job.state.outputs
        and job.state.outputs[-1].status == "succeeded"
    )

    if has_successful_output:
        return await run_database_operation(
            change_job, job.request.id, advance, stage.owner
        )

    if job.state.status == "input_required":
        await deliver(job, stage.callbacks)

        return None

    if not job.state.terminal:
        raise RuntimeError("A2A stream ended before a terminal or input-required state")

    return job


async def _reconcile_with_cancellation(
    job: CollaborationJob, stage: _StageExecution, client: Client
) -> CollaborationJob | None:
    async with asyncio.TaskGroup() as streams:
        watcher = streams.create_task(
            watch_cancel(job.request.id, client, stage.task_id)
        )

        try:
            return await _reconcile_stage(job, stage, client)
        finally:
            # The watcher makes SDK calls. Join it before closing the client.
            watcher.cancel()
            await asyncio.gather(watcher, return_exceptions=True)


async def _run_stage(
    job: CollaborationJob, owner: str, callbacks: httpx.AsyncClient
) -> CollaborationJob | None:
    step = STEPS[job.state.stage_index]
    message_id = f"{job.request.id}-{step}"
    stage = _StageExecution(
        step=step,
        message_id=message_id,
        task_id=remote_task_id(message_id),
        owner=owner,
        callbacks=callbacks,
    )

    settings = load_agent_config().a2a
    endpoint = settings.reviewer_url if step == "review" else settings.planner_url
    timeout = httpx.Timeout(
        REMOTE_CONNECT_TIMEOUT_SECONDS, read=REMOTE_READ_TIMEOUT_SECONDS
    )

    async with httpx.AsyncClient(timeout=timeout) as transport:
        client = await create_client(
            endpoint,
            client_config=ClientConfig(
                httpx_client=transport, supported_protocol_bindings=["JSONRPC"]
            ),
        )

        try:
            return await _reconcile_with_cancellation(job, stage, client)
        finally:
            await client.close()


async def process_job(
    job: CollaborationJob, owner: str, callbacks: httpx.AsyncClient
) -> None:
    """Reconcile leased stages until delivery completes or a stage needs input."""
    while not job.state.terminal:
        if not await deliver(job, callbacks):
            refreshed = await run_database_operation(read_job, job.request.id)

            if refreshed is None:
                return

            job = refreshed

        finished_stage = await _run_stage(job, owner, callbacks)

        if finished_stage is None:
            return

        # A control request may have committed while the remote stream ended.
        refreshed = await run_database_operation(read_job, finished_stage.request.id)

        if refreshed is None:
            return

        job = refreshed

    await deliver(job, callbacks)


async def _renew_job_lease(job_id: str, owner: str) -> None:
    while True:
        await asyncio.sleep(LEASE_RENEWAL_SECONDS)

        if not await run_database_operation(renew_lease, job_id, owner):
            raise RuntimeError("A2A coordinator lease was lost")


async def _process_with_lease(
    job: CollaborationJob, owner: str, callbacks: httpx.AsyncClient
) -> None:
    # Renewal failure cancels stream processing before another owner can
    # reclaim the job. A detached heartbeat would leave a stale producer.
    async with asyncio.TaskGroup() as workers:
        renewal = workers.create_task(_renew_job_lease(job.request.id, owner))

        try:
            await process_job(job, owner, callbacks)
        finally:
            renewal.cancel()


async def _run_claimed(
    job: CollaborationJob, owner: str, callbacks: httpx.AsyncClient
) -> None:
    try:
        await _process_with_lease(job, owner, callbacks)
    except (httpx.HTTPError, RuntimeError) as error:
        logger.warning(
            "A2A collaboration %s will be reconciled: %s", job.request.id, error
        )
    except Exception:
        logger.exception("A2A collaboration %s will be reconciled", job.request.id)
    finally:
        # Stream processing and renewal have both stopped before release.
        await run_database_operation(release_lease, job.request.id, owner)


async def _poll_jobs(
    active: dict[str, asyncio.Task[None]], callbacks: httpx.AsyncClient
) -> None:
    while True:
        for job_id, task in list(active.items()):
            if task.done():
                task.result()
                del active[job_id]

        capacity = DEFAULT_CLAIM_LIMIT - len(active)

        if capacity > 0:
            owner = uuid4().hex
            jobs = await run_database_operation(claim_jobs, owner, capacity)

            for job in jobs:
                active[job.request.id] = asyncio.create_task(
                    _run_claimed(job, owner, callbacks)
                )

        await asyncio.sleep(JOB_POLL_SECONDS)


async def run_a2a_worker() -> None:
    """Claim coordinator jobs and drain active jobs before closing callbacks."""
    active: dict[str, asyncio.Task[None]] = {}

    async with httpx.AsyncClient(timeout=CALLBACK_TIMEOUT_SECONDS) as callbacks:
        try:
            await _poll_jobs(active, callbacks)
        finally:
            # Active jobs can post a final callback or release a lease.
            for task in active.values():
                task.cancel()

            await asyncio.gather(*active.values(), return_exceptions=True)
