"""Model settings and credentials come from one private configuration file."""

from typing import cast

import pytest
from langchain_core.language_models.model_profile import ModelProfile
from langchain_core.messages import AIMessage
from langchain_qwq import ChatQwen
from pydantic import SecretStr

from agent_playground.knowledge.config import EmbeddingConfig
from agent_playground.models.catalog import (
    agent_info,
    create_chat_model,
    model_configuration,
)
from tests.model_config import ModelConfigFile
from tests.test_context import RecordingModel


def test_catalog_uses_private_file_and_ignores_obsolete_model_environment(
    model_config: ModelConfigFile, monkeypatch: pytest.MonkeyPatch
):
    def sdk_profile(_provider: str, _model: str) -> ModelProfile:
        return {"max_input_tokens": 64000, "max_output_tokens": 8000}

    monkeypatch.setattr(
        "agent_playground.models.profiles.library_model_profile",
        sdk_profile,
    )
    model_config.chat(
        "qwen", model="configured-qwen", api_key="file-qwen-key", max_input_tokens=64000
    )
    model_config.settings["chat"]["default"] = "qwen"
    model_config.save()
    monkeypatch.setenv("CHAT_DEFAULT_MODEL", "deepseek")
    monkeypatch.setenv("QWEN_MODEL", "obsolete-model")

    info = agent_info()

    assert info["defaultModelId"] == "qwen"
    assert info["model"] == "configured-qwen"
    assert next(option for option in info["models"] if option["id"] == "qwen")[
        "available"
    ]
    assert "file-qwen-key" not in str(info)


def test_provider_uses_file_credentials_and_address(model_config: ModelConfigFile):
    model_config.chat(
        "qwen", api_key="file-qwen-key", base_url="https://private.example/v1"
    )

    model = cast(ChatQwen, create_chat_model("qwen"))

    assert isinstance(model.api_key, SecretStr)
    assert model.api_key.get_secret_value() == "file-qwen-key"
    assert model.api_base == "https://private.example/v1"


def test_each_model_uses_its_file_context_budget(model_config: ModelConfigFile):
    model_config.chat("qwen", max_input_tokens=45000)
    model_config.settings["chat"]["compact_ratio"] = 0.6
    model_config.save()

    settings = model_configuration("qwen").context_settings(
        RecordingModel(responses=[AIMessage(content="Ready.")])
    )

    assert settings.window == 45000
    assert settings.compact_ratio == 0.6


def test_embedding_uses_file_key_and_preserves_quota_settings(
    model_config: ModelConfigFile,
):
    model_config.embedding(
        api_key="file-embedding-key",
        batch_size=7,
        tokens_per_minute=12000,
        requests_per_minute=600,
        max_retries=0,
        dimensions=128,
    )

    config = EmbeddingConfig.from_config()

    assert config.api_key == "file-embedding-key"
    assert config.batch_size == 7
    assert config.tokens_per_minute == 12000
    assert config.requests_per_minute == 600
    assert config.max_retries == 0
    assert config.dimensions == 128


@pytest.mark.parametrize("broken", ["default", "budget", "provider"])
def test_invalid_file_is_rejected_without_exposing_credentials(
    broken: str, model_config: ModelConfigFile
):
    model_config.chat("qwen", api_key="must-never-appear")

    if broken == "default":
        model_config.settings["chat"]["default"] = "missing-model"
    elif broken == "budget":
        model_config.settings["chat"]["models"]["qwen"]["max_input_tokens"] = 0
    else:
        model_config.settings["chat"]["models"]["qwen"]["provider"] = "unsupported"

    model_config.save()

    with pytest.raises(ValueError) as failure:
        agent_info()

    assert "must-never-appear" not in str(failure.value)


def test_yaml_parser_error_does_not_quote_the_secret_line(
    model_config: ModelConfigFile,
):
    model_config.path.write_text('chat:\n  api_key: "must-never-appear\n')

    with pytest.raises(ValueError, match="valid YAML") as failure:
        agent_info()

    assert "must-never-appear" not in str(failure.value)


def test_missing_file_never_falls_back_to_environment_keys(
    model_config: ModelConfigFile, monkeypatch: pytest.MonkeyPatch
):
    model_config.path.unlink()
    monkeypatch.setenv("DASHSCOPE_API_KEY", "obsolete-secret")

    with pytest.raises(ValueError, match="Create models.yaml") as failure:
        agent_info()

    assert "obsolete-secret" not in str(failure.value)
