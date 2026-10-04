"""Application metadata and demonstration routes alongside Aegra's protocol routes."""

import asyncio
from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI

from agent_playground.config import configured_model_name
from agent_playground.report_demo.routes import router as report_demo_router
from agent_playground.report_demo.worker import run_report_worker
from agent_playground.sql_demo.routes import router as sql_demo_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    worker = asyncio.create_task(run_report_worker())

    try:
        yield
    finally:
        worker.cancel()

        with suppress(asyncio.CancelledError):
            await worker


app = FastAPI(title="Agent Playground", lifespan=lifespan)
app.include_router(sql_demo_router)
app.include_router(report_demo_router)


@app.get("/agent-info")
def agent_info() -> dict[str, str]:
    return {"model": configured_model_name()}
