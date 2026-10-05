"""Share weighted request/token admission and provider cooldowns through Redis."""

from __future__ import annotations

import asyncio
import os
import time
from collections.abc import Awaitable, Callable
from typing import TYPE_CHECKING, Self, cast

from limits import RateLimitItemPerMinute, RateLimitItemPerSecond
from limits.aio.storage import RedisStorage
from limits.aio.storage.redis.redispy import RedispyBridge
from limits.aio.strategies import SlidingWindowCounterRateLimiter
from redis.asyncio import Redis

if TYPE_CHECKING:
    from agent_playground.knowledge.store import EmbeddingConfig

BeforeRequest = Callable[[], Awaitable[None]]


class EmbeddingQuota:
    def __init__(self, config: EmbeddingConfig, redis_url: str | None = None):
        url = redis_url or os.getenv("REDIS_URL", "")

        if not url:
            raise ValueError("Configure REDIS_URL for shared embedding rate limits")

        storage = RedisStorage(
            f"async+{url}",
            implementation="redispy",
            wrap_exceptions=True,
            key_prefix="agent-playground:embedding",
            socket_timeout=5,
            socket_connect_timeout=5,
        )
        self.redis = cast(Redis, cast(RedispyBridge, storage.bridge).get_connection())
        self.limiter = SlidingWindowCounterRateLimiter(storage)
        self.key = f"agent-playground:embedding:{config.quota_key}"
        self.token_budget = config.batch_token_budget
        self.rates = [
            (
                "requests",
                RateLimitItemPerSecond(
                    max(1, int(config.requests_per_minute * 0.8 / 60))
                ),
            ),
            (
                "requests",
                RateLimitItemPerMinute(max(1, int(config.requests_per_minute * 0.8))),
            ),
            ("tokens", RateLimitItemPerSecond(self.token_budget)),
            (
                "tokens",
                RateLimitItemPerMinute(max(1, int(config.tokens_per_minute * 0.8))),
            ),
        ]

    async def __aenter__(self) -> Self:
        return self

    async def __aexit__(self, *_args: object) -> None:
        await self.redis.aclose()

    def lock(self):
        return self.redis.lock(f"{self.key}:lock", timeout=15, blocking_timeout=5)

    async def acquire(
        self, tokens: int, before_request: BeforeRequest | None = None
    ) -> float:
        if tokens > self.token_budget:
            raise ValueError(
                "Embedding text exceeds the configured per-second token budget"
            )

        started = time.monotonic()

        while True:
            if before_request:
                await before_request()

            async with self.lock():
                cooldown = max(0, await self.redis.pttl(f"{self.key}:cooldown")) / 1000
                delay = cooldown

                if not cooldown:
                    for name, rate in self.rates:
                        cost = tokens if name == "tokens" else 1

                        if not await self.limiter.test(rate, self.key, name, cost=cost):
                            stats = await self.limiter.get_window_stats(
                                rate, self.key, name
                            )
                            delay = max(0.05, stats.reset_time - time.time())

                            break
                    else:
                        # The shared lock makes admission across all four budgets atomic.
                        for name, rate in self.rates:
                            cost = tokens if name == "tokens" else 1

                            if not await self.limiter.hit(
                                rate, self.key, name, cost=cost
                            ):
                                raise RuntimeError(
                                    "Embedding quota admission changed while locked"
                                )

                        return time.monotonic() - started

            # Recheck job ownership while waiting, including long Retry-After windows.
            await asyncio.sleep(min(delay, 1.0))

    async def cooldown(self, seconds: float) -> None:
        milliseconds = max(1, int(seconds * 1000))

        async with self.lock():
            remaining = await self.redis.pttl(f"{self.key}:cooldown")

            if milliseconds > remaining:
                await self.redis.set(f"{self.key}:cooldown", "1", px=milliseconds)
