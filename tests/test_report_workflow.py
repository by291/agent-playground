"""Keep report submission identity durable across lost upstream responses."""

import asyncio
import json
from typing import Any

import httpx
import pytest
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.graph import END, START, StateGraph
from langgraph.types import Command, StateSnapshot

from agent_playground.workflows.external import register_external_task
from agent_playground.workflows.report.graph import ReportState, make_report_workflow
from tests.agent_config import update_agent_config


class ReportApiFixture:
    def __init__(self, outcome: str):
        self.outcome = outcome
        self.jobs: dict[str, dict[str, Any]] = {}
        self.registrations: list[dict[str, Any]] = []
        self.submissions: list[dict[str, Any]] = []
        self.events: list[dict[str, Any]] = []

    def handle(self, request: httpx.Request) -> httpx.Response:
        if request.url.path == "/internal/external-tasks":
            assert request.headers["Authorization"] == "Bearer internal-token"
            body = json.loads(request.content)
            self.registrations.append(body)
            return httpx.Response(
                200,
                json={"taskId": body["taskId"], "callbackToken": "callback-token"},
            )

        if request.url.path.endswith("/events"):
            assert request.headers["Authorization"] == "Bearer callback-token"
            self.events.append(json.loads(request.content))
            return httpx.Response(200, json={"accepted": True})

        if self.outcome == "unavailable":
            raise httpx.ReadTimeout("Report service unavailable", request=request)

        if request.method == "POST" and request.url.path == "/report-demo/jobs":
            body = json.loads(request.content)
            self.submissions.append(body)

            if self.outcome == "uncertain-then-rejected":
                if len(self.submissions) == 1:
                    raise httpx.ReadTimeout(
                        "Submission response unavailable", request=request
                    )

                return httpx.Response(422)

            if self.outcome in {"rejected", "rejected-with-existing-job"}:
                return httpx.Response(422, json={"detail": "Invalid report task"})

            self.jobs.setdefault(body["id"], body)

            if self.outcome in {"response-lost", "accepted-unconfirmed"}:
                raise httpx.ReadTimeout("Accepted response lost", request=request)

            if self.outcome == "server-error":
                return httpx.Response(503)

            return httpx.Response(202, json={"jobId": body["id"], "status": "queued"})

        if request.method == "GET":
            if self.outcome == "accepted-unconfirmed":
                raise httpx.ReadTimeout("Job lookup unavailable", request=request)

            job_id = request.url.path.rsplit("/", 1)[1]
            job = self.jobs.get(job_id)

            if job is None:
                return httpx.Response(404)

            return httpx.Response(
                200,
                json={
                    "jobId": job_id,
                    "status": "queued",
                    "task": job["task"],
                    "outcome": job["outcome"],
                },
            )

        raise AssertionError(
            f"Unexpected report request: {request.method} {request.url}"
        )


def configure_report_api(monkeypatch: pytest.MonkeyPatch, outcome: str):
    api = ReportApiFixture(outcome)
    client_class = httpx.AsyncClient
    transport = httpx.MockTransport(api.handle)

    def client_factory(**kwargs: Any):
        return client_class(transport=transport, **kwargs)

    async def publish(**kwargs: Any):
        return None

    monkeypatch.setattr(httpx, "AsyncClient", client_factory)
    update_agent_config("workflow", api_token="internal-token")
    update_agent_config("workflow", app_api_url="http://app")
    update_agent_config("services", report_demo_url="http://report/report-demo")
    monkeypatch.setattr(
        "agent_playground.workflows.report.graph.publish_workflow_output", publish
    )
    builder = StateGraph(ReportState)
    builder.add_node("report", make_report_workflow())
    builder.add_edge(START, "report")
    builder.add_edge("report", END)

    return api, builder.compile(checkpointer=InMemorySaver())


@pytest.mark.parametrize("outcome", ["response-lost", "server-error"])
def test_report_recovers_accepted_submission_and_waits_for_the_original_task(
    monkeypatch: pytest.MonkeyPatch, outcome: str
):
    api, graph = configure_report_api(monkeypatch, outcome)

    async def run():
        config = {
            "configurable": {"thread_id": "report"},
            "metadata": {"agui_run_id": "run"},
        }
        paused = await graph.ainvoke(
            ReportState(task="Monthly report", workflow_call_id="call"), config
        )
        task_id = api.registrations[0]["taskId"]
        snapshot = await graph.aget_state(config, subgraphs=True)
        report = snapshot.tasks[0].state
        assert isinstance(report, StateSnapshot)
        assert report.values["task_id"] == task_id
        assert paused["__interrupt__"][0].value == {
            "kind": "workflow_external_wait",
            "taskId": task_id,
            "workflowCallId": "call",
        }
        assert list(api.jobs) == [task_id]
        assert len(api.submissions) == 1
        completed = await graph.ainvoke(
            Command(
                resume={
                    "kind": "external_task_result",
                    "taskId": task_id,
                    "revision": 5,
                    "status": "succeeded",
                    "result": {"summary": "Monthly report is ready"},
                }
            ),
            config,
        )
        assert completed["status"] == "succeeded"
        assert completed["result"] == {"summary": "Monthly report is ready"}
        assert len(api.submissions) == 1

    asyncio.run(run())


