"""Exercise private runtime settings and the environment-only library boundary."""

import os
import subprocess
import sys
from pathlib import Path
from typing import Any

import pytest
import yaml

from agent_playground import cli
from agent_playground.config import app_api_url, load_agent_config, workflow_api_token
from agent_playground.skills.sandbox import SandboxSettings


def update_config(path: Path, section: str, **values: Any) -> None:
    document = yaml.safe_load(path.read_text())
    document[section].update(values)
    path.write_text(yaml.safe_dump(document))
    load_agent_config.cache_clear()


def test_runtime_yaml_supplies_workflow_database_and_sandbox(agent_config: Path):
    update_config(
        agent_config,
        "workflow",
        app_api_url="https://app.example/api/",
        api_token="private-token",
    )
    update_config(
        agent_config,
        "skills",
        sandbox_url="http://sandbox.example:8080/",
        sandbox_api_key="sandbox-private-key",
        sandbox_image="runtime:custom",
        allowed_hosts=["example.com", "*.example.net"],
        script_environment={"SCRIPT_API_KEY": "script-private-key"},
        command_timeout=30,
    )

    config = load_agent_config()
    sandbox = SandboxSettings.from_config()

    assert app_api_url() == "https://app.example/api"
    assert workflow_api_token() == "private-token"
    assert config.database.application_url.get_secret_value().startswith(
        "postgresql://"
    )
    assert sandbox.url == "http://sandbox.example:8080"
    assert sandbox.api_key == "sandbox-private-key"
    assert sandbox.image == "runtime:custom"
    assert sandbox.command_timeout == 30
    assert sandbox.allowed_hosts == ("example.com", "*.example.net")
    assert sandbox.environment == {"SCRIPT_API_KEY": "script-private-key"}
    assert "private-key" not in repr(config)
    assert "private-token" not in repr(config)


