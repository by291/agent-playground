"""Batch literal text, retry one failed batch and retain completed vectors."""

from __future__ import annotations

import asyncio
import logging
import math
import random
import time
from collections.abc import Iterator
from datetime import UTC, datetime
from email.utils import parsedate_to_datetime
from typing import TYPE_CHECKING, override

from langchain_core.embeddings import Embeddings
from openai import APIConnectionError, APIStatusError, AsyncOpenAI, RateLimitError, omit

from agent_playground.knowledge.rate_limits import BeforeRequest, EmbeddingQuota
from agent_playground.knowledge.token_estimation import EmbeddingTokenEstimator

if TYPE_CHECKING:
    from agent_playground.knowledge.store import EmbeddingConfig

logger = logging.getLogger(__name__)


def validate_vectors(vectors: list[list[float]], count: int) -> int:
    if len(vectors) != count or not vectors:
        raise ValueError("Embedding API returned an unexpected number of vectors")

    dimension = len(vectors[0])

    if not dimension or any(
        len(vector) != dimension
        or not all(math.isfinite(value) for value in vector)
        or not any(vector)
        for vector in vectors
    ):
        raise ValueError("Embedding API returned invalid vectors")

    return dimension


def retry_delay(error: APIStatusError | APIConnectionError, retry: int) -> float:
    if isinstance(error, APIStatusError):
        for name, divisor in (("retry-after-ms", 1000), ("retry-after", 1)):
            value = error.response.headers.get(name)

            if value:
                try:
                    seconds = float(value) / divisor
                except ValueError:
                    try:
                        date = parsedate_to_datetime(value)
                        seconds = (date - datetime.now(UTC)).total_seconds()
                    except (ValueError, TypeError, OverflowError):
                        continue

                if math.isfinite(seconds) and seconds > 0:
                    return seconds

    return min(60, 2 ** (retry + 1)) + random.uniform(0, 1)


def rate_limit_message(error: RateLimitError) -> str:
    message = str(error).lower()

    if "allocated quota exceeded" in message or "current quota" in message:
        return "Embedding token rate limit reached. Wait before retrying and check the configured TPM against your provider quota."

    if "requests rate limit" in message or "requests list" in message:
        return "Embedding request rate limit reached. Wait before retrying and check the configured RPM against your provider quota."

    return "Embedding service is rate limited. Wait before retrying and check your provider quota."


