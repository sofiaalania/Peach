import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Item
from app.schemas import ItemCreate, ItemUpdate


async def list_items(
    session: AsyncSession,
    *,
    owner_id: str,
    limit: int,
    offset: int,
) -> tuple[list[Item], int]:
    """Return items belonging to *owner_id* only."""
    base = select(Item).where(Item.owner_id == owner_id)

    total = (
        await session.scalar(
            select(func.count()).select_from(base.subquery())
        )
        or 0
    )

    result = await session.execute(
        base.order_by(Item.created_at.desc())
        .limit(limit)
        .offset(offset)
    )

    return list(result.scalars()), total


async def get_item(
    session: AsyncSession,
    item_id: uuid.UUID,
    *,
    owner_id: str,
) -> Item | None:
    """Fetch an item only if it belongs to *owner_id*."""
    return await session.scalar(
        select(Item).where(Item.id == item_id, Item.owner_id == owner_id)
    )


async def create_item(
    session: AsyncSession,
    payload: ItemCreate,
    *,
    owner_id: str,
) -> Item:

    data = payload.model_dump()
    # Serialize nested Pydantic models to dicts for JSONB storage
    if data.get("agenda_items") is not None:
        data["agenda_items"] = [
            ai if isinstance(ai, dict) else ai for ai in data["agenda_items"]
        ]
    if data.get("action_items") is not None:
        data["action_items"] = [
            ai if isinstance(ai, dict) else ai for ai in data["action_items"]
        ]

    item = Item(**data, owner_id=owner_id)

    session.add(item)
    await session.flush()
    await session.refresh(item)

    return item


async def update_item(
    session: AsyncSession,
    item: Item,
    payload: ItemUpdate,
) -> Item:

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(item, field, value)

    await session.flush()
    await session.refresh(item)

    return item


async def delete_item(
    session: AsyncSession,
    item: Item,
) -> None:

    await session.delete(item)
    await session.flush()