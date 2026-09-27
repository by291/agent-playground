"""Persist completed workflow UI steps before publishing stream events."""

import asyncio
import os
from dataclasses import dataclass
from functools import lru_cache
from uuid import uuid4

from sqlalchemy import (
    BigInteger,
    Column,
    DateTime,
    Integer,
    MetaData,
    String,
    Table,
    UniqueConstraint,
    create_engine,
    select,
    update,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.engine import Engine
from sqlalchemy.sql import func

metadata = MetaData(schema="public")
WORKFLOW_OUTPUT_VERSION = 2
conversations = Table(
    "conversations",
    metadata,
    Column("thread_id", String, primary_key=True),
    Column("next_output_seq", BigInteger, nullable=False),
    extend_existing=True,
)
conversation_runs = Table(
    "conversation_runs",
    metadata,
    Column("agui_run_id", String, primary_key=True),
    Column("thread_id", String, nullable=False),
    extend_existing=True,
)
workflow_outputs = Table(
    "workflow_outputs",
    metadata,
    Column("id", String, primary_key=True),
    Column("thread_id", String, nullable=False),
    Column("agui_run_id", String, nullable=False),
    Column("workflow_call_id", String, nullable=False),
    Column("step_id", String, nullable=False),
    Column("step_seq", Integer, nullable=False),
    Column("output_seq", BigInteger, nullable=False),
    Column("kind", String, nullable=False, server_default="a2ui"),
    Column("version", Integer, nullable=False, server_default="1"),
    Column("payload", JSONB, nullable=False),
    Column(
        "created_at", DateTime(timezone=True), nullable=False, server_default=func.now()
    ),
    UniqueConstraint("thread_id", "workflow_call_id", "step_id", "version"),
    UniqueConstraint("thread_id", "output_seq"),
)


@dataclass(frozen=True)
class WorkflowOutput:
    id: str
    agui_run_id: str
    output_seq: int
    payload: dict[str, object]


@lru_cache(maxsize=1)
def _engine() -> Engine:
    database_url = os.environ.get("APP_DATABASE_URL")
    if not database_url:
        raise RuntimeError("APP_DATABASE_URL is required for workflow output")
    engine = create_engine(
        database_url.replace("postgresql://", "postgresql+psycopg://", 1)
    )
    workflow_outputs.create(engine, checkfirst=True)
    return engine


def prepare_output_store() -> None:
    _engine()


def _store(
    thread_id: str,
    agui_run_id: str,
    workflow_call_id: str,
    step_id: str,
    step_seq: int,
    payload: dict[str, object],
) -> WorkflowOutput:
    with _engine().begin() as connection:
        # Lock before checking the idempotency key so concurrent writers see the winner.
        conversation = connection.execute(
            select(conversations.c.next_output_seq)
            .where(conversations.c.thread_id == thread_id)
            .with_for_update()
        ).scalar_one_or_none()
        if conversation is None:
            raise ValueError("Unknown conversation")
        existing = (
            connection.execute(
                select(workflow_outputs)
                .where(
                    workflow_outputs.c.thread_id == thread_id,
                    workflow_outputs.c.workflow_call_id == workflow_call_id,
                    workflow_outputs.c.step_id == step_id,
                )
                .order_by(workflow_outputs.c.version.desc())
                .limit(1)
            )
            .mappings()
            .one_or_none()
        )
        if existing is not None:
            # A resumed call must publish its saved card, even after a catalog upgrade.
            if (
                existing["version"] == WORKFLOW_OUTPUT_VERSION
                and existing["payload"] != payload
            ):
                raise ValueError("Workflow output payload conflict")
            return WorkflowOutput(
                existing["id"],
                existing["agui_run_id"],
                existing["output_seq"],
                existing["payload"],
            )
        matching_run = connection.execute(
            select(conversation_runs.c.agui_run_id).where(
                conversation_runs.c.agui_run_id == agui_run_id,
                conversation_runs.c.thread_id == thread_id,
            )
        ).first()
        if matching_run is None:
            raise ValueError("Workflow output has no matching AG-UI run")
        output_id = str(uuid4())
        connection.execute(
            workflow_outputs.insert().values(
                id=output_id,
                thread_id=thread_id,
                agui_run_id=agui_run_id,
                workflow_call_id=workflow_call_id,
                step_id=step_id,
                step_seq=step_seq,
                output_seq=conversation,
                version=WORKFLOW_OUTPUT_VERSION,
                payload=payload,
            )
        )
        connection.execute(
            update(conversations)
            .where(conversations.c.thread_id == thread_id)
            .values(next_output_seq=conversation + 1)
        )
        return WorkflowOutput(output_id, agui_run_id, conversation, payload)


async def store_workflow_output(
    thread_id: str,
    agui_run_id: str,
    workflow_call_id: str,
    step_id: str,
    step_seq: int,
    payload: dict[str, object],
) -> WorkflowOutput:
    return await asyncio.to_thread(
        _store, thread_id, agui_run_id, workflow_call_id, step_id, step_seq, payload
    )
