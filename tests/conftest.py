"""Share PostgreSQL startup while keeping each integration test's database isolated."""

from collections.abc import Iterator
from urllib.parse import urlsplit
from uuid import uuid4

import psycopg
import pytest
from psycopg import sql
from testcontainers.community.postgres import PostgresContainer


@pytest.fixture(scope="session")
def postgres_container() -> Iterator[PostgresContainer]:
    with PostgresContainer("pgvector/pgvector:0.8.7-pg18") as postgres:
        yield postgres


@pytest.fixture
def postgres_database_url(postgres_container: PostgresContainer) -> Iterator[str]:
    admin_url = postgres_container.get_connection_url(driver=None)
    database_name = f"test_{uuid4().hex}"
    database_url = urlsplit(admin_url)._replace(path=f"/{database_name}").geturl()

    with psycopg.connect(admin_url, autocommit=True) as connection:
        connection.execute(
            sql.SQL("CREATE DATABASE {}").format(sql.Identifier(database_name))
        )

        try:
            yield database_url
        finally:
            # Tests must release their connections; a leak should fail teardown.
            connection.execute(
                sql.SQL("DROP DATABASE {}").format(sql.Identifier(database_name))
            )
