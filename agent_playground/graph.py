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
from agent_playground.knowledge.tools import search_knowledge
from agent_playground.observability import execution_trace
from agent_playground.prompts import SYSTEM_PROMPT
from agent_playground.skills.catalog import SkillCatalog
from agent_playground.skills.sandbox import skill_execution
from agent_playground.skills.tools import default_catalog, skill_tools
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
    skills: SkillCatalog | None = None,
):
    if model is None:
        model_name = configured_model_name()
        model = ChatDeepSeek(model=model_name, stream_usage=True)
        summary_model = summary_model or ChatDeepSeek(
            model=model_name,
            max_tokens=4096,
            extra_body={"thinking": {"type": "disabled"}},
        )

    catalog = skills if skills is not None else default_catalog()
    prompt = SYSTEM_PROMPT + catalog.prompt()
    tools = [
        get_current_time,
        search_knowledge,
        *(mcp_tools or []),
        run_experiment_workflow,
        run_report_workflow,
        sql_workflow_tool(model),
        *skill_tools(catalog),
    ]

    return create_agent(
        model=model,
        tools=tools,
        checkpointer=checkpointer,
        system_prompt=prompt,
        middleware=[ContextMiddleware(model, summary_model or model, prompt, tools)],
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

    async with skill_execution(default_catalog()):
        if runtime.execution_runtime is None:
            yield compiled
            return

        with execution_trace(config):
            yield compiled
