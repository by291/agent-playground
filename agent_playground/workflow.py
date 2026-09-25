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
from langgraph.graph import END, START, StateGraph
from pydantic import BaseModel, Field

BASIC_CATALOG = BasicCatalog()


class ExperimentState(BaseModel):
    idea: str
    title: str = ""
    steps: list[str] = Field(default_factory=list)


class TitleUpdate(TypedDict):
    title: str


class StepsUpdate(TypedDict):
    steps: list[str]


class ExperimentCard(BaseModel):
    kind: Literal["a2ui"] = "a2ui"
    messages: list[A2uiMessage]


def prepare_idea(state: ExperimentState) -> TitleUpdate:
    idea = " ".join(state.idea.split())[:160]
    return {"title": idea or "Untitled experiment"}


def plan_steps(state: ExperimentState) -> StepsUpdate:
    return {
        "steps": [
            f"Define what success means for {state.title}.",
            "Run the smallest useful trial.",
            "Record the result and decide what to change next.",
        ]
    }


builder = StateGraph(ExperimentState)
builder.add_node("prepare_idea", prepare_idea)
builder.add_node("plan_steps", plan_steps)
builder.add_edge(START, "prepare_idea")
builder.add_edge("prepare_idea", "plan_steps")
builder.add_edge("plan_steps", END)
experiment_workflow = builder.compile()


def experiment_card(state: ExperimentState) -> ExperimentCard:
    """Return protocol messages for one self-contained A2UI surface."""
    surface_id = f"experiment-{uuid4()}"
    step_ids = [ComponentId(f"step-{index}") for index in range(len(state.steps))]
    components: list[CardComponent | ColumnComponent | TextComponent] = [
        CardComponent(id=ComponentId("root"), child=ComponentId("content")),
        ColumnComponent(
            id=ComponentId("content"),
            children=[ComponentId("eyebrow"), ComponentId("title"), *step_ids],
        ),
        TextComponent(
            id=ComponentId("eyebrow"), text="EXPERIMENT PLAN", variant="caption"
        ),
        TextComponent(id=ComponentId("title"), text=state.title, variant="h3"),
        *[
            TextComponent(id=step_id, text=f"{index}. {step}")
            for index, (step_id, step) in enumerate(
                zip(step_ids, state.steps, strict=True), start=1
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


@tool
def run_experiment_workflow(idea: str) -> str:
    """Create a short experiment plan and a visual card for the user's idea."""
    state = experiment_workflow.invoke(ExperimentState(idea=idea))
    return experiment_card(ExperimentState.model_validate(state)).model_dump_json(
        by_alias=True, exclude_none=True
    )
