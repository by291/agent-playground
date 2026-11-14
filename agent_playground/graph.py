"""The agent graph served through Aegra's Agent Protocol API."""

import sys
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass
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
from langgraph.graph.state import CompiledStateGraph
from langgraph.types import Checkpointer
from langgraph_sdk.runtime import ServerRuntime

from agent_playground.config.agent import ApprovalSettings, load_agent_config
from agent_playground.context import ContextMiddleware, ContextMiddlewareOptions
from agent_playground.db.async_operations import run_database_operation
from agent_playground.db.connection import prepare_app_store
from agent_playground.interactions import InteractionMiddleware, ask_user
from agent_playground.knowledge.tools import search_knowledge
from agent_playground.memory.middleware import MemoryMiddleware
from agent_playground.memory.models import MEMORY_TOKEN_BUDGET
from agent_playground.memory.tools import MEMORY_INSTRUCTIONS, memory_tools
from agent_playground.models.catalog import (
    ChatModelRequest,
    create_chat_model,
    model_configuration,
)
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

GRAPH_CACHE_SIZE = 2

# LangChain merges the middleware schemas into the graph at runtime.
type ConversationGraph = CompiledStateGraph[Any, Any, Any, Any]


@dataclass(frozen=True, kw_only=True)
class AgentGraphOptions:
    """Group model selection and optional dependencies for graph construction."""

    model: BaseChatModel | None = None
    checkpointer: Checkpointer | None = None
    mcp_tools: list[BaseTool] | None = None
    summary_model: BaseChatModel | None = None
    skills: SkillCatalog | None = None
    model_id: str | None = None
    approval_settings: ApprovalSettings | None = None


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


def make_graph(options: AgentGraphOptions | None = None) -> ConversationGraph:
    """Assemble one conversation agent with model-scoped budgets and tools."""
    options = options or AgentGraphOptions()
    configuration = model_configuration(options.model_id)
    model = options.model
    summary_model = options.summary_model

    if model is None:
        model = create_chat_model(ChatModelRequest(model_id=configuration.id))
        summary_model = summary_model or create_chat_model(
            ChatModelRequest(model_id=configuration.id, is_summary=True)
        )

    settings = configuration.context_settings(model)
    image_tokens = configuration.image_tokens

    catalog = options.skills if options.skills is not None else default_catalog()
    prompt = SYSTEM_PROMPT + catalog.prompt() + MEMORY_INSTRUCTIONS

    mcp_tools = options.mcp_tools or []
    tools = [
        ask_user,
        get_current_time,
        search_knowledge,
        *memory_tools(),
        *mcp_tools,
        run_experiment_workflow,
        run_report_workflow,
        run_a2a_workflow,
        sql_workflow_tool(model),
        *skill_tools(catalog),
    ]

    planning = PlanningMiddleware(tool_description=PLANNING_TOOL_DESCRIPTION)

    # LangChain runs after_model hooks in reverse order. Save public replies
    # before the approval hook can interrupt the run.
    middleware: list[AgentMiddleware[Any, Any, Any]] = [
        MemoryMiddleware(),
        InteractionMiddleware(
            tools,
            mcp_tools,
            options.approval_settings or load_agent_config().approvals,
        ),
        planning,
        ContextMiddleware(
            ContextMiddlewareOptions(
                model=model,
                summary_model=summary_model or model,
                system_prompt=prompt + "\n\n" + planning.system_prompt,
                tools=[*tools, *planning.tools],
                settings=settings,
                tokens_per_image=image_tokens,
                memory_token_budget=MEMORY_TOKEN_BUDGET,
                planning_token_budget=PLANNING_TOKEN_BUDGET,
            )
        ),
    ]

    return create_agent(
        model=model,
        tools=tools,
        checkpointer=options.checkpointer,
        system_prompt=prompt,
        middleware=middleware,
    )


@alru_cache(maxsize=1)
async def shared_mcp_tools() -> list[BaseTool]:
    """Discover process-shared tools once; each invocation opens its own session."""
    return await mcp_client().get_tools()


@alru_cache(maxsize=GRAPH_CACHE_SIZE)
async def base_graph(model_id: str) -> ConversationGraph:
    """Cache compiled graphs for execution and inspection without opening application storage."""
    tools = await shared_mcp_tools()

    return make_graph(AgentGraphOptions(mcp_tools=tools, model_id=model_id))


@asynccontextmanager
async def graph(
    config: RunnableConfig, runtime: ServerRuntime[dict[str, object]]
) -> AsyncIterator[ConversationGraph]:
    """Aegra keeps this context open for the complete worker execution."""
    requested = (config.get("configurable") or {}).get("model_id")

    if requested is not None and not isinstance(requested, str):
        raise ValueError("Invalid chat model ID")

    configuration = model_configuration(requested)
    compiled = await base_graph(configuration.id)

    if runtime.execution_runtime is None:
        yield compiled
        return

    # Aegra may pick up queued runs before the custom lifespan gets to initialize
    # the schema. Both paths share the same preparation for the process engine.
    await run_database_operation(prepare_app_store)

    # Tool calls share this sandbox scope until Aegra finishes execution.
    async with skill_execution(default_catalog()):
        with execution_trace(config):
            yield compiled
