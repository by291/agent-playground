"""A2A child snapshots preserve live artifacts and terminal state."""

import asyncio
import json

import httpx
import pytest
from a2a.types import (
    Artifact,
    CancelTaskRequest,
    Part,
    StreamResponse,
    Task,
    TaskArtifactUpdateEvent,
    TaskState,
    TaskStatus,
)


def test_child_prompts_separate_draft_review_and_revision() -> None:
    from agent_playground.db.a2a_jobs import CollaborationJob
    from agent_playground.services.a2a.coordinator import prompt_for
    from agent_playground.services.a2a.models import (
        ChildOutput,
        CollaborationRequest,
        CollaborationState,
    )

    state = CollaborationState(user_input="For new engineers")
    job = CollaborationJob(
        CollaborationRequest(
            id="stage-test", task="Plan a peer review workshop", callback_token="secret"
        ),
        state,
        0,
    )
    draft_prompt = prompt_for(job)
    assert draft_prompt.startswith("Stage: Draft\n")
    assert "initial draft only" in draft_prompt
    assert "Plan a peer review workshop" in draft_prompt
    assert "For new engineers" in draft_prompt
    assert "Reviewer feedback:\n" not in draft_prompt
    state.outputs = [
        ChildOutput(
            agent="Planner",
            step="plan",
            taskId="plan-task",
            contextId="planner",
            status="succeeded",
            text="A concrete initial draft",
        )
    ]
    state.stage_index = 1
    review_prompt = prompt_for(job)
    assert review_prompt.startswith("Stage: Review\n")
    assert "independent critique only" in review_prompt
    assert "A concrete initial draft" in review_prompt
    state.outputs.append(
        ChildOutput(
            agent="Reviewer",
            step="review",
            taskId="review-task",
            contextId="reviewer",
            status="succeeded",
            text="Assign a backup facilitator",
        )
    )
    state.stage_index = 2
    revision_prompt = prompt_for(job)
    assert revision_prompt.startswith("Stage: Revise\n")
    assert "Reviewer feedback:\nAssign a backup facilitator" in revision_prompt
    assert "A concrete initial draft" in revision_prompt


def test_artifact_reconnect_replaces_partial_text_before_appending():
    from agent_playground.services.a2a.coordinator import apply_remote_event
    from agent_playground.services.a2a.models import CollaborationState

    state = CollaborationState()
    first = StreamResponse(
        task=Task(
            id="remote",
            context_id="context",
            status=TaskStatus(state=TaskState.TASK_STATE_WORKING),
            artifacts=[Artifact(artifact_id="answer", parts=[Part(text="Saved")])],
        )
    )
    state = apply_remote_event(state, first)
    assert state.outputs[0].text == "Saved"
    replacement = StreamResponse(
        artifact_update=TaskArtifactUpdateEvent(
            task_id="remote",
            context_id="context",
            artifact=Artifact(artifact_id="answer", parts=[Part(text="Restarted")]),
            append=False,
        )
    )
    state = apply_remote_event(state, replacement)
    addition = StreamResponse(
        artifact_update=TaskArtifactUpdateEvent(
            task_id="remote",
            context_id="context",
            artifact=Artifact(artifact_id="answer", parts=[Part(text=" answer")]),
            append=True,
        )
    )
    state = apply_remote_event(state, addition)
    assert state.outputs[0].text == "Restarted answer"
    assert state.outputs[0].agent == "Planner"


def test_remote_input_required_keeps_existing_artifact():
    from agent_playground.services.a2a.coordinator import apply_remote_event
    from agent_playground.services.a2a.models import CollaborationState

    event = StreamResponse(
        task=Task(
            id="remote",
            context_id="context",
            status=TaskStatus(state=TaskState.TASK_STATE_INPUT_REQUIRED),
            artifacts=[
                Artifact(artifact_id="answer", parts=[Part(text="Partial plan")])
            ],
        )
    )
    state = apply_remote_event(CollaborationState(), event)
    assert state.status == "input_required"
    assert state.outputs[0].text == "Partial plan"


