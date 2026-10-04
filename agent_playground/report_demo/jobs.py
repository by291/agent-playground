"""Build timed callback snapshots for the demonstration report API."""

from datetime import UTC, datetime

from agent_playground.db.report_jobs import ReportJob, pending_report_jobs
from agent_playground.report_demo.models import ReportEvent

FINAL_REVISION = 5


def report_event(job: ReportJob, revision: int) -> ReportEvent:
    stages = [
        ("queued", "Queued for report generation", 0),
        ("preparing", "Preparing report data", 20),
        ("processing", "Processing report data", 60),
        ("finalizing", "Finalizing the report", 90),
    ]

    if revision <= 4:
        stage, message, progress = stages[revision - 1]
        return ReportEvent(
            revision=revision,
            status="queued" if revision == 1 else "running",
            stage=stage,
            message=message,
            progress=progress,
        )

    if job.outcome == "failed":
        return ReportEvent(
            revision=5,
            status="failed",
            stage="failed",
            message="Report generation failed",
            progress=90,
            error="The demo report service could not finalize the report.",
        )

    return ReportEvent(
        revision=5,
        status="succeeded",
        stage="completed",
        message="The report is ready",
        progress=100,
        result={
            "title": "Generated report",
            "summary": f"The demo report service completed: {job.task}",
            "sections": ["Data prepared", "Analysis completed", "Report finalized"],
        },
    )


def pending_report_events(
    *, now: datetime | None = None
) -> list[tuple[ReportJob, ReportEvent]]:
    current = now or datetime.now(UTC)
    events = []

    for job in pending_report_jobs(FINAL_REVISION):
        revision = job.delivered_revision + 1

        if (current - job.created_at).total_seconds() >= (revision - 1) * 3:
            events.append((job, report_event(job, revision)))

    return events
