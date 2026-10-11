"""Follow real A2A streams and publish recoverable child output snapshots."""

import asyncio
import logging
from functools import partial
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
    STEPS,
    ChildOutput,
    CollaborationState,
    TaskStatus,
    remote_task_id,
)

logger = logging.getLogger(__name__)
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


def apply_remote_event(
    state: CollaborationState, event: StreamResponse
) -> CollaborationState:
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

        if len(output.text) > 100000:
            raise ValueError("A2A output exceeds the demo's 100000-character limit")

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

    if output.status in {"input_required", "failed", "cancelled"}:
        state.status = output.status

        if output.status == "failed":
            state.error = state.message

    return state


def advance(state: CollaborationState) -> CollaborationState:
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
    elif step == "revise":
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
    *,
    step: str,
    message_id: str,
    task_id: str,
    remote: Task | None,
) -> SendMessageRequest:
    """Reuse reserved message content before constructing a new stage request."""
    is_input_continuation = step == "plan" and bool(job.state.user_input)
    outgoing_message_id = f"{message_id}-input" if is_input_continuation else message_id
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
        role = "reviewer" if step == "review" else "planner"
        message = Message(
            role=Role.ROLE_USER,
            message_id=outgoing_message_id,
            task_id=task_id if is_input_continuation else "",
            context_id=f"{job.request.id}-{role}",
            parts=[Part(text=prompt_for(job))],
        )

    return SendMessageRequest(
        message=message,
        metadata={
            "requireInput": job.request.require_input
            and step == "plan"
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

    if response.status_code == 404:
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
    while True:
        job = await run_database_operation(read_job, job_id)

        if job is None or job.state.terminal:
            return

        if job.state.cancel_requested:
            try:
                await client.cancel_task(CancelTaskRequest(id=task_id))
                return
            except TaskNotFoundError:
                pass
            except TaskNotCancelableError:
                return
            except (httpx.HTTPError, A2AClientError) as error:
                logger.warning("A2A cancellation %s will be retried: %s", job_id, error)

        await asyncio.sleep(0.2)


async def process_job(
    job: CollaborationJob, owner: str, callbacks: httpx.AsyncClient
) -> None:
    while not job.state.terminal:
        if not await deliver(job, callbacks):
            refreshed = await run_database_operation(read_job, job.request.id)

            if refreshed is None:
                return

            job = refreshed

        step = STEPS[job.state.stage_index]
        role = "reviewer" if step == "review" else "planner"
        settings = load_agent_config().a2a
        endpoint = settings.reviewer_url if role == "reviewer" else settings.planner_url
        message_id = f"{job.request.id}-{step}"
        task_id = remote_task_id(message_id)

        async with httpx.AsyncClient(timeout=httpx.Timeout(15, read=90)) as transport:
            client = await create_client(
                endpoint,
                client_config=ClientConfig(
                    httpx_client=transport, supported_protocol_bindings=["JSONRPC"]
                ),
            )
            try:
                async with asyncio.TaskGroup() as streams:
                    watcher = streams.create_task(
                        watch_cancel(job.request.id, client, task_id)
                    )

                    try:
                        try:
                            remote = await client.get_task(GetTaskRequest(id=task_id))
                        except TaskNotFoundError:
                            remote = None

                        if remote is not None:
                            has_new_input = (
                                remote.status.state
                                == TaskState.TASK_STATE_INPUT_REQUIRED
                                and job.state.user_input
                            )

                            # New input belongs to the next dispatch. Applying
                            # the old remote snapshot would restore its wait.
                            if not has_new_input:
                                job = await run_database_operation(
                                    change_job,
                                    job.request.id,
                                    partial(
                                        apply_remote_event,
                                        event=StreamResponse(task=remote),
                                    ),
                                    owner,
                                )
                                await deliver(job, callbacks)

                        cancel_before_dispatch = (
                            job.state.cancel_requested and remote is None
                        )
                        remote_completed = (
                            remote is not None
                            and remote.status.state == TaskState.TASK_STATE_COMPLETED
                        )

                        waiting_for_input = (
                            job.state.status == "input_required"
                            and not job.state.cancel_requested
                        )

                        if cancel_before_dispatch or remote_completed:
                            job = await run_database_operation(
                                change_job, job.request.id, advance, owner
                            )
                        elif job.state.terminal or waiting_for_input:
                            await deliver(job, callbacks)
                            return
                        else:
                            request = _stage_request(
                                job,
                                step=step,
                                message_id=message_id,
                                task_id=task_id,
                                remote=remote,
                            )

                            async for event in client.send_message(request):
                                job = await run_database_operation(
                                    change_job,
                                    job.request.id,
                                    partial(apply_remote_event, event=event),
                                    owner,
                                )
                                await deliver(job, callbacks)

                            stage_succeeded = (
                                not job.state.terminal
                                and job.state.outputs
                                and job.state.outputs[-1].status == "succeeded"
                            )

                            if stage_succeeded:
                                job = await run_database_operation(
                                    change_job, job.request.id, advance, owner
                                )
                            elif job.state.status == "input_required":
                                await deliver(job, callbacks)
                                return
                            elif not job.state.terminal:
                                raise RuntimeError(
                                    "A2A stream ended before a terminal or input-required state"
                                )
                    finally:
                        # Join the cancellation watcher before closing the SDK
                        # client it uses; it must not outlive this stage.
                        watcher.cancel()
                        await asyncio.gather(watcher, return_exceptions=True)
            finally:
                await client.close()

        # A control request may have committed while the remote stream ended.
        refreshed = await run_database_operation(read_job, job.request.id)

        if refreshed is None:
            return

        job = refreshed

    await deliver(job, callbacks)


async def run_a2a_worker() -> None:
    active: dict[str, asyncio.Task[None]] = {}

    async def run_claimed(
        job: CollaborationJob, owner: str, callbacks: httpx.AsyncClient
    ) -> None:
        async def heartbeat() -> None:
            while True:
                await asyncio.sleep(10)

                if not await run_database_operation(renew_lease, job.request.id, owner):
                    raise RuntimeError("A2A coordinator lease was lost")

        try:
            # Renewal failure cancels stream processing before another owner can
            # reclaim the job. A detached heartbeat would leave a stale producer.
            async with asyncio.TaskGroup() as workers:
                renewal = workers.create_task(heartbeat())

                try:
                    await process_job(job, owner, callbacks)
                finally:
                    renewal.cancel()
        except (httpx.HTTPError, RuntimeError) as error:
            logger.warning(
                "A2A collaboration %s will be reconciled: %s", job.request.id, error
            )
        except Exception:
            logger.exception("A2A collaboration %s will be reconciled", job.request.id)
        finally:
            await run_database_operation(release_lease, job.request.id, owner)

    async with httpx.AsyncClient(timeout=10) as callbacks:
        try:
            while True:
                for job_id, task in list(active.items()):
                    if task.done():
                        task.result()
                        del active[job_id]

                if len(active) < 4:
                    owner = uuid4().hex
                    jobs = await run_database_operation(
                        claim_jobs, owner, 4 - len(active)
                    )

                    for job in jobs:
                        active[job.request.id] = asyncio.create_task(
                            run_claimed(job, owner, callbacks)
                        )

                await asyncio.sleep(0.5)
        finally:
            for task in active.values():
                task.cancel()

            await asyncio.gather(*active.values(), return_exceptions=True)
