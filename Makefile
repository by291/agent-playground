.DEFAULT_GOAL := help

ifeq ($(OS),Windows_NT)
SHELL := cmd.exe
.SHELLFLAGS := /d /s /c
GRADLEW := android\gradlew.bat
else
GRADLEW := ./android/gradlew
endif

.PHONY: help setup infra-up infra-down skills-smoke agent server web dev dev-stop observability-up dev-observability agent-observability server-observability web-observability typecheck lint format format-check test build check
.PHONY: android-format android-format-check android-lint android-check
.PHONY: a2a a2a-stop

help:
	@echo "Setup:   make setup, make infra-up, make infra-down"
	@echo "Run:     make dev, make dev-stop, make agent, make server, make web"
	@echo "Skills:  make skills-smoke"
	@echo "A2A:     make a2a, make a2a-stop"
	@echo "Observe: make observability-up, make dev-observability"
	@echo "Quality: make check, make typecheck, make lint, make format, make format-check, make test, make build"
	@echo "Android: make android-check, make android-lint, make android-format, make android-format-check"

setup:
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

a2a:
	node scripts/dev.mjs start-a2a

a2a-stop:
	node scripts/dev.mjs stop-a2a

observability-up:
	docker compose --profile observability up -d --wait

dev-observability: observability-up
	node scripts/dev.mjs start-observability

agent-observability:
	node scripts/dev.mjs run-observability agent

server-observability:
	node scripts/dev.mjs run-observability server

web-observability:
	node scripts/dev.mjs run-observability web

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

android-format:
	$(GRADLEW) -p android spotlessApply

android-format-check:
	$(GRADLEW) -p android spotlessCheck

android-lint:
	$(GRADLEW) -p android lintCheck

android-check:
	$(GRADLEW) -p android qualityCheck
