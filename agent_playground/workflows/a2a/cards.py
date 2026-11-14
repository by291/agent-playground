"""Build compact completion receipts for external A2A collaboration."""

from a2ui.core.schema.v0_9 import A2uiMessageListWrapper
from a2ui.core.schema.v0_9.common_types import ComponentId

from agent_playground.workflows.cards import (
    WorkflowPanel,
    WorkflowText,
    workflow_surface,
)


def completion_receipt(
    surface_id: str, title: str, text: str
) -> A2uiMessageListWrapper:
    """Publish completion without duplicating the separately owned child output."""
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

    return workflow_surface(surface_id, components)
