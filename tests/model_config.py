"""Owned model configuration files for tests; never load developer credentials."""

from pathlib import Path
from typing import Any

import yaml

from agent_playground.config.models import load_model_config


class ModelConfigFile:
    def __init__(self, path: Path):
        self.path = path
        self.settings: dict[str, Any] = {
            "chat": {
                "default": "deepseek",
                "compact_ratio": 0.8,
                "models": {
                    "deepseek": {
                        "provider": "deepseek",
                        "label": "DeepSeek",
                        "model": "deepseek-flash",
                        "api_key": "test-deepseek",
                        "max_output_tokens": 1000,
                        "thinking": "medium",
                    },
                    "qwen": {
                        "provider": "qwen",
                        "label": "Qwen",
                        "model": "qwen3.8-flash",
                        "api_key": "",
                        "base_url": "https://maas.qianwenaiapi.com/compatible-mode/v1",
                        "max_input_tokens": 991808,
                        "max_output_tokens": 1000,
                        "thinking": "disabled",
                    },
                },
            },
            "embedding": {
                "base_url": "https://embedding.example/v1",
                "model": "test-embedding",
                "api_key": "",
            },
        }
        self.save()

    def save(self):
        self.path.write_text(yaml.safe_dump(self.settings, sort_keys=False))
        load_model_config.cache_clear()

    def chat(self, model_id: str = "deepseek", **settings: Any):
        self.settings["chat"]["models"][model_id].update(settings)
        self.save()

    def embedding(self, **settings: Any):
        self.settings["embedding"].update(settings)
        self.save()
