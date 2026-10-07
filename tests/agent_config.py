"""Keep tests on owned YAML settings, independently of developer credentials."""

import os
from pathlib import Path
from typing import Any

import pytest
import yaml

from agent_playground.config import PROJECT_ROOT, load_agent_config


def update_agent_config(section: str, **values: Any) -> None:
    # The autouse fixture always selects an owned file; require its explicit path.
    path = Path(os.environ["AGENT_CONFIG_PATH"])
    document = yaml.safe_load(path.read_text(encoding="utf-8"))
    document[section].update(values)
    path.write_text(yaml.safe_dump(document, sort_keys=False), encoding="utf-8")
    load_agent_config.cache_clear()


@pytest.fixture(autouse=True)
def agent_config(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    path = tmp_path / "agent.yaml"
    path.write_text((PROJECT_ROOT / "agent.example.yaml").read_text(encoding="utf-8"))
    monkeypatch.setenv("AGENT_CONFIG_PATH", str(path))
    load_agent_config.cache_clear()

    yield path

    load_agent_config.cache_clear()
