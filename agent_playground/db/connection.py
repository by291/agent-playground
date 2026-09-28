"""Connect to the application database and create Python-owned output storage."""

import os
from functools import lru_cache

from sqlalchemy import create_engine
from sqlalchemy.engine import Engine

from agent_playground.db.schema import workflow_outputs


@lru_cache(maxsize=1)
def output_engine() -> Engine:
    database_url = os.environ.get("APP_DATABASE_URL")

    if not database_url:
        raise RuntimeError("APP_DATABASE_URL is required for workflow output")

    engine = create_engine(
        database_url.replace("postgresql://", "postgresql+psycopg://", 1)
    )

    workflow_outputs.create(engine, checkfirst=True)

    return engine


def prepare_output_store() -> None:
    output_engine()
