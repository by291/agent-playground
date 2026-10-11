"""Persist idempotent SQL demonstration receipts without executing their SQL."""

import asyncio
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert

from agent_playground.db.connection import app_engine
from agent_playground.db.schema import sql_demo_submissions


@dataclass(frozen=True)
class SqlSubmissionRecord:
    id: str
    sql: str


class SubmissionConflictError(ValueError):
    """An existing receipt key belongs to a different SQL statement."""


def _store(*, submission_id: str, sql: str) -> SqlSubmissionRecord:
    with app_engine().begin() as connection:
        # Insert first so concurrent retries share one receipt. The following
        # read checks the winning statement before this transaction commits.
        connection.execute(
            insert(sql_demo_submissions)
            .values(id=submission_id, sql=sql)
            .on_conflict_do_nothing(index_elements=[sql_demo_submissions.c.id])
        )
        row = (
            connection.execute(
                select(sql_demo_submissions).where(
                    sql_demo_submissions.c.id == submission_id
                )
            )
            .mappings()
            .one()
        )

        if row["sql"] != sql:
            raise SubmissionConflictError(
                "Submission key is already used for another SQL"
            )

        return SqlSubmissionRecord(id=row["id"], sql=row["sql"])


def _read(submission_id: str) -> SqlSubmissionRecord | None:
    with app_engine().connect() as connection:
        row = (
            connection.execute(
                select(sql_demo_submissions).where(
                    sql_demo_submissions.c.id == submission_id
                )
            )
            .mappings()
            .one_or_none()
        )

        if row is None:
            return None

        return SqlSubmissionRecord(id=row["id"], sql=row["sql"])


async def store_sql_submission(*, submission_id: str, sql: str) -> SqlSubmissionRecord:
    """Store or replay a receipt; the SQL text is never executed here."""
    return await asyncio.to_thread(_store, submission_id=submission_id, sql=sql)


async def read_sql_submission(submission_id: str) -> SqlSubmissionRecord | None:
    return await asyncio.to_thread(_read, submission_id)
