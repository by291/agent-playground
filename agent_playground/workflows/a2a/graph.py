"""Checkpoint the coordination identity before starting independent agents."""

from typing import Any, Literal

from a2ui.core.schema import (
    A2uiMessageListWrapper,
    CreateSurface,
    CreateSurfaceMessage,
    UpdateComponents,
    UpdateComponentsMessage,
)
from a2ui.core.schema.common_types import ComponentId
from langgraph.graph import END, START, StateGraph
from langgraph.types import Checkpointer
from pydantic import BaseModel

from agent_playground.workflows.a2a.api import HttpA2aApi
from agent_playground.workflows.cards import WorkflowPanel, WorkflowText
from agent_playground.workflows.external import (
    register_external_task,
    wait_for_external_task,
)
from agent_playground.workflows.output import (
    WORKFLOW_CATALOG_ID,
    WorkflowOutputMetadata,
    WorkflowPresentation,
    publish_workflow_output,
)


def _completion_receipt(
    surface_id: str, title: str, text: str
) -> A2uiMessageListWrapper:
    components = [
        WorkflowPanel(
            id=ComponentId("root"),
            children=[
                ComponentId("eyebrow"),
                ComponentId("title"),
                ComponentId("body"),
            ],
        ),
        WorkflowText(
            id=ComponentId("eyebrow"), text="A2A COLLABORATION", role="eyebrow"
        ),
        WorkflowText(id=ComponentId("title"), text=title, role="title"),
        WorkflowText(id=ComponentId("body"), text=text, role="body"),
    ]

    return A2uiMessageListWrapper(
        messages=[
            CreateSurfaceMessage(
                create_surface=CreateSurface(
                    surface_id=surface_id, catalog_id=WORKFLOW_CATALOG_ID
                )
            ),
            UpdateComponentsMessage(
                update_components=UpdateComponents(
                    surface_id=surface_id, components=components
                )
            ),
        ]
    )


class A2aState(BaseModel):
    task: str
    workflow_call_id: str
    require_input: bool = False
    task_id: str = ""
    callback_token: str = ""
    status: Literal["succeeded", "failed", "cancelled"] | None = None
    result: dict[str, Any] | None = None
    error: str | None = None


def make_a2a_workflow(checkpointer: Checkpointer | None = None):
    async def register(state: A2aState):
        registration = await register_external_task(
            workflow_call_id=state.workflow_call_id,
            step_id="a2a",
            label="A2A collaboration",
        )

        return {
            "task_id": registration.task_id,
            "callback_token": registration.callback_token,
        }

    async def submit(state: A2aState):
        await HttpA2aApi().submit(
            task_id=state.task_id,
            task=state.task,
            callback_token=state.callback_token,
            require_input=state.require_input,
        )

    def wait(state: A2aState):
        result = wait_for_external_task(
            task_id=state.task_id, workflow_call_id=state.workflow_call_id
        )

        return {"status": result.status, "result": result.result, "error": result.error}

    async def publish(state: A2aState):
        titles = {
            "succeeded": "A2A collaboration completed",
            "failed": "A2A collaboration failed",
            "cancelled": "A2A collaboration cancelled",
        }
        if state.status == "succeeded":
            receipt = "The full revision is available in the agent output."
        elif state.status == "cancelled":
            receipt = "The agent collaboration was cancelled."
        else:
            receipt = state.error or "The agent collaboration failed."

        surface_id = f"a2a-{state.workflow_call_id}-result"
        await publish_workflow_output(
            workflow_call_id=state.workflow_call_id,
            step_id="result",
            step_seq=1,
            card=_completion_receipt(
                surface_id=surface_id,
                title=titles[state.status or "failed"],
                text=receipt,
            ),
            workflow=WorkflowOutputMetadata(
                presentation=WorkflowPresentation(
                    surface_id=surface_id, group_id=state.workflow_call_id
                )
            ),
        )

    builder = StateGraph(A2aState)
    builder.add_node("register", register)
    builder.add_node("submit", submit)
    builder.add_node("wait", wait)
    builder.add_node("publish", publish)
    builder.add_edge(START, "register")
    builder.add_edge("register", "submit")
    builder.add_edge("submit", "wait")
    builder.add_edge("wait", "publish")
    builder.add_edge("publish", END)

    return builder.compile(checkpointer=checkpointer)
