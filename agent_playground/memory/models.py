"""Validated memory contracts and stable storage namespaces."""

from datetime import datetime
from hashlib import sha256
from typing import Literal, Self

from langgraph.store.base import Item
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

MEMORY_ROOT = ("agent_playground", "memories", "shared")
MEMORY_TOKEN_BUDGET = 1024


class MemoryScope(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    category: Literal["preference", "project"]
    project: str | None = Field(default=None, min_length=1, max_length=100)

    @field_validator("project", mode="before")
    @classmethod
    def trim_project(cls, value: object) -> object:
        if isinstance(value, str):
            value = value.strip()

            if len(value.encode("utf-16-le")) > 200:
                raise ValueError("Project names must contain at most 100 characters")

        return value

    @model_validator(mode="after")
    def validate_scope(self) -> Self:
        if self.category == "project" and self.project is None:
            raise ValueError("Project facts require an explicit project name")

        if self.category == "preference" and self.project is not None:
            raise ValueError("Preferences do not belong to a project")

        return self


class MemoryMutation(MemoryScope):
    revision: int = Field(gt=0, le=9_007_199_254_740_991, strict=True)


class MemoryEdit(MemoryMutation):
    text: str = Field(min_length=1, max_length=1000)

    @field_validator("text", mode="before")
    @classmethod
    def trim_text(cls, value: object) -> object:
        if isinstance(value, str):
            value = value.strip()

            if len(value.encode("utf-16-le")) > 2000:
                raise ValueError("Memories must contain at most 1000 characters")

        return value


class MemoryContent(MemoryEdit):
    source_thread_id: str | None = Field(
        default=None, alias="sourceThreadId", max_length=256
    )
    source_message_id: str | None = Field(
        default=None, alias="sourceMessageId", max_length=256
    )

    @field_validator("source_thread_id", "source_message_id")
    @classmethod
    def validate_source_id(cls, value: str | None) -> str | None:
        if value is not None and len(value.encode("utf-16-le")) > 512:
            raise ValueError("Memory source IDs must contain at most 256 characters")

        return value


class MemoryView(MemoryContent):
    id: str
    created_at: datetime = Field(alias="createdAt")
    updated_at: datetime = Field(alias="updatedAt")


class MemoryPage(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    items: list[MemoryView]
    next_offset: int | None = Field(alias="nextOffset")


def memory_namespace(scope: MemoryScope) -> tuple[str, ...]:
    if scope.project is None:
        return (*MEMORY_ROOT, "preferences")

    project_key = sha256(scope.project.casefold().encode()).hexdigest()

    return (*MEMORY_ROOT, "projects", project_key)


def memory_view(item: Item) -> MemoryView | None:
    if item.value.get("deleted") is True:
        return None

    content = MemoryContent.model_validate(item.value.get("content"))

    return MemoryView(
        **content.model_dump(),
        id=item.key,
        createdAt=item.created_at,
        updatedAt=item.updated_at,
    )
