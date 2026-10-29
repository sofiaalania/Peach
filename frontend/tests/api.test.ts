import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, api, parsedAgendaSchema } from "@/lib/api";

function mockFetch(body: unknown, init: { status?: number } = {}) {
  const status = init.status ?? 200;
  return vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response);
}

afterEach(() => {
  vi.restoreAllMocks();
  sessionStorage.clear();
});

describe("api", () => {
  it("parses a list response", async () => {
    mockFetch({ items: [], total: 0 });
    await expect(api.listItems()).resolves.toEqual({ items: [], total: 0 });
  });

  it("passes pagination through as query parameters", async () => {
    const spy = mockFetch({ items: [], total: 0 });
    await api.listItems({ limit: 5, offset: 10 });
    expect(spy.mock.calls[0][0]).toContain("/api/v1/items?limit=5&offset=10");
  });

  it("raises ApiError carrying the detail from the backend", async () => {
    mockFetch({ detail: "Item not found" }, { status: 404 });
    await expect(api.listItems()).rejects.toMatchObject({
      status: 404,
      message: "Item not found",
    });
  });

  it("raises ApiError when the network is unreachable", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      throw new TypeError("failed");
    });
    await expect(api.listItems()).rejects.toBeInstanceOf(ApiError);
  });

  it("attaches Authorization Bearer token from session storage if present", async () => {
    sessionStorage.setItem(
      "oidc.user:https://cognito-idp.example.com/pool:client",
      JSON.stringify({ id_token: "test-id-token-xyz" }),
    );
    const spy = mockFetch({ items: [], total: 0 });
    await api.listItems();
    const headers = spy.mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers?.Authorization).toBe("Bearer test-id-token-xyz");
  });

  it("handles meeting and agenda fields in createItem", async () => {
    const meetingData = {
      id: "meeting-1",
      name: "Team Planning",
      description: "Weekly planning",
      status: "todo" as const,
      start_time: "2026-11-01T10:00:00Z",
      duration_minutes: 45,
      participants: 4,
      agenda_items: [{ topic: "Sprint goals", owner: "Alice", minutes: 20 }],
      action_items: [
        { task: "Setup board", owner: "Bob", due_date: "2026-11-02" },
      ],
      created_at: "2026-10-29T10:00:00Z",
      updated_at: "2026-10-29T10:00:00Z",
    };
    const spy = mockFetch(meetingData);
    const result = await api.createItem({
      name: "Team Planning",
      description: "Weekly planning",
      status: "todo",
      start_time: "2026-11-01T10:00:00Z",
      duration_minutes: 45,
      participants: 4,
      agenda_items: [{ topic: "Sprint goals", owner: "Alice", minutes: 20 }],
      action_items: [
        { task: "Setup board", owner: "Bob", due_date: "2026-11-02" },
      ],
    });
    expect(result.duration_minutes).toBe(45);
    expect(result.participants).toBe(4);
    expect(result.agenda_items?.[0].topic).toBe("Sprint goals");
    expect(result.action_items?.[0].task).toBe("Setup board");
    expect(spy.mock.calls[0][1]?.method).toBe("POST");
  });
});
describe("agenda parsing API", () => {
  const draft = {
    title: "Planning",
    description: null,
    start_time: null,
    duration_minutes: null,
    participants: null,
    agenda_items: [],
    action_items: [],
  };

  it("posts text with the existing Cognito token and validates the draft", async () => {
    sessionStorage.setItem(
      "oidc.user:test:client",
      JSON.stringify({ id_token: "jwt-token" }),
    );
    const fetch = mockFetch(draft);
    await expect(api.parseAgenda("Meeting notes")).resolves.toEqual(draft);
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/ai/parse-agenda"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ text: "Meeting notes" }),
        headers: expect.objectContaining({ Authorization: "Bearer jwt-token" }),
      }),
    );
  });

  it("rejects an invalid model response", async () => {
    mockFetch({ ...draft, participants: "many" });
    await expect(api.parseAgenda("Notes")).rejects.toThrow();
    expect(parsedAgendaSchema.safeParse(draft).success).toBe(true);
  });

  it("propagates parsing failures through ApiError", async () => {
    mockFetch({ detail: "Agenda parsing failed" }, { status: 502 });
    await expect(api.parseAgenda("Notes")).rejects.toMatchObject({
      status: 502,
    });
  });
});
