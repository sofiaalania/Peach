import asyncio
import csv
from datetime import date, datetime, time, timedelta, timezone
import io

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.config import get_settings
from app.models.meeting import Meeting


def parse_iso_week(week: str) -> tuple[datetime, datetime, datetime, datetime]:
    """Parse 'YYYY-Www' (e.g. '2026-W40') into:
    (start_of_week, end_of_week, start_of_prev_week, end_of_prev_week) in UTC.
    """
    if "-W" not in week:
        raise ValueError(f"Invalid ISO week format '{week}', expected 'YYYY-Www'")
    parts = week.split("-W")
    year = int(parts[0])
    week_num = int(parts[1])

    start_date = date.fromisocalendar(year, week_num, 1)
    start_of_week = datetime.combine(start_date, time.min, tzinfo=timezone.utc)
    end_of_week = start_of_week + timedelta(days=7)

    start_of_prev_week = start_of_week - timedelta(days=7)
    end_of_prev_week = start_of_week

    return start_of_week, end_of_week, start_of_prev_week, end_of_prev_week


async def query_week_metrics(
    session: AsyncSession, start: datetime, end: datetime
) -> tuple[int, float]:
    """Return (count, total_duration_hours) for meetings in [start, end)."""
    count_stmt = (
        select(func.count())
        .select_from(Meeting)
        .where(Meeting.start_time >= start, Meeting.start_time < end)
    )
    count = (await session.scalar(count_stmt)) or 0

    duration_stmt = (
        select(func.coalesce(func.sum(Meeting.duration_minutes), 0))
        .where(Meeting.start_time >= start, Meeting.start_time < end)
    )
    total_minutes = (await session.scalar(duration_stmt)) or 0
    total_hours = round(total_minutes / 60.0, 2)

    return count, total_hours


async def query_longest_meetings(
    session: AsyncSession, start: datetime, end: datetime, limit: int = 5
) -> list[Meeting]:
    """Return up to 5 longest meetings in [start, end)."""
    stmt = (
        select(Meeting)
        .where(Meeting.start_time >= start, Meeting.start_time < end)
        .order_by(Meeting.duration_minutes.desc(), Meeting.start_time.asc())
        .limit(limit)
    )
    result = await session.execute(stmt)
    return list(result.scalars().all())


async def generate_weekly_report_csv(session: AsyncSession, week: str) -> bytes:
    start_curr, end_curr, start_prev, end_prev = parse_iso_week(week)

    curr_count, curr_hours = await query_week_metrics(session, start_curr, end_curr)
    prev_count, prev_hours = await query_week_metrics(session, start_prev, end_prev)
    longest_meetings = await query_longest_meetings(session, start_curr, end_curr, limit=5)

    count_diff = curr_count - prev_count
    hours_diff = round(curr_hours - prev_hours, 2)

    count_pct_str = (
        f"{(count_diff / prev_count) * 100:+.1f}%"
        if prev_count > 0
        else ("N/A" if curr_count == 0 else "+100.0%")
    )
    hours_pct_str = (
        f"{(hours_diff / prev_hours) * 100:+.1f}%"
        if prev_hours > 0
        else ("N/A" if curr_hours == 0 else "+100.0%")
    )

    output = io.StringIO()
    writer = csv.writer(output)

    # Header / Meta
    writer.writerow(["Weekly Meetings Report", week])
    writer.writerow([])

    # Section 1: Summary Comparison
    writer.writerow(["Metric", f"Week {week}", "Previous Week", "Change", "Change (%)"])
    writer.writerow([
        "Meeting Count",
        curr_count,
        prev_count,
        f"{count_diff:+d}",
        count_pct_str,
    ])
    writer.writerow([
        "Total Duration (hours)",
        f"{curr_hours:.2f}",
        f"{prev_hours:.2f}",
        f"{hours_diff:+.2f}",
        hours_pct_str,
    ])
    writer.writerow([])

    # Section 2: Top 5 Longest Meetings
    writer.writerow(["Top Longest Meetings", f"Week {week}"])
    writer.writerow(["Title", "Start Time (UTC)", "Duration (minutes)", "Participants"])
    for m in longest_meetings:
        writer.writerow([
            m.title,
            m.start_time.isoformat(),
            m.duration_minutes,
            m.participants,
        ])

    return output.getvalue().encode("utf-8")


def build_weekly_report(week: str, session: AsyncSession | None = None) -> bytes:
    """Query the meetings of one ISO week (e.g. '2026-W40') and return the CSV bytes."""
    if session is not None:
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            loop = None

        if loop and loop.is_running():
            import concurrent.futures
            with concurrent.futures.ThreadPoolExecutor() as pool:
                return pool.submit(asyncio.run, generate_weekly_report_csv(session, week)).result()
        return asyncio.run(generate_weekly_report_csv(session, week))

    settings = get_settings()
    engine = create_async_engine(settings.database_url, poolclass=NullPool)
    session_factory = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)

    async def _runner():
        async with session_factory() as sess:
            return await generate_weekly_report_csv(sess, week)

    try:
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            loop = None

        if loop and loop.is_running():
            import concurrent.futures
            with concurrent.futures.ThreadPoolExecutor() as pool:
                return pool.submit(asyncio.run, _runner()).result()
        else:
            return asyncio.run(_runner())
    finally:
        asyncio.run(engine.dispose())
