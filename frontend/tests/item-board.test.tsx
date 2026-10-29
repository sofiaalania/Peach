import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ItemBoard } from "@/components/item-board";
import { api } from "@/lib/api";
import { makeItem, renderWithQuery } from "./utils";

function mockItems() {
  vi.spyOn(api, "listItems").mockResolvedValue({
    items: [
      makeItem(),
      makeItem({ id: "2", name: "Second", status: "in_progress" }),
      makeItem({ id: "3", name: "Third", status: "done" }),
    ],
    total: 3,
  });
}

describe("ItemBoard", () => {
  it("renders the three status columns", async () => {
    vi.spyOn(api, "listItems").mockResolvedValue({ items: [], total: 0 });
    renderWithQuery(<ItemBoard />);

    await waitFor(() =>
      expect(screen.getByText("0 tasks", { exact: false })).toBeInTheDocument(),
    );
    for (const label of ["To do", "In progress", "Done"]) {
      expect(screen.getByRole("region", { name: label })).toBeInTheDocument();
    }
  });

  it("places each card in the column matching its status", async () => {
    mockItems();
    renderWithQuery(<ItemBoard />);

    await waitFor(() =>
      expect(screen.getByText("Example")).toBeInTheDocument(),
    );
    const column = (name: string) => screen.getByRole("region", { name });
    expect(within(column("To do")).getByText("Example")).toBeInTheDocument();
    expect(
      within(column("In progress")).getByText("Second"),
    ).toBeInTheDocument();
    expect(within(column("Done")).getByText("Third")).toBeInTheDocument();
  });

  it("opens the edit dialog when a card is clicked", async () => {
    mockItems();
    renderWithQuery(<ItemBoard />);

    await userEvent.click(
      await screen.findByRole("button", { name: "Edit Second" }),
    );

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Edit task" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Title")).toHaveValue("Second");
    expect(screen.getByRole("radio", { name: "In progress" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("moves a card when it is dropped on another column", async () => {
    mockItems();
    // Never settles, so the board shows the optimistic move rather than a refetch.
    const update = vi
      .spyOn(api, "updateItem")
      .mockReturnValue(new Promise(() => {}));
    renderWithQuery(<ItemBoard />);

    const card = await screen.findByRole("button", { name: "Edit Example" });
    const store = new Map<string, string>();
    const dataTransfer = {
      types: ["application/x-peach-item"],
      setData: (type: string, value: string) => store.set(type, value),
      getData: (type: string) => store.get(type) ?? "",
      effectAllowed: "",
      dropEffect: "",
    };
    const done = screen.getByRole("region", { name: "Done" });

    const at = { dataTransfer, clientX: 10, clientY: 10 };
    fireEvent.dragStart(card, at);
    fireEvent.dragOver(done, at);
    fireEvent.drop(done, at);

    await waitFor(() =>
      expect(update).toHaveBeenCalledWith(makeItem().id, { status: "done" }),
    );
    expect(within(done).getByText("Example")).toBeInTheDocument();
  });

  it("moves a card that only slightly overlaps the next column", async () => {
    mockItems();
    const update = vi
      .spyOn(api, "updateItem")
      .mockReturnValue(new Promise(() => {}));
    renderWithQuery(<ItemBoard />);

    const card = await screen.findByRole("button", { name: "Edit Example" });
    const rect = (left: number, width: number) =>
      ({ left, right: left + width, width, top: 0, bottom: 500 }) as DOMRect;
    // Columns 0-300, 310-610, 620-920; the card is 280 wide.
    const [todo, inProgress, done] = ["To do", "In progress", "Done"].map(
      (name) => screen.getByRole("region", { name }),
    );
    todo.getBoundingClientRect = () => rect(0, 300);
    inProgress.getBoundingClientRect = () => rect(310, 300);
    done.getBoundingClientRect = () => rect(620, 300);
    card.getBoundingClientRect = () => rect(10, 280);

    const dataTransfer = {
      types: ["application/x-peach-item"],
      setData: () => {},
      getData: () => "",
      effectAllowed: "",
      dropEffect: "",
    };
    // Grabbed 20px from its left edge; moved 40px right, so its right edge
    // sits at 330, i.e. 20px into "In progress" while the pointer is still in "To do".
    fireEvent.dragStart(card, { dataTransfer, clientX: 30, clientY: 20 });
    fireEvent.dragOver(todo, { dataTransfer, clientX: 70, clientY: 20 });
    fireEvent.drop(todo, { dataTransfer, clientX: 70, clientY: 20 });

    await waitFor(() =>
      expect(update).toHaveBeenCalledWith(makeItem().id, {
        status: "in_progress",
      }),
    );
  });

  it("surfaces a retry affordance when loading fails", async () => {
    vi.spyOn(api, "listItems").mockImplementation(async () => {
      throw new Error("Could not reach the API");
    });
    renderWithQuery(<ItemBoard />);

    await waitFor(() =>
      expect(screen.getByText("Could not load tasks")).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("opens the create dialog from a column", async () => {
    vi.spyOn(api, "listItems").mockResolvedValue({ items: [], total: 0 });
    renderWithQuery(<ItemBoard />);

    const inProgress = await screen.findByRole("region", {
      name: "In progress",
    });
    await userEvent.click(
      await within(inProgress).findByRole("button", { name: "New" }),
    );

    expect(
      await screen.findByRole("heading", { name: "New task" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "In progress" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("renders meeting event details on cards", async () => {
    vi.spyOn(api, "listItems").mockResolvedValue({
      items: [
        makeItem({
          id: "event-1",
          name: "Sprint Retrospective",
          start_time: "2026-11-01T14:00:00Z",
          duration_minutes: 60,
          participants: 8,
          agenda_items: [{ topic: "Retro", owner: "Alice", minutes: 30 }],
          action_items: [{ task: "Doc update", owner: "Bob", due_date: "2026-11-05" }],
        }),
      ],
      total: 1,
    });
    renderWithQuery(<ItemBoard />);

    await waitFor(() =>
      expect(screen.getByText("Sprint Retrospective")).toBeInTheDocument(),
    );
    expect(screen.getByText("60m")).toBeInTheDocument();
    expect(screen.getByText("8")).toBeInTheDocument();
    expect(screen.getByText("1 agenda")).toBeInTheDocument();
    expect(screen.getByText("1 action")).toBeInTheDocument();
  });
});
