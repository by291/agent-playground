.DEFAULT_GOAL := help

.PHONY: help setup infra-up infra-down agent server web dev typecheck lint format format-check test build check

help:
	@echo "Setup:   make setup, make infra-up, make infra-down"
	@echo "Run:     make dev, make agent, make server, make web"
	@echo "Quality: make check, make typecheck, make lint, make format, make format-check, make test, make build"

setup:
	@if [ ! -f .env ]; then cp .env.example .env; echo "Created .env; set OPENAI_API_KEY before running the agent."; fi
	uv sync
	pnpm install

infra-up:
	docker compose up -d --wait

infra-down:
	docker compose down

agent:
	uv run --env-file .env aegra serve --host 127.0.0.1 --port 2026

server:
	pnpm --filter agent-playground-server dev

web:
	pnpm --filter agent-playground-web dev

dev: infra-up
	$(MAKE) -j3 agent server web

typecheck:
	uv run pyrefly check
	pnpm check

lint:
	uv run ruff check .
	pnpm lint

format:
	uv run ruff format .
	pnpm format

format-check:
	uv run ruff format --check .
	pnpm format:check

test:
	uv run pytest

build:
	pnpm build

check: typecheck lint format-check test build
