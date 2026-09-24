.DEFAULT_GOAL := help

.PHONY: help setup infra-up infra-down agent server web dev typecheck lint format format-check test build check

help:
	@echo "Setup:   make setup, make infra-up, make infra-down"
	@echo "Run:     make dev, make agent, make server, make web"
	@echo "Quality: make check, make typecheck, make lint, make format, make format-check, make test, make build"

setup:
	@if [ ! -f .env ]; then cp .env.example .env; echo "Created .env; set DEEPSEEK_API_KEY before running the agent."; fi
	@if [ ! -f server/.env ]; then cp server/.env.example server/.env; echo "Created server/.env."; fi
	@if [ ! -f web/.env ]; then cp web/.env.example web/.env; echo "Created web/.env."; fi
	uv sync
	pnpm install

infra-up:
	docker compose up -d --wait

infra-down:
	docker compose down

agent:
	uv run agent

server:
	pnpm dev:server

web:
	pnpm dev:web

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
