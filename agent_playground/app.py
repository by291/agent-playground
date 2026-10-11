"""Application metadata and demonstration routes alongside Aegra's protocol routes."""

import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI

from agent_playground.db.async_operations import run_database_operation
from agent_playground.db.connection import close_app_store, prepare_app_store
from agent_playground.knowledge.worker import run_knowledge_worker
from agent_playground.memory.routes import router as memory_router
from agent_playground.models.catalog import AgentInfo
from agent_playground.models.catalog import agent_info as model_agent_info
from agent_playground.services.a2a.coordinator import run_a2a_worker
from agent_playground.services.a2a.routes import router as a2a_router
from agent_playground.services.report.routes import router as report_router
from agent_playground.services.report.worker import run_report_worker
from agent_playground.services.sql.routes import router as sql_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Own schema startup, worker draining and final database disposal."""
    workers: list[asyncio.Task[None]] = []

    try:
        await run_database_operation(prepare_app_store)
        workers = [
            asyncio.create_task(run_report_worker()),
            asyncio.create_task(run_knowledge_worker()),
            asyncio.create_task(run_a2a_worker()),
        ]

        yield
    finally:
        for worker in workers:
            worker.cancel()

        try:
            results = await asyncio.gather(*workers, return_exceptions=True)

            # All workers have drained before one failure is propagated to shutdown.
            for result in results:
                if isinstance(result, BaseException) and not isinstance(
                    result, asyncio.CancelledError
                ):
                    raise result
        finally:
            # Workers can still be inside database operations while draining.
            await run_database_operation(close_app_store)


app = FastAPI(title="Agent Playground", lifespan=lifespan)
app.include_router(sql_router)
app.include_router(report_router)
app.include_router(a2a_router)
app.include_router(memory_router)


@app.get("/agent-info")
def agent_info() -> AgentInfo:
    return model_agent_info()
