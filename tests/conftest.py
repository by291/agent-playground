"""Share PostgreSQL startup while keeping each integration test's database isolated."""

from collections.abc import Iterator
from pathlib import Path
from urllib.parse import urlsplit
from uuid import uuid4

import psycopg
import pytest
from psycopg import sql
from testcontainers.community.postgres import PostgresContainer
from testcontainers.community.redis import RedisContainer

from tests.model_config import ModelConfigFile

pytest_plugins = ["tests.agent_config"]


@pytest.fixture(autouse=True)
def model_config(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    configuration = ModelConfigFile(tmp_path / "models.yaml")
    monkeypatch.setenv("MODELS_CONFIG_PATH", str(configuration.path))

    yield configuration

    configuration.save()


def pytest_collection_modifyitems(items: list[pytest.Item]) -> None:
    # Fixture closures include indirect/autouse dependencies on container services.
    container_fixtures = {"postgres_container", "embedding_redis_url"}

    for item in items:
        if isinstance(item, pytest.Function) and container_fixtures.intersection(
            item.fixturenames
        ):
            item.add_marker(pytest.mark.integration)


@pytest.fixture(scope="session")
def embedding_redis_url() -> Iterator[str]:
    with RedisContainer("redis:8-alpine") as redis:
        yield f"redis://{redis.get_container_host_ip()}:{redis.get_exposed_port(6379)}/0"


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
