"""Read and validate the Agent's private YAML configuration files."""

import os
from functools import lru_cache
from pathlib import Path
from typing import Literal, Self
from urllib.parse import urlsplit

import yaml
from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    SecretStr,
    ValidationError,
    field_validator,
    model_validator,
)

from agent_playground.model_profiles import (
    ChatProvider,
    ThinkingLevel,
    model_information,
)

PROJECT_ROOT = Path(__file__).resolve().parent.parent


class SettingsModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, frozen=True)


def validate_url(value: str, schemes: tuple[str, ...]) -> str:
    try:
        parsed = urlsplit(value)
        port = parsed.port
        valid = (
            parsed.scheme in schemes
            and bool(parsed.hostname)
            and (port is None or port > 0)
        )
    except ValueError:
        valid = False

    if not valid:
        raise ValueError("Use an absolute URL with the supported scheme and host")

    return value.rstrip("/")


class HttpSettings(SettingsModel):
    host: str = Field(default="127.0.0.1", min_length=1)
    port: int = Field(default=2026, ge=1, le=65535)


class DatabaseSettings(SettingsModel):
    aegra_url: SecretStr
    application_url: SecretStr

    @field_validator("aegra_url", "application_url")
    @classmethod
    def postgres_url(cls, value: SecretStr) -> SecretStr:
        validate_url(value.get_secret_value(), ("postgres", "postgresql"))

        return value


class RedisSettings(SettingsModel):
    broker_enabled: bool = True
    url: SecretStr = SecretStr("redis://127.0.0.1:56379/0")

    @field_validator("url")
    @classmethod
    def redis_url(cls, value: SecretStr) -> SecretStr:
        validate_url(value.get_secret_value(), ("redis", "rediss"))

        return value


class WorkflowSettings(SettingsModel):
    app_api_url: str = "http://127.0.0.1:3000"
    api_token: SecretStr = SecretStr("")

    @field_validator("app_api_url")
    @classmethod
    def callback_url(cls, value: str) -> str:
        return validate_url(value, ("http", "https"))


class ServiceSettings(SettingsModel):
    sql_demo_url: str = "http://127.0.0.1:2026/sql-demo"
    report_demo_url: str = "http://127.0.0.1:2026/report-demo"

    @field_validator("sql_demo_url", "report_demo_url")
    @classmethod
    def service_url(cls, value: str) -> str:
        return validate_url(value, ("http", "https"))


class A2aSettings(SettingsModel):
    mode: Literal["model", "scripted"] = "model"
    planner_url: str = "http://127.0.0.1:2031"
    reviewer_url: str = "http://127.0.0.1:2032"
    demo_api_url: str = "http://127.0.0.1:2026/a2a-demo"

    @field_validator("planner_url", "reviewer_url", "demo_api_url")
    @classmethod
    def agent_url(cls, value: str) -> str:
        return validate_url(value, ("http", "https"))


class SkillSettings(SettingsModel):
    directory: str = "skills"
    sandbox_url: str = "http://127.0.0.1:8080"
    sandbox_api_key: SecretStr = SecretStr("agent-playground-local-sandbox")
    sandbox_image: str = Field(
        default="agent-playground-skill-runtime:local", min_length=1
    )
    command_timeout: float = Field(default=120, gt=0, allow_inf_nan=False)
    allowed_hosts: list[str] = Field(default_factory=lambda: ["httpbin.org"])
    script_environment: dict[str, SecretStr] = Field(default_factory=dict)

    @field_validator("sandbox_url")
    @classmethod
    def sandbox_address(cls, value: str) -> str:
        return validate_url(value, ("http", "https"))

    @field_validator("allowed_hosts")
    @classmethod
    def host_names(cls, values: list[str]) -> list[str]:
        if any(not value.strip() or "://" in value or "/" in value for value in values):
            raise ValueError(
                "Use nonempty host names or host patterns without a URL scheme"
            )

        return values


class ObservabilitySettings(SettingsModel):
    service_name: str = Field(default="agent-playground-agent", min_length=1)
    targets: list[Literal["GENERIC", "LANGFUSE", "PHOENIX"]] = Field(
        default_factory=list
    )
    otlp_endpoint: str | None = None
    otlp_headers: SecretStr = SecretStr("")
    console_export: bool = False
    prometheus_metrics: bool = False
    langfuse_base_url: str = "http://localhost:3000"
    langfuse_public_key: SecretStr = SecretStr("")
    langfuse_secret_key: SecretStr = SecretStr("")
    phoenix_endpoint: str = "http://127.0.0.1:6006/v1/traces"
    phoenix_api_key: SecretStr = SecretStr("")

    @field_validator("otlp_endpoint", "langfuse_base_url", "phoenix_endpoint")
    @classmethod
    def collector_url(cls, value: str | None) -> str | None:
        if value is None:
            return None

        return validate_url(value, ("http", "https"))


class AgentConfig(SettingsModel):
    http: HttpSettings = Field(default_factory=HttpSettings)
    database: DatabaseSettings
    redis: RedisSettings = Field(default_factory=RedisSettings)
    workflow: WorkflowSettings = Field(default_factory=WorkflowSettings)
    services: ServiceSettings = Field(default_factory=ServiceSettings)
    a2a: A2aSettings = Field(default_factory=A2aSettings)
    skills: SkillSettings = Field(default_factory=SkillSettings)
    observability: ObservabilitySettings = Field(default_factory=ObservabilitySettings)


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


def _load_yaml[Settings: BaseModel](path: Path, schema: type[Settings]) -> Settings:
    try:
        content = path.read_text(encoding="utf-8")
    except FileNotFoundError:
        raise ValueError(
            f"Create {path.name} from {path.stem}.example.yaml or run make setup"
        ) from None

    try:
        document = yaml.safe_load(content)
    except yaml.YAMLError:
        # Parser errors can quote the line containing a credential.
        raise ValueError("Configuration is not valid YAML") from None

    try:
        return schema.model_validate(document)
    except ValidationError as error:
        issues = [
            f"{'.'.join(str(part) for part in issue['loc'])}: {issue['msg']}"
            for issue in error.errors(include_input=False, include_url=False)
        ]

        raise ValueError(f"Invalid configuration: {'; '.join(issues)}") from None


@lru_cache(maxsize=1)
def load_agent_config() -> AgentConfig:
    path = Path(os.getenv("AGENT_CONFIG_PATH", str(PROJECT_ROOT / "agent.yaml")))

    return _load_yaml(path, AgentConfig)


@lru_cache(maxsize=1)
def load_model_config() -> ModelConfig:
    path = Path(os.getenv("MODELS_CONFIG_PATH", str(PROJECT_ROOT / "models.yaml")))

    return _load_yaml(path, ModelConfig)


def app_api_url() -> str:
    return load_agent_config().workflow.app_api_url


def workflow_api_token() -> str:
    return load_agent_config().workflow.api_token.get_secret_value()