def test_coordinator_registration_replay_and_control_are_durable(
    monkeypatch: pytest.MonkeyPatch, postgres_database_url: str
):
    from agent_playground.db.a2a_jobs import (
        create_job,
        read_job,
        request_cancel,
        request_input,
    )
    from agent_playground.db.connection import app_engine, prepare_app_store
    from agent_playground.services.a2a.models import CollaborationRequest

    monkeypatch.setenv("APP_DATABASE_URL", postgres_database_url)
    app_engine.cache_clear()
    prepare_app_store()

    try:
        request = CollaborationRequest(
            id="job", task="Plan an order analysis", callback_token="secret"
        )
        create_job(request)
        create_job(request)
        saved = read_job("job")
        assert saved is not None
        assert saved.state.revision == 1
        with pytest.raises(ValueError, match="identity"):
            create_job(request.model_copy(update={"task": "Another task"}))
        with pytest.raises(ValueError, match="waiting"):
            request_input("job", "Audience")
        request_cancel("job")
        app_engine().dispose()
        app_engine.cache_clear()
        saved = read_job("job")
        assert saved is not None
        assert saved.state.cancel_requested
    finally:
        app_engine().dispose()
        app_engine.cache_clear()


def test_cancelled_external_result_resumes_parent_without_success_result():
    from agent_playground.workflows.external import ExternalTaskResult

    parsed = ExternalTaskResult.model_validate(
        {
            "kind": "external_task_result",
            "taskId": "job",
            "revision": 3,
            "status": "cancelled",
        }
    )
    assert parsed.status == "cancelled"


@pytest.mark.parametrize("sdk_error", [False, True])
def test_transient_cancel_transport_failure_retries_actual_remote_cancel(
    monkeypatch: pytest.MonkeyPatch, sdk_error: bool
):
    from unittest.mock import AsyncMock

    from a2a.client.errors import A2AClientError

    from agent_playground.db.a2a_jobs import CollaborationJob
    from agent_playground.services.a2a import coordinator
    from agent_playground.services.a2a.models import (
        CollaborationRequest,
        CollaborationState,
    )

    cancelled = False
    job = CollaborationJob(
        CollaborationRequest(id="job", task="Plan", callback_token="secret"),
        CollaborationState(cancel_requested=True),
        0,
    )

    def saved_job(job_id: str) -> CollaborationJob:
        return job

    monkeypatch.setattr(coordinator, "read_job", saved_job)
    client = AsyncMock()
    attempts = 0

    async def cancel(request: CancelTaskRequest):
        nonlocal cancelled, attempts
        attempts += 1

        if attempts == 1:
            if sdk_error:
                raise A2AClientError("Cancel response lost")

            raise httpx.ReadError("Cancel response lost")

        cancelled = True

    client.cancel_task.side_effect = cancel
    asyncio.run(asyncio.wait_for(coordinator.watch_cancel("job", client, "remote"), 2))
    assert cancelled
    assert attempts == 2


