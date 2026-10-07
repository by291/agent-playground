"""Schema preparation and engine disposal belong to the process lifecycle."""

import asyncio
import threading
from concurrent.futures import ThreadPoolExecutor

import pytest
from sqlalchemy import event, inspect
from sqlalchemy.engine import Engine

from agent_playground import http
from agent_playground.db.connection import app_engine, prepare_app_store
from agent_playground.knowledge import worker as knowledge_worker_module
from agent_playground.services.report import worker as report_worker_module


def test_schema_preparation_creates_only_python_owned_tables(
    monkeypatch: pytest.MonkeyPatch, postgres_database_url: str
):
    monkeypatch.setenv("APP_DATABASE_URL", postgres_database_url)
    app_engine.cache_clear()
    engine = app_engine()

    try:
        assert inspect(engine).get_table_names() == []
        prepare_app_store()
        assert set(inspect(engine).get_table_names()) == {
            "workflow_outputs",
            "sql_demo_submissions",
            "report_demo_jobs",
            "a2a_demo_tasks",
            "a2a_demo_jobs",
        }
        prepare_app_store()
        assert app_engine() is engine
    finally:
        engine.dispose()
        app_engine.cache_clear()


def test_concurrent_process_startup_prepares_schema_once(
    monkeypatch: pytest.MonkeyPatch, postgres_database_url: str
):
    monkeypatch.setenv("APP_DATABASE_URL", postgres_database_url)
    app_engine.cache_clear()
    engine = app_engine()
    ready = threading.Barrier(3)

    def prepare(_index: int) -> None:
        ready.wait(timeout=5)
        prepare_app_store()

    try:
        with ThreadPoolExecutor(max_workers=3) as starters:
            list(starters.map(prepare, range(3)))

        assert "a2a_demo_tasks" in inspect(engine).get_table_names()
        assert "a2a_demo_jobs" in inspect(engine).get_table_names()
    finally:
        engine.dispose()
        app_engine.cache_clear()


@pytest.mark.parametrize("worker_name", ["report", "knowledge"])
def test_shutdown_waits_for_a_cancelled_workers_database_thread(
    monkeypatch: pytest.MonkeyPatch, worker_name: str
):
    actions: list[str] = []
    release = threading.Event()

    async def run():
        started = asyncio.Event()
        loop = asyncio.get_running_loop()

        def blocked_database_operation() -> list[object]:
            loop.call_soon_threadsafe(started.set)
            assert release.wait(10), "Test database operation was not released"
            actions.append("database finished")

            return []

        class Repository:
            def claim(self) -> None:
                blocked_database_operation()

        async def idle_worker():
            await asyncio.Future()

        monkeypatch.setattr(http, "prepare_app_store", lambda: None)
        monkeypatch.setattr(http, "close_app_store", lambda: actions.append("dispose"))
        monkeypatch.setattr(http, "run_a2a_worker", idle_worker)

        if worker_name == "report":
            monkeypatch.setattr(
                report_worker_module,
                "pending_report_events",
                blocked_database_operation,
            )
            monkeypatch.setattr(http, "run_knowledge_worker", idle_worker)
        else:
            monkeypatch.setattr(
                knowledge_worker_module, "KnowledgeRepository", Repository
            )
            monkeypatch.setattr(http, "run_report_worker", idle_worker)

        lifespan = http.lifespan(http.app)
        await lifespan.__aenter__()
        await asyncio.wait_for(started.wait(), 5)
        closing = asyncio.create_task(lifespan.__aexit__(None, None, None))

        try:
            with pytest.raises(TimeoutError):
                await asyncio.wait_for(asyncio.shield(closing), 0.05)

            assert actions == []
        finally:
            release.set()
            await asyncio.wait_for(closing, 5)

        assert actions == ["database finished", "dispose"]

    asyncio.run(run())


def test_application_shutdown_drains_workers_before_releasing_its_engine(
    monkeypatch: pytest.MonkeyPatch, postgres_database_url: str
):
    monkeypatch.setenv("APP_DATABASE_URL", postgres_database_url)
    app_engine.cache_clear()
    prepare_app_store()
    engine = app_engine()
    actions: list[str] = []

    def disposed(_engine: Engine) -> None:
        actions.append("dispose")

    event.listen(engine, "engine_disposed", disposed)
    ready = asyncio.Event()

    async def report_worker():
        try:
            await asyncio.Future()
        finally:
            actions.append("report drained")

    async def knowledge_worker():
        ready.set()

        try:
            await asyncio.Future()
        finally:
            actions.append("knowledge drained")

    async def a2a_worker():
        try:
            await asyncio.Future()
        finally:
            actions.append("a2a drained")

    monkeypatch.setattr(http, "run_report_worker", report_worker)
    monkeypatch.setattr(http, "run_knowledge_worker", knowledge_worker)
    monkeypatch.setattr(http, "run_a2a_worker", a2a_worker)

    async def run():
        async with http.lifespan(http.app):
            await ready.wait()

        assert set(actions[:3]) == {
            "report drained",
            "knowledge drained",
            "a2a drained",
        }
        assert actions[3:] == ["dispose"]
        assert app_engine.cache_info().currsize == 0

    try:
        asyncio.run(run())
    finally:
        engine.dispose()
        app_engine.cache_clear()


def test_cancelled_startup_drains_schema_preparation_and_releases_the_engine(
    monkeypatch: pytest.MonkeyPatch,
):
    actions: list[str] = []
    release = threading.Event()

    async def run():
        started = asyncio.Event()
        loop = asyncio.get_running_loop()

        def prepare():
            loop.call_soon_threadsafe(started.set)
            assert release.wait(10), "Test schema preparation was not released"
            actions.append("prepared")

        monkeypatch.setattr(http, "prepare_app_store", prepare)
        monkeypatch.setattr(http, "close_app_store", lambda: actions.append("dispose"))
        lifespan = http.lifespan(http.app)
        starting = asyncio.create_task(lifespan.__aenter__())
        await asyncio.wait_for(started.wait(), 5)
        starting.cancel()

        try:
            with pytest.raises(TimeoutError):
                await asyncio.wait_for(asyncio.shield(starting), 0.05)

            assert actions == []
        finally:
            release.set()

            with pytest.raises(asyncio.CancelledError):
                await starting

        assert actions == ["prepared", "dispose"]

    asyncio.run(run())
