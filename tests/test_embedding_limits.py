"""Exercise the real SDK and shared Redis budgets against controlled responses."""

import asyncio
import json
import logging
import time
from collections.abc import Callable
from contextlib import asynccontextmanager
from dataclasses import replace
from uuid import uuid4

import httpx2
import pytest
from openai import AsyncOpenAI

from agent_playground.knowledge.embeddings import EmbeddingService
from agent_playground.knowledge.rate_limits import EmbeddingQuota
from agent_playground.knowledge.store import EmbeddingConfig
from agent_playground.knowledge.worker import SupersededIndexJob


@pytest.fixture
def config() -> EmbeddingConfig:
    return EmbeddingConfig(
        "http://embedding.invalid/v1", f"test-{uuid4()}", "controlled-key"
    )


def embedding_response(request: httpx2.Request) -> httpx2.Response:
    texts = json.loads(request.content)["input"]

    return httpx2.Response(
        200,
        headers={
            "x-request-id": "controlled-request",
            "x-ratelimit-remaining-tokens": "123",
        },
        json={
            "data": [
                {"index": index, "embedding": [1.0, 0.1]} for index in range(len(texts))
            ],
            "usage": {"prompt_tokens": 42, "total_tokens": 42},
        },
    )


@asynccontextmanager
async def controlled_embeddings(
    config: EmbeddingConfig,
    redis_url: str,
    handler: Callable[[httpx2.Request], httpx2.Response] = embedding_response,
):
    async with (
        EmbeddingQuota(config, redis_url) as quota,
        httpx2.AsyncClient(transport=httpx2.MockTransport(handler)) as http,
        AsyncOpenAI(
            api_key=config.api_key,
            base_url=config.base_url,
            http_client=http,
            max_retries=0,
        ) as client,
    ):
        yield EmbeddingService(config, client, quota)


def test_query_shares_token_budget_with_an_independent_index_client(
    config: EmbeddingConfig, embedding_redis_url: str
):
    quota = replace(config, tokens_per_minute=1500)

    async def run():
        async with (
            controlled_embeddings(quota, embedding_redis_url) as index,
            controlled_embeddings(quota, embedding_redis_url) as query,
        ):
            assert await index.aembed_documents(["abcdefghijkl"]) == [[1.0, 0.1]]
            started = time.monotonic()
            assert await query.aembed_query("q") == [1.0, 0.1]
            assert time.monotonic() - started >= 0.7

    asyncio.run(run())


def test_minute_request_quota_survives_the_second_window(
    config: EmbeddingConfig, embedding_redis_url: str
):
    quota = replace(config, requests_per_minute=1)
    requests: list[httpx2.Request] = []

    def handle(request: httpx2.Request):
        requests.append(request)

        return embedding_response(request)

    async def run():
        async with controlled_embeddings(quota, embedding_redis_url, handle) as service:
            await service.aembed_query("first")
            await asyncio.sleep(1.1)
            pending = asyncio.create_task(service.aembed_query("second"))

            try:
                await asyncio.sleep(0.15)
                assert not pending.done()
                assert len(requests) == 1
            finally:
                pending.cancel()

                with pytest.raises(asyncio.CancelledError):
                    await pending

    asyncio.run(run())


def test_batches_respect_weighted_utf8_budget(
    config: EmbeddingConfig, embedding_redis_url: str
):
    quota = replace(config, tokens_per_minute=1500)
    requests: list[list[str]] = []

    def handle(request: httpx2.Request):
        requests.append(json.loads(request.content)["input"])

        return embedding_response(request)

    async def run():
        async with controlled_embeddings(quota, embedding_redis_url, handle) as service:
            assert (
                await service.aembed_documents(["中文", "中文", "x"])
                == [[1.0, 0.1]] * 3
            )

    asyncio.run(run())
    assert requests == [["中文"], ["中文"], ["x"]]


def test_retry_after_cools_other_clients_after_index_retry_exhaustion(
    config: EmbeddingConfig, embedding_redis_url: str
):
    quota = replace(config, max_retries=0)

    def reject(_request: httpx2.Request):
        return httpx2.Response(
            429,
            headers={"Retry-After": "0.3"},
            json={"error": {"message": "Allocated quota exceeded"}},
        )

    async def run():
        async with (
            controlled_embeddings(quota, embedding_redis_url, reject) as index,
            controlled_embeddings(quota, embedding_redis_url) as query,
        ):
            with pytest.raises(ValueError, match="token rate limit.*TPM"):
                await index.aembed_documents(["document"])

            started = time.monotonic()
            await query.aembed_query("query")
            assert time.monotonic() - started >= 0.2

    asyncio.run(run())


def test_obsolete_index_stops_while_waiting_for_provider_cooldown(
    config: EmbeddingConfig, embedding_redis_url: str
):
    requests: list[httpx2.Request] = []

    def handle(request: httpx2.Request):
        requests.append(request)

        return embedding_response(request)

    async def run():
        checks = 0

        async def ownership():
            nonlocal checks
            checks += 1

            if checks > 1:
                raise SupersededIndexJob

        async with controlled_embeddings(
            config, embedding_redis_url, handle
        ) as service:
            await service.quota.cooldown(10)

            with pytest.raises(SupersededIndexJob):
                await service.aembed_documents(["document"], before_request=ownership)

    asyncio.run(run())
    assert requests == []


def test_completed_batch_logs_usage_and_request_id(
    config: EmbeddingConfig, embedding_redis_url: str, caplog: pytest.LogCaptureFixture
):
    caplog.set_level(logging.INFO, logger="agent_playground.knowledge.embeddings")

    async def run():
        async with controlled_embeddings(config, embedding_redis_url) as service:
            await service.aembed_query("query")

    asyncio.run(run())
    assert "actual_tokens=42" in caplog.text
    assert "request_id=controlled-request" in caplog.text
    assert "remaining_tokens=123" in caplog.text


def test_invalid_vectors_stop_before_the_next_batch(
    config: EmbeddingConfig, embedding_redis_url: str
):
    requests: list[httpx2.Request] = []

    def invalid(request: httpx2.Request):
        requests.append(request)

        return httpx2.Response(
            200,
            json={
                "data": [{"index": 0, "embedding": [0, 0]}],
                "usage": {"prompt_tokens": 1, "total_tokens": 1},
            },
        )

    async def run():
        async with controlled_embeddings(
            replace(config, batch_size=1), embedding_redis_url, invalid
        ) as service:
            with pytest.raises(ValueError, match="invalid vectors"):
                await service.aembed_documents(["first", "second"])

    asyncio.run(run())
    assert len(requests) == 1
