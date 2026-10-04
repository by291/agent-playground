"""Store workflow outputs atomically with stable identity and sequence allocation."""

import asyncio
from dataclasses import dataclass
from uuid import uuid4

from sqlalchemy import select, update

from agent_playground.db.connection import app_engine
from agent_playground.db.schema import (
    conversation_runs,
    conversations,
    workflow_outputs,
)

WORKFLOW_OUTPUT_VERSION = 3


@dataclass(frozen=True)
class WorkflowOutput:
    id: str
    agui_run_id: str
    output_seq: int
    payload: dict[str, object]


def _store(
    *,
    thread_id: str,
    agui_run_id: str,
    workflow_call_id: str,
    step_id: str,
    step_seq: int,
    payload: dict[str, object],
) -> WorkflowOutput:
    with app_engine().begin() as connection:
        # Lock before checking the idempotency key so concurrent writers see the winner.
        next_output_seq = connection.execute(
            select(conversations.c.next_output_seq)
            .where(conversations.c.thread_id == thread_id)
            .with_for_update()
        ).scalar_one_or_none()

        if next_output_seq is None:
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
            if existing["version"] != WORKFLOW_OUTPUT_VERSION:
                raise ValueError(
                    "Unsupported workflow output version; start a new conversation"
                )

            if existing["payload"] != payload:
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
                output_seq=next_output_seq,
                version=WORKFLOW_OUTPUT_VERSION,
                payload=payload,
            )
        )
        connection.execute(
            update(conversations)
            .where(conversations.c.thread_id == thread_id)
            .values(next_output_seq=next_output_seq + 1)
        )

        return WorkflowOutput(output_id, agui_run_id, next_output_seq, payload)


async def store_workflow_output(
    *,
    thread_id: str,
    agui_run_id: str,
    workflow_call_id: str,
    step_id: str,
    step_seq: int,
    payload: dict[str, object],
) -> WorkflowOutput:
    return await asyncio.to_thread(
        _store,
        thread_id=thread_id,
        agui_run_id=agui_run_id,
        workflow_call_id=workflow_call_id,
        step_id=step_id,
        step_seq=step_seq,
        payload=payload,
    )
