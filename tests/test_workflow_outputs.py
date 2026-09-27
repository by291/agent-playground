"""Check output identity when a persisted workflow resumes across catalog versions."""

import pytest
from sqlalchemy import select
from testcontainers.community.postgres import PostgresContainer

from agent_playground.workflow_outputs import (
    _engine,
    _store,
    conversation_runs,
    conversations,
    metadata,
    workflow_outputs,
)


def test_catalog_change_preserves_replayed_output(monkeypatch: pytest.MonkeyPatch):
    old_payload: dict[str, object] = {"kind": "a2ui", "messages": [{"version": "v0.9"}]}
    new_payload: dict[str, object] = {
        "kind": "a2ui",
        "messages": [{"version": "v0.9.1"}],
    }

    with PostgresContainer("postgres:18-alpine") as postgres:
        monkeypatch.setenv("APP_DATABASE_URL", postgres.get_connection_url(driver=None))
        _engine.cache_clear()
        engine = _engine()
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

            replay = _store("thread", "new-run", "call", "review", 3, new_payload)
            assert replay.id == "old-output"
            assert replay.agui_run_id == "old-run"
            assert replay.payload == old_payload

            fresh = _store("thread", "new-run", "new-call", "idea", 1, new_payload)
            assert fresh.payload == new_payload
            assert (
                _store("thread", "new-run", "new-call", "idea", 1, new_payload) == fresh
            )
            with pytest.raises(ValueError, match="payload conflict"):
                _store("thread", "new-run", "new-call", "idea", 1, old_payload)

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
            assert versions == [1, 2]
        finally:
            _engine.cache_clear()
            engine.dispose()
