"""Short local command for serving the agent through Aegra."""

import os

from aegra_cli.cli import cli

from agent_playground.config.agent import AgentConfig, load_agent_config
from agent_playground.config.reader import PROJECT_ROOT


def aegra_environment(config: AgentConfig) -> dict[str, str]:
    """Translate YAML into the runtime library's environment before serving."""
    observability = config.observability

    return {
        "HOST": config.http.host,
        "PORT": str(config.http.port),
        "DATABASE_URL": config.database.aegra_url.get_secret_value(),
        "REDIS_BROKER_ENABLED": str(config.redis.broker_enabled).lower(),
        "REDIS_URL": config.redis.url.get_secret_value(),
        "OTEL_SERVICE_NAME": observability.service_name,
        "OTEL_TARGETS": ",".join(observability.targets),
        "OTEL_EXPORTER_OTLP_ENDPOINT": observability.otlp_endpoint or "",
        "OTEL_EXPORTER_OTLP_HEADERS": observability.otlp_headers.get_secret_value(),
        "OTEL_CONSOLE_EXPORT": str(observability.console_export).lower(),
        "ENABLE_PROMETHEUS_METRICS": str(observability.prometheus_metrics).lower(),
        "LANGFUSE_BASE_URL": observability.langfuse_base_url,
        "LANGFUSE_PUBLIC_KEY": observability.langfuse_public_key.get_secret_value(),
        "LANGFUSE_SECRET_KEY": observability.langfuse_secret_key.get_secret_value(),
        "PHOENIX_COLLECTOR_ENDPOINT": observability.phoenix_endpoint,
        "PHOENIX_API_KEY": observability.phoenix_api_key.get_secret_value(),
    }


def main() -> None:
    config = load_agent_config()

    # YAML settings replace inherited values before Aegra's dotenv loading runs.
    os.environ.update(aegra_environment(config))
    os.environ.setdefault("AEGRA_CONFIG", str(PROJECT_ROOT / "aegra.json"))

    cli.main(args=["serve", "--config", os.environ["AEGRA_CONFIG"]])
