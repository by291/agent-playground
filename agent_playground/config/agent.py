"""Validated Agent runtime settings and their private YAML reader."""

import os
from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field, SecretStr, field_validator

from agent_playground.config.reader import (
    PROJECT_ROOT,
    SettingsModel,
    load_yaml_settings,
    validate_url,
)


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


class ApprovalSettings(SettingsModel):
    """Select per-operation approval gates without granting persistent permissions."""

    mode: Literal["side_effects", "all", "configured"] = "side_effects"
    tools: dict[str, bool] = Field(default_factory=dict)


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
    approvals: ApprovalSettings = Field(default_factory=ApprovalSettings)
    observability: ObservabilitySettings = Field(default_factory=ObservabilitySettings)


@lru_cache(maxsize=1)
def load_agent_config() -> AgentConfig:
    """Cache validated runtime settings from the selected Agent YAML file."""
    path = Path(os.getenv("AGENT_CONFIG_PATH", str(PROJECT_ROOT / "agent.yaml")))

    return load_yaml_settings(path, AgentConfig)


def app_api_url() -> str:
    return load_agent_config().workflow.app_api_url


def workflow_api_token() -> str:
    return load_agent_config().workflow.api_token.get_secret_value()