def test_report_rejection_completes_the_registered_task_as_failed(
    monkeypatch: pytest.MonkeyPatch,
):
    api, graph = configure_report_api(monkeypatch, "rejected")

    async def run():
        config = {
            "configurable": {"thread_id": "rejected-report"},
            "metadata": {"agui_run_id": "run"},
        }
        paused = await graph.ainvoke(
            ReportState(task="Monthly report", workflow_call_id="call"), config
        )
        task_id = api.registrations[0]["taskId"]
        assert paused["__interrupt__"][0].value["taskId"] == task_id
        assert len(api.events) == 1
        event = api.events[0]
        assert event["status"] == "failed"
        assert event["revision"] == 1
        assert "422" in event["error"]
        assert not api.jobs
        completed = await graph.ainvoke(
            Command(
                resume={
                    "kind": "external_task_result",
                    "taskId": task_id,
                    "revision": event["revision"],
                    "status": event["status"],
                    "error": event["error"],
                }
            ),
            config,
        )
        assert completed["status"] == "failed"
        assert completed["error"] == event["error"]

    asyncio.run(run())


@pytest.mark.parametrize("outcome", ["unavailable", "uncertain-then-rejected"])
def test_unconfirmed_report_submission_can_retry_its_checkpointed_registration(
    monkeypatch: pytest.MonkeyPatch, outcome: str
):
    api, graph = configure_report_api(monkeypatch, outcome)

    async def run():
        config = {
            "configurable": {"thread_id": "unconfirmed-report"},
            "metadata": {"agui_run_id": "run"},
        }

        with pytest.raises(httpx.HTTPError):
            await graph.ainvoke(
                ReportState(task="Monthly report", workflow_call_id="call"), config
            )

        task_id = api.registrations[0]["taskId"]
        snapshot = await graph.aget_state(config, subgraphs=True)
        report = snapshot.tasks[0].state
        assert isinstance(report, StateSnapshot)
        assert report.values["task_id"] == task_id
        assert not snapshot.tasks[0].interrupts
        assert not api.events
        api.outcome = "accepted"
        paused = await graph.ainvoke(None, config)
        assert paused["__interrupt__"][0].value["taskId"] == task_id
        assert len(api.registrations) == 1
        assert list(api.jobs) == [task_id]

    asyncio.run(run())


def test_checkpoint_replay_confirms_an_existing_job_before_a_later_rejection(
    monkeypatch: pytest.MonkeyPatch,
):
    api, graph = configure_report_api(monkeypatch, "accepted-unconfirmed")

    async def run():
        config = {
            "configurable": {"thread_id": "accepted-unconfirmed"},
            "metadata": {"agui_run_id": "run"},
        }

        with pytest.raises(httpx.HTTPError):
            await graph.ainvoke(
                ReportState(task="Monthly report", workflow_call_id="call"), config
            )

        task_id = api.registrations[0]["taskId"]
        assert task_id in api.jobs
        api.outcome = "rejected-with-existing-job"
        paused = await graph.ainvoke(None, config)
        assert paused["__interrupt__"][0].value["taskId"] == task_id
        assert not api.events

    asyncio.run(run())


def test_report_can_recover_a_submission_checkpoint_from_before_registration_was_split(
    monkeypatch: pytest.MonkeyPatch,
):
    api, graph = configure_report_api(monkeypatch, "accepted")

    async def legacy_submit(state: ReportState):
        await register_external_task(
            workflow_call_id=state.workflow_call_id,
            step_id="report",
            label="Generate report",
        )
        raise httpx.ReadTimeout("Legacy submission response lost")

    legacy = StateGraph(ReportState)
    legacy.add_node("submit", legacy_submit)
    legacy.add_edge(START, "submit")
    legacy.add_edge("submit", END)
    builder = StateGraph(ReportState)
    builder.add_node("report", legacy.compile())
    builder.add_edge(START, "report")
    builder.add_edge("report", END)
    saver = graph.checkpointer
    assert isinstance(saver, InMemorySaver)
    legacy_graph = builder.compile(checkpointer=saver)

    async def run():
        config = {
            "configurable": {"thread_id": "legacy-report"},
            "metadata": {"agui_run_id": "run"},
        }

        with pytest.raises(httpx.ReadTimeout):
            await legacy_graph.ainvoke(
                ReportState(task="Monthly report", workflow_call_id="call"), config
            )

        task_id = api.registrations[0]["taskId"]
        paused = await graph.ainvoke(None, config)
        assert paused["__interrupt__"][0].value["taskId"] == task_id
        assert [registration["taskId"] for registration in api.registrations] == [
            task_id,
            task_id,
        ]
        assert list(api.jobs) == [task_id]

    asyncio.run(run())
