import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ItemFormDialog } from "@/components/item-form-dialog";
import { api, ApiError, type ParsedAgenda } from "@/lib/api";
import { makeItem, renderWithQuery } from "./utils";

const draft: ParsedAgenda = {
  title: "Planning",
  description: "Sprint discussion",
  start_time: "2026-11-01T10:00:00Z",
  duration_minutes: 45,
  participants: 6,
  agenda_items: [{ topic: "Roadmap", owner: "Alice", minutes: 20 }],
  action_items: [{ task: "Update Jira", owner: "Bob", due_date: "2026-11-05" }],
};

function openForm() {
  const create = vi.spyOn(api, "createItem").mockResolvedValue(makeItem());
  const update = vi.spyOn(api, "updateItem").mockResolvedValue(makeItem());
  const onOpenChange = vi.fn();
  const view = renderWithQuery(
    <ItemFormDialog
      open
      onOpenChange={onOpenChange}
      defaultStatus="in_progress"
    />,
  );
  return { create, update, onOpenChange, ...view };
}

async function pasteAndParse() {
  fireEvent.change(screen.getByLabelText("Meeting notes or agenda"), {
    target: { value: "Planning notes" },
  });
  await userEvent.click(screen.getByRole("button", { name: "Parse with AI" }));
}

describe("agenda form integration", () => {
  it("prefills every meeting field, allows edits, and persists only on Create", async () => {
    const parse = vi.spyOn(api, "parseAgenda").mockResolvedValue(draft);
    const { create, update } = openForm();
    await pasteAndParse();
    await screen.findByText(
      "Agenda ready for review. Nothing has been saved yet.",
    );
    expect(parse).toHaveBeenCalledWith("Planning notes");
    expect(screen.getByLabelText("Title")).toHaveValue("Planning");
    expect(screen.getByLabelText("Description")).toHaveValue(
      "Sprint discussion",
    );
    expect(screen.getByLabelText("Duration (min)")).toHaveValue(45);
    expect(screen.getByLabelText("Participants")).toHaveValue(6);
    const localTime = (
      screen.getByLabelText("Start date & time") as HTMLInputElement
    ).value;
    expect(new Date(localTime).toISOString()).toBe("2026-11-01T10:00:00.000Z");
    expect(screen.getByPlaceholderText("Topic")).toHaveValue("Roadmap");
    expect(
      screen
        .getAllByPlaceholderText("Owner")
        .map((el) => (el as HTMLInputElement).value),
    ).toEqual(["Alice", "Bob"]);
    expect(screen.getByPlaceholderText("Minutes")).toHaveValue(20);
    expect(screen.getByPlaceholderText("Task")).toHaveValue("Update Jira");
    expect(document.querySelector('input[type="date"]')).toHaveValue(
      "2026-11-05",
    );
    expect(create).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "Edited planning" },
    });
    fireEvent.change(screen.getByPlaceholderText("Topic"), {
      target: { value: "Edited roadmap" },
    });
    await userEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() =>
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Edited planning",
          status: "in_progress",
          description: draft.description,
          start_time: "2026-11-01T10:00:00.000Z",
          duration_minutes: 45,
          participants: 6,
          agenda_items: [
            { topic: "Edited roadmap", owner: "Alice", minutes: 20 },
          ],
          action_items: draft.action_items,
        }),
      ),
    );
  });

  it("shows loading and blocks duplicate parsing and saving", async () => {
    let resolve!: (value: ParsedAgenda) => void;
    vi.spyOn(api, "parseAgenda").mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const { create } = openForm();
    await pasteAndParse();
    expect(screen.getByRole("button", { name: "Parsing..." })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Create" })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("Parsing your agenda");
    await act(async () => resolve(draft));
    expect(create).not.toHaveBeenCalled();
  });

  it.each([new Error("provider details"), new ApiError(401, "expired")])(
    "keeps manual fields on failure and supports retry",
    async (error) => {
      const parse = vi
        .spyOn(api, "parseAgenda")
        .mockRejectedValueOnce(error)
        .mockResolvedValue(draft);
      const { create } = openForm();
      fireEvent.change(screen.getByLabelText("Title"), {
        target: { value: "Manual title" },
      });
      await pasteAndParse();
      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent(
        error instanceof ApiError
          ? "Please sign in again"
          : "fill in the form manually",
      );
      expect(screen.getByLabelText("Title")).toHaveValue("Manual title");
      expect(create).not.toHaveBeenCalled();
      await userEvent.click(
        screen.getByRole("button", { name: "Parse with AI" }),
      );
      await screen.findByText(
        "Agenda ready for review. Nothing has been saved yet.",
      );
      expect(parse).toHaveBeenCalledTimes(2);
    },
  );

  it("preserves manual task creation without parsing", async () => {
    const parse = vi.spyOn(api, "parseAgenda");
    const { create } = openForm();
    expect(
      screen.getByRole("button", { name: "Parse with AI" }),
    ).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "Manual task" },
    });
    await userEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() =>
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({ name: "Manual task" }),
      ),
    );
    expect(parse).not.toHaveBeenCalled();
  });

  it("accepts missing extracted values without clearing a manual title", async () => {
    vi.spyOn(api, "parseAgenda").mockResolvedValue({
      title: null,
      description: null,
      start_time: null,
      duration_minutes: null,
      participants: null,
      agenda_items: [],
      action_items: [],
    });
    const { create } = openForm();
    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "My meeting" },
    });
    await pasteAndParse();
    await screen.findByText(
      "Agenda ready for review. Nothing has been saved yet.",
    );
    expect(screen.getByLabelText("Title")).toHaveValue("My meeting");
    await userEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(create).toHaveBeenCalled());
  });

  it("ignores a result from a closed dialog and resets parsing state on reopen", async () => {
    let resolve!: (value: ParsedAgenda) => void;
    vi.spyOn(api, "parseAgenda").mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const { rerender, onOpenChange, create } = openForm();
    await pasteAndParse();
    rerender(<ItemFormDialog open={false} onOpenChange={onOpenChange} />);
    rerender(<ItemFormDialog open onOpenChange={onOpenChange} />);
    await act(async () => resolve(draft));
    expect(screen.getByLabelText("Title")).toHaveValue("");
    expect(screen.getByLabelText("Meeting notes or agenda")).toHaveValue("");
    expect(create).not.toHaveBeenCalled();
  });
});
