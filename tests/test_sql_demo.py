"""Exercise demonstration SQL validation without executing queries."""

import asyncio

import httpx
import pytest
from testcontainers.community.postgres import PostgresContainer

from agent_playground.db.connection import app_engine
from agent_playground.http import app
from agent_playground.sql_demo.validation import check_sql


def test_sql_checks_reject_wildcards_unknown_columns_and_mutations():
    assert not check_sql("SELECT * FROM orders").passed
    assert not check_sql("SELECT missing FROM orders").passed
    assert not check_sql("DELETE FROM orders").passed
    assert not check_sql("SELECT id FROM orders; SELECT id FROM orders").passed
    assert not check_sql("SELECT FROM").passed
    assert check_sql("SELECT id, amount FROM orders").passed
    assert check_sql("SELECT COUNT(*) AS total FROM orders").passed


def test_http_generation_validation_and_idempotent_receipts(
    monkeypatch: pytest.MonkeyPatch,
):
    async def run():
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://demo"
        ) as client:
            generated = await client.post(
                "/sql-demo/generate", json={"task": "Show orders"}
            )
            assert generated.status_code == 200
            checked = await client.post(
                "/sql-demo/check", json={"sql": generated.json()["sql"]}
            )
            assert not checked.json()["passed"]
            invalid = await client.post(
                "/sql-demo/submit",
                json={"id": "receipt", "sql": "SELECT * FROM orders"},
            )
            assert invalid.status_code == 422
            payload = {"id": "receipt", "sql": "SELECT id FROM orders"}
            submitted = await client.post("/sql-demo/submit", json=payload)
            duplicate = await client.post("/sql-demo/submit", json=payload)
            assert submitted.status_code == duplicate.status_code == 200
            assert submitted.json() == duplicate.json()
            receipt = await client.get("/sql-demo/submissions/receipt")
            assert receipt.json() == submitted.json()
            missing = await client.get("/sql-demo/submissions/missing")
            assert missing.status_code == 404
            conflict = await client.post(
                "/sql-demo/submit",
                json={"id": "receipt", "sql": "SELECT amount FROM orders"},
            )
            assert conflict.status_code == 409

    with PostgresContainer("postgres:18-alpine") as postgres:
        monkeypatch.setenv("APP_DATABASE_URL", postgres.get_connection_url(driver=None))
        app_engine.cache_clear()

        try:
            asyncio.run(run())
        finally:
            engine = app_engine()
            app_engine.cache_clear()
            engine.dispose()
