"""Share weighted request/token admission and provider cooldowns through Redis."""

from __future__ import annotations

import asyncio
import time
from collections.abc import Awaitable, Callable
from typing import TYPE_CHECKING, Self, cast

from limits import RateLimitItemPerMinute, RateLimitItemPerSecond
from limits.aio.storage import RedisStorage
from limits.aio.storage.redis.redispy import RedispyBridge
from limits.aio.strategies import SlidingWindowCounterRateLimiter
from redis.asyncio import Redis
from redis.asyncio.lock import Lock

from agent_playground.config.agent import load_agent_config
from agent_playground.knowledge.config import (
    QUOTA_HEADROOM_FRACTION,
    SECONDS_PER_MINUTE,
)

if TYPE_CHECKING:
    from agent_playground.knowledge.config import EmbeddingConfig

REDIS_TIMEOUT_SECONDS = 5
LOCK_TTL_SECONDS = 15
OWNERSHIP_CHECK_SECONDS = 1.0
MIN_WINDOW_WAIT_SECONDS = 0.05
MILLISECONDS_PER_SECOND = 1000

BeforeRequest = Callable[[], Awaitable[None]]


class EmbeddingQuota:
    """Own the Redis client used for shared admission and provider cooldowns."""

    def __init__(self, config: EmbeddingConfig, redis_url: str | None = None) -> None:
        if not redis_url:
            redis_settings = load_agent_config().redis
            redis_url = redis_settings.url.get_secret_value()

        if not redis_url:
            raise ValueError(
                "Configure redis.url in agent.yaml for shared embedding rate limits"
            )

        storage = RedisStorage(
            f"async+{redis_url}",
            implementation="redispy",
            wrap_exceptions=True,
            key_prefix="agent-playground:embedding",
            socket_timeout=REDIS_TIMEOUT_SECONDS,
            socket_connect_timeout=REDIS_TIMEOUT_SECONDS,
        )
        bridge = cast(RedispyBridge, storage.bridge)
        self.redis = cast(Redis, bridge.get_connection())
        self.limiter = SlidingWindowCounterRateLimiter(storage)
        self.key = f"agent-playground:embedding:{config.quota_key}"
        self.token_budget = config.batch_token_budget
        self.rates = [
            (
                "requests",
                RateLimitItemPerSecond(
                    max(
                        1,
                        int(
                            config.requests_per_minute
                            * QUOTA_HEADROOM_FRACTION
                            / SECONDS_PER_MINUTE
                        ),
                    )
                ),
            ),
            (
                "requests",
                RateLimitItemPerMinute(
                    max(1, int(config.requests_per_minute * QUOTA_HEADROOM_FRACTION))
                ),
            ),
            ("tokens", RateLimitItemPerSecond(self.token_budget)),
            (
                "tokens",
                RateLimitItemPerMinute(
                    max(1, int(config.tokens_per_minute * QUOTA_HEADROOM_FRACTION))
                ),
            ),
        ]

    async def __aenter__(self) -> Self:
        return self

    async def __aexit__(self, *_args: object) -> None:
        await self.redis.aclose()

    def lock(self) -> Lock:
        """Serialize admission and cooldown updates for this provider quota."""
        return self.redis.lock(
            f"{self.key}:lock",
            timeout=LOCK_TTL_SECONDS,
            blocking_timeout=REDIS_TIMEOUT_SECONDS,
        )

    async def acquire(
        self, tokens: int, before_request: BeforeRequest | None = None
    ) -> float:
        """Reserve request and token budgets together, renewing job ownership while waiting."""
        if tokens > self.token_budget:
            raise ValueError(
                "Embedding text exceeds the configured per-second token budget"
            )

        started = time.monotonic()

        while True:
            if before_request:
                await before_request()

            async with self.lock():
                delay = await self._try_reserve(tokens)

                if delay is None:
                    return time.monotonic() - started

            # Recheck job ownership during provider waits without holding the shared lock.
            await asyncio.sleep(min(delay, OWNERSHIP_CHECK_SECONDS))

    async def _try_reserve(self, tokens: int) -> float | None:
        cooldown = await self.redis.pttl(f"{self.key}:cooldown")

        if cooldown > 0:
            return cooldown / MILLISECONDS_PER_SECOND

        reservations = [
            (
                name,
                rate,
                tokens if name == "tokens" else 1,
            )
            for name, rate in self.rates
        ]

        # Check every window before charging any of them under the same lock.
        for name, rate, cost in reservations:
            if not await self.limiter.test(rate, self.key, name, cost=cost):
                stats = await self.limiter.get_window_stats(rate, self.key, name)

                return max(MIN_WINDOW_WAIT_SECONDS, stats.reset_time - time.time())

        for name, rate, cost in reservations:
            if not await self.limiter.hit(rate, self.key, name, cost=cost):
                raise RuntimeError("Embedding quota admission changed while locked")

        return None

    async def cooldown(self, seconds: float) -> None:
        """Extend the shared provider cooldown without shortening another client's wait."""
        milliseconds = max(1, int(seconds * MILLISECONDS_PER_SECOND))

        async with self.lock():
            remaining = await self.redis.pttl(f"{self.key}:cooldown")

            if milliseconds > remaining:
                await self.redis.set(f"{self.key}:cooldown", "1", px=milliseconds)
