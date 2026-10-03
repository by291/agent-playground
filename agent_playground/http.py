"""Read-only application metadata alongside Aegra's protocol routes."""

from fastapi import FastAPI

from agent_playground.config import configured_model_name

app = FastAPI(title="Agent Playground")


@app.get("/agent-info")
def agent_info() -> dict[str, str]:
    return {"model": configured_model_name()}
