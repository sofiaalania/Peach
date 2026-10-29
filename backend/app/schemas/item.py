import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

ItemStatus = Literal["todo", "in_progress", "done"]


# --- Nested meeting sub-schemas (ParsedAgenda-compatible) ---


class AgendaItemSchema(BaseModel):
    """A single agenda topic."""

    topic: str = Field(min_length=1, max_length=300)
    owner: str = Field(default="", max_length=120)
    minutes: int = Field(default=0, ge=0)


class ActionItemSchema(BaseModel):
    """A single action item."""

    task: str = Field(min_length=1, max_length=500)
    owner: str = Field(default="", max_length=120)
    due_date: str | None = Field(default=None, max_length=30)


# --- Item schemas ---


class ItemBase(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=2000)
    status: ItemStatus = "todo"

    # Meeting fields (all optional — plain tasks omit them)
    start_time: datetime | None = None
    duration_minutes: int | None = Field(default=None, ge=1, le=1440)
    participants: int | None = Field(default=None, ge=1, le=10000)
    agenda_items: list[AgendaItemSchema] | None = None
    action_items: list[ActionItemSchema] | None = None


class ItemCreate(ItemBase):
    pass


class ItemUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=2000)
    status: ItemStatus | None = None
    start_time: datetime | None = None
    duration_minutes: int | None = Field(default=None, ge=1, le=1440)
    participants: int | None = Field(default=None, ge=1, le=10000)
    agenda_items: list[AgendaItemSchema] | None = None
    action_items: list[ActionItemSchema] | None = None


class ItemRead(ItemBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    created_at: datetime
    updated_at: datetime


class ItemList(BaseModel):
    items: list[ItemRead]
    total: int
