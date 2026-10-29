"""Report builder Lambda handler.

Runs in VPC with Aurora access and S3 access (via S3 Gateway VPC Endpoint).
Handles:
1. EventBridge Scheduler direct invocations: {"week": null, "source": "schedule"}
2. SQS message invocations: {"Records": [{"body": "{\"week\": null, \"source\": \"schedule\"}"}]}
3. Manual test invocations: {"week": "2026-W41", "source": "manual"}
"""

from datetime import datetime, timedelta, timezone
import json
import logging
import os
from typing import Any

import boto3

from app.reports.weekly import build_weekly_report

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)


def get_previous_iso_week() -> str:
    """Return the previous ISO week string, e.g. '2026-W40'."""
    today = datetime.now(timezone.utc).date()
    # Go back 7 days to guarantee landing in the previous week
    prev_week_date = today - timedelta(days=7)
    year, week_num, _ = prev_week_date.isocalendar()
    return f"{year}-W{week_num:02d}"


def detect_trigger(event: dict[str, Any]) -> str:
    """Detect whether the invocation was triggered by SQS on-demand, EventBridge Schedule, or manual."""
    if "Records" in event and event["Records"]:
        first = event["Records"][0]
        if first.get("eventSource") == "aws:sqs":
            payload = extract_payload(event)
            if payload.get("source") == "schedule":
                return "schedule"
            return "sqs"

    source = event.get("source")
    if source in ("schedule", "aws.scheduler"):
        return "schedule"

    return "direct"


def extract_payload(event: dict[str, Any]) -> dict[str, Any]:
    """Extract the payload dict from direct or SQS events."""
    if "Records" in event and event["Records"]:
        record = event["Records"][0]
        if record.get("eventSource") == "aws:sqs" and "body" in record:
            try:
                body = json.loads(record["body"])
                if isinstance(body, dict):
                    return body
            except (json.JSONDecodeError, TypeError):
                pass
    return event


def handler(event: dict[str, Any], context: Any = None) -> dict[str, Any]:
    trigger = detect_trigger(event)
    payload = extract_payload(event)

    week = payload.get("week")
    if not week:
        week = get_previous_iso_week()

    # Step 3 requirement:
    # log.info("report-builder triggered", extra={"trigger": detect_trigger(event), "week": week})
    logger.info(
        "report-builder triggered [trigger=%s, week=%s]",
        trigger,
        week,
        extra={"trigger": trigger, "week": week},
    )

    # Build CSV report
    csv_bytes = build_weekly_report(week)

    # Upload to S3 reports bucket
    bucket = os.environ.get("REPORTS_BUCKET")
    if not bucket:
        raise ValueError("REPORTS_BUCKET environment variable is not set")

    key = f"reports/{week}.csv"
    s3 = boto3.client("s3")
    s3.put_object(
        Bucket=bucket,
        Key=key,
        Body=csv_bytes,
        ContentType="text/csv",
    )

    logger.info("Successfully generated and uploaded report: s3://%s/%s", bucket, key)
    return {
        "status": "ok",
        "trigger": trigger,
        "week": week,
        "s3_uri": f"s3://{bucket}/{key}",
    }
