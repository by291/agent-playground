"""HTTP endpoints for generating, checking and recording demonstration SQL."""

from fastapi import APIRouter, HTTPException

from agent_playground.db.sql_submissions import (
    SubmissionConflictError,
    read_sql_submission,
    store_sql_submission,
)
from agent_playground.services.sql.models import (
    CheckRequest,
    GenerateRequest,
    SqlCheck,
    SqlSource,
    SqlSubmission,
    SubmitRequest,
)
from agent_playground.services.sql.validation import check_sql

router = APIRouter(prefix="/sql-demo", tags=["SQL demonstration"])


@router.post("/generate")
async def generate_sql(request: GenerateRequest) -> SqlSource:
    return SqlSource(
        sql="SELECT * FROM orders;",
        dialect="postgres",
        schema_text=(
            "orders(id BIGINT, customer_id BIGINT, created_at TIMESTAMP, "
            "status TEXT, amount DECIMAL). Status values: paid, pending, cancelled. "
            "This fixed demo source deliberately uses a wildcard. "
            "Adapt it to the user's task using only this schema."
        ),
    )


@router.post("/check")
async def validate_sql(request: CheckRequest) -> SqlCheck:
    return check_sql(request.sql)


@router.post("/submit")
async def submit_sql(request: SubmitRequest) -> SqlSubmission:
    report = check_sql(request.sql)

    if not report.passed:
        raise HTTPException(422, report.issues)

    try:
        record = await store_sql_submission(submission_id=request.id, sql=request.sql)
    except SubmissionConflictError as error:
        raise HTTPException(409, str(error)) from error

    return SqlSubmission(id=record.id, sql=record.sql, status="submitted")


@router.get("/submissions/{submission_id}")
async def get_submission(submission_id: str) -> SqlSubmission:
    record = await read_sql_submission(submission_id)

    if record is None:
        raise HTTPException(404, "Submission not found")

    return SqlSubmission(id=record.id, sql=record.sql, status="submitted")
