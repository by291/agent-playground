"""A deterministic example workflow that produces an A2UI experiment card."""

from typing import Literal, TypedDict

from langchain.tools import tool
from langchain_core.callbacks.manager import adispatch_custom_event
from langgraph.config import get_config
from langgraph.graph import END, START, StateGraph
from langgraph.prebuilt import ToolRuntime
from langgraph.types import interrupt
from pydantic import BaseModel, Field

from agent_playground.workflow_cards import experiment_card
from agent_playground.workflow_outputs import store_workflow_output


class ExperimentState(BaseModel):
    idea: str
    card_group_id: str
    title: str = ""
    steps: list[str] = Field(default_factory=list)
    review_status: Literal["approved", "rejected"] | None = None


class TitleUpdate(TypedDict):
    title: str


class StepsUpdate(TypedDict):
    steps: list[str]


class ReviewUpdate(TypedDict):
    title: str
    steps: list[str]
    review_status: Literal["approved", "rejected"]


class PlanReview(BaseModel):
    decision: Literal["approve", "reject"]
    title: str
    steps: list[str]


async def prepare_idea(state: ExperimentState) -> TitleUpdate:
    idea = " ".join(state.idea.split())[:160]
    title = idea or "Untitled experiment"
    await emit_card(
        state.model_copy(update={"title": title}), "idea", "IDEA CAPTURED", []
    )
    return {"title": title}


async def plan_steps(state: ExperimentState) -> StepsUpdate:
    steps = [
        f"Define what success means for {state.title}.",
        "Run the smallest useful trial.",
        "Record the result and decide what to change next.",
    ]
    await emit_card(state, "draft", "DRAFT PLAN", steps)
    return {"steps": steps}


async def review_plan(state: ExperimentState) -> ReviewUpdate:
    await emit_card(
        state,
        "review",
        "REVIEW REQUIRED",
        ["Review the draft plan before continuing."],
    )
    review = PlanReview.model_validate(
        interrupt(
            {
                "kind": "experiment_plan_review",
                "workflowCallId": state.card_group_id,
                "title": state.title,
                "steps": state.steps,
            },
            response_schema=PlanReview,
        )
    )
    if review.decision == "reject":
        return {
            "title": state.title,
            "steps": state.steps,
            "review_status": "rejected",
        }
    return {
        "title": review.title.strip(),
        "steps": review.steps,
        "review_status": "approved",
    }


async def finish_plan(state: ExperimentState) -> dict[str, object]:
    if state.review_status == "rejected":
        await emit_card(
            state, "reviewed", "PLAN REJECTED", ["The reviewer rejected this draft."]
        )
    else:
        await emit_card(state, "reviewed", "APPROVED PLAN", state.steps)
    return {}


builder = StateGraph(ExperimentState)
builder.add_node("prepare_idea", prepare_idea)
builder.add_node("plan_steps", plan_steps)
builder.add_node("review_plan", review_plan)
builder.add_node("finish_plan", finish_plan)
builder.add_edge(START, "prepare_idea")
builder.add_edge("prepare_idea", "plan_steps")
builder.add_edge("plan_steps", "review_plan")
builder.add_edge("review_plan", "finish_plan")
builder.add_edge("finish_plan", END)
experiment_workflow = builder.compile()


async def emit_card(
    state: ExperimentState, stage: str, heading: str, lines: list[str]
) -> None:
    card = experiment_card(state.card_group_id, state.title, stage, heading, lines)
    config = get_config()
    metadata = config.get("metadata") or {}
    configurable = config.get("configurable") or {}
    agui_run_id = metadata.get("agui_run_id")
    thread_id = configurable.get("thread_id")
    if not isinstance(agui_run_id, str) or not isinstance(thread_id, str):
        raise TypeError("Workflow output is missing AG-UI run or thread ID")
    payload = card.model_dump(mode="json", by_alias=True, exclude_none=True)
    output = await store_workflow_output(
        thread_id,
        agui_run_id,
        state.card_group_id,
        stage,
        {"idea": 1, "draft": 2, "review": 3, "reviewed": 4}[stage],
        payload,
    )
    await adispatch_custom_event(
        "a2ui",
        {
            "id": output.id,
            "aguiRunId": output.agui_run_id,
            "workflowCallId": state.card_group_id,
            "outputSeq": output.output_seq,
            "toolCallId": state.card_group_id,
            **output.payload,
        },
    )


@tool
async def run_experiment_workflow(idea: str, runtime: ToolRuntime) -> str:
    """Run a visible experiment-planning workflow with a human review step."""
    if not runtime.tool_call_id:
        raise ValueError("Workflow requires a stable tool call ID")
    result = await experiment_workflow.ainvoke(
        ExperimentState(
            idea=idea,
            card_group_id=runtime.tool_call_id,
        )
    )
    completed = ExperimentState.model_validate(result)
    if completed.review_status == "rejected":
        return "The reviewer rejected the experiment plan."
    steps = "\n".join(
        f"{index}. {step}" for index, step in enumerate(completed.steps, 1)
    )
    return f"Approved experiment plan: {completed.title}\n{steps}"
