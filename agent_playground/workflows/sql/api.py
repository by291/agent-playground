"""HTTP contracts and client for the local SQL demonstration service."""

from http import HTTPStatus
from typing import Protocol

import httpx

from agent_playground.config.agent import load_agent_config
from agent_playground.services.sql.models import SqlCheck, SqlSource, SqlSubmission

_SQL_TIMEOUT_SECONDS = 30


class SqlApi(Protocol):
    async def fetch(self, task: str) -> SqlSource:
        """Fetch the task's starting SQL, dialect and schema."""

    async def check(self, sql: str) -> SqlCheck:
        """Validate SQL with the checker service."""

    async def submit(self, sql: str, key: str) -> SqlSubmission:
        """Record SQL under the workflow's idempotency key."""


class HttpSqlApi:
    def __init__(self) -> None:
        self.base_url = load_agent_config().services.sql_demo_url

    async def fetch(self, task: str) -> SqlSource:
        """Fetch the task's starting SQL, dialect and schema."""
        async with httpx.AsyncClient(timeout=_SQL_TIMEOUT_SECONDS) as client:
            response = await client.post(
                f"{self.base_url}/generate", json={"task": task}
            )
            response.raise_for_status()

            return SqlSource.model_validate(response.json())

    async def check(self, sql: str) -> SqlCheck:
        """Validate SQL with the checker service."""
        async with httpx.AsyncClient(timeout=_SQL_TIMEOUT_SECONDS) as client:
            response = await client.post(f"{self.base_url}/check", json={"sql": sql})
            response.raise_for_status()

            return SqlCheck.model_validate(response.json())

    async def submit(self, sql: str, key: str) -> SqlSubmission:
        """Record SQL under the workflow's idempotency key."""
        submission_url = f"{self.base_url}/submit"
        request_body = {"sql": sql, "id": key}

        async with httpx.AsyncClient(timeout=_SQL_TIMEOUT_SECONDS) as client:
            try:
                response = await client.post(submission_url, json=request_body)
            except httpx.TransportError:
                # A timeout may follow a committed receipt. Reconcile before retrying
                # the same idempotent submission; never generate another key.
                response = await client.get(f"{self.base_url}/submissions/{key}")

                if response.status_code == HTTPStatus.NOT_FOUND:
                    response = await client.post(submission_url, json=request_body)

            response.raise_for_status()
            receipt = SqlSubmission.model_validate(response.json())

            if receipt.id != key or receipt.sql != sql:
                raise ValueError("SQL submission receipt does not match the request")

            return receipt
