"""Batch literal text, retry one failed batch and retain completed vectors."""

from __future__ import annotations

import asyncio
import logging
import math
import random
import time
from collections.abc import Iterator
from dataclasses import dataclass, field, replace
from datetime import UTC, datetime
from email.utils import parsedate_to_datetime
from typing import TYPE_CHECKING, Literal, override

from langchain_core.embeddings import Embeddings
from openai import APIConnectionError, APIStatusError, AsyncOpenAI, RateLimitError, omit

from agent_playground.knowledge.rate_limits import (
    OWNERSHIP_CHECK_SECONDS,
    BeforeRequest,
    EmbeddingQuota,
)
from agent_playground.knowledge.token_estimation import EmbeddingTokenEstimator

if TYPE_CHECKING:
    from agent_playground.knowledge.config import EmbeddingConfig

logger = logging.getLogger(__name__)

RETRY_HEADERS = (("retry-after-ms", 1000), ("retry-after", 1))
MAX_BACKOFF_SECONDS = 60
MAX_JITTER_SECONDS = 1
RETRYABLE_STATUS_CODES = {
    408,
    409,
    429,
}


@dataclass(frozen=True, kw_only=True)
class EmbeddingBatch:
    """Carry batch inputs, quota calibration and the remaining retry allowance."""

    texts: list[str]
    index: int
    operation: Literal["index", "query"]
    before_request: BeforeRequest | None = None
    estimator: EmbeddingTokenEstimator = field(default_factory=EmbeddingTokenEstimator)
    max_retries: int | None = None


@dataclass(frozen=True, kw_only=True)
class _BatchAttempt:
    batch: EmbeddingBatch
    tokens: int
    retry: int
    retry_limit: int


@dataclass(frozen=True, kw_only=True)
class _AdmittedBatch:
    attempt: _BatchAttempt
    ratio: float
    samples: int
    wait: float
    started: float


def validate_vectors(vectors: list[list[float]], count: int) -> int:
    """Return the common dimension after validating the batch shape and values."""
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


def _parse_retry_header(value: str, divisor: int) -> float | None:
    try:
        return float(value) / divisor
    except ValueError:
        # Providers can supply an HTTP date instead of a numeric wait.
        try:
            date = parsedate_to_datetime(value)

            return (date - datetime.now(UTC)).total_seconds()
        except (
            ValueError,
            TypeError,
            OverflowError,
        ):
            return None


def retry_delay(error: APIStatusError | APIConnectionError, retry: int) -> float:
    """Use the provider's retry window or fall back to capped, jittered backoff."""
    if isinstance(error, APIStatusError):
        for name, divisor in RETRY_HEADERS:
            value = error.response.headers.get(name)

            if not value:
                continue

            seconds = _parse_retry_header(value, divisor)

            if seconds is not None and math.isfinite(seconds) and seconds > 0:
                return seconds

    return min(MAX_BACKOFF_SECONDS, 2 ** (retry + 1)) + random.uniform(
        0, MAX_JITTER_SECONDS
    )


def rate_limit_message(error: RateLimitError) -> str:
    """Explain the relevant provider quota without returning the raw error."""
    message = str(error).lower()

    if "allocated quota exceeded" in message or "current quota" in message:
        return "Embedding token rate limit reached. Wait before retrying and check the configured TPM against your provider quota."

    if "requests rate limit" in message or "requests list" in message:
        return "Embedding request rate limit reached. Wait before retrying and check the configured RPM against your provider quota."

    return "Embedding service is rate limited. Wait before retrying and check your provider quota."


async def _wait_before_retry(
    delay: float, before_request: BeforeRequest | None
) -> None:
    # Lease renewal and generation checks must continue throughout non-quota delays.
    until = time.monotonic() + delay

    while (remaining := until - time.monotonic()) > 0:
        if before_request:
            await before_request()

        await asyncio.sleep(min(remaining, OWNERSHIP_CHECK_SECONDS))


