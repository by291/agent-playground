"""Expose the same agent as an AG-UI stream on Aegra's HTTP server."""

import logging

from aegra_api.services.langgraph_service import get_langgraph_service
from ag_ui.core import RunErrorEvent
from ag_ui.core.types import RunAgentInput
from ag_ui.encoder import EventEncoder
from ag_ui_langgraph import LangGraphAgent
from fastapi import FastAPI, Request
from fastapi.responses import StreamingResponse

app = FastAPI()
logger = logging.getLogger(__name__)


@app.post("/agent")
async def run_agent(input_data: RunAgentInput, request: Request) -> StreamingResponse:
    encoder = EventEncoder(accept=request.headers.get("accept"))

    async def events():
        # Aegra injects its PostgreSQL checkpointer into this request's graph copy.
        try:
            async with get_langgraph_service().get_graph("agent") as graph:
                agent = LangGraphAgent(name="agent", graph=graph, emit_raw_events=False)
                async for event in agent.run(input_data):
                    yield encoder.encode(event)
        except Exception:
            logger.exception("Agent run failed")
            yield encoder.encode(RunErrorEvent(message="Agent run failed."))

    return StreamingResponse(events(), media_type=encoder.get_content_type())
