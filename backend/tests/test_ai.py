"""Route tests use the existing JWT verifier and never contact Bedrock or a database."""

from unittest.mock import AsyncMock

import pytest
from botocore.exceptions import NoCredentialsError
from httpx import ASGITransport, AsyncClient

from app.ai.agenda import MAX_INPUT_LENGTH, AgendaParsingError, ParsedAgenda
from app.config import get_settings
from app.db import get_session
from app.main import create_app
from tests.tokens import auth

URL = "/api/v1/ai/parse-agenda"


@pytest.fixture
async def ai_client():
    app = create_app()

    async def forbid_database():
        pytest.fail("Parsing must not access the database")

    app.dependency_overrides[get_session] = forbid_database
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        yield client, app


@pytest.fixture
def parser(monkeypatch):
    mock = AsyncMock(return_value=ParsedAgenda())
    monkeypatch.setattr("app.api.routes.ai.parse_agenda", mock)
    return mock


async def test_parse_returns_editable_fields(ai_client, parser):
    client, _ = ai_client
    result = ParsedAgenda(
        title="Planning", description="Next sprint", start_time="2026-11-01T10:00:00Z",
        duration_minutes=45, participants=6,
        agenda_items=[{"topic": "Roadmap", "owner": "Alice", "minutes": 20}],
        action_items=[{"task": "Update Jira", "owner": "Bob", "due_date": "2026-11-05"}],
    )
    parser.return_value = result
    text = "  Planning meeting notes  "
    response = await client.post(URL, json={"text": text}, headers=auth())
    assert response.status_code == 200
    assert response.json() == result.model_dump(mode="json")
    parser.assert_awaited_once_with(text)


async def test_missing_fields_remain_empty(ai_client, parser):
    client, _ = ai_client
    response = await client.post(URL, json={"text": "Meeting"}, headers=auth())
    assert response.status_code == 200
    assert response.json() == ParsedAgenda().model_dump(mode="json")


@pytest.mark.parametrize("headers", [{}, {"Authorization": "Bearer invalid-token"}])
async def test_authentication_required(ai_client, parser, headers):
    client, _ = ai_client
    response = await client.post(URL, json={"text": "Meeting"}, headers=headers)
    assert response.status_code == 401
    assert response.headers["www-authenticate"] == "Bearer"
    parser.assert_not_called()


async def test_authentication_fails_closed(ai_client, parser):
    client, app = ai_client
    settings = get_settings().model_copy(update={"cognito_user_pool_id": ""})
    app.dependency_overrides[get_settings] = lambda: settings
    response = await client.post(URL, json={"text": "Meeting"}, headers=auth())
    assert response.status_code == 503
    parser.assert_not_called()


@pytest.mark.parametrize("payload", [
    {}, {"text": ""}, {"text": " \n\t"}, {"text": "x" * (MAX_INPUT_LENGTH + 1)},
    {"text": None}, {"text": 123}, {"text": ["Meeting"]},
])
async def test_invalid_input_is_rejected_before_parsing(ai_client, parser, payload):
    client, _ = ai_client
    response = await client.post(URL, json=payload, headers=auth())
    assert response.status_code == 422
    parser.assert_not_called()


async def test_maximum_length_is_accepted(ai_client, parser):
    client, _ = ai_client
    text = "x" * MAX_INPUT_LENGTH
    response = await client.post(URL, json={"text": text}, headers=auth())
    assert response.status_code == 200
    parser.assert_awaited_once_with(text)


@pytest.mark.parametrize("error", [
    AgendaParsingError("private provider details and model output"), NoCredentialsError(),
])
async def test_parser_failure_is_sanitized(ai_client, parser, error):
    client, _ = ai_client
    parser.side_effect = error
    response = await client.post(URL, json={"text": "Meeting"}, headers=auth())
    assert response.status_code == 502
    assert response.json() == {"detail": "Agenda parsing failed. Please try again later."}

