"""Connect to the application database and create Python-owned storage."""

import os
from functools import lru_cache

from sqlalchemy import create_engine
from sqlalchemy.engine import Engine

from agent_playground.db.report_jobs import report_jobs
from agent_playground.db.schema import sql_demo_submissions, workflow_outputs


def postgres_driver_url(database_url: str) -> str:
    if database_url.startswith("postgres://"):
        database_url = "postgresql://" + database_url.removeprefix("postgres://")

    return database_url.replace("postgresql://", "postgresql+psycopg://", 1)


@lru_cache(maxsize=1)
def app_engine() -> Engine:
    database_url = os.environ.get("APP_DATABASE_URL")

    if not database_url:
        raise RuntimeError("APP_DATABASE_URL is required for application storage")

    engine = create_engine(
        postgres_driver_url(database_url), connect_args={"connect_timeout": 5}
    )

    report_jobs.create(engine, checkfirst=True)
    workflow_outputs.create(engine, checkfirst=True)
    sql_demo_submissions.create(engine, checkfirst=True)

    return engine


def prepare_app_store() -> None:
    app_engine()
