"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlignLeft, Calendar, Clock, Plus, Users } from "lucide-react";
import { useRef, useState, type DragEvent } from "react";
import { toast } from "sonner";

import { ItemFormDialog } from "@/components/item-form-dialog";
import { PageHeader } from "@/components/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  api,
  itemStatuses,
  type Item,
  type ItemList,
  type ItemStatus,
} from "@/lib/api";
import { statusMeta } from "@/lib/item-status";
import { cn } from "@/lib/utils";

const DRAG_TYPE = "application/x-peach-item";

type DragInfo = {
  id: string;
  from: ItemStatus;
  /** Where inside the card it was grabbed, so we can track the card's footprint. */
  offsetX: number;
  width: number;
};

export function ItemBoard() {
  const queryClient = useQueryClient();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Item | null>(null);
  const [newStatus, setNewStatus] = useState<ItemStatus>("todo");
  const [pendingDelete, setPendingDelete] = useState<Item | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<ItemStatus | null>(null);
  const drag = useRef<DragInfo | null>(null);
  const columns = useRef<Partial<Record<ItemStatus, HTMLElement | null>>>({});

  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: ["items"],
    queryFn: () => api.listItems({ limit: 100 }),
  });

  const move = useMutation({
    mutationFn: ({ id, status }: { id: string; status: ItemStatus }) =>
      api.updateItem(id, { status }),
    // Move the card immediately; roll back if the API refuses.
    onMutate: async ({ id, status }) => {
      await queryClient.cancelQueries({ queryKey: ["items"] });
      const previous = queryClient.getQueryData<ItemList>(["items"]);
      queryClient.setQueryData<ItemList>(["items"], (old) =>
        old
          ? {
              ...old,
              items: old.items.map((it) =>
                it.id === id ? { ...it, status } : it,
              ),
            }
          : old,
      );
      return { previous };
    },
    onError: (err: Error, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["items"], context.previous);
      }
      toast.error(err.message);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["items"] }),
  });

  const remove = useMutation({
    mutationFn: (item: Item) => api.deleteItem(item.id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["items"] });
      toast.success("Task deleted");
      setFormOpen(false);
    },
    onError: (err: Error) => toast.error(err.message),
    onSettled: () => setPendingDelete(null),
  });

  function openCreate(status: ItemStatus) {
    setEditing(null);
    setNewStatus(status);
    setFormOpen(true);
  }

  function openEdit(item: Item) {
    setEditing(item);
    setFormOpen(true);
  }

  /** A card counts as over another column as soon as any part of it overlaps
   *  that column; otherwise fall back to whatever column the pointer is in. */
  function targetFor(event: DragEvent): ItemStatus | null {
    const info = drag.current;
    if (!info) return null;
    // Some browsers report 0,0 on the last dragover; keep the previous target.
    if (event.clientX === 0 && event.clientY === 0) return dropTarget;

    const left = event.clientX - info.offsetX;
    const right = left + info.width;
    let best: ItemStatus | null = null;
    let bestOverlap = 0;
    for (const status of itemStatuses) {
      if (status === info.from) continue;
      const rect = columns.current[status]?.getBoundingClientRect();
      if (!rect) continue;
      const overlap = Math.min(right, rect.right) - Math.max(left, rect.left);
      if (overlap > bestOverlap) {
        best = status;
        bestOverlap = overlap;
      }
    }
    if (best) return best;

    const under = (event.target as HTMLElement).closest<HTMLElement>(
      "[data-status]",
    );
    return (under?.dataset.status as ItemStatus | undefined) ?? info.from;
  }

  function handleDragOver(event: DragEvent) {
    if (!drag.current) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const target = targetFor(event);
    if (target !== dropTarget) setDropTarget(target);
  }

  function handleDrop(event: DragEvent) {
    event.preventDefault();
    const info = drag.current;
    const target = targetFor(event);
    endDrag();
    if (info && target && target !== info.from) {
      move.mutate({ id: info.id, status: target });
    }
  }

  function endDrag() {
    drag.current = null;
    setDraggingId(null);
    setDropTarget(null);
  }

  return (
    <div className="grid gap-8">
      <PageHeader
        icon="📋"
        title="Board"
        description={
          data
            ? `${data.total} task${data.total === 1 ? "" : "s"} · drag cards between columns, click one to edit`
            : "Loading..."
        }
        action={
          <Button size="lg" onClick={() => openCreate("todo")}>
            <Plus data-icon="inline-start" className="size-4" />
            New task
          </Button>
        }
      />

      {isError && (
        <Alert variant="destructive">
          <AlertTitle>Could not load tasks</AlertTitle>
          <AlertDescription className="flex items-center gap-4">
            <span>{(error as Error).message}</span>
            <Button size="sm" variant="outline" onClick={() => refetch()}>
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {!isError && (
        // Vertical padding keeps the drop ring from being clipped by the scroller.
        <div
          className="-mx-6 overflow-x-auto px-6 py-1 sm:-mx-8 sm:px-8"
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node)) {
              setDropTarget(null);
            }
          }}
        >
          <div className="grid min-h-[60vh] min-w-[720px] grid-cols-3 gap-3">
            {itemStatuses.map((status) => {
              const meta = statusMeta[status];
              const cards =
                data?.items.filter((item) => item.status === status) ?? [];
              const isTarget = dropTarget === status;
              return (
                <section
                  key={status}
                  aria-label={meta.label}
                  data-status={status}
                  ref={(node) => {
                    columns.current[status] = node;
                  }}
                  className={cn(
                    "flex flex-col gap-2 rounded-xl p-2 transition-shadow",
                    meta.column,
                    isTarget && "ring-2 ring-primary/40 ring-inset",
                  )}
                >
                  <header className="flex items-center gap-2 px-1.5 pt-1 pb-0.5">
                    <span
                      className={cn(
                        "inline-flex h-6 items-center gap-1.5 rounded-full px-2 text-sm font-medium",
                        meta.pill,
                      )}
                    >
                      <span
                        aria-hidden
                        className={cn("size-2 rounded-full", meta.dot)}
                      />
                      {meta.label}
                    </span>
                    <span className="text-sm text-muted-foreground tabular-nums">
                      {data ? cards.length : ""}
                    </span>
                  </header>

                  {isPending && (
                    <>
                      <Skeleton className="h-16 w-full rounded-lg" />
                      <Skeleton className="h-16 w-full rounded-lg" />
                    </>
                  )}

                  {cards.map((item) => (
                    <BoardCard
                      key={item.id}
                      item={item}
                      dragging={draggingId === item.id}
                      onOpen={() => openEdit(item)}
                      onDragStart={(event) => {
                        const rect =
                          event.currentTarget.getBoundingClientRect();
                        drag.current = {
                          id: item.id,
                          from: status,
                          offsetX: event.clientX - rect.left,
                          width: rect.width,
                        };
                        event.dataTransfer.setData(DRAG_TYPE, item.id);
                        event.dataTransfer.effectAllowed = "move";
                        setDraggingId(item.id);
                      }}
                      onDragEnd={endDrag}
                    />
                  ))}

                  {data && (
                    <button
                      type="button"
                      onClick={() => openCreate(status)}
                      className="flex h-8 items-center gap-1.5 rounded-md px-2 text-sm text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
                    >
                      <Plus className="size-4" />
                      New
                    </button>
                  )}
                </section>
              );
            })}
          </div>
        </div>
      )}

      <ItemFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        item={editing}
        defaultStatus={newStatus}
        onDelete={setPendingDelete}
      />

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => !open && setPendingDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this task?</AlertDialogTitle>
            <AlertDialogDescription>
              &quot;{pendingDelete?.name}&quot; will be removed permanently.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => pendingDelete && remove.mutate(pendingDelete)}
              disabled={remove.isPending}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

