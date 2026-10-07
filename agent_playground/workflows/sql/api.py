"""HTTP contracts and client for the local SQL demonstration service."""

from typing import Protocol

import httpx

from agent_playground.config import load_agent_config
from agent_playground.services.sql.models import SqlCheck, SqlSource, SqlSubmission


class SqlApi(Protocol):
    async def fetch(self, task: str) -> SqlSource: ...

    async def check(self, sql: str) -> SqlCheck: ...

    async def submit(self, sql: str, key: str) -> SqlSubmission: ...


class HttpSqlApi:
    def __init__(self):
        self.base_url = load_agent_config().services.sql_demo_url

    async def fetch(self, task: str) -> SqlSource:
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(
                f"{self.base_url}/generate", json={"task": task}
            )
            response.raise_for_status()

            return SqlSource.model_validate(response.json())

    async def check(self, sql: str) -> SqlCheck:
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(f"{self.base_url}/check", json={"sql": sql})
            response.raise_for_status()

            return SqlCheck.model_validate(response.json())

    async def submit(self, sql: str, key: str) -> SqlSubmission:
        async with httpx.AsyncClient(timeout=30) as client:
            try:
                response = await client.post(
                    f"{self.base_url}/submit", json={"sql": sql, "id": key}
                )
            except httpx.TransportError:
                # A timeout may follow a committed receipt. Reconcile before retrying
                # the same idempotent submission; never generate another key.
                response = await client.get(f"{self.base_url}/submissions/{key}")

                if response.status_code == 404:
                    response = await client.post(
                        f"{self.base_url}/submit", json={"sql": sql, "id": key}
                    )

            response.raise_for_status()
            receipt = SqlSubmission.model_validate(response.json())

            if receipt.id != key or receipt.sql != sql:
                raise ValueError("SQL submission receipt does not match the request")

            return receipt
