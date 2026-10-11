"""Model metadata uses the same configuration as the agent graph."""

from fastapi.testclient import TestClient

from agent_playground.app import app
from tests.model_config import ModelConfigFile


def test_agent_info_reports_configured_model_without_a_model_call(
    model_config: ModelConfigFile,
):
    model_config.chat(model="deepseek-v4-flash", thinking="disabled")
    response = TestClient(app).get("/agent-info")

    assert response.status_code == 200
    assert response.json()["model"] == "deepseek-v4-flash"
    assert response.json()["defaultModelId"] == "deepseek"


def test_agent_info_uses_the_default_model():
    assert TestClient(app).get("/agent-info").json()["model"] == "deepseek-flash"


def test_model_catalog_exposes_options_without_credentials(
    model_config: ModelConfigFile,
):
    model_config.chat(api_key="private-deepseek-key")
    model_config.chat(
        "qwen",
        api_key="private-qwen-key",
        base_url="https://private-endpoint.example/v1",
    )
    model_config.settings["chat"]["default"] = "qwen"
    model_config.save()

    response = TestClient(app).get("/agent-info")
    info = response.json()

    assert response.status_code == 200
    assert info["model"] == "qwen3.8-flash"
    assert info["defaultModelId"] == "qwen"
    assert info["models"] == [
        {
            "id": "deepseek",
            "label": "DeepSeek",
            "model": "deepseek-flash",
            "available": True,
        },
        {"id": "qwen", "label": "Qwen", "model": "qwen3.8-flash", "available": True},
    ]
    assert "private" not in response.text


def test_model_catalog_marks_unconfigured_qwen_unavailable(
    model_config: ModelConfigFile,
):
    model_config.chat("qwen", api_key="")

    info = TestClient(app).get("/agent-info").json()

    assert (
        next(model for model in info["models"] if model["id"] == "qwen")["available"]
        is False
    )
