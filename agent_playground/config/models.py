"""Validated chat/embedding settings and their private YAML reader."""

import os
from functools import lru_cache
from pathlib import Path
from typing import Self

from pydantic import BaseModel, ConfigDict, Field, SecretStr, model_validator

from agent_playground.config.reader import PROJECT_ROOT, load_yaml_settings
from agent_playground.models.profiles import (
    ChatProvider,
    ThinkingLevel,
    model_information,
)


class ChatModelSettings(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    provider: ChatProvider
    label: str | None = Field(default=None, min_length=1)
    model: str = Field(min_length=1)
    api_key: SecretStr = SecretStr("")
    base_url: str | None = None
    max_input_tokens: int | None = Field(default=None, gt=0)
    max_output_tokens: int | None = Field(default=None, gt=0)
    thinking: ThinkingLevel = "disabled"

    @model_validator(mode="after")
    def validate_generation_settings(self) -> Self:
        information = model_information(self.provider, self.model)

        if self.thinking not in information.thinking_levels:
            raise ValueError("thinking level is not supported by this model")

        if (
            self.max_input_tokens is not None
            and self.max_input_tokens > information.max_input_tokens
        ):
            raise ValueError(
                f"max_input_tokens must not exceed {information.max_input_tokens}"
            )

        if (
            self.max_output_tokens is not None
            and self.max_output_tokens > information.max_output_tokens
        ):
            raise ValueError(
                f"max_output_tokens must not exceed {information.max_output_tokens}"
            )

        output_budget = self.max_output_tokens or information.output_budget(
            self.thinking
        )

        if output_budget >= information.context_window:
            raise ValueError("max_output_tokens must leave room for input tokens")

        return self


class ChatSettings(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    default: str
    compact_ratio: float = Field(default=0.8, gt=0.2, lt=1)
    models: dict[str, ChatModelSettings] = Field(min_length=1)

    @model_validator(mode="after")
    def require_default_model(self) -> Self:
        if self.default not in self.models:
            raise ValueError("chat.default must name a configured model")

        return self


class EmbeddingSettings(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    base_url: str = "https://api.openai.com/v1"
    model: str = ""
    api_key: SecretStr = SecretStr("")
    dimensions: int | None = Field(default=None, gt=0)
    max_distance: float = Field(default=0.55, ge=0, le=2, allow_inf_nan=False)
    batch_size: int = Field(default=10, gt=0)
    tokens_per_minute: int = Field(default=1_000_000, gt=0)
    requests_per_minute: int = Field(default=24_000, gt=0)
    max_retries: int = Field(default=5, ge=0)
    index_timeout: int = Field(default=600, gt=0)
    quota_scope: str = ""


class ModelConfig(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    chat: ChatSettings
    embedding: EmbeddingSettings = Field(default_factory=EmbeddingSettings)
    a2a_model: str = "deepseek"

    @model_validator(mode="after")
    def require_child_model(self) -> Self:
        if self.a2a_model not in self.chat.models:
            raise ValueError("a2a_model must name a configured model")

        return self


@lru_cache(maxsize=1)
def load_model_config() -> ModelConfig:
    """Cache validated model settings without constructing provider clients."""
    path = Path(os.getenv("MODELS_CONFIG_PATH", str(PROJECT_ROOT / "models.yaml")))

    return load_yaml_settings(path, ModelConfig)
