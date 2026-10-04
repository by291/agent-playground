"""The agent graph served through Aegra's Agent Protocol API."""

import sys
from contextlib import asynccontextmanager
from datetime import UTC, datetime

from async_lru import alru_cache
from langchain.agents import create_agent
from langchain.tools import tool
from langchain_core.language_models import BaseChatModel
from langchain_core.runnables import RunnableConfig
from langchain_core.tools import BaseTool
from langchain_deepseek import ChatDeepSeek
from langchain_mcp_adapters.client import MultiServerMCPClient
from langgraph.types import Checkpointer
from langgraph_sdk.runtime import ServerRuntime

from agent_playground.config import configured_model_name
from agent_playground.context import ContextMiddleware
from agent_playground.db.connection import prepare_app_store
from agent_playground.observability import execution_trace
from agent_playground.workflows.experiment.tool import run_experiment_workflow
from agent_playground.workflows.report.tool import run_report_workflow
from agent_playground.workflows.sql.tool import sql_workflow_tool


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
    summary_model: BaseChatModel | None = None,
):
    if model is None:
        model_name = configured_model_name()
        model = ChatDeepSeek(model=model_name, stream_usage=True)
        summary_model = summary_model or ChatDeepSeek(
            model=model_name,
            max_tokens=4096,
            extra_body={"thinking": {"type": "disabled"}},
        )

    tools = [
        get_current_time,
        *(mcp_tools or []),
        run_experiment_workflow,
        run_report_workflow,
        sql_workflow_tool(model),
    ]
    system_prompt = (
        "You are a concise assistant. Use get_current_time when the user asks "
        "for the current date or time. Use calculate_sum for arithmetic "
        "that asks you to add two numbers. Use run_experiment_workflow when "
        "the user asks for an experiment plan or a visual card. "
        "Use run_report_workflow when the user asks to generate a report, "
        "an asynchronous API job, or external task progress. Its external service "
        "updates progress and completes even when the user closes the page. "
        "Only start one report workflow at a time. "
        "Use run_sql_workflow when the user asks for a SQL review workflow, "
        "SQL checking, or the SQL demo. It uses a demo orders table and records "
        "accepted SQL without executing it. Only start one SQL workflow at a time. "
        "The user can already see the workflow plan and review result in a card. "
        "After a workflow call, briefly acknowledge the review outcome without "
        "repeating the title or steps, unless the user asks for those details."
        " After a SQL workflow, briefly acknowledge submission or abandonment "
        "without repeating SQL already shown in the card."
    )

    return create_agent(
        model=model,
        tools=tools,
        checkpointer=checkpointer,
        system_prompt=system_prompt,
        middleware=[
            ContextMiddleware(model, summary_model or model, system_prompt, tools)
        ],
    )


@alru_cache(maxsize=1)
async def base_graph():
    """Share graph setup; Aegra copies it and injects persistence for each run."""
    prepare_app_store()
    tools = await mcp_client().get_tools()

    return make_graph(mcp_tools=tools)


@asynccontextmanager
async def graph(config: RunnableConfig, runtime: ServerRuntime[dict[str, object]]):
    """Aegra keeps this context open for the complete worker execution."""
    compiled = await base_graph()

    if runtime.execution_runtime is None:
        yield compiled
        return

    with execution_trace(config):
        yield compiled
