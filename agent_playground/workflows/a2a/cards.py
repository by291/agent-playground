"""Build compact completion receipts for external A2A collaboration."""

from a2ui.core.schema import (
    A2uiMessageListWrapper,
    CreateSurface,
    CreateSurfaceMessage,
    UpdateComponents,
    UpdateComponentsMessage,
)
from a2ui.core.schema.common_types import ComponentId

from agent_playground.workflows.cards import WorkflowPanel, WorkflowText
from agent_playground.workflows.output import WORKFLOW_CATALOG_ID


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
