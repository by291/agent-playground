"""Check output identity and reject unsupported persisted output versions."""

import pytest
from sqlalchemy import select
from testcontainers.community.postgres import PostgresContainer

from agent_playground.db.connection import output_engine
from agent_playground.db.schema import (
    conversation_runs,
    conversations,
    metadata,
    workflow_outputs,
)
from agent_playground.db.workflow_outputs import _store


def test_old_outputs_are_rejected_and_current_outputs_are_idempotent(
    monkeypatch: pytest.MonkeyPatch,
):
    old_payload: dict[str, object] = {"kind": "a2ui", "messages": [{"version": "v0.9"}]}
    new_payload: dict[str, object] = {
        "messages": [{"version": "v0.9.1"}],
    }

    with PostgresContainer("postgres:18-alpine") as postgres:
        monkeypatch.setenv("APP_DATABASE_URL", postgres.get_connection_url(driver=None))
        output_engine.cache_clear()
        engine = output_engine()

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

            with pytest.raises(ValueError, match="Unsupported workflow output version"):
                _store(
                    thread_id="thread",
                    agui_run_id="new-run",
                    workflow_call_id="call",
                    step_id="review",
                    step_seq=3,
                    payload=new_payload,
                )

            fresh = _store(
                thread_id="thread",
                agui_run_id="new-run",
                workflow_call_id="new-call",
                step_id="idea",
                step_seq=1,
                payload=new_payload,
            )

            assert fresh.payload == new_payload
            assert (
                _store(
                    thread_id="thread",
                    agui_run_id="old-run",
                    workflow_call_id="new-call",
                    step_id="idea",
                    step_seq=1,
                    payload=new_payload,
                )
                == fresh
            )

            with pytest.raises(ValueError, match="payload conflict"):
                _store(
                    thread_id="thread",
                    agui_run_id="new-run",
                    workflow_call_id="new-call",
                    step_id="idea",
                    step_seq=1,
                    payload=old_payload,
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
            output_engine.cache_clear()
            engine.dispose()
