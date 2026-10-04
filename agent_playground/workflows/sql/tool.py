"""Agent tool entry point for the conversational SQL workflow."""

from langchain.tools import tool
from langchain_core.language_models import BaseChatModel
from langchain_core.tools import BaseTool
from langgraph.prebuilt import ToolRuntime

from agent_playground.workflows.sql.agent import make_revision_agent
from agent_playground.workflows.sql.api import HttpSqlApi
from agent_playground.workflows.sql.graph import make_sql_workflow
from agent_playground.workflows.sql.models import SqlState


def sql_workflow_tool(model: BaseChatModel) -> BaseTool:
    revise = make_revision_agent(model)
    workflow = make_sql_workflow(revise, HttpSqlApi())

    @tool
    async def run_sql_workflow(task: str, runtime: ToolRuntime) -> str:
        """Fetch and check demo SQL, revise it conversationally, and ask the user to accept or abandon it."""
        if not runtime.tool_call_id:
            raise ValueError("SQL workflow requires a stable tool call ID")

        result = await workflow.ainvoke(
            SqlState(task=task, workflow_call_id=runtime.tool_call_id)
        )
        completed = SqlState.model_validate(result)

        if completed.status == "abandoned":
            return "The user abandoned the SQL workflow. Nothing was submitted."

        return f"SQL was recorded by the demo API without execution. Receipt: {completed.submission}"

    return run_sql_workflow
