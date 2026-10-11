"""Serve one independent official A2A planner or reviewer agent."""

import argparse
from contextlib import asynccontextmanager
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


def create_a2a_app(
    role: AgentRole,
    base_url: str,
    *,
    task_store: PostgresTaskStore | None = None,
    executor: DemoAgentExecutor | None = None,
) -> FastAPI:
    """Own executor shutdown and close the database only when this app created it."""
    store = task_store or PostgresTaskStore(role)
    agent_executor = executor or DemoAgentExecutor(role)
    card = AgentCard(
        name=f"Demo {role.title()}",
        description=f"Independent {role} agent for the planner/reviewer A2A demonstration.",
        version="1.0.0",
        supported_interfaces=[
            AgentInterface(
                url=f"{base_url.rstrip('/')}/",
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
    owns_store = task_store is None

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        if owns_store:
            await run_database_operation(prepare_app_store)

        try:
            yield
        finally:
            try:
                # Producers and subscriptions can still write task snapshots.
                # Close them before releasing the app-owned database pool.
                await handler.aclose()
            finally:
                if owns_store:
                    await run_database_operation(close_app_store)

    app = FastAPI(title=f"A2A Demo {role.title()}", lifespan=lifespan)
    app.state.a2a_handler = handler
    add_a2a_routes_to_fastapi(
        app,
        agent_card_routes=create_agent_card_routes(card),
        jsonrpc_routes=create_jsonrpc_routes(handler, rpc_url="/"),
    )

    return app


def main() -> None:
    parser = argparse.ArgumentParser(description="Run one independent A2A demo agent")
    parser.add_argument("--role", choices=["planner", "reviewer"], required=True)
    parser.add_argument("--host")
    parser.add_argument("--port", type=int)
    args = parser.parse_args()

    settings = load_agent_config().a2a
    endpoint = settings.planner_url if args.role == "planner" else settings.reviewer_url
    address = urlsplit(endpoint)
    host = args.host or address.hostname
    port = args.port or address.port or (443 if address.scheme == "https" else 80)
    base_url = f"http://{host}:{port}" if args.host or args.port else endpoint

    app = create_a2a_app(args.role, base_url)
    uvicorn.run(app, host=host or "127.0.0.1", port=port, timeout_graceful_shutdown=5)


if __name__ == "__main__":
    main()
