"""The agent graph served through Aegra's Agent Protocol API."""

import os
import sys
from datetime import UTC, datetime

from langchain.agents import create_agent
from langchain.tools import tool
from langchain_core.language_models import BaseChatModel
from langchain_core.tools import BaseTool
from langchain_deepseek import ChatDeepSeek
from langchain_mcp_adapters.client import MultiServerMCPClient
from langgraph.types import Checkpointer

from agent_playground.workflow import run_experiment_workflow


@tool
def get_current_time() -> str:
    """Return the current date and time in UTC as an ISO 8601 string."""
    return datetime.now(UTC).isoformat()


def mcp_client() -> MultiServerMCPClient:
    return MultiServerMCPClient(
        {
            "local": {
                "transport": "stdio",
                "command": sys.executable,
                "args": ["-m", "agent_playground.mcp_server"],
            }
        }
    )


def make_graph(
    model: BaseChatModel | None = None,
    checkpointer: Checkpointer | None = None,
    mcp_tools: list[BaseTool] | None = None,
):
    if model is None:
        model = ChatDeepSeek(model=os.getenv("DEEPSEEK_MODEL", "deepseek-flash"))
    return create_agent(
        model=model,
        tools=[get_current_time, *(mcp_tools or []), run_experiment_workflow],
        checkpointer=checkpointer,
        system_prompt=(
            "You are a concise assistant. Use get_current_time when the user asks "
            "for the current date or time. Use calculate_sum for arithmetic "
            "that asks you to add two numbers. Use run_experiment_workflow when "
            "the user asks for an experiment plan or a visual card. "
            "After an approved workflow call, summarize its plan in plain text. "
            "If the reviewer rejected it, acknowledge the rejection."
        ),
    )


async def graph():
    """Load MCP tools once at startup; Aegra supplies the PostgreSQL checkpointer."""
    tools = await mcp_client().get_tools()
    return make_graph(mcp_tools=tools)
