"""Build timed callback snapshots for the demonstration report API."""

from datetime import UTC, datetime

from agent_playground.db.report_jobs import ReportJob, pending_report_jobs
from agent_playground.services.report.models import ReportEvent

REVISION_INTERVAL_SECONDS = 3
FINALIZING_PROGRESS_PERCENT = 90
COMPLETE_PROGRESS_PERCENT = 100
REPORT_STAGES = (
    (
        "queued",
        "Queued for report generation",
        0,
    ),
    (
        "preparing",
        "Preparing report data",
        20,
    ),
    (
        "processing",
        "Processing report data",
        60,
    ),
    (
        "finalizing",
        "Finalizing the report",
        FINALIZING_PROGRESS_PERCENT,
    ),
)
FINAL_REVISION = len(REPORT_STAGES) + 1


def report_event(job: ReportJob, revision: int) -> ReportEvent:
    """Build the progress or conclusion recorded for a report revision."""
    if revision <= len(REPORT_STAGES):
        (
            stage,
            message,
            progress,
        ) = REPORT_STAGES[revision - 1]

        return ReportEvent(
            revision=revision,
            status="queued" if revision == 1 else "running",
            stage=stage,
            message=message,
            progress=progress,
        )

    if job.outcome == "failed":
        return ReportEvent(
            revision=FINAL_REVISION,
            status="failed",
            stage="failed",
            message="Report generation failed",
            progress=FINALIZING_PROGRESS_PERCENT,
            error="The demo report service could not finalize the report.",
        )

    return ReportEvent(
        revision=FINAL_REVISION,
        status="succeeded",
        stage="completed",
        message="The report is ready",
        progress=COMPLETE_PROGRESS_PERCENT,
        result={
            "title": "Generated report",
            "summary": f"The demo report service completed: {job.task}",
            "sections": [
                "Data prepared",
                "Analysis completed",
                "Report finalized",
            ],
        },
    )


def pending_report_events(
    *, now: datetime | None = None
) -> list[tuple[ReportJob, ReportEvent]]:
    """Find the next due callback for each report with pending revisions."""
    current_time = now or datetime.now(UTC)
    events = []

    for job in pending_report_jobs(FINAL_REVISION):
        revision = job.delivered_revision + 1

        elapsed_seconds = (current_time - job.created_at).total_seconds()
        revision_due = elapsed_seconds >= (revision - 1) * REVISION_INTERVAL_SECONDS

        # Advance one revision per acknowledged callback, even if the worker
        # resumes long after creation. Never skip durable progress snapshots.
        if revision_due:
            events.append((job, report_event(job, revision)))

    return events
