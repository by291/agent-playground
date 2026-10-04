.DEFAULT_GOAL := help

.PHONY: help setup infra-up infra-down skills-smoke agent server web dev dev-stop observability-up dev-observability agent-observability server-observability web-observability typecheck lint format format-check test build check

help:
	@echo "Setup:   make setup, make infra-up, make infra-down"
	@echo "Run:     make dev, make dev-stop, make agent, make server, make web"
	@echo "Skills:  make skills-smoke"
	@echo "Observe: make observability-up, make dev-observability"
	@echo "Quality: make check, make typecheck, make lint, make format, make format-check, make test, make build"

setup:
	@if [ ! -f .env ]; then cp .env.example .env; echo "Created .env; set DEEPSEEK_API_KEY before running the agent."; fi
	@if [ ! -f server/.env ]; then cp server/.env.example server/.env; echo "Created server/.env."; fi
	@if [ ! -f web/.env ]; then cp web/.env.example web/.env; echo "Created web/.env."; fi
	node scripts/setup-env.mjs
	uv sync
	pnpm install

infra-up:
	docker build -t agent-playground-skill-runtime:local -f infra/skills/runtime.Dockerfile infra/skills
	docker pull opensandbox/execd:release-1.1.1-rc.1
	docker pull opensandbox/egress:release-1.1.1-rc.1
	docker compose up -d --wait

infra-down:
	docker compose --profile observability down

skills-smoke:
	uv run python scripts/skill-smoke.py

agent:
	uv run agent

server:
	pnpm dev:server

web:
	pnpm dev:web

dev: infra-up
	node scripts/dev.mjs start

dev-stop:
	node scripts/dev.mjs stop

observability-up:
	docker compose --profile observability up -d --wait

dev-observability: observability-up
	node scripts/dev.mjs start-observability

agent-observability:
	HOST=0.0.0.0 OTEL_SERVICE_NAME=agent-playground-agent OTEL_TARGETS=GENERIC OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318/v1/traces ENABLE_PROMETHEUS_METRICS=true uv run agent

server-observability:
	OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318 pnpm dev:server

web-observability:
	VITE_OBSERVABILITY_ENABLED=true pnpm dev:web

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
	pnpm test
	pnpm test:dev

build:
	pnpm build

check: typecheck lint format-check test build