@pytest.mark.parametrize(
    "scenario",
    [
        "success",
        "clarification",
        "clarification_reconnect",
        "cancel",
        "reconnect",
        "deleted",
    ],
)
def test_coordinator_runs_real_http_agents(
    monkeypatch: pytest.MonkeyPatch, postgres_database_url: str, scenario: str
):
    from test_a2a_agents import running_server  # pyrefly: ignore[missing-import]

    from agent_playground.db.a2a_jobs import (
        claim_jobs,
        create_job,
        read_job,
        release_lease,
        request_cancel,
        request_input,
    )
    from agent_playground.db.a2a_tasks import PostgresTaskStore
    from agent_playground.db.connection import close_app_store, prepare_app_store
    from agent_playground.services.a2a.coordinator import process_job
    from agent_playground.services.a2a.models import CollaborationRequest

    close_app_store()
    monkeypatch.setenv("APP_DATABASE_URL", postgres_database_url)
    monkeypatch.setenv("A2A_DEMO_MODE", "scripted")
    prepare_app_store()
    events = []
    interrupted = False

    def callbacks(request: httpx.Request):
        nonlocal interrupted
        assert request.headers["Authorization"] == "Bearer secret"
        event = json.loads(request.content)
        events.append(event)

        if event.get("outputs") and event["outputs"][0]["text"] and not interrupted:
            if scenario == "cancel":
                request_cancel("job")
                interrupted = True
            elif scenario in {"reconnect", "clarification_reconnect"}:
                interrupted = True
                raise httpx.ReadError("Connection lost", request=request)
            elif scenario == "deleted":
                interrupted = True

                return httpx.Response(404)

        return httpx.Response(200, json={"accepted": True})

    async def run():
        create_job(
            CollaborationRequest(
                id="job",
                task="Plan an order analysis",
                callback_token="secret",
                require_input=scenario.startswith("clarification"),
            )
        )
        async with httpx.AsyncClient(
            transport=httpx.MockTransport(callbacks)
        ) as client:
            job = claim_jobs("owner")[0]

            if scenario == "reconnect":
                with pytest.raises(ExceptionGroup) as disconnected:
                    await process_job(job, "owner", client)

                assert isinstance(disconnected.value.exceptions[0], httpx.ReadError)
                release_lease("job", "owner")
                job = claim_jobs("owner")[0]

            await process_job(job, "owner", client)

            if scenario.startswith("clarification"):
                saved = read_job("job")
                assert saved is not None
                assert saved.state.status == "input_required"
                request_input("job", "Engineering team")
                release_lease("job", "owner")

                if scenario == "clarification_reconnect":
                    with pytest.raises(ExceptionGroup) as disconnected:
                        await process_job(claim_jobs("owner")[0], "owner", client)

                    assert isinstance(disconnected.value.exceptions[0], httpx.ReadError)
                    release_lease("job", "owner")

                await process_job(claim_jobs("owner")[0], "owner", client)

        saved = read_job("job")
        assert saved is not None
        result = saved.state
        assert result.status == (
            "cancelled" if scenario in {"cancel", "deleted"} else "succeeded"
        )
        assert any(
            event.get("outputs")
            and event["outputs"][0]["text"]
            and event["status"] == "running"
            for event in events
        )

        if scenario not in {"cancel", "deleted"}:
            assert [output.step for output in result.outputs] == [
                "plan",
                "review",
                "revise",
            ]
            assert all(output.status == "succeeded" for output in result.outputs)
            assert result.outputs[0].context_id == result.outputs[2].context_id

    try:
        with (
            running_server(PostgresTaskStore("planner")) as planner,
            running_server(PostgresTaskStore("reviewer")) as reviewer,
        ):
            monkeypatch.setenv("A2A_PLANNER_URL", planner)
            monkeypatch.setenv("A2A_REVIEWER_URL", reviewer)
            asyncio.run(asyncio.wait_for(run(), 30))
    finally:
        close_app_store()


