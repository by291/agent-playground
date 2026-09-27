"""A deterministic example workflow that produces an A2UI experiment card."""

from typing import Literal, TypedDict
from uuid import uuid4

from a2ui.core.basic_catalog import BasicCatalog
from a2ui.core.basic_catalog.components import (
    CardComponent,
    ColumnComponent,
    TextComponent,
)
from a2ui.core.schema import (
    A2uiMessage,
    CreateSurface,
    CreateSurfaceMessage,
    UpdateComponents,
    UpdateComponentsMessage,
)
from a2ui.core.schema.common_types import ComponentId
from langchain.tools import tool
from langchain_core.callbacks.manager import adispatch_custom_event
from langgraph.graph import END, START, StateGraph
from langgraph.prebuilt import ToolRuntime
from langgraph.types import interrupt
from pydantic import BaseModel, Field

BASIC_CATALOG = BasicCatalog()


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


class ExperimentCard(BaseModel):
    kind: Literal["a2ui"] = "a2ui"
    messages: list[A2uiMessage]


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


def experiment_card(
    state: ExperimentState, stage: str, heading: str, lines: list[str]
) -> ExperimentCard:
    """Return protocol messages for one workflow step."""
    surface_id = f"experiment-{state.card_group_id}-{stage}"
    step_ids = [ComponentId(f"step-{index}") for index in range(len(lines))]
    components: list[CardComponent | ColumnComponent | TextComponent] = [
        CardComponent(id=ComponentId("root"), child=ComponentId("content")),
        ColumnComponent(
            id=ComponentId("content"),
            children=[ComponentId("eyebrow"), ComponentId("title"), *step_ids],
        ),
        TextComponent(id=ComponentId("eyebrow"), text=heading, variant="caption"),
        TextComponent(id=ComponentId("title"), text=state.title, variant="h3"),
        *[
            TextComponent(id=step_id, text=f"{index}. {step}")
            for index, (step_id, step) in enumerate(
                zip(step_ids, lines, strict=True), start=1
            )
        ],
    ]
    return ExperimentCard(
        messages=[
            CreateSurfaceMessage(
                create_surface=CreateSurface(
                    surface_id=surface_id, catalog_id=BASIC_CATALOG.catalog_id
                )
            ),
            UpdateComponentsMessage(
                update_components=UpdateComponents(
                    surface_id=surface_id, components=components
                )
            ),
        ]
    )


async def emit_card(
    state: ExperimentState, stage: str, heading: str, lines: list[str]
) -> None:
    card = experiment_card(state, stage, heading, lines)
    await adispatch_custom_event(
        "experiment_card",
        {
            "id": f"experiment-{state.card_group_id}-{stage}",
            "toolCallId": state.card_group_id,
            **card.model_dump(mode="json", by_alias=True, exclude_none=True),
        },
    )


@tool
async def run_experiment_workflow(idea: str, runtime: ToolRuntime) -> str:
    """Run a visible experiment-planning workflow with a human review step."""
    result = await experiment_workflow.ainvoke(
        ExperimentState(
            idea=idea,
            card_group_id=runtime.tool_call_id or str(uuid4()),
        )
    )
    completed = ExperimentState.model_validate(result)
    if completed.review_status == "rejected":
        return "The reviewer rejected the experiment plan."
    steps = "\n".join(
        f"{index}. {step}" for index, step in enumerate(completed.steps, 1)
    )
    return f"Approved experiment plan: {completed.title}\n{steps}"
