import {
  IconCopy,
  IconDots,
  IconExternalLink,
  IconLock,
  IconLockOpen,
  IconWorld,
} from "@tabler/icons-react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { openUrl } from "@tauri-apps/plugin-opener";
import clsx from "clsx";
import { toast } from "sonner";

import type { DomainRoute } from "@/lib/ipc/bindings";
import { Button } from "@/ui/button";
import { Chip } from "@/ui/chip";
import { IconAction } from "@/ui/icon-action";
import { Menu, type MenuEntry } from "@/ui/menu";
import { Tip } from "@/ui/tooltip";

import { routeState } from "./model";

type DomainRowProps = {
  route: DomainRoute;
  url: string;
  caTrusted: boolean;
  onEdit: () => void;
  onRemove: () => void;
};

function copy(url: string) {
  writeText(url)
    .then(() => toast("Copied", { description: url }))
    .catch(() => undefined);
}

function Https({ route, caTrusted }: { route: DomainRoute; caTrusted: boolean }) {
  if (!route.https) {
    return (
      <span className="inline-flex items-center gap-1 text-ink-3">
        <IconWorld className="size-3.5" aria-hidden />
        HTTP
      </span>
    );
  }
  return caTrusted ? (
    <Tip label="Signed by the Containeria local certificate authority">
      <span className="inline-flex items-center gap-1">
        <IconLock className="size-3.5" aria-hidden />
        HTTPS
      </span>
    </Tip>
  ) : (
    <Tip label="Browsers warn until you trust the local certificate">
      <span className="inline-flex items-center gap-1 text-ink-3">
        <IconLockOpen className="size-3.5" aria-hidden />
        Untrusted
      </span>
    </Tip>
  );
}

export function DomainRow({ route, url, caTrusted, onEdit, onRemove }: DomainRowProps) {
  const up = route.down === null;
  const open = () => openUrl(url).catch(() => undefined);
  const entries: MenuEntry[] = [
    { label: "Open in browser", onSelect: open, disabled: !up },
    { label: "Copy URL", onSelect: () => copy(url) },
    { label: "Copy curl command", onSelect: () => copy(`curl -sS ${url}`) },
    ...(route.kind === "custom"
      ? [
          { kind: "separator" as const },
          { label: "Edit route…", onSelect: onEdit },
          { label: "Remove route…", danger: true, onSelect: onRemove },
        ]
      : []),
  ];
  return (
    <tr
      className={clsx(
        "group/row h-9 hover:bg-hover [&>td]:border-b-[0.5px] [&>td]:border-line [&>td]:px-2.5",
        !up && "[&>td]:text-ink-3",
      )}
    >
      <td className="max-w-0 pl-5!">
        <span className="flex min-w-0 items-center gap-2">
          <span className={clsx("truncate font-mono text-mono-13", up && "text-ink")}>
            {route.host}
          </span>
          {route.kind === "custom" ? <Chip>Custom</Chip> : null}
        </span>
      </td>
      <td className="max-w-0">
        <span className="flex min-w-0 items-center gap-1">
          <span className="truncate">{route.container}</span>
          {route.port === null ? null : (
            <span className="font-mono text-mono-12 text-ink-3">:{route.port}</span>
          )}
        </span>
      </td>
      <td>
        <Https route={route} caTrusted={caTrusted} />
      </td>
      <td>{routeState(route)}</td>
      <td className="pr-5! text-right">
        <span className="inline-flex gap-0.5 opacity-0 transition-opacity duration-140 group-focus-within/row:opacity-100 group-hover/row:opacity-100">
          <IconAction label="Open in browser" target={route.host} disabled={!up} onClick={open}>
            <IconExternalLink />
          </IconAction>
          <IconAction label="Copy URL" target={route.host} onClick={() => copy(url)}>
            <IconCopy />
          </IconAction>
          <Menu entries={entries} align="end">
            <Button
              variant="ghost"
              size="sm"
              iconOnly
              aria-label={`More for ${route.host}`}
              className="text-ink-3 hover:text-ink"
            >
              <IconDots />
            </Button>
          </Menu>
        </span>
      </td>
    </tr>
  );
}