class EmbeddingService(Embeddings):
    def __init__(
        self, config: EmbeddingConfig, client: AsyncOpenAI, quota: EmbeddingQuota
    ):
        self.config = config
        self.client = client
        self.quota = quota

    @override
    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        raise NotImplementedError("Use asynchronous embedding methods")

    @override
    def embed_query(self, text: str) -> list[float]:
        raise NotImplementedError("Use asynchronous embedding methods")

    def batches(
        self, texts: list[str], estimator: EmbeddingTokenEstimator
    ) -> Iterator[list[str]]:
        offset = 0

        while offset < len(texts):
            batch: list[str] = []
            tokens = 0

            for text in texts[offset : offset + self.config.batch_size]:
                cost = estimator.estimate(text)

                if cost > self.config.batch_token_budget:
                    raise ValueError(
                        "A text fragment exceeds the per-second embedding budget; check RAG_EMBEDDING_TPM or shorten the text"
                    )

                if batch and tokens + cost > self.config.batch_token_budget:
                    break

                batch.append(text)
                tokens += cost

            offset += len(batch)

            # Resume with the latest usage, rather than keeping a precomputed next-fragment cost.
            yield batch

    @override
    async def aembed_documents(
        self,
        texts: list[str],
        *,
        before_request: BeforeRequest | None = None,
    ) -> list[list[float]]:
        vectors: list[list[float]] = []
        dimension: int | None = None
        estimator = EmbeddingTokenEstimator()

        for index, batch in enumerate(self.batches(texts, estimator)):
            result = await self.embed_batch(
                batch, index, "index", before_request, estimator=estimator
            )
            batch_dimension = validate_vectors(result, len(batch))

            if dimension is not None and batch_dimension != dimension:
                raise ValueError(
                    "Embedding API changed vector dimensions between batches"
                )

            dimension = batch_dimension
            vectors.extend(result)

        return vectors

    @override
    async def aembed_query(self, text: str) -> list[float]:
        return (await self.embed_batch([text], 0, "query", None))[0]

    async def embed_batch(
        self,
        batch: list[str],
        index: int,
        operation: str,
        before_request: BeforeRequest | None,
        *,
        estimator: EmbeddingTokenEstimator | None = None,
        max_retries: int | None = None,
    ) -> list[list[float]]:
        estimator = estimator or EmbeddingTokenEstimator()
        retry_limit = self.config.max_retries if max_retries is None else max_retries

        for retry in range(retry_limit + 1):
            tokens = sum(estimator.estimate(text) for text in batch)

            if tokens > self.config.batch_token_budget:
                logger.info(
                    "Embedding batch split to fit quota budget: batch=%s texts=%s estimated_tokens=%s",
                    index,
                    len(batch),
                    tokens,
                )
                result: list[list[float]] = []

                for part in self.batches(batch, estimator):
                    result.extend(
                        await self.embed_batch(
                            part,
                            index,
                            operation,
                            before_request,
                            estimator=estimator,
                            max_retries=retry_limit - retry,
                        )
                    )

                return result

            ratio = estimator.ratio
            samples = estimator.samples
            wait = await self.quota.acquire(tokens, before_request)

            if before_request:
                await before_request()

            started = time.monotonic()

            try:
                raw = await self.client.embeddings.with_raw_response.create(
                    input=batch,
                    model=self.config.model,
                    encoding_format="float",
                    dimensions=self.config.dimensions
                    if self.config.dimensions is not None
                    else omit,
                )
                response = raw.parse()
                entries = sorted(response.data, key=lambda item: item.index)

                if [entry.index for entry in entries] != list(range(len(batch))):
                    raise ValueError("Embedding API returned invalid vector indexes")

                result = [entry.embedding for entry in entries]
                validate_vectors(result, len(batch))
                actual = getattr(
                    getattr(response, "usage", None), "prompt_tokens", None
                )

                if operation == "index":
                    estimator.observe(batch, actual)

                logger.info(
                    "Embedding batch completed: operation=%s batch=%s texts=%s estimated_tokens=%s actual_tokens=%s token_ratio=%.3f calibration_samples=%s quota_wait_seconds=%.3f duration_seconds=%.3f retries=%s request_id=%s remaining_tokens=%s",
                    operation,
                    index,
                    len(batch),
                    tokens,
                    actual,
                    ratio,
                    samples,
                    wait,
                    time.monotonic() - started,
                    retry,
                    raw.headers.get("x-request-id"),
                    raw.headers.get("x-ratelimit-remaining-tokens"),
                )

                return result
            except (APIStatusError, APIConnectionError) as error:
                retryable = (
                    isinstance(error, APIConnectionError)
                    or error.status_code in {408, 409, 429}
                    or error.status_code >= 500
                )

                if not retryable:
                    raise

                delay = retry_delay(error, retry)

                if isinstance(error, RateLimitError):
                    # All clients observe the longest provider cooldown, even after this attempt fails.
                    await self.quota.cooldown(delay)
                    estimator.backoff()

                if retry == retry_limit:
                    logger.error(
                        "Embedding batch failed: operation=%s batch=%s estimated_tokens=%s attempts=%s error=%s request_id=%s",
                        operation,
                        index,
                        tokens,
                        retry + 1,
                        type(error).__name__,
                        error.request_id if isinstance(error, APIStatusError) else None,
                    )

                    if isinstance(error, RateLimitError):
                        raise ValueError(rate_limit_message(error)) from error

                    raise

                logger.warning(
                    "Embedding batch retry: operation=%s batch=%s estimated_tokens=%s retry=%s wait_seconds=%.3f error=%s request_id=%s",
                    operation,
                    index,
                    tokens,
                    retry + 1,
                    delay,
                    type(error).__name__,
                    error.request_id if isinstance(error, APIStatusError) else None,
                )

                if not isinstance(error, RateLimitError):
                    # Keep the job lease live during non-quota retry delays as well.
                    until = time.monotonic() + delay

                    while (remaining := until - time.monotonic()) > 0:
                        if before_request:
                            await before_request()

                        await asyncio.sleep(min(remaining, 1.0))

        raise RuntimeError("Embedding retry loop ended without a result")