def test_yaml_is_not_overridden_by_process_environment_or_dotenv(
    agent_config: Path, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.chdir(agent_config.parent)
    (agent_config.parent / ".env").write_text(
        "APP_API_URL=http://obsolete\nWORKFLOW_API_TOKEN=obsolete-token\nPORT=bad\n"
    )
    update_config(agent_config, "workflow", api_token="yaml-token")

    assert workflow_api_token() == "yaml-token"
    assert app_api_url() == "http://127.0.0.1:3000"

    monkeypatch.setenv("APP_API_URL", "http://test-app/")
    monkeypatch.setenv("WORKFLOW_API_TOKEN", "test-token")
    monkeypatch.setenv("PORT", "invalid-port")
    monkeypatch.setenv("REDIS_BROKER_ENABLED", "invalid-boolean")
    monkeypatch.setenv("HOST", "0.0.0.0")
    monkeypatch.setenv("OTEL_TARGETS", "GENERIC")
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://collector:4318/v1/traces")
    monkeypatch.setenv("ENABLE_PROMETHEUS_METRICS", "true")
    load_agent_config.cache_clear()
    config = load_agent_config()

    assert workflow_api_token() == "yaml-token"
    assert app_api_url() == "http://127.0.0.1:3000"
    assert config.http.port == 2026
    assert config.http.host == "127.0.0.1"
    assert config.redis.broker_enabled is True
    assert config.observability.targets == []
    assert config.observability.prometheus_metrics is False


@pytest.mark.parametrize(
    ("section", "field", "value"),
    [
        ("http", "port", "2026"),
        ("http", "port", 65536),
        ("redis", "broker_enabled", "true"),
        ("redis", "url", "http://private-redis-password"),
        ("database", "application_url", "private-db-password"),
        ("workflow", "api_token", ["private-token"]),
        ("services", "sql_demo_url", "private-service-key"),
        ("a2a", "mode", "private-invalid-value"),
        ("skills", "script_environment", {"KEY": 42}),
        ("skills", "command_timeout", 0),
        ("skills", "allowed_hosts", ["http://private-host-key"]),
        ("observability", "targets", ["private-target-key"]),
    ],
)
def test_invalid_runtime_configuration_hides_input_values(
    agent_config: Path, section: str, field: str, value: object
):
    update_config(agent_config, section, **{field: value})

    with pytest.raises(ValueError) as caught:
        load_agent_config()

    assert f"{section}.{field}" in str(caught.value)
    assert "private-" not in str(caught.value)


def test_malformed_yaml_diagnostic_hides_credentials(agent_config: Path):
    agent_config.write_text("workflow:\n  api_token: [private-token\n")

    with pytest.raises(ValueError, match="not valid YAML") as caught:
        load_agent_config()

    assert "private-token" not in str(caught.value)


def test_missing_runtime_file_explains_setup(agent_config: Path):
    agent_config.unlink()

    with pytest.raises(ValueError, match="agent.example.yaml or run make setup"):
        load_agent_config()


def test_unknown_runtime_fields_are_rejected(agent_config: Path):
    update_config(agent_config, "http", unknown="private-key")

    with pytest.raises(ValueError, match="http.unknown") as caught:
        load_agent_config()

    assert "private-key" not in str(caught.value)


def test_script_environment_comes_only_from_yaml(
    agent_config: Path, monkeypatch: pytest.MonkeyPatch
):
    update_config(agent_config, "skills", script_environment={"YAML_KEY": "yaml-value"})
    monkeypatch.setenv("SKILL_SCRIPT_ENV", "SCRIPT_KEY")
    monkeypatch.setenv("SCRIPT_KEY", "private-process-value")

    assert SandboxSettings.from_config().environment == {"YAML_KEY": "yaml-value"}


def test_aegra_bridge_exports_validated_runtime_settings(agent_config: Path):
    update_config(
        agent_config,
        "database",
        aegra_url="postgresql://user:private-password@database:5432/agent",
    )
    update_config(
        agent_config, "observability", targets=["GENERIC"], prometheus_metrics=True
    )
    config = load_agent_config()
    environment = cli.aegra_environment(config)

    assert (
        environment["DATABASE_URL"]
        == "postgresql://user:private-password@database:5432/agent"
    )
    assert environment["REDIS_BROKER_ENABLED"] == "true"
    assert environment["OTEL_TARGETS"] == "GENERIC"
    assert environment["ENABLE_PROMETHEUS_METRICS"] == "true"
    assert "APP_DATABASE_URL" not in environment
    assert "DEEPSEEK_API_KEY" not in environment


@pytest.mark.parametrize("platform", ["darwin", "win32"])
def test_agent_launcher_exports_yaml_before_aegra_serve(
    agent_config: Path, monkeypatch: pytest.MonkeyPatch, platform: str
):
    from aegra_cli import cli as aegra_cli

    update_config(agent_config, "http", host="127.0.0.2", port=9123)
    aegra_path = agent_config.parent / "custom-aegra.json"
    aegra_path.write_text("{}")
    (agent_config.parent / ".env").write_text(
        "HOST=obsolete\nPORT=bad\nDATABASE_URL=obsolete\n"
    )
    monkeypatch.setattr(os, "environ", dict(os.environ))
    monkeypatch.setenv("AEGRA_CONFIG", str(aegra_path))
    monkeypatch.setenv("PORT", "invalid-inherited-port")
    monkeypatch.setenv("DATABASE_URL", "invalid-inherited-database")
    monkeypatch.setattr(sys, "platform", platform)
    commands: list[list[str]] = []

    def run(command: list[str], *, check: bool):
        assert not check
        assert os.environ["PORT"] == "9123"
        assert (
            os.environ["DATABASE_URL"]
            == load_agent_config().database.aegra_url.get_secret_value()
        )
        assert os.environ["AEGRA_CONFIG"] == str(aegra_path.resolve())
        commands.append(command)

        return subprocess.CompletedProcess(command, 0)

    monkeypatch.setattr(aegra_cli.subprocess, "run", run)

    with pytest.raises(SystemExit) as caught:
        cli.main()

    assert caught.value.code == 0
    assert commands[0][:8] == [
        sys.executable,
        "-m",
        "uvicorn",
        "aegra_api.main:app",
        "--host",
        "127.0.0.2",
        "--port",
        "9123",
    ]

    if platform == "win32":
        assert commands[0][8:] == [
            "--loop",
            "aegra_api.utils.event_loop:selector_loop_factory",
        ]
    else:
        assert commands[0][8:] == []


def test_a2a_launcher_uses_configured_endpoint_and_retains_explicit_cli_overrides(
    agent_config: Path, monkeypatch: pytest.MonkeyPatch
):
    from agent_playground.services.a2a import server

    update_config(agent_config, "a2a", planner_url="http://127.0.0.3:9131")
    monkeypatch.setattr(sys, "argv", ["a2a", "--role", "planner"])
    cards: list[tuple[str, str]] = []
    listeners: list[dict[str, Any]] = []

    def create_app(role: str, url: str):
        cards.append((role, url))

        return "application"

    def run(app: str, **options: Any):
        assert app == "application"
        listeners.append(options)

    monkeypatch.setattr(server, "create_a2a_app", create_app)
    monkeypatch.setattr(server.uvicorn, "run", run)
    server.main()

    assert cards == [("planner", "http://127.0.0.3:9131")]
    assert listeners[0]["host"] == "127.0.0.3"
    assert listeners[0]["port"] == 9131

    monkeypatch.setattr(
        sys,
        "argv",
        ["a2a", "--role", "planner", "--host", "127.0.0.1", "--port", "9135"],
    )
    server.main()

    assert cards[1] == ("planner", "http://127.0.0.1:9135")
    assert listeners[1]["port"] == 9135
