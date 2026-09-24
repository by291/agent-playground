"""The agent graph served through Aegra's Agent Protocol API."""

import os
from datetime import UTC, datetime

from langchain.agents import create_agent
from langchain.tools import tool
from langchain_core.language_models import BaseChatModel
from langchain_deepseek import ChatDeepSeek
from langgraph.types import Checkpointer


@tool
def get_current_time() -> str:
    """Return the current date and time in UTC as an ISO 8601 string."""
    return datetime.now(UTC).isoformat()


def make_graph(
    model: BaseChatModel | None = None, checkpointer: Checkpointer | None = None
):
    if model is None:
        model = ChatDeepSeek(model=os.getenv("DEEPSEEK_MODEL", "deepseek-flash"))
    return create_agent(
        model=model,
        tools=[get_current_time],
        checkpointer=checkpointer,
        system_prompt=(
            "You are a concise assistant. Use get_current_time when the user asks "
            "for the current date or time."
        ),
    )


# Aegra supplies its own PostgreSQL checkpointer when it serves this graph.
graph = make_graph()
