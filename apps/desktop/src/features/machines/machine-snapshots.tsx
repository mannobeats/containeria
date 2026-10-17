import { IconCamera, IconDots } from "@tabler/icons-react";
import { useState } from "react";

import { formatRelative } from "@/lib/format";
import type { MachineSnapshot } from "@/lib/ipc/bindings";
import { errorMessage } from "@/lib/ipc/errors";
import { Button } from "@/ui/button";
import { ConfirmSheet } from "@/ui/confirm-sheet";
import { EmptyState } from "@/ui/empty-state";
import { ContextMenu, Menu, type MenuEntry } from "@/ui/menu";

import { useDeleteSnapshot, useMachineSnapshots, useRestoreSnapshot } from "./api";

type Pending = { snapshot: MachineSnapshot; kind: "restore" | "delete" };

function Row({
  snapshot,
  onPick,
}: {
  snapshot: MachineSnapshot;
  onPick: (pending: Pending) => void;
}) {
  const menu: MenuEntry[] = [
    { label: "Restore…", onSelect: () => onPick({ snapshot, kind: "restore" }) },
    { kind: "separator" },
    {
      label: "Delete Snapshot…",
      danger: true,
      onSelect: () => onPick({ snapshot, kind: "delete" }),
    },
  ];
  const created = Date.parse(snapshot.createdAt);
  return (
    <ContextMenu entries={menu}>
      <li className="grid h-[34px] grid-cols-[minmax(0,1fr)_160px_32px] items-center gap-3 border-b-[0.5px] border-line px-4 text-13 text-ink hover:bg-hover data-[state=open]:bg-hover">
        <span className="truncate font-mono text-mono-12 select-text">{snapshot.name}</span>
        <time
          dateTime={snapshot.createdAt}
          title={Number.isNaN(created) ? undefined : new Date(created).toLocaleString()}
          className="text-right text-12 text-ink-3"
        >
          {Number.isNaN(created) ? "" : formatRelative(created / 1000)}
        </time>
        <Menu entries={menu} align="end">
          <Button variant="ghost" size="sm" iconOnly aria-label={`More for ${snapshot.name}`}>
            <IconDots />
          </Button>
        </Menu>
      </li>
    </ContextMenu>
  );
}

/** The machine's snapshots: take one, go back to one, or delete one. */
export function MachineSnapshots({ name, onTake }: { name: string; onTake: () => void }) {
  const { data: snapshots, error } = useMachineSnapshots(name);
  const restore = useRestoreSnapshot();
  const remove = useDeleteSnapshot();
  const [pending, setPending] = useState<Pending | null>(null);
  const close = (open: boolean) => (open ? undefined : setPending(null));
  const confirm = () => {
    if (pending) {
      const input = { name, snapshot: pending.snapshot.name };
      (pending.kind === "restore" ? restore : remove).mutate(input, {
        onSettled: () => setPending(null),
      });
    }
  };
  const target = pending?.snapshot.name ?? "snapshot";
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-11 shrink-0 items-center border-b-[0.5px] border-line pr-3 pl-4">
        <h2 className="m-0 text-13 font-semibold text-ink">Snapshots</h2>
        <Button size="sm" className="ml-auto" onClick={onTake}>
          <IconCamera />
          Take Snapshot
        </Button>
      </div>
      {error ? (
        <EmptyState title="Snapshots can't be read">{errorMessage(error)}</EmptyState>
      ) : null}
      {snapshots?.length === 0 ? (
        <EmptyState title="No snapshots yet">
          A snapshot saves the disk as it is, so you can go back before an upgrade or experiment.
        </EmptyState>
      ) : null}
      {snapshots?.length ? (
        <ul
          aria-label={`Snapshots of ${name}`}
          className="m-0 min-h-0 flex-1 list-none overflow-auto p-0"
        >
          {snapshots.map((snapshot) => (
            <Row key={snapshot.name} snapshot={snapshot} onPick={setPending} />
          ))}
        </ul>
      ) : null}
      <ConfirmSheet
        open={pending?.kind === "restore"}
        onOpenChange={close}
        title={`Restore ${name} to ${target}?`}
        action="Restore snapshot"
        pending={restore.isPending}
        onConfirm={confirm}
      >
        Everything that changed in the machine since this snapshot is lost. A running machine
        restarts.
      </ConfirmSheet>
      <ConfirmSheet
        open={pending?.kind === "delete"}
        onOpenChange={close}
        title={`Delete snapshot ${target}?`}
        action="Delete snapshot"
        pending={remove.isPending}
        onConfirm={confirm}
      >
        The machine isn't changed. The snapshot can't be recovered.
      </ConfirmSheet>
    </div>
  );
}
