"""Store workflow outputs atomically with stable identity and sequence allocation."""

from dataclasses import dataclass
from uuid import uuid4

from sqlalchemy import RowMapping, select, text, update

from agent_playground.db.async_operations import run_database_operation
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


@dataclass(frozen=True, kw_only=True)
class StoreWorkflowOutput:
    thread_id: str
    agui_run_id: str
    workflow_call_id: str
    step_id: str
    step_seq: int
    payload: dict[str, object]


def _replay_output(
    existing: RowMapping, requested_payload: dict[str, object]
) -> WorkflowOutput:
    if existing["version"] != WORKFLOW_OUTPUT_VERSION:
        raise ValueError(
            "Unsupported workflow output version; start a new conversation"
        )

    if existing["payload"] != requested_payload:
        raise ValueError("Workflow output payload conflict")

    # Replay returns the original run and sequence, even when a later
    # run resumes the same workflow step.
    return WorkflowOutput(
        id=existing["id"],
        agui_run_id=existing["agui_run_id"],
        output_seq=existing["output_seq"],
        payload=existing["payload"],
    )


def _store(request: StoreWorkflowOutput) -> WorkflowOutput:
    with app_engine().begin() as connection:
        # Lock before checking the idempotency key so concurrent writers see the winner.
        sequence_query = (
            select(conversations.c.next_output_seq)
            .where(conversations.c.thread_id == request.thread_id)
            .with_for_update()
        )
        next_output_seq = connection.execute(sequence_query).scalar_one_or_none()

        if next_output_seq is None:
            raise ValueError("Unknown conversation")

        output_query = select(workflow_outputs).where(
            workflow_outputs.c.thread_id == request.thread_id,
            workflow_outputs.c.workflow_call_id == request.workflow_call_id,
            workflow_outputs.c.step_id == request.step_id,
        )
        latest_output = output_query.order_by(workflow_outputs.c.version.desc()).limit(
            1
        )
        existing = connection.execute(latest_output).mappings().one_or_none()

        if existing is not None:
            return _replay_output(existing, request.payload)

        matching_run = connection.execute(
            select(conversation_runs.c.agui_run_id).where(
                conversation_runs.c.agui_run_id == request.agui_run_id,
                conversation_runs.c.thread_id == request.thread_id,
            )
        ).first()

        if matching_run is None:
            raise ValueError("Workflow output has no matching AG-UI run")

        output_id = str(uuid4())
        output = WorkflowOutput(
            id=output_id,
            agui_run_id=request.agui_run_id,
            output_seq=next_output_seq,
            payload=request.payload,
        )

        connection.execute(
            workflow_outputs.insert().values(
                id=output.id,
                thread_id=request.thread_id,
                agui_run_id=output.agui_run_id,
                workflow_call_id=request.workflow_call_id,
                step_id=request.step_id,
                step_seq=request.step_seq,
                output_seq=output.output_seq,
                version=WORKFLOW_OUTPUT_VERSION,
                payload=output.payload,
            )
        )
        connection.execute(
            update(conversations)
            .where(conversations.c.thread_id == request.thread_id)
            .values(next_output_seq=next_output_seq + 1)
        )

        # PostgreSQL delivers NOTIFY only after the output and its sequence
        # allocation commit together.
        connection.execute(
            text("SELECT pg_notify('conversation_changed', :thread_id)"),
            {"thread_id": request.thread_id},
        )

        return output


async def store_workflow_output(request: StoreWorkflowOutput) -> WorkflowOutput:
    """Store one workflow step or replay its original identity and sequence."""
    # A running transaction can still commit after cancellation. Drain it so
    # the caller cannot exit while its output write is in flight.
    return await run_database_operation(_store, request)
