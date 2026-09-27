"""Build complete A2UI cards for experiment workflow steps."""

from typing import Literal

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
from pydantic import BaseModel

BASIC_CATALOG = BasicCatalog()


class ExperimentCard(BaseModel):
    kind: Literal["a2ui"] = "a2ui"
    messages: list[A2uiMessage]


def experiment_card(
    card_group_id: str, title: str, stage: str, heading: str, lines: list[str]
) -> ExperimentCard:
    """Return protocol messages for one workflow step."""
    surface_id = f"experiment-{card_group_id}-{stage}"
    step_ids = [ComponentId(f"step-{index}") for index in range(len(lines))]
    components: list[CardComponent | ColumnComponent | TextComponent] = [
        CardComponent(id=ComponentId("root"), child=ComponentId("content")),
        ColumnComponent(
            id=ComponentId("content"),
            children=[ComponentId("eyebrow"), ComponentId("title"), *step_ids],
        ),
        TextComponent(id=ComponentId("eyebrow"), text=heading, variant="caption"),
        TextComponent(id=ComponentId("title"), text=title, variant="h3"),
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
