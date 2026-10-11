"""Durable coordinator jobs and leases independent of browser/run lifetimes."""

from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import Integer, RowMapping, and_, or_, select, update
from sqlalchemy.dialects.postgresql import insert

from agent_playground.db.connection import app_engine
from agent_playground.db.schema import a2a_jobs
from agent_playground.services.a2a.contracts import (
    CollaborationRequest,
    CollaborationState,
)


@dataclass(frozen=True)
class CollaborationJob:
    request: CollaborationRequest
    state: CollaborationState
    delivered_revision: int


def decode_job(row: RowMapping) -> CollaborationJob:
    return CollaborationJob(
        CollaborationRequest.model_validate(row["request"]),
        CollaborationState.model_validate(row["state"]),
        row["delivered_revision"],
    )


def create_job(request: CollaborationRequest) -> CollaborationJob:
    """Create or replay a coordinator job without replacing its saved state."""
    payload = request.model_dump()

    with app_engine().begin() as connection:
        # A retry can reuse the identity, but it cannot change the request
        # attached to another creator's durable state.
        connection.execute(
            insert(a2a_jobs)
            .values(
                id=request.id, request=payload, state=CollaborationState().model_dump()
            )
            .on_conflict_do_nothing()
        )
        row = (
            connection.execute(select(a2a_jobs).where(a2a_jobs.c.id == request.id))
            .mappings()
            .one()
        )

        if row["request"] != payload:
            raise ValueError("A2A job identity conflict")

        return decode_job(row)


def read_job(job_id: str) -> CollaborationJob | None:
    with app_engine().connect() as connection:
        row = (
            connection.execute(select(a2a_jobs).where(a2a_jobs.c.id == job_id))
            .mappings()
            .first()
        )

    return decode_job(row) if row else None


def change_job(
    job_id: str,
    operation: Callable[[CollaborationState], CollaborationState],
    owner: str | None = None,
) -> CollaborationJob:
    """Apply a state transition under the row lock and optional worker lease."""
    with app_engine().begin() as connection:
        # Serialize coordinator updates with user controls before testing the
        # lease and terminal state against the latest committed snapshot.
        row = (
            connection.execute(
                select(a2a_jobs).where(a2a_jobs.c.id == job_id).with_for_update()
            )
            .mappings()
            .one()
        )

        lease_is_current = (
            row["lease_owner"] == owner
            and row["lease_until"] is not None
            and row["lease_until"] > datetime.now(UTC)
        )

        if owner is not None and not lease_is_current:
            raise ValueError("A2A coordinator lease was lost")

        previous = CollaborationState.model_validate(row["state"])
        state = operation(previous.model_copy(deep=True))

        terminal_state_changed = previous.terminal and state != previous

        if terminal_state_changed:
            raise ValueError("A2A collaboration is already terminal")

        if state != previous:
            # Only persisted changes produce callback revisions; a replay keeps
            # its current revision and delivery offset.
            state.revision = previous.revision + 1
            connection.execute(
                update(a2a_jobs)
                .where(a2a_jobs.c.id == job_id)
                .values(state=state.model_dump())
            )

        return CollaborationJob(
            CollaborationRequest.model_validate(row["request"]),
            state,
            row["delivered_revision"],
        )


def request_cancel(job_id: str) -> CollaborationJob:
    def cancel(state: CollaborationState) -> CollaborationState:
        if state.terminal:
            raise ValueError("A2A collaboration is already terminal")

        state.cancel_requested = True
        state.message = "Cancellation requested; waiting for the agents"

        return state

    return change_job(job_id, cancel)


def request_input(job_id: str, text: str) -> CollaborationJob:
    def supply(state: CollaborationState) -> CollaborationState:
        if state.status != "input_required" or state.cancel_requested:
            raise ValueError("A2A collaboration is not waiting for input")

        state.user_input = text
        state.status = "running"
        state.message = "Continuing with the additional information"

        return state

    return change_job(job_id, supply)


def claim_jobs(owner: str, limit: int = 4) -> list[CollaborationJob]:
    """Lease available jobs that need execution, cancellation or delivery."""
    now = datetime.now(UTC)
    state = a2a_jobs.c.state
    has_pending_work = or_(
        state["revision"].astext.cast(Integer) > a2a_jobs.c.delivered_revision,
        and_(state["status"].astext.in_(["queued", "running"])),
        and_(
            state["status"].astext == "input_required",
            state["cancel_requested"].astext == "true",
        ),
    )

    with app_engine().begin() as connection:
        # Claim and assign ownership in one transaction. Other workers skip
        # locked rows rather than receiving the same job before this commit.
        rows = (
            connection.execute(
                select(a2a_jobs)
                .where(
                    has_pending_work,
                    or_(a2a_jobs.c.lease_until.is_(None), a2a_jobs.c.lease_until < now),
                )
                .limit(limit)
                .with_for_update(skip_locked=True)
            )
            .mappings()
            .all()
        )

        for row in rows:
            connection.execute(
                update(a2a_jobs)
                .where(a2a_jobs.c.id == row["id"])
                .values(lease_owner=owner, lease_until=now + timedelta(seconds=30))
            )

        return [decode_job(row) for row in rows]


def renew_lease(job_id: str, owner: str) -> bool:
    """Renew only a still-current lease; an expired worker cannot reclaim it."""
    with app_engine().begin() as connection:
        result = connection.execute(
            update(a2a_jobs)
            .where(
                a2a_jobs.c.id == job_id,
                a2a_jobs.c.lease_owner == owner,
                a2a_jobs.c.lease_until > datetime.now(UTC),
            )
            .values(lease_until=datetime.now(UTC) + timedelta(seconds=30))
        )

        return result.rowcount == 1


def release_lease(job_id: str, owner: str) -> None:
    """Release this owner's lease without disturbing a replacement worker."""
    with app_engine().begin() as connection:
        connection.execute(
            update(a2a_jobs)
            .where(a2a_jobs.c.id == job_id, a2a_jobs.c.lease_owner == owner)
            .values(lease_owner=None, lease_until=None)
        )


def mark_delivered(job_id: str, revision: int) -> None:
    """Record callback progress without regressing a newer delivery revision."""
    with app_engine().begin() as connection:
        connection.execute(
            update(a2a_jobs)
            .where(a2a_jobs.c.id == job_id, a2a_jobs.c.delivered_revision < revision)
            .values(delivered_revision=revision)
        )
