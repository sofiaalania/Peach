import uuid

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from tests.tokens import make_token

# ---------------------------------------------------------------------------
# Basic CRUD (authenticated as Alice)
# ---------------------------------------------------------------------------

async def test_list_is_empty_initially(client: AsyncClient) -> None:
    response = await client.get("/api/v1/items")
    assert response.status_code == 200
    assert response.json() == {"items": [], "total": 0}


async def test_create_returns_201_and_the_item(client: AsyncClient) -> None:
    response = await client.post("/api/v1/items", json={"name": "First", "description": "hello"})
    assert response.status_code == 201
    body = response.json()
    assert body["name"] == "First"
    assert body["description"] == "hello"
    assert body["status"] == "todo"
    assert uuid.UUID(body["id"])
    assert body["created_at"] and body["updated_at"]


async def test_create_rejects_empty_name(client: AsyncClient) -> None:
    response = await client.post("/api/v1/items", json={"name": ""})
    assert response.status_code == 422


async def test_get_roundtrips(client: AsyncClient) -> None:
    created = (await client.post("/api/v1/items", json={"name": "Fetch me"})).json()
    response = await client.get(f"/api/v1/items/{created['id']}")
    assert response.status_code == 200
    assert response.json()["id"] == created["id"]


async def test_get_missing_returns_404(client: AsyncClient) -> None:
    response = await client.get(f"/api/v1/items/{uuid.uuid4()}")
    assert response.status_code == 404
    assert response.json()["detail"] == "Item not found"


async def test_patch_applies_partial_update(client: AsyncClient) -> None:
    created = (await client.post("/api/v1/items", json={"name": "Before"})).json()
    response = await client.patch(f"/api/v1/items/{created['id']}", json={"status": "in_progress"})
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "in_progress"
    assert body["name"] == "Before"


async def test_rejects_unknown_status(client: AsyncClient) -> None:
    response = await client.post("/api/v1/items", json={"name": "Bad", "status": "blocked"})
    assert response.status_code == 422


async def test_patch_missing_returns_404(client: AsyncClient) -> None:
    response = await client.patch(f"/api/v1/items/{uuid.uuid4()}", json={"name": "x"})
    assert response.status_code == 404


async def test_delete_returns_204_then_404(client: AsyncClient) -> None:
    created = (await client.post("/api/v1/items", json={"name": "Doomed"})).json()
    assert (await client.delete(f"/api/v1/items/{created['id']}")).status_code == 204
    assert (await client.get(f"/api/v1/items/{created['id']}")).status_code == 404


async def test_delete_missing_returns_404(client: AsyncClient) -> None:
    response = await client.delete(f"/api/v1/items/{uuid.uuid4()}")
    assert response.status_code == 404


async def test_pagination(client: AsyncClient) -> None:
    for index in range(3):
        await client.post("/api/v1/items", json={"name": f"Item {index}"})
    response = await client.get("/api/v1/items", params={"limit": 2, "offset": 0})
    body = response.json()
    assert body["total"] == 3
    assert len(body["items"]) == 2


async def test_pagination_rejects_bad_limit(client: AsyncClient) -> None:
    assert (await client.get("/api/v1/items", params={"limit": 0})).status_code == 422
    assert (await client.get("/api/v1/items", params={"limit": 101})).status_code == 422


# ---------------------------------------------------------------------------
# Cross-user isolation
# ---------------------------------------------------------------------------

async def test_items_are_private_to_their_owner(client: AsyncClient) -> None:
    mine = (await client.post("/api/v1/items", json={"name": "Alice's"})).json()
    bob = {"Authorization": f"Bearer {make_token('bob-sub', 'bob@example.com')}"}

    listing = (await client.get("/api/v1/items", headers=bob)).json()
    assert listing == {"items": [], "total": 0}

    # Someone else's item is indistinguishable from a missing one.
    url = f"/api/v1/items/{mine['id']}"
    assert (await client.get(url, headers=bob)).status_code == 404
    assert (await client.patch(url, json={"name": "mine now"}, headers=bob)).status_code == 404
    assert (await client.delete(url, headers=bob)).status_code == 404

    # Untouched for its owner.
    assert (await client.get(url)).json()["name"] == "Alice's"


async def test_bob_cannot_edit_alice_items(
    client: AsyncClient, bob_client: AsyncClient
) -> None:
    """Dedicated bob_client fixture variant."""
    created = (await client.post("/api/v1/items", json={"name": "Alice only"})).json()
    url = f"/api/v1/items/{created['id']}"

    assert (await bob_client.get(url)).status_code == 404
    assert (await bob_client.patch(url, json={"name": "stolen"})).status_code == 404
    assert (await bob_client.delete(url)).status_code == 404

    # Alice can still see it
    assert (await client.get(url)).status_code == 200


# ---------------------------------------------------------------------------
# Authentication enforcement
# ---------------------------------------------------------------------------

async def test_unauthenticated_list_returns_401(anon_client: AsyncClient) -> None:
    response = await anon_client.get("/api/v1/items")
    assert response.status_code == 401


async def test_unauthenticated_create_returns_401(anon_client: AsyncClient) -> None:
    response = await anon_client.post("/api/v1/items", json={"name": "Nope"})
    assert response.status_code == 401


async def test_unauthenticated_get_returns_401(anon_client: AsyncClient) -> None:
    response = await anon_client.get(f"/api/v1/items/{uuid.uuid4()}")
    assert response.status_code == 401


async def test_unauthenticated_patch_returns_401(anon_client: AsyncClient) -> None:
    response = await anon_client.patch(f"/api/v1/items/{uuid.uuid4()}", json={"name": "x"})
    assert response.status_code == 401