class EmbeddingService(Embeddings):
    """Borrow scoped clients and retry only batches whose vectors did not complete."""

    def __init__(
        self, config: EmbeddingConfig, client: AsyncOpenAI, quota: EmbeddingQuota
    ) -> None:
        self.config = config
        self.client = client
        self.quota = quota

    @override
    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        """Reject synchronous calls because embedding uses async quota admission."""
        raise NotImplementedError("Use asynchronous embedding methods")

    @override
    def embed_query(self, text: str) -> list[float]:
        """Reject synchronous calls because embedding uses async quota admission."""
        raise NotImplementedError("Use asynchronous embedding methods")

    def batches(
        self, texts: list[str], estimator: EmbeddingTokenEstimator
    ) -> Iterator[list[str]]:
        """Yield batches using the estimator's current calibration on each resume."""
        offset = 0

        while offset < len(texts):
            batch: list[str] = []
            tokens = 0

            for text in texts[offset : offset + self.config.batch_size]:
                cost = estimator.estimate(text)

                if cost > self.config.batch_token_budget:
                    raise ValueError(
                        "A text fragment exceeds the per-second embedding budget; check embedding.tokens_per_minute in models.yaml or shorten the text"
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
        """Embed documents in order with calibration shared across their batches."""
        vectors: list[list[float]] = []
        dimension: int | None = None
        estimator = EmbeddingTokenEstimator()

        for index, batch in enumerate(self.batches(texts, estimator)):
            result = await self.embed_batch(
                EmbeddingBatch(
                    texts=batch,
                    index=index,
                    operation="index",
                    before_request=before_request,
                    estimator=estimator,
                )
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
        """Embed one query using the shared provider quota."""
        vectors = await self.embed_batch(
            EmbeddingBatch(texts=[text], index=0, operation="query")
        )

        return vectors[0]

    async def embed_batch(self, batch: EmbeddingBatch) -> list[list[float]]:
        """Embed a batch and split it if recalibration raises its quota cost."""
        retry_limit = (
            self.config.max_retries if batch.max_retries is None else batch.max_retries
        )

        for retry in range(retry_limit + 1):
            tokens = sum(batch.estimator.estimate(text) for text in batch.texts)
            attempt = _BatchAttempt(
                batch=batch, tokens=tokens, retry=retry, retry_limit=retry_limit
            )

            if tokens > self.config.batch_token_budget:
                return await self._split_batch(attempt)

            admission = await self._admit_batch(attempt)

            try:
                return await self._request_batch(admission)
            except (APIStatusError, APIConnectionError) as error:
                if not await self._wait_for_retry(error, attempt):
                    raise

        raise RuntimeError("Embedding retry loop ended without a result")

    async def _split_batch(self, attempt: _BatchAttempt) -> list[list[float]]:
        batch = attempt.batch
        logger.info(
            "Embedding batch split to fit quota budget: batch=%s texts=%s estimated_tokens=%s",
            batch.index,
            len(batch.texts),
            attempt.tokens,
        )
        vectors: list[list[float]] = []

        # Splitting after recalibration must not replenish exhausted retries.
        for part in self.batches(batch.texts, batch.estimator):
            segment = replace(
                batch, texts=part, max_retries=attempt.retry_limit - attempt.retry
            )
            vectors.extend(await self.embed_batch(segment))

        return vectors

    async def _admit_batch(self, attempt: _BatchAttempt) -> _AdmittedBatch:
        batch = attempt.batch
        ratio = batch.estimator.ratio
        samples = batch.estimator.samples

        wait = await self.quota.acquire(attempt.tokens, batch.before_request)

        # Quota admission may have waited long enough for the generation to change.
        if batch.before_request:
            await batch.before_request()

        return _AdmittedBatch(
            attempt=attempt,
            ratio=ratio,
            samples=samples,
            wait=wait,
            started=time.monotonic(),
        )

    async def _request_batch(self, admission: _AdmittedBatch) -> list[list[float]]:
        batch = admission.attempt.batch
        request = self.client.embeddings.with_raw_response
        raw = await request.create(
            input=batch.texts,
            model=self.config.model,
            encoding_format="float",
            dimensions=self.config.dimensions
            if self.config.dimensions is not None
            else omit,
        )

        response = raw.parse()
        entries = sorted(response.data, key=lambda item: item.index)

        # Match vectors to the submitted fragments even if the provider reorders entries.
        if [entry.index for entry in entries] != list(range(len(batch.texts))):
            raise ValueError("Embedding API returned invalid vector indexes")

        result = [entry.embedding for entry in entries]
        validate_vectors(result, len(batch.texts))
        usage = getattr(response, "usage", None)
        actual = getattr(usage, "prompt_tokens", None)

        if batch.operation == "index":
            batch.estimator.observe(batch.texts, actual)

        logger.info(
            "Embedding batch completed: operation=%s batch=%s texts=%s estimated_tokens=%s actual_tokens=%s token_ratio=%.3f calibration_samples=%s quota_wait_seconds=%.3f duration_seconds=%.3f retries=%s request_id=%s remaining_tokens=%s",
            batch.operation,
            batch.index,
            len(batch.texts),
            admission.attempt.tokens,
            actual,
            admission.ratio,
            admission.samples,
            admission.wait,
            time.monotonic() - admission.started,
            admission.attempt.retry,
            raw.headers.get("x-request-id"),
            raw.headers.get("x-ratelimit-remaining-tokens"),
        )

        return result

    async def _wait_for_retry(
        self, error: APIStatusError | APIConnectionError, attempt: _BatchAttempt
    ) -> bool:
        can_retry = (
            isinstance(error, APIConnectionError)
            or error.status_code in RETRYABLE_STATUS_CODES
            or error.status_code >= 500
        )

        if not can_retry:
            return False

        batch = attempt.batch
        delay = retry_delay(error, attempt.retry)
        request_id = error.request_id if isinstance(error, APIStatusError) else None

        if isinstance(error, RateLimitError):
            # Other callers must honor the provider cooldown even on the final attempt.
            await self.quota.cooldown(delay)
            batch.estimator.backoff()

        if attempt.retry == attempt.retry_limit:
            logger.error(
                "Embedding batch failed: operation=%s batch=%s estimated_tokens=%s attempts=%s error=%s request_id=%s",
                batch.operation,
                batch.index,
                attempt.tokens,
                attempt.retry + 1,
                type(error).__name__,
                request_id,
            )

            if isinstance(error, RateLimitError):
                raise ValueError(rate_limit_message(error)) from error

            return False

        logger.warning(
            "Embedding batch retry: operation=%s batch=%s estimated_tokens=%s retry=%s wait_seconds=%.3f error=%s request_id=%s",
            batch.operation,
            batch.index,
            attempt.tokens,
            attempt.retry + 1,
            delay,
            type(error).__name__,
            request_id,
        )

        # Rate-limited requests wait at shared quota admission during the next attempt.
        if not isinstance(error, RateLimitError):
            await _wait_before_retry(delay, batch.before_request)

        return True
