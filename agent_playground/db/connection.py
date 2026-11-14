"""Own the shared engine; prepare Python-owned tables explicitly at startup."""

from functools import lru_cache
from threading import Lock

from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine

from agent_playground.config.agent import load_agent_config
from agent_playground.db.schema import (
    a2a_jobs,
    a2a_tasks,
    metadata,
    report_jobs,
    sql_demo_submissions,
    workflow_outputs,
)

DATABASE_CONNECT_TIMEOUT_SECONDS = 5
_schema_lock = Lock()
_prepared_engine: Engine | None = None


def postgres_driver_url(database_url: str) -> str:
    """Normalize PostgreSQL schemes for SQLAlchemy's Psycopg driver."""
    if database_url.startswith("postgres://"):
        database_url = "postgresql://" + database_url.removeprefix("postgres://")

    return database_url.replace("postgresql://", "postgresql+psycopg://", 1)


@lru_cache(maxsize=1)
def app_engine() -> Engine:
    """Return the process-owned engine, released by ``close_app_store``."""
    database = load_agent_config().database
    database_url = database.application_url.get_secret_value()

    if not database_url:
        raise RuntimeError(
            "Agent database.application_url is required for application storage"
        )

    return create_engine(
        postgres_driver_url(database_url),
        connect_args={"connect_timeout": DATABASE_CONNECT_TIMEOUT_SECONDS},
    )


def prepare_app_store() -> None:
    """Prepare Python-owned tables once for the current process engine."""
    global _prepared_engine

    with _schema_lock:
        engine = app_engine()

        if _prepared_engine is engine:
            return

        _create_application_tables(engine)
        _prepared_engine = engine


def _create_application_tables(engine: Engine) -> None:
    try:
        with engine.begin() as connection:
            # Independent agent processes can start together. Serialize both the
            # existence checks and DDL so checkfirst cannot race another creator.
            connection.execute(
                text(
                    "SELECT pg_advisory_xact_lock(hashtextextended('agent_playground_python_schema', 0))"
                )
            )
            metadata.create_all(
                connection,
                tables=[
                    report_jobs,
                    workflow_outputs,
                    sql_demo_submissions,
                    a2a_tasks,
                    a2a_jobs,
                ],
            )
    except Exception:
        close_app_store()
        raise


def close_app_store() -> None:
    """Dispose the cached engine after its callers have drained database work."""
    global _prepared_engine
    _prepared_engine = None

    if not app_engine.cache_info().currsize:
        return

    try:
        app_engine().dispose()
    finally:
        app_engine.cache_clear()
