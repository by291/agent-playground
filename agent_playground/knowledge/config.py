"""Resolve embedding settings, shared quota identity and index compatibility."""

import hashlib
import json
from dataclasses import dataclass, field

from agent_playground.config.models import load_model_config

QUOTA_HEADROOM_FRACTION = 0.8
SECONDS_PER_MINUTE = 60


@dataclass(frozen=True)
class EmbeddingConfig:
    base_url: str
    model: str
    api_key: str = field(repr=False)
    dimensions: int | None = None
    max_distance: float = 0.55
    batch_size: int = 10
    tokens_per_minute: int = 1_000_000
    requests_per_minute: int = 24_000
    max_retries: int = 5
    index_timeout: int = 600
    quota_scope: str = ""

    @property
    def batch_token_budget(self) -> int:
        """Return the maximum token reservation for one request."""
        # Keep headroom for provider accounting and other account traffic.
        return max(
            1,
            int(self.tokens_per_minute * QUOTA_HEADROOM_FRACTION / SECONDS_PER_MINUTE),
        )

    @property
    def quota_key(self) -> str:
        """Share admission across clients that use the same provider quota."""
        identity = json.dumps([self.quota_scope or self.base_url, self.model])

        return hashlib.sha256(identity.encode()).hexdigest()

    @classmethod
    def from_config(cls) -> "EmbeddingConfig":
        """Load and validate the embedding provider settings without contacting it."""
        settings = load_model_config().embedding
        api_key = settings.api_key.get_secret_value()

        if not api_key.strip() or not settings.model:
            raise ValueError(
                "Configure embedding.api_key and embedding.model in models.yaml, then retry indexing"
            )

        return cls(
            base_url=settings.base_url.rstrip("/"),
            model=settings.model,
            api_key=api_key,
            dimensions=settings.dimensions,
            max_distance=settings.max_distance,
            batch_size=settings.batch_size,
            tokens_per_minute=settings.tokens_per_minute,
            requests_per_minute=settings.requests_per_minute,
            max_retries=settings.max_retries,
            index_timeout=settings.index_timeout,
            quota_scope=settings.quota_scope,
        )

    def profile(self, dimension: int) -> str:
        """Fence retrieval to vectors produced by compatible embedding settings."""
        identity = json.dumps(
            [
                self.base_url,
                self.model,
                self.dimensions,
            ],
            separators=(",", ":"),
        )

        return f"{hashlib.sha256(identity.encode()).hexdigest()}:{dimension}"
