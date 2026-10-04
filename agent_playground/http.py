"""Application metadata and demonstration routes alongside Aegra's protocol routes."""

import asyncio
from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI

from agent_playground.config import configured_model_name
from agent_playground.knowledge.worker import run_knowledge_worker
from agent_playground.services.report.routes import router as report_router
from agent_playground.services.report.worker import run_report_worker
from agent_playground.services.sql.routes import router as sql_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    workers = [
        asyncio.create_task(run_report_worker()),
        asyncio.create_task(run_knowledge_worker()),
    ]

    try:
        yield
    finally:
        for worker in workers:
            worker.cancel()

        for worker in workers:
            with suppress(asyncio.CancelledError):
                await worker


app = FastAPI(title="Agent Playground", lifespan=lifespan)
app.include_router(sql_router)
app.include_router(report_router)


@app.get("/agent-info")
def agent_info() -> dict[str, str]:
    return {"model": configured_model_name()}
