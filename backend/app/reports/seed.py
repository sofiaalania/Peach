"""Sample meetings seed logic.

Idempotent: checks for existing meetings with the same title and start_time,
and inserts only if missing. Safe to run multiple times.
"""

import asyncio
from datetime import datetime, timezone
import logging
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.config import get_settings
from app.models.meeting import Meeting

logger = logging.getLogger(__name__)

SAMPLE_MEETINGS = [
    # Week 2026-W40: Sept 28, 2026 – Oct 4, 2026
    {
        "title": "Sprint 39 Retrospective",
        "start_time": datetime(2026, 9, 28, 9, 0, tzinfo=timezone.utc),
        "duration_minutes": 60,
        "participants": 6,
    },
    {
        "title": "Architecture Sync: Event-Driven Pipeline",
        "start_time": datetime(2026, 9, 29, 14, 0, tzinfo=timezone.utc),
        "duration_minutes": 90,
        "participants": 4,
    },
    {
        "title": "Weekly Engineering Standup",
        "start_time": datetime(2026, 9, 30, 10, 0, tzinfo=timezone.utc),
        "duration_minutes": 30,
        "participants": 8,
    },
    {
        "title": "Product Roadmap Review",
        "start_time": datetime(2026, 10, 1, 15, 30, tzinfo=timezone.utc),
        "duration_minutes": 120,
        "participants": 10,
    },
    # Week 2026-W41: Oct 5, 2026 – Oct 11, 2026
    {
        "title": "Sprint 40 Planning & Estimation",
        "start_time": datetime(2026, 10, 5, 9, 30, tzinfo=timezone.utc),
        "duration_minutes": 150,
        "participants": 7,
    },
    {
        "title": "Security & IAM Permissions Audit",
        "start_time": datetime(2026, 10, 6, 11, 0, tzinfo=timezone.utc),
        "duration_minutes": 45,
        "participants": 3,
    },
    {
        "title": "Weekly Engineering Standup",
        "start_time": datetime(2026, 10, 7, 10, 0, tzinfo=timezone.utc),
        "duration_minutes": 30,
        "participants": 8,
    },
    {
        "title": "Customer Feedback & UX Alignment",
        "start_time": datetime(2026, 10, 8, 14, 0, tzinfo=timezone.utc),
        "duration_minutes": 60,
        "participants": 5,
    },
    {
        "title": "Incident Post-Mortem: SQS Visibility Timeout",
        "start_time": datetime(2026, 10, 9, 16, 0, tzinfo=timezone.utc),
        "duration_minutes": 75,
        "participants": 6,
    },
    {
        "title": "All-Hands Product Showcase",
        "start_time": datetime(2026, 10, 9, 17, 30, tzinfo=timezone.utc),
        "duration_minutes": 60,
        "participants": 25,
    },
]


async def seed(session: AsyncSession) -> int:
    added = 0
    for sample in SAMPLE_MEETINGS:
        stmt = select(Meeting).where(
            Meeting.title == sample["title"],
            Meeting.start_time == sample["start_time"],
        )
        existing = await session.scalar(stmt)
        if not existing:
            meeting = Meeting(
                id=uuid.uuid4(),
                title=sample["title"],
                start_time=sample["start_time"],
                duration_minutes=sample["duration_minutes"],
                participants=sample["participants"],
            )
            session.add(meeting)
            added += 1

    await session.commit()
    return added


def seed_meetings_sync(database_url: str | None = None) -> int:
    settings = get_settings()
    url = database_url or settings.database_url
    engine = create_async_engine(url, poolclass=NullPool)
    session_factory = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)

    async def _run():
        async with session_factory() as session:
            count = await seed(session)
            return count

    try:
        return asyncio.run(_run())
    finally:
        asyncio.run(engine.dispose())
