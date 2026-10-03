"""Model metadata uses the same configuration as the agent graph."""

import pytest
from fastapi.testclient import TestClient

from agent_playground.http import app


def test_agent_info_reports_configured_model_without_a_model_call(
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setenv("DEEPSEEK_MODEL", "configured-model")
    response = TestClient(app).get("/agent-info")

    assert response.status_code == 200
    assert response.json() == {"model": "configured-model"}


def test_agent_info_uses_the_default_model(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.delenv("DEEPSEEK_MODEL", raising=False)

    assert TestClient(app).get("/agent-info").json() == {"model": "deepseek-flash"}
