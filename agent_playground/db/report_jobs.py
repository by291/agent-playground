"""Persist report jobs and delivery offsets independently of workflow execution."""

from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert

from agent_playground.db.connection import app_engine
from agent_playground.db.schema import report_jobs


@dataclass(frozen=True)
class ReportJob:
    id: str
    task: str
    callback_token: str
    outcome: str
    delivered_revision: int
    created_at: datetime


def create_report_job(
    *, job_id: str, task: str, callback_token: str, outcome: str
) -> ReportJob:
    with app_engine().begin() as connection:
        connection.execute(
            insert(report_jobs)
            .values(
                id=job_id, task=task, callback_token=callback_token, outcome=outcome
            )
            .on_conflict_do_nothing()
        )
        row = (
            connection.execute(select(report_jobs).where(report_jobs.c.id == job_id))
            .mappings()
            .one()
        )
        job = ReportJob(
            id=row["id"],
            task=row["task"],
            callback_token=row["callback_token"],
            outcome=row["outcome"],
            delivered_revision=row["delivered_revision"],
            created_at=row["created_at"],
        )

        if (job.task, job.callback_token, job.outcome) != (
            task,
            callback_token,
            outcome,
        ):
            raise ValueError("Report job identity conflict")

        return job


def pending_report_jobs(final_revision: int) -> list[ReportJob]:
    with app_engine().connect() as connection:
        rows = (
            connection.execute(
                select(report_jobs).where(
                    report_jobs.c.delivered_revision < final_revision
                )
            )
            .mappings()
            .all()
        )

    jobs = []

    for row in rows:
        job = ReportJob(
            id=row["id"],
            task=row["task"],
            callback_token=row["callback_token"],
            outcome=row["outcome"],
            delivered_revision=row["delivered_revision"],
            created_at=row["created_at"],
        )
        jobs.append(job)

    return jobs


def mark_report_event_delivered(job_id: str, revision: int) -> None:
    with app_engine().begin() as connection:
        connection.execute(
            update(report_jobs)
            .where(
                report_jobs.c.id == job_id,
                report_jobs.c.delivered_revision == revision - 1,
            )
            .values(delivered_revision=revision)
        )


def stop_report_job(job_id: str, final_revision: int) -> None:
    with app_engine().begin() as connection:
        connection.execute(
            update(report_jobs)
            .where(report_jobs.c.id == job_id)
            .values(delivered_revision=final_revision)
        )


def read_report_job(job_id: str) -> ReportJob | None:
    with app_engine().connect() as connection:
        row = (
            connection.execute(select(report_jobs).where(report_jobs.c.id == job_id))
            .mappings()
            .first()
        )

    if row is None:
        return None

    return ReportJob(
        id=row["id"],
        task=row["task"],
        callback_token=row["callback_token"],
        outcome=row["outcome"],
        delivered_revision=row["delivered_revision"],
        created_at=row["created_at"],
    )