@pytest.mark.parametrize("continuation", [False, True])
@pytest.mark.parametrize(
    "remote_state",
    [TaskState.TASK_STATE_SUBMITTED, TaskState.TASK_STATE_WORKING],
)
def test_coordinator_reuses_saved_remote_prompt_after_upgrade(
    monkeypatch: pytest.MonkeyPatch,
    postgres_database_url: str,
    continuation: bool,
    remote_state: TaskState,
) -> None:
    from a2a.server.context import ServerCallContext
    from a2a.types import Message, Role, SendMessageRequest
    from test_a2a_agents import running_server  # pyrefly: ignore[missing-import]

    from agent_playground.db.a2a_jobs import (
        CollaborationJob,
        change_job,
        claim_jobs,
        create_job,
        read_job,
    )
    from agent_playground.db.a2a_tasks import PostgresTaskStore
    from agent_playground.db.connection import close_app_store, prepare_app_store
    from agent_playground.services.a2a import coordinator
    from agent_playground.services.a2a.models import CollaborationRequest

    close_app_store()
    monkeypatch.setenv("APP_DATABASE_URL", postgres_database_url)
    monkeypatch.setenv("A2A_DEMO_MODE", "scripted")
    prepare_app_store()
    original_prompt_for = coordinator.prompt_for
    fresh_stages: list[int] = []

    def current_prompt_for(job: CollaborationJob) -> str:
        assert job.state.stage_index != 0, "A reserved request must keep its old prompt"
        fresh_stages.append(job.state.stage_index)

        return original_prompt_for(job)

    monkeypatch.setattr(coordinator, "prompt_for", current_prompt_for)

    async def run() -> None:
        job_id = "prompt-upgrade"
        create_job(
            CollaborationRequest(
                id=job_id,
                task="Plan an order analysis",
                callback_token="secret",
                require_input=True,
            )
        )
        store = PostgresTaskStore("planner")
        context = ServerCallContext()
        legacy_message = Message(
            role=Role.ROLE_USER,
            message_id=f"{job_id}-plan",
            context_id=f"{job_id}-planner",
            parts=[
                Part(text="Plan an order analysis."),
                Part(text="Legacy draft instructions."),
            ],
            metadata={"templateVersion": "legacy"},
        )
        remote = await store.reserve_request(
            SendMessageRequest(message=legacy_message, metadata={"requireInput": True}),
            context,
        )

        if continuation:
            remote.status.state = TaskState.TASK_STATE_INPUT_REQUIRED
            remote.status.message.CopyFrom(
                Message(
                    role=Role.ROLE_AGENT,
                    message_id="question",
                    parts=[Part(text="Who is the audience?")],
                )
            )
            await store.save(remote, context)
            legacy_message = Message(
                role=Role.ROLE_USER,
                message_id=f"{job_id}-plan-input",
                task_id=remote.id,
                context_id=remote.context_id,
                parts=[
                    Part(text="Legacy continuation instructions."),
                    Part(text="Audience: Engineering team"),
                ],
                metadata={"templateVersion": "legacy-answer"},
            )
            remote = await store.reserve_request(
                SendMessageRequest(
                    message=legacy_message, metadata={"requireInput": False}
                ),
                context,
            )
            change_job(
                job_id,
                lambda state: state.model_copy(
                    update={"user_input": "Engineering team"}
                ),
            )

        remote.status.state = remote_state
        await store.save(remote, context)

        async with httpx.AsyncClient(
            transport=httpx.MockTransport(lambda request: httpx.Response(200))
        ) as callbacks:
            await coordinator.process_job(claim_jobs("owner")[0], "owner", callbacks)

        completed = read_job(job_id)
        assert completed is not None
        assert completed.state.status == (
            "succeeded" if continuation else "input_required"
        )
        assert fresh_stages == ([1, 2] if continuation else [])
        recovered = await store.get(remote.id, context)
        assert recovered is not None
        replayed = next(
            message
            for message in recovered.history
            if message.message_id == legacy_message.message_id
        )
        assert replayed == legacy_message

    try:
        with (
            running_server(PostgresTaskStore("planner")) as planner,
            running_server(PostgresTaskStore("reviewer")) as reviewer,
        ):
            monkeypatch.setenv("A2A_PLANNER_URL", planner)
            monkeypatch.setenv("A2A_REVIEWER_URL", reviewer)
            asyncio.run(asyncio.wait_for(run(), 15))
    finally:
        close_app_store()


def test_expired_lease_cannot_write_or_renew(
    monkeypatch: pytest.MonkeyPatch, postgres_database_url: str
):
    from datetime import UTC, datetime, timedelta

    from sqlalchemy import update

    from agent_playground.db.a2a_jobs import (
        change_job,
        claim_jobs,
        create_job,
        renew_lease,
    )
    from agent_playground.db.connection import (
        app_engine,
        close_app_store,
        prepare_app_store,
    )
    from agent_playground.db.schema import a2a_jobs
    from agent_playground.services.a2a.models import CollaborationRequest

    close_app_store()
    monkeypatch.setenv("APP_DATABASE_URL", postgres_database_url)
    prepare_app_store()

    try:
        create_job(CollaborationRequest(id="job", task="Plan", callback_token="secret"))
        claim_jobs("old-owner")

        with app_engine().begin() as connection:
            connection.execute(
                update(a2a_jobs)
                .where(a2a_jobs.c.id == "job")
                .values(lease_until=datetime.now(UTC) - timedelta(seconds=1))
            )

        assert not renew_lease("job", "old-owner")

        with pytest.raises(ValueError, match="lease"):
            change_job(
                "job",
                lambda state: state.model_copy(update={"message": "Stale"}),
                "old-owner",
            )

        assert len(claim_jobs("new-owner")) == 1

        with pytest.raises(ValueError, match="lease"):
            change_job(
                "job",
                lambda state: state.model_copy(update={"message": "Stale"}),
                "old-owner",
            )
    finally:
        close_app_store()
