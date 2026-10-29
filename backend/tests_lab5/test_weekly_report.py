import csv
from datetime import datetime, timezone
import io
import os
import uuid

import pytest
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.models.meeting import Meeting
from app.reports.weekly import (
    build_weekly_report,
    generate_weekly_report_csv,
    parse_iso_week,
)

DATABASE_URL = os.environ.get(
    "DATABASE_URL", "postgresql+asyncpg://peach:peach@db:5432/peach"
)


@pytest.fixture
async def db_session():
    engine = create_async_engine(DATABASE_URL, poolclass=NullPool)
    session_factory = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
    async with session_factory() as session:
        yield session
        # Clean up test meetings
        await session.execute(
            delete(Meeting).where(Meeting.title.like("TEST_%"))
        )
        await session.commit()
    await engine.dispose()


def test_parse_iso_week():
    start_curr, end_curr, start_prev, end_prev = parse_iso_week("2026-W40")
    # 2026-W40 starts on Monday 2026-09-28
    assert start_curr == datetime(2026, 9, 28, 0, 0, tzinfo=timezone.utc)
    assert end_curr == datetime(2026, 10, 5, 0, 0, tzinfo=timezone.utc)
    assert start_prev == datetime(2026, 9, 21, 0, 0, tzinfo=timezone.utc)
    assert end_prev == start_curr


@pytest.mark.asyncio
async def test_empty_week_report(db_session: AsyncSession):
    # Week 2029-W01 has no meetings
    raw_csv = await generate_weekly_report_csv(db_session, "2029-W01")
    assert isinstance(raw_csv, bytes)
    content = raw_csv.decode("utf-8")
    assert "Weekly Meetings Report" in content
    assert "2029-W01" in content
    assert "Meeting Count,0,0,+0,N/A" in content


@pytest.mark.asyncio
async def test_report_with_meetings(db_session: AsyncSession):
    # Week 2030-W10: March 4, 2030 to March 10, 2030
    # Add 2 meetings in W10 (prev week)
    db_session.add(
        Meeting(
            id=uuid.uuid4(),
            title="TEST_W10 Meeting 1",
            start_time=datetime(2030, 3, 5, 10, 0, tzinfo=timezone.utc),
            duration_minutes=60,
            participants=4,
        )
    )
    db_session.add(
        Meeting(
            id=uuid.uuid4(),
            title="TEST_W10 Meeting 2",
            start_time=datetime(2030, 3, 6, 14, 0, tzinfo=timezone.utc),
            duration_minutes=120,
            participants=5,
        )
    )

    # Week 2030-W11: March 11, 2030 to March 17, 2030
    # Add 3 meetings in W11 (current week)
    db_session.add(
        Meeting(
            id=uuid.uuid4(),
            title="TEST_W11 Short",
            start_time=datetime(2030, 3, 12, 9, 0, tzinfo=timezone.utc),
            duration_minutes=30,
            participants=2,
        )
    )
    db_session.add(
        Meeting(
            id=uuid.uuid4(),
            title="TEST_W11 Medium",
            start_time=datetime(2030, 3, 13, 11, 0, tzinfo=timezone.utc),
            duration_minutes=90,
            participants=8,
        )
    )
    db_session.add(
        Meeting(
            id=uuid.uuid4(),
            title="TEST_W11 Long",
            start_time=datetime(2030, 3, 14, 15, 0, tzinfo=timezone.utc),
            duration_minutes=180,
            participants=12,
        )
    )
    await db_session.commit()

    raw_csv = await generate_weekly_report_csv(db_session, "2030-W11")
    text = raw_csv.decode("utf-8")
    reader = [row for row in csv.reader(io.StringIO(text)) if row]

    # Verify summary numbers
    assert any("Meeting Count" in row[0] and row[1] == "3" and row[2] == "2" for row in reader)
    assert any("Total Duration" in row[0] and "5.00" in row[1] and "3.00" in row[2] for row in reader)

    # Verify top meetings are ordered longest first
    titles_in_order = [row[0] for row in reader if row[0].startswith("TEST_W11")]
    assert titles_in_order == ["TEST_W11 Long", "TEST_W11 Medium", "TEST_W11 Short"]


def test_idempotent_filename():
    week = "2026-W41"
    key1 = f"reports/{week}.csv"
    key2 = f"reports/{week}.csv"
    assert key1 == key2 == "reports/2026-W41.csv"
