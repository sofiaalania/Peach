import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, type RenderOptions } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";

import type { Item } from "@/lib/api";

/** Render with a fresh QueryClient so tests never share cache state. */
export function renderWithQuery(ui: ReactElement, options?: RenderOptions) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  }

  return render(ui, { wrapper: Wrapper, ...options });
}

export function makeItem(overrides: Partial<Item> = {}): Item {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    name: "Example",
    description: "An example item",
    status: "todo",
    start_time: null,
    duration_minutes: null,
    participants: null,
    agenda_items: null,
    action_items: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}