async def test_unauthenticated_delete_returns_401(anon_client: AsyncClient) -> None:
    response = await anon_client.delete(f"/api/v1/items/{uuid.uuid4()}")
    assert response.status_code == 401


# ---------------------------------------------------------------------------
# Meeting / event fields
# ---------------------------------------------------------------------------

async def test_create_event_with_meeting_fields(client: AsyncClient) -> None:
    payload = {
        "name": "Sprint Retro",
        "status": "todo",
        "start_time": "2026-11-01T10:00:00+02:00",
        "duration_minutes": 60,
        "participants": 5,
        "agenda_items": [
            {"topic": "What went well", "owner": "Alice", "minutes": 15},
            {"topic": "What to improve", "owner": "Bob", "minutes": 20},
        ],
        "action_items": [
            {"task": "Write docs", "owner": "Charlie", "due_date": "2026-11-05"},
        ],
    }
    resp = await client.post("/api/v1/items", json=payload)
    assert resp.status_code == 201
    body = resp.json()
    assert body["name"] == "Sprint Retro"
    assert body["duration_minutes"] == 60
    assert body["participants"] == 5
    assert len(body["agenda_items"]) == 2
    assert body["agenda_items"][0]["topic"] == "What went well"
    assert len(body["action_items"]) == 1
    assert body["action_items"][0]["task"] == "Write docs"
    assert body["start_time"] is not None


async def test_update_agenda_items(client: AsyncClient) -> None:
    created = (
        await client.post("/api/v1/items", json={"name": "Meeting"})
    ).json()
    resp = await client.patch(
        f"/api/v1/items/{created['id']}",
        json={
            "agenda_items": [{"topic": "Added later", "owner": "Eve", "minutes": 10}],
        },
    )
    assert resp.status_code == 200
    assert len(resp.json()["agenda_items"]) == 1
    assert resp.json()["agenda_items"][0]["topic"] == "Added later"


async def test_update_action_items(client: AsyncClient) -> None:
    created = (
        await client.post("/api/v1/items", json={"name": "Meeting 2"})
    ).json()
    resp = await client.patch(
        f"/api/v1/items/{created['id']}",
        json={
            "action_items": [{"task": "Follow up", "owner": "Dave", "due_date": "2026-12-01"}],
        },
    )
    assert resp.status_code == 200
    assert len(resp.json()["action_items"]) == 1


async def test_event_fields_are_optional(client: AsyncClient) -> None:
    """A plain task with no meeting fields still works."""
    resp = await client.post("/api/v1/items", json={"name": "Plain task"})
    assert resp.status_code == 201
    body = resp.json()
    assert body["start_time"] is None
    assert body["duration_minutes"] is None
    assert body["participants"] is None
    assert body["agenda_items"] is None
    assert body["action_items"] is None


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------

async def test_rejects_negative_duration(client: AsyncClient) -> None:
    resp = await client.post(
        "/api/v1/items", json={"name": "Bad", "duration_minutes": -5}
    )
    assert resp.status_code == 422


async def test_rejects_zero_duration(client: AsyncClient) -> None:
    resp = await client.post(
        "/api/v1/items", json={"name": "Bad", "duration_minutes": 0}
    )
    assert resp.status_code == 422


async def test_rejects_zero_participants(client: AsyncClient) -> None:
    resp = await client.post(
        "/api/v1/items", json={"name": "Bad", "participants": 0}
    )
    assert resp.status_code == 422


async def test_rejects_empty_agenda_topic(client: AsyncClient) -> None:
    resp = await client.post(
        "/api/v1/items",
        json={"name": "Bad", "agenda_items": [{"topic": "", "owner": "X", "minutes": 5}]},
    )
    assert resp.status_code == 422


async def test_rejects_empty_action_task(client: AsyncClient) -> None:
    resp = await client.post(
        "/api/v1/items",
        json={"name": "Bad", "action_items": [{"task": "", "owner": "X"}]},
    )
    assert resp.status_code == 422


# ---------------------------------------------------------------------------
# Legacy data preservation & isolation
# ---------------------------------------------------------------------------

async def test_legacy_unowned_items_are_not_exposed(
    client: AsyncClient, session: AsyncSession
) -> None:
    """Existing records without owners must never be exposed or claimed by an authenticated user."""
    from app.models import Item

    legacy_item = Item(name="Legacy Unowned Task", status="todo", owner_id=None)
    session.add(legacy_item)
    await session.flush()
    await session.refresh(legacy_item)

    # Alice lists items - legacy unowned item must not appear in listing
    resp = await client.get("/api/v1/items")
    assert resp.status_code == 200
    ids = [it["id"] for it in resp.json()["items"]]
    assert str(legacy_item.id) not in ids

    # Direct fetch of legacy unowned item by Alice must return 404
    fetch_resp = await client.get(f"/api/v1/items/{legacy_item.id}")
    assert fetch_resp.status_code == 404


def test_jwks_cache_handles_settings_without_type_error() -> None:
    """Settings is unhashable; verify JWKS client caching works with hashable keys."""
    from app.auth import _jwks_client_from_json, _jwks_client_from_url

    client1 = _jwks_client_from_url("https://example.com/jwks.json")
    client2 = _jwks_client_from_url("https://example.com/jwks.json")
    assert client1 is client2

    jwks_json = '{"keys": []}'
    set_client1 = _jwks_client_from_json(jwks_json)
    set_client2 = _jwks_client_from_json(jwks_json)
    assert set_client1 is set_client2

