"""Verify independently advancing report job callbacks and durable delivery."""

import asyncio
from datetime import UTC, datetime, timedelta

import httpx
import pytest

from agent_playground.db.connection import app_engine, prepare_app_store
from agent_playground.db.report_jobs import (
    create_report_job as store_report_job,
)
from agent_playground.db.report_jobs import (
    mark_report_event_delivered,
)
from agent_playground.http import app
from agent_playground.services.report.jobs import pending_report_events
from agent_playground.services.report.models import ReportRequest
from agent_playground.services.report.worker import deliver_report_events


def create_report_job(request: ReportRequest):
    return store_report_job(
        job_id=request.id,
        task=request.task,
        callback_token=request.callback_token,
        outcome=request.outcome,
    )


def test_report_api_reconciles_an_accepted_job_without_exposing_callback_credentials(
    monkeypatch: pytest.MonkeyPatch,
    postgres_database_url: str,
):
    monkeypatch.setenv("APP_DATABASE_URL", postgres_database_url)
    app_engine.cache_clear()
    prepare_app_store()
    engine = app_engine()

    async def run():
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://demo"
        ) as client:
            request = {
                "id": "reconciled-job",
                "task": "Monthly report",
                "callback_token": "callback-secret",
                "outcome": "succeeded",
            }
            accepted = await client.post("/report-demo/jobs", json=request)
            assert accepted.status_code == 202
            unauthorized = await client.get("/report-demo/jobs/reconciled-job")
            assert unauthorized.status_code == 401
            response = await client.get(
                "/report-demo/jobs/reconciled-job",
                headers={"Authorization": "Bearer callback-secret"},
            )
            assert response.status_code == 200
            assert response.json() == {
                "jobId": "reconciled-job",
                "status": "queued",
                "task": "Monthly report",
                "outcome": "succeeded",
            }
            assert "callback-secret" not in response.text
            replay = await client.post("/report-demo/jobs", json=request)
            assert replay.json() == accepted.json()
            missing = await client.get(
                "/report-demo/jobs/missing",
                headers={"Authorization": "Bearer callback-secret"},
            )
            assert missing.status_code == 404

    try:
        asyncio.run(run())
    finally:
        engine.dispose()
        app_engine.cache_clear()


def test_report_events_resume_from_the_last_committed_delivery(
    monkeypatch: pytest.MonkeyPatch,
    postgres_database_url: str,
):
    monkeypatch.setenv("APP_DATABASE_URL", postgres_database_url)
    app_engine.cache_clear()
    prepare_app_store()
    engine = app_engine()

    try:
        request = ReportRequest(
            id="job",
            task="Monthly report",
            callback_token="token",
            outcome="succeeded",
        )
        first = create_report_job(request)
        assert create_report_job(request) == first
        assert pending_report_events(now=first.created_at - timedelta(seconds=1)) == []
        events = pending_report_events(now=first.created_at + timedelta(seconds=20))
        assert events[0][1].revision == 1
        mark_report_event_delivered("job", 1)
        engine.dispose()
        app_engine.cache_clear()
        engine = app_engine()
        events = pending_report_events(now=first.created_at + timedelta(seconds=20))
        assert events[0][1].revision == 2

        for revision in range(2, 6):
            events = pending_report_events(
                now=datetime.now(UTC) + timedelta(seconds=20)
            )
            assert events[0][1].revision == revision
            mark_report_event_delivered("job", revision)

        assert (
            pending_report_events(now=datetime.now(UTC) + timedelta(seconds=20)) == []
        )
        with pytest.raises(ValueError, match="identity conflict"):
            create_report_job(request.model_copy(update={"task": "Other task"}))
        create_report_job(
            ReportRequest(
                id="deleted-job",
                task="Deleted conversation",
                callback_token="token",
            )
        )

        async def deliver_to_deleted_conversation():
            transport = httpx.MockTransport(
                lambda request: httpx.Response(404, request=request)
            )
            async with httpx.AsyncClient(transport=transport) as client:
                await deliver_report_events(client)

        asyncio.run(deliver_to_deleted_conversation())
        assert (
            pending_report_events(now=datetime.now(UTC) + timedelta(seconds=20)) == []
        )
    finally:
        engine.dispose()
        app_engine.cache_clear()
