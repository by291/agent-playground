"""Serve one independent official A2A planner or reviewer agent."""

import argparse
from contextlib import asynccontextmanager
from dataclasses import dataclass
from urllib.parse import urlsplit

import uvicorn
from a2a.server.routes import (
    add_a2a_routes_to_fastapi,
    create_agent_card_routes,
    create_jsonrpc_routes,
)
from a2a.types import (
    AgentCapabilities,
    AgentCard,
    AgentInterface,
    AgentSkill,
)
from fastapi import FastAPI

from agent_playground.config.agent import load_agent_config
from agent_playground.db.a2a_tasks import PostgresTaskStore
from agent_playground.db.async_operations import run_database_operation
from agent_playground.db.connection import close_app_store, prepare_app_store
from agent_playground.services.a2a.agent import DemoAgentExecutor
from agent_playground.services.a2a.contracts import AgentRole
from agent_playground.services.a2a.handler import DurableRequestHandler

HTTPS_PORT = 443
HTTP_PORT = 80
GRACEFUL_SHUTDOWN_SECONDS = 5


@dataclass(frozen=True, kw_only=True)
class A2aAppConfig:
    role: AgentRole
    base_url: str
    task_store: PostgresTaskStore | None = None
    executor: DemoAgentExecutor | None = None


async def _close_handler(
    handler: DurableRequestHandler, *, has_owned_store: bool
) -> None:
    try:
        # Producers can still write task snapshots while they drain.
        await handler.aclose()
    finally:
        if has_owned_store:
            await run_database_operation(close_app_store)


def create_a2a_app(config: A2aAppConfig) -> FastAPI:
    """Own executor shutdown and close the database only when this app created it."""
    role = config.role
    store = config.task_store or PostgresTaskStore(role)
    agent_executor = config.executor or DemoAgentExecutor(role)

    card = AgentCard(
        name=f"Demo {role.title()}",
        description=f"Independent {role} agent for the planner/reviewer A2A demonstration.",
        version="1.0.0",
        supported_interfaces=[
            AgentInterface(
                url=f"{config.base_url.rstrip('/')}/",
                protocol_binding="JSONRPC",
                protocol_version="1.0",
            )
        ],
        capabilities=AgentCapabilities(streaming=True),
        default_input_modes=["text/plain"],
        default_output_modes=["text/plain"],
        skills=[
            AgentSkill(
                id=role,
                name=role.title(),
                description="Create and revise practical plans"
                if role == "planner"
                else "Evaluate plans and return actionable feedback",
                tags=[role, "a2a-demo"],
            )
        ],
    )

    handler = DurableRequestHandler(agent_executor, store, card)
    has_owned_store = config.task_store is None

    @asynccontextmanager
    async def _lifespan(_app: FastAPI):
        if has_owned_store:
            await run_database_operation(prepare_app_store)

        try:
            yield
        finally:
            await _close_handler(handler, has_owned_store=has_owned_store)

    app = FastAPI(title=f"A2A Demo {role.title()}", lifespan=_lifespan)
    app.state.a2a_handler = handler
    add_a2a_routes_to_fastapi(
        app,
        agent_card_routes=create_agent_card_routes(card),
        jsonrpc_routes=create_jsonrpc_routes(handler, rpc_url="/"),
    )

    return app


def main() -> None:
    """Run the configured planner or reviewer HTTP server."""
    parser = argparse.ArgumentParser(description="Run one independent A2A demo agent")
    parser.add_argument("--role", choices=["planner", "reviewer"], required=True)
    parser.add_argument("--host")
    parser.add_argument("--port", type=int)

    arguments = parser.parse_args()

    settings = load_agent_config().a2a
    endpoint = (
        settings.planner_url if arguments.role == "planner" else settings.reviewer_url
    )
    address = urlsplit(endpoint)
    host = arguments.host or address.hostname
    default_port = HTTPS_PORT if address.scheme == "https" else HTTP_PORT
    port = arguments.port or address.port or default_port
    base_url = f"http://{host}:{port}" if arguments.host or arguments.port else endpoint

    app = create_a2a_app(A2aAppConfig(role=arguments.role, base_url=base_url))
    uvicorn.run(
        app,
        host=host or "127.0.0.1",
        port=port,
        timeout_graceful_shutdown=GRACEFUL_SHUTDOWN_SECONDS,
    )


if __name__ == "__main__":
    main()
