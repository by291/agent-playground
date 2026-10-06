"""Own the shared engine; prepare Python-owned tables explicitly at startup."""

import os
from functools import lru_cache

from sqlalchemy import create_engine
from sqlalchemy.engine import Engine

from agent_playground.db.schema import (
    metadata,
    report_jobs,
    sql_demo_submissions,
    workflow_outputs,
)


def postgres_driver_url(database_url: str) -> str:
    if database_url.startswith("postgres://"):
        database_url = "postgresql://" + database_url.removeprefix("postgres://")

    return database_url.replace("postgresql://", "postgresql+psycopg://", 1)


@lru_cache(maxsize=1)
def app_engine() -> Engine:
    database_url = os.environ.get("APP_DATABASE_URL")

    if not database_url:
        raise RuntimeError("APP_DATABASE_URL is required for application storage")

    return create_engine(
        postgres_driver_url(database_url), connect_args={"connect_timeout": 5}
    )


def prepare_app_store() -> None:
    try:
        metadata.create_all(
            app_engine(), tables=[report_jobs, workflow_outputs, sql_demo_submissions]
        )
    except Exception:
        close_app_store()
        raise


def close_app_store() -> None:
    if not app_engine.cache_info().currsize:
        return

    try:
        app_engine().dispose()
    finally:
        app_engine.cache_clear()
