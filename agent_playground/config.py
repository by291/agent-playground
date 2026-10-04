"""Application configuration for agents, workflow clients and service callbacks."""

import os


def configured_model_name() -> str:
    return os.getenv("DEEPSEEK_MODEL", "deepseek-flash")


def app_api_url() -> str:
    return os.getenv("APP_API_URL", "http://127.0.0.1:3000").rstrip("/")