type CardProps = {
  item: Item;
  dragging: boolean;
  onOpen: () => void;
  onDragStart: (event: DragEvent<HTMLDivElement>) => void;
  onDragEnd: () => void;
};

function BoardCard({
  item,
  dragging,
  onOpen,
  onDragStart,
  onDragEnd,
}: CardProps) {
  const isEvent = Boolean(item.start_time);
  return (
    <div
      role="button"
      tabIndex={0}
      draggable
      aria-label={`Edit ${item.name}`}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={cn(
        "group cursor-pointer rounded-lg bg-card px-3 py-2.5 text-left shadow-notion-sm transition select-none",
        "hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        "active:cursor-grabbing",
        dragging && "opacity-40",
      )}
    >
      <p
        className={cn(
          "text-sm leading-snug font-medium break-words",
          item.status === "done" && "text-muted-foreground line-through",
        )}
      >
        {item.name}
      </p>
      {item.description && (
        <p className="mt-1 line-clamp-2 text-xs leading-relaxed break-words text-muted-foreground">
          {item.description}
        </p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        {item.description && <AlignLeft aria-hidden className="size-3.5" />}
        {isEvent && item.start_time && (
          <span className="inline-flex items-center gap-1">
            <Calendar aria-hidden className="size-3" />
            {new Date(item.start_time).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
        )}
        {item.duration_minutes && (
          <span className="inline-flex items-center gap-1">
            <Clock aria-hidden className="size-3" />
            {item.duration_minutes}m
          </span>
        )}
        {item.participants && (
          <span className="inline-flex items-center gap-1">
            <Users aria-hidden className="size-3" />
            {item.participants}
          </span>
        )}
        {item.agenda_items && item.agenda_items.length > 0 && (
          <span className="rounded bg-accent px-1.5 py-0.5 text-[10px] font-medium">
            {item.agenda_items.length} agenda
          </span>
        )}
        {item.action_items && item.action_items.length > 0 && (
          <span className="rounded bg-accent px-1.5 py-0.5 text-[10px] font-medium">
            {item.action_items.length} action
          </span>
        )}
        {!isEvent && (
          <span>
            {new Date(item.created_at).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
            })}
          </span>
        )}
      </div>
    </div>
  );
}
