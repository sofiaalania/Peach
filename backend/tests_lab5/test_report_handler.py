from datetime import datetime, timezone
import json
import re
from unittest.mock import MagicMock, patch

import pytest

from app.reports.lambda_handler import (
    detect_trigger,
    extract_payload,
    get_previous_iso_week,
    handler,
)


def test_get_previous_iso_week_format():
    week = get_previous_iso_week()
    assert re.match(r"^\d{4}-W\d{2}$", week)


def test_detect_trigger_direct():
    event = {"week": "2026-W41", "source": "manual"}
    assert detect_trigger(event) == "direct"


def test_detect_trigger_schedule():
    event = {"week": None, "source": "schedule"}
    assert detect_trigger(event) == "schedule"

    event_aws = {"source": "aws.scheduler"}
    assert detect_trigger(event_aws) == "schedule"


def test_detect_trigger_sqs():
    event = {
        "Records": [
            {
                "eventSource": "aws:sqs",
                "body": json.dumps({"week": "2026-W41", "source": "manual"}),
            }
        ]
    }
    assert detect_trigger(event) == "sqs"


def test_detect_trigger_sqs_schedule():
    event = {
        "Records": [
            {
                "eventSource": "aws:sqs",
                "body": json.dumps({"week": None, "source": "schedule"}),
            }
        ]
    }
    assert detect_trigger(event) == "schedule"


def test_extract_payload_sqs():
    payload = {"week": "2026-W41", "source": "manual"}
    event = {
        "Records": [
            {
                "eventSource": "aws:sqs",
                "body": json.dumps(payload),
            }
        ]
    }
    assert extract_payload(event) == payload


def test_extract_payload_direct():
    event = {"week": "2026-W40", "source": "schedule"}
    assert extract_payload(event) == event


@patch("app.reports.lambda_handler.boto3.client")
@patch("app.reports.lambda_handler.build_weekly_report")
def test_handler_with_sqs_event(mock_build, mock_boto, monkeypatch):
    monkeypatch.setenv("REPORTS_BUCKET", "test-bucket")
    mock_build.return_value = b"Weekly Meetings Report,2026-W41\n"
    s3_mock = MagicMock()
    mock_boto.return_value = s3_mock

    event = {
        "Records": [
            {
                "eventSource": "aws:sqs",
                "body": json.dumps({"week": "2026-W41", "source": "manual"}),
            }
        ]
    }

    result = handler(event)

    assert result["status"] == "ok"
    assert result["trigger"] == "sqs"
    assert result["week"] == "2026-W41"
    assert result["s3_uri"] == "s3://test-bucket/reports/2026-W41.csv"

    mock_build.assert_called_once_with("2026-W41")
    s3_mock.put_object.assert_called_once_with(
        Bucket="test-bucket",
        Key="reports/2026-W41.csv",
        Body=b"Weekly Meetings Report,2026-W41\n",
        ContentType="text/csv",
    )


@patch("app.reports.lambda_handler.boto3.client")
@patch("app.reports.lambda_handler.build_weekly_report")
def test_handler_schedule_default_week(mock_build, mock_boto, monkeypatch):
    monkeypatch.setenv("REPORTS_BUCKET", "test-bucket")
    mock_build.return_value = b"test,csv\n"
    s3_mock = MagicMock()
    mock_boto.return_value = s3_mock

    event = {"week": None, "source": "schedule"}
    result = handler(event)

    assert result["status"] == "ok"
    assert result["trigger"] == "schedule"
    assert re.match(r"^\d{4}-W\d{2}$", result["week"])
    mock_build.assert_called_once()
    s3_mock.put_object.assert_called_once()
