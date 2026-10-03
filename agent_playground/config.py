"""Configuration shared by the graph and public agent metadata."""

import os


def configured_model_name() -> str:
    return os.getenv("DEEPSEEK_MODEL", "deepseek-flash")
