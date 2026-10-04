"""Application metadata and demonstration routes alongside Aegra's protocol routes."""

from fastapi import FastAPI

from agent_playground.config import configured_model_name
from agent_playground.sql_demo.routes import router as sql_demo_router

app = FastAPI(title="Agent Playground")
app.include_router(sql_demo_router)


@app.get("/agent-info")
def agent_info() -> dict[str, str]:
    return {"model": configured_model_name()}
