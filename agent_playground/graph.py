"""The agent graph served through Aegra's Agent Protocol API."""

import sys
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from typing import Any

from async_lru import alru_cache
from langchain.agents import create_agent
from langchain.agents.middleware import AgentMiddleware
from langchain.tools import tool
from langchain_core.language_models import BaseChatModel
from langchain_core.runnables import RunnableConfig
from langchain_core.tools import BaseTool
from langchain_mcp_adapters.client import MultiServerMCPClient
from langgraph.types import Checkpointer
from langgraph_sdk.runtime import ServerRuntime

from agent_playground.config.agent import ApprovalSettings, load_agent_config
from agent_playground.context import ContextMiddleware
from agent_playground.db.connection import prepare_app_store
from agent_playground.interactions import InteractionMiddleware, ask_user
from agent_playground.knowledge.tools import search_knowledge
from agent_playground.memory.middleware import MemoryMiddleware
from agent_playground.memory.models import MEMORY_TOKEN_BUDGET
from agent_playground.memory.tools import MEMORY_INSTRUCTIONS, memory_tools
from agent_playground.models.catalog import create_chat_model, model_configuration
from agent_playground.observability import execution_trace
from agent_playground.planning import (
    PLANNING_TOKEN_BUDGET,
    PLANNING_TOOL_DESCRIPTION,
    PlanningMiddleware,
)
from agent_playground.prompts import SYSTEM_PROMPT
from agent_playground.skills.catalog import SkillCatalog
from agent_playground.skills.sandbox import skill_execution
from agent_playground.skills.tools import default_catalog, skill_tools
from agent_playground.workflows.a2a.tool import run_a2a_workflow
from agent_playground.workflows.experiment.tool import run_experiment_workflow
from agent_playground.workflows.report.tool import run_report_workflow
from agent_playground.workflows.sql.tool import sql_workflow_tool


@tool
def get_current_time() -> str:
    """Return the current date and time in UTC as an ISO 8601 string."""
    return datetime.now(UTC).isoformat()


def mcp_client() -> MultiServerMCPClient:
    """Use this process's interpreter to discover the local stdio tools."""
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
    model_id: str | None = None,
    approval_settings: ApprovalSettings | None = None,
):
    """Assemble one conversation agent with model-scoped budgets and tools."""
    configuration = model_configuration(model_id)

    if model is None:
        model = create_chat_model(configuration.id)
        summary_model = summary_model or create_chat_model(
            configuration.id, summary=True
        )

    settings = configuration.context_settings(model)
    image_tokens = configuration.image_tokens

    catalog = skills if skills is not None else default_catalog()
    prompt = SYSTEM_PROMPT + catalog.prompt() + MEMORY_INSTRUCTIONS
    tools = [
        ask_user,
        get_current_time,
        search_knowledge,
        *memory_tools(),
        *(mcp_tools or []),
        run_experiment_workflow,
        run_report_workflow,
        run_a2a_workflow,
        sql_workflow_tool(model),
        *skill_tools(catalog),
    ]

    planning = PlanningMiddleware(tool_description=PLANNING_TOOL_DESCRIPTION)
    # create_agent merges the middleware-owned schemas into one checkpoint state.
    middleware: list[AgentMiddleware[Any, Any, Any]] = [
        MemoryMiddleware(),
        InteractionMiddleware(
            tools,
            mcp_tools or [],
            approval_settings or load_agent_config().approvals,
        ),
        planning,
        ContextMiddleware(
            model,
            summary_model or model,
            prompt + "\n\n" + planning.system_prompt,
            [*tools, *planning.tools],
            settings,
            image_tokens,
            memory_token_budget=MEMORY_TOKEN_BUDGET,
            planning_token_budget=PLANNING_TOKEN_BUDGET,
        ),
    ]

    return create_agent(
        model=model,
        tools=tools,
        checkpointer=checkpointer,
        system_prompt=prompt,
        middleware=middleware,
    )


@alru_cache(maxsize=1)
async def shared_mcp_tools():
    """Discover process-shared tools once; each invocation opens its own session."""
    return await mcp_client().get_tools()


@alru_cache(maxsize=2)
async def base_graph(model_id: str):
    """Cache one graph per configured model; Aegra injects the same durable state."""
    prepare_app_store()
    tools = await shared_mcp_tools()

    return make_graph(mcp_tools=tools, model_id=model_id)


@asynccontextmanager
async def graph(config: RunnableConfig, runtime: ServerRuntime[dict[str, object]]):
    """Aegra keeps this context open for the complete worker execution."""
    requested = (config.get("configurable") or {}).get("model_id")

    if requested is not None and not isinstance(requested, str):
        raise ValueError("Invalid chat model ID")

    configuration = model_configuration(requested)
    compiled = await base_graph(configuration.id)

    # Keep the sandbox scope open across the yield; inspection omits the run trace.
    async with skill_execution(default_catalog()):
        if runtime.execution_runtime is None:
            yield compiled
            return

        with execution_trace(config):
            yield compiled
