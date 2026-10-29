import { z } from "zod";

/** Browser code must reach the API through the published port; server components
 *  resolve the Compose service name instead. */
export function apiBaseUrl(): string {
  if (typeof window === "undefined") {
    return process.env.INTERNAL_API_URL ?? "http://backend:8000";
  }
  return process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Get the current id_token from the OIDC session (if any). */
function getIdToken(): string | null {
  if (typeof window === "undefined") return null;
  const storageKey = Object.keys(sessionStorage).find((k) =>
    k.startsWith("oidc.user:"),
  );
  if (!storageKey) return null;
  try {
    const data = JSON.parse(sessionStorage.getItem(storageKey) ?? "{}");
    return data.id_token ?? null;
  } catch {
    return null;
  }
}

async function request<T>(
  path: string,
  schema: z.ZodType<T>,
  init?: RequestInit,
): Promise<T> {
  const token = getIdToken();
  const authHeaders: Record<string, string> = token
    ? { Authorization: `Bearer ${token}` }
    : {};

  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl()}${path}`, {
      ...init,
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders,
        ...(init?.headers ?? {}),
      },
    });
  } catch {
    throw new ApiError(0, "Could not reach the API");
  }

  if (!response.ok) {
    const detail = await response
      .json()
      .then((body) => (typeof body?.detail === "string" ? body.detail : null))
      .catch(() => null);
    throw new ApiError(
      response.status,
      detail ?? `Request failed (${response.status})`,
    );
  }

  if (response.status === 204) {
    return schema.parse(undefined);
  }
  return schema.parse(await response.json());
}

/* --- schemas mirroring the API contract --- */

export const itemStatuses = ["todo", "in_progress", "done"] as const;
export const itemStatusSchema = z.enum(itemStatuses);

export const agendaItemSchema = z.object({
  topic: z.string(),
  owner: z.string(),
  minutes: z.number().int().min(0),
});

export const actionItemSchema = z.object({
  task: z.string(),
  owner: z.string(),
  due_date: z.string().nullable().optional(),
});

export const parsedAgendaSchema = z.object({
  title: z.string().nullable(),
  description: z.string().nullable(),
  start_time: z.string().nullable(),
  duration_minutes: z.number().int().positive().nullable(),
  participants: z.number().int().positive().nullable(),
  agenda_items: z.array(agendaItemSchema),
  action_items: z.array(actionItemSchema),
});

export type ParsedAgenda = z.infer<typeof parsedAgendaSchema>;

export const itemSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  status: itemStatusSchema,
  start_time: z.string().nullable().optional(),
  duration_minutes: z.number().int().positive().nullable().optional(),
  participants: z.number().int().positive().nullable().optional(),
  agenda_items: z.array(agendaItemSchema).nullable().optional(),
  action_items: z.array(actionItemSchema).nullable().optional(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const itemListSchema = z.object({
  items: z.array(itemSchema),
  total: z.number().int(),
});

export const healthSchema = z.object({
  status: z.string(),
  database: z.string(),
});

export const itemInputSchema = z.object({
  name: z.string().min(1, "Name is required").max(120, "Name is too long"),
  description: z.string().max(2000, "Description is too long").optional(),
  status: itemStatusSchema,
  start_time: z.string().optional().nullable(),
  duration_minutes: z
    .number()
    .int()
    .positive("Must be at least 1")
    .optional()
    .nullable(),
  participants: z
    .number()
    .int()
    .positive("Must be at least 1")
    .optional()
    .nullable(),
  agenda_items: z
    .array(
      z.object({
        topic: z.string().min(1, "Topic is required"),
        owner: z.string(),
        minutes: z.number().int().min(0),
      }),
    )
    .optional()
    .nullable(),
  action_items: z
    .array(
      z.object({
        task: z.string().min(1, "Task is required"),
        owner: z.string(),
        due_date: z.string().optional().nullable(),
      }),
    )
    .optional()
    .nullable(),
});

export type ItemStatus = z.infer<typeof itemStatusSchema>;
export type Item = z.infer<typeof itemSchema>;
export type ItemList = z.infer<typeof itemListSchema>;
export type Health = z.infer<typeof healthSchema>;
export type ItemInput = z.infer<typeof itemInputSchema>;
export type AgendaItem = z.infer<typeof agendaItemSchema>;
export type ActionItem = z.infer<typeof actionItemSchema>;

/* --- endpoints --- */

export const api = {
  parseAgenda: (text: string) =>
    request("/api/v1/ai/parse-agenda", parsedAgendaSchema, {
      method: "POST",
      body: JSON.stringify({ text }),
    }),

  readiness: () => request("/api/v1/health/ready", healthSchema),

  listItems: (params: { limit?: number; offset?: number } = {}) => {
    const query = new URLSearchParams();
    if (params.limit !== undefined) query.set("limit", String(params.limit));
    if (params.offset !== undefined) query.set("offset", String(params.offset));
    const suffix = query.size > 0 ? `?${query}` : "";
    return request(`/api/v1/items${suffix}`, itemListSchema);
  },

  createItem: (payload: ItemInput) =>
    request("/api/v1/items", itemSchema, {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  updateItem: (id: string, payload: Partial<ItemInput>) =>
    request(`/api/v1/items/${id}`, itemSchema, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),

  deleteItem: (id: string) =>
    request(`/api/v1/items/${id}`, z.undefined(), { method: "DELETE" }),
};
