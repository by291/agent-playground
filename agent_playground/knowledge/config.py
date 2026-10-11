"""Resolve embedding settings, shared quota identity and index compatibility."""

import hashlib
import json
from dataclasses import dataclass, field

from agent_playground.config.models import load_model_config


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
        # Keep headroom for provider accounting and other account traffic.
        return max(1, int(self.tokens_per_minute * 0.8 / 60))

    @property
    def quota_key(self) -> str:
        """Share admission across clients that use the same provider quota."""
        identity = json.dumps([self.quota_scope or self.base_url, self.model])

        return hashlib.sha256(identity.encode()).hexdigest()

    @classmethod
    def from_config(cls) -> "EmbeddingConfig":
        settings = load_model_config().embedding
        api_key = settings.api_key.get_secret_value()

        if not api_key.strip() or not settings.model:
            raise ValueError(
                "Configure embedding.api_key and embedding.model in models.yaml, then retry indexing"
            )

        return cls(
            settings.base_url.rstrip("/"),
            settings.model,
            api_key,
            settings.dimensions,
            settings.max_distance,
            settings.batch_size,
            settings.tokens_per_minute,
            settings.requests_per_minute,
            settings.max_retries,
            settings.index_timeout,
            settings.quota_scope,
        )

    def profile(self, dimension: int) -> str:
        """Fence retrieval to vectors produced by compatible embedding settings."""
        identity = json.dumps(
            [self.base_url, self.model, self.dimensions], separators=(",", ":")
        )

        return f"{hashlib.sha256(identity.encode()).hexdigest()}:{dimension}"
