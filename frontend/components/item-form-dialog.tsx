"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Controller, useFieldArray, useForm } from "react-hook-form";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import {
  api,
  ApiError,
  itemInputSchema,
  itemStatuses,
  type Item,
  type ItemInput,
  type ItemStatus,
} from "@/lib/api";
import { statusMeta } from "@/lib/item-status";
import { cn } from "@/lib/utils";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Present when editing, absent when creating. */
  item?: Item | null;
  /** Column a new card starts in. */
  defaultStatus?: ItemStatus;
  /** Shown only when editing; the caller owns the confirmation. */
  onDelete?: (item: Item) => void;
};

function toLocalDateTime(value: string): string {
  const dt = new Date(value);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
}

export function ItemFormDialog(props: Props) {
  // A fresh dialog session owns its draft and ignores requests from earlier sessions.
  return props.open ? (
    <ItemFormDialogContent
      key={props.item?.id ?? `new-${props.defaultStatus ?? "todo"}`}
      {...props}
    />
  ) : null;
}

function ItemFormDialogContent({
  open,
  onOpenChange,
  item,
  defaultStatus = "todo",
  onDelete,
}: Props) {
  const queryClient = useQueryClient();
  const isEditing = Boolean(item);
  const [agendaText, setAgendaText] = useState("");
  const [isParsing, setIsParsing] = useState(false);
  const [parseError, setParseError] = useState("");
  const [parsed, setParsed] = useState(false);
  const parseGeneration = useRef(0);

  const form = useForm<ItemInput>({
    resolver: zodResolver(itemInputSchema),
    defaultValues: {
      name: "",
      description: "",
      status: defaultStatus,
      start_time: null,
      duration_minutes: null,
      participants: null,
      agenda_items: [],
      action_items: [],
    },
  });

  const agendaFields = useFieldArray({
    control: form.control,
    name: "agenda_items" as never,
  });

  const actionFields = useFieldArray({
    control: form.control,
    name: "action_items" as never,
  });

  useEffect(() => {
    if (!open) return;

    const startTimeValue = item?.start_time
      ? toLocalDateTime(item.start_time)
      : null;

    form.reset({
      name: item?.name ?? "",
      description: item?.description ?? "",
      status: item?.status ?? defaultStatus,
      start_time: startTimeValue,
      duration_minutes: item?.duration_minutes ?? null,
      participants: item?.participants ?? null,
      agenda_items: item?.agenda_items ?? [],
      action_items: item?.action_items ?? [],
    });
    return () => {
      parseGeneration.current += 1;
    };
  }, [open, item, defaultStatus, form]);

  async function parseAgenda() {
    if (isParsing || mutation.isPending) return;
    if (!agendaText.trim() || agendaText.length > 10000) {
      setParseError("Paste an agenda between 1 and 10,000 characters.");
      return;
    }
    const generation = ++parseGeneration.current;
    setIsParsing(true);
    setParseError("");
    setParsed(false);
    try {
      const result = await api.parseAgenda(agendaText);
      if (generation !== parseGeneration.current) return;
      const current = form.getValues();
      form.reset({
        ...current,
        name: result.title ?? current.name,
        description: result.description ?? current.description,
        start_time: result.start_time
          ? toLocalDateTime(result.start_time)
          : current.start_time,
        duration_minutes: result.duration_minutes ?? current.duration_minutes,
        participants: result.participants ?? current.participants,
        agenda_items: result.agenda_items,
        action_items: result.action_items.map((action) => ({
          ...action,
          due_date: action.due_date ?? "",
        })),
      });
      setParsed(true);
    } catch (error) {
      if (generation !== parseGeneration.current) return;
      setParseError(
        error instanceof ApiError && error.status === 401
          ? "Your session has expired. Please sign in again."
          : "We couldn't parse this agenda. Try again or fill in the form manually.",
      );
    } finally {
      if (generation === parseGeneration.current) setIsParsing(false);
    }
  }

  const mutation = useMutation({
    mutationFn: (values: ItemInput) => {
      // Convert datetime-local string to ISO with timezone
      const payload = { ...values };
      if (payload.start_time) {
        const local = new Date(payload.start_time);
        payload.start_time = local.toISOString();
      }
      // Clean up empty arrays
      if (payload.agenda_items?.length === 0) payload.agenda_items = null;
      if (payload.action_items?.length === 0) payload.action_items = null;
      // Clean up null/undefined numeric fields
      if (!payload.duration_minutes) payload.duration_minutes = null;
      if (!payload.participants) payload.participants = null;

      return item ? api.updateItem(item.id, payload) : api.createItem(payload);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["items"] });
      toast.success(isEditing ? "Task updated" : "Task created");
      onOpenChange(false);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit task" : "New task"}</DialogTitle>
          <DialogDescription>
            {isEditing
              ? "Change the details or move it to another column."
              : "Add a card to the board."}
          </DialogDescription>
        </DialogHeader>

        <form
          className="grid gap-4"
          onSubmit={form.handleSubmit((values) => {
            if (!isParsing) mutation.mutate(values);
          })}
        >
          {!isEditing && (
            <section
              aria-labelledby="paste-agenda-heading"
              className="grid gap-2 rounded-md border p-3"
            >
              <h3 id="paste-agenda-heading" className="text-sm font-medium">
                Paste an Agenda
              </h3>
              <FieldLabel htmlFor="agenda-text">
                Meeting notes or agenda
              </FieldLabel>
              <Textarea
                id="agenda-text"
                rows={5}
                maxLength={10000}
                value={agendaText}
                onChange={(event) => setAgendaText(event.target.value)}
                disabled={isParsing || mutation.isPending}
              />
              <p className="text-sm text-muted-foreground">
                AI fills in the form below. Review and edit the details, then
                use Create to save. Parsing again replaces the extracted fields
                and agenda/action rows.
              </p>
              <Button
                type="button"
                variant="outline"
                onClick={parseAgenda}
                disabled={isParsing || mutation.isPending || !agendaText.trim()}
              >
                {isParsing ? "Parsing..." : "Parse with AI"}
              </Button>
              {isParsing && <p role="status">Parsing your agenda...</p>}
              {parseError && (
                <p role="alert" className="text-sm text-destructive">
                  {parseError}
                </p>
              )}
              {parsed && (
                <p role="status">
                  Agenda ready for review. Nothing has been saved yet.
                </p>
              )}
            </section>
          )}
          <Field data-invalid={Boolean(form.formState.errors.name)}>
            <FieldLabel htmlFor="name">Title</FieldLabel>
            <Input id="name" autoComplete="off" {...form.register("name")} />
            {form.formState.errors.name && (
              <FieldError errors={[form.formState.errors.name]} />
            )}
          </Field>

          <Field>
            <FieldLabel id="status-label">Status</FieldLabel>
            <Controller
              control={form.control}
              name="status"
              render={({ field }) => (
                <div
                  role="radiogroup"
                  aria-labelledby="status-label"
                  className="flex flex-wrap gap-1.5"
                >
                  {itemStatuses.map((status) => {
                    const meta = statusMeta[status];
                    const selected = field.value === status;
                    return (
                      <button
                        key={status}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        onClick={() => field.onChange(status)}
                        className={cn(
                          "inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium transition",
                          selected
                            ? cn(meta.pill, "ring-1 ring-foreground/15")
                            : "text-muted-foreground hover:bg-accent",
                        )}
                      >
                        <span
                          aria-hidden
                          className={cn("size-2 rounded-full", meta.dot)}
                        />
                        {meta.label}
                      </button>
                    );
                  })}
                </div>
              )}
            />
          </Field>

          <Field data-invalid={Boolean(form.formState.errors.description)}>
            <FieldLabel htmlFor="description">Description</FieldLabel>
            <Textarea
              id="description"
              rows={3}
              placeholder="Add more detail..."
              {...form.register("description")}
            />
            {form.formState.errors.description && (
              <FieldError errors={[form.formState.errors.description]} />
            )}
          </Field>

          {/* --- Meeting fields --- */}
          <Separator />
          <p className="text-sm font-medium text-muted-foreground">
            Event details (optional)
          </p>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field>
              <FieldLabel htmlFor="start_time">Start date & time</FieldLabel>
              <Input
                id="start_time"
                type="datetime-local"
                {...form.register("start_time")}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="duration_minutes">Duration (min)</FieldLabel>
              <Input
                id="duration_minutes"
                type="number"
                min={1}
                max={1440}
                placeholder="60"
                {...form.register("duration_minutes", {
                  setValueAs: (value: string) =>
                    value == null || value === "" ? null : Number(value),
                })}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="participants">Participants</FieldLabel>
              <Input
                id="participants"
                type="number"
                min={1}
                placeholder="5"
                {...form.register("participants", {
                  setValueAs: (value: string) =>
                    value == null || value === "" ? null : Number(value),
                })}
              />
            </Field>
          </div>

          {/* --- Agenda items --- */}
          <Separator />
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">Agenda items</p>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() =>
                  agendaFields.append({ topic: "", owner: "", minutes: 0 })
                }
              >
                <Plus className="mr-1 size-3" />
                Add
              </Button>
            </div>
            {agendaFields.fields.map((field, index) => (
              <div
                key={field.id}
                className="flex items-start gap-2 rounded-md border border-border p-2"
              >
                <div className="grid flex-1 grid-cols-1 gap-2 sm:grid-cols-3">
                  <Input
                    placeholder="Topic"
                    {...form.register(`agenda_items.${index}.topic` as const)}
                  />
                  <Input
                    placeholder="Owner"
                    {...form.register(`agenda_items.${index}.owner` as const)}
                  />
                  <Input
                    type="number"
                    min={0}
                    placeholder="Minutes"
                    {...form.register(
                      `agenda_items.${index}.minutes` as const,
                      {
                        valueAsNumber: true,
                      },
                    )}
                  />
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="mt-0.5 shrink-0 text-muted-foreground hover:text-destructive"
                  onClick={() => agendaFields.remove(index)}
                >
                  <X className="size-4" />
                </Button>
              </div>
            ))}
          </div>

          {/* --- Action items --- */}
          <Separator />
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">Action items</p>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() =>
                  actionFields.append({ task: "", owner: "", due_date: "" })
                }
              >
                <Plus className="mr-1 size-3" />
                Add
              </Button>
            </div>
            {actionFields.fields.map((field, index) => (
              <div
                key={field.id}
                className="flex items-start gap-2 rounded-md border border-border p-2"
              >
                <div className="grid flex-1 grid-cols-1 gap-2 sm:grid-cols-3">
                  <Input
                    placeholder="Task"
                    {...form.register(`action_items.${index}.task` as const)}
                  />
                  <Input
                    placeholder="Owner"
                    {...form.register(`action_items.${index}.owner` as const)}
                  />
                  <Input
                    type="date"
                    {...form.register(
                      `action_items.${index}.due_date` as const,
                    )}
                  />
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="mt-0.5 shrink-0 text-muted-foreground hover:text-destructive"
                  onClick={() => actionFields.remove(index)}
                >
                  <X className="size-4" />
                </Button>
              </div>
            ))}
          </div>

          <DialogFooter className="sm:justify-between">
            {item && onDelete ? (
              <Button
                type="button"
                size="lg"
                variant="ghost"
                className="text-destructive hover:text-destructive"
                onClick={() => onDelete(item)}
                disabled={mutation.isPending}
              >
                <Trash2 data-icon="inline-start" className="size-4" />
                Delete
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button
                type="button"
                size="lg"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={mutation.isPending}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="lg"
                disabled={mutation.isPending || isParsing}
              >
                {mutation.isPending
                  ? "Saving..."
                  : isEditing
                    ? "Save changes"
                    : "Create"}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
