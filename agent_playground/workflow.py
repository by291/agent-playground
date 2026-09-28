"""A deterministic example workflow that produces an A2UI experiment card."""

from typing import Literal, TypedDict

from langchain.tools import tool
from langgraph.graph import END, START, StateGraph
from langgraph.prebuilt import ToolRuntime
from langgraph.types import interrupt
from pydantic import BaseModel, Field

from agent_playground.workflow_cards import publish_experiment_card


class ExperimentState(BaseModel):
    idea: str
    # Keep the persisted checkpoint key; its value is the workflow tool call ID.
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

    await publish_experiment_card(
        workflow_call_id=state.card_group_id,
        title=title,
        stage="idea",
        heading="IDEA CAPTURED",
        lines=[],
    )

    return {"title": title}


async def plan_steps(state: ExperimentState) -> StepsUpdate:
    steps = [
        f"Define what success means for {state.title}.",
        "Run the smallest useful trial.",
        "Record the result and decide what to change next.",
    ]

    await publish_experiment_card(
        workflow_call_id=state.card_group_id,
        title=state.title,
        stage="draft",
        heading="DRAFT PLAN",
        lines=steps,
    )

    return {"steps": steps}


async def review_plan(state: ExperimentState) -> ReviewUpdate:
    await publish_experiment_card(
        workflow_call_id=state.card_group_id,
        title=state.title,
        stage="review",
        heading="REVIEW REQUIRED",
        lines=["Review the draft plan before continuing."],
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
        heading = "PLAN REJECTED"
        lines = ["The reviewer rejected this draft."]
    else:
        heading = "APPROVED PLAN"
        lines = state.steps

    await publish_experiment_card(
        workflow_call_id=state.card_group_id,
        title=state.title,
        stage="reviewed",
        heading=heading,
        lines=lines,
    )

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
