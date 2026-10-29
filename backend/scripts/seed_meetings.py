"""CLI entry point for seeding sample meetings locally."""

from app.reports.seed import seed_meetings_sync

if __name__ == "__main__":
    count = seed_meetings_sync()
    print(f"Seeding completed. Inserted {count} new meetings.")
