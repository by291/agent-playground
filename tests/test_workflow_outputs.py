"""Check output identity and reject unsupported persisted output versions."""

import asyncio
import threading
from dataclasses import replace

import pytest
from sqlalchemy import select

from agent_playground.db import workflow_outputs as output_store
from agent_playground.db.connection import app_engine
from agent_playground.db.schema import (
    conversation_runs,
    conversations,
    metadata,
    workflow_outputs,
)
from agent_playground.db.workflow_outputs import (
    StoreWorkflowOutput,
    WorkflowOutput,
    store_workflow_output,
)
from tests.agent_config import update_agent_config


def test_old_outputs_are_rejected_and_current_outputs_are_idempotent(
    monkeypatch: pytest.MonkeyPatch,
    postgres_database_url: str,
):
    old_payload: dict[str, object] = {"kind": "a2ui", "messages": [{"version": "v0.9"}]}
    new_payload: dict[str, object] = {
        "messages": [{"version": "v0.9.1"}],
    }

    update_agent_config("database", application_url=postgres_database_url)
    app_engine.cache_clear()
    engine = app_engine()

    try:
        metadata.create_all(engine)

        with engine.begin() as connection:
            connection.execute(
                conversations.insert().values(thread_id="thread", next_output_seq=2)
            )
            connection.execute(
                conversation_runs.insert(),
                [
                    {"agui_run_id": "old-run", "thread_id": "thread"},
                    {"agui_run_id": "new-run", "thread_id": "thread"},
                ],
            )
            connection.execute(
                workflow_outputs.insert().values(
                    id="old-output",
                    thread_id="thread",
                    agui_run_id="old-run",
                    workflow_call_id="call",
                    step_id="review",
                    step_seq=3,
                    output_seq=1,
                    version=1,
                    payload=old_payload,
                )
            )

        old_request = StoreWorkflowOutput(
            thread_id="thread",
            agui_run_id="new-run",
            workflow_call_id="call",
            step_id="review",
            step_seq=3,
            payload=new_payload,
        )
        new_request = StoreWorkflowOutput(
            thread_id="thread",
            agui_run_id="new-run",
            workflow_call_id="new-call",
            step_id="idea",
            step_seq=1,
            payload=new_payload,
        )

        with pytest.raises(ValueError, match="Unsupported workflow output version"):
            asyncio.run(store_workflow_output(old_request))

        fresh = asyncio.run(store_workflow_output(new_request))
        assert fresh.payload == new_payload

        replayed = asyncio.run(
            store_workflow_output(replace(new_request, agui_run_id="old-run"))
        )
        assert replayed == fresh

        with pytest.raises(ValueError, match="payload conflict"):
            asyncio.run(
                store_workflow_output(replace(new_request, payload=old_payload))
            )

        with engine.connect() as connection:
            versions = (
                connection.execute(
                    select(workflow_outputs.c.version).order_by(
                        workflow_outputs.c.output_seq
                    )
                )
                .scalars()
                .all()
            )

        assert versions == [1, 3]
    finally:
        app_engine.cache_clear()
        engine.dispose()


def test_cancelling_output_storage_waits_for_the_transaction(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    release_transaction = threading.Event()
    transaction_finished = threading.Event()

    async def verify() -> None:
        transaction_started = asyncio.Event()
        loop = asyncio.get_running_loop()

        def store(_request: StoreWorkflowOutput) -> WorkflowOutput:
            loop.call_soon_threadsafe(transaction_started.set)
            assert release_transaction.wait(timeout=5)
            transaction_finished.set()

            return WorkflowOutput(
                id="output", agui_run_id="run", output_seq=1, payload={}
            )

        monkeypatch.setattr(output_store, "_store", store)
        request = StoreWorkflowOutput(
            thread_id="thread",
            agui_run_id="run",
            workflow_call_id="call",
            step_id="review",
            step_seq=1,
            payload={},
        )
        storing = asyncio.create_task(store_workflow_output(request))

        try:
            await asyncio.wait_for(transaction_started.wait(), timeout=5)
            storing.cancel()
            await asyncio.sleep(0)

            assert not storing.done()
        finally:
            release_transaction.set()

            with pytest.raises(asyncio.CancelledError):
                await asyncio.wait_for(storing, timeout=5)

        assert transaction_finished.is_set()

    asyncio.run(verify())
