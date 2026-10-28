import {
  IconCopy,
  IconDots,
  IconExternalLink,
  IconLock,
  IconLockOpen,
  IconWorld,
} from "@tabler/icons-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import clsx from "clsx";

import { copyText } from "@/lib/clipboard";
import type { DomainRoute } from "@/lib/ipc/bindings";
import { Button } from "@/ui/button";
import { Chip } from "@/ui/chip";
import { rowActions } from "@/ui/classes";
import { IconAction } from "@/ui/icon-action";
import { ContextMenu, Menu, type MenuEntry } from "@/ui/menu";
import { Tip } from "@/ui/tooltip";

import { routeState } from "./model";

type DomainRowProps = {
  route: DomainRoute;
  url: string;
  caTrusted: boolean;
  onEdit: () => void;
  onRemove: () => void;
};

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
  const copyUrl = () => copyText("URL", url);
  const entries: MenuEntry[] = [
    { label: "Open in Browser", onSelect: open, disabled: !up },
    { kind: "separator" },
    { label: "Copy URL", onSelect: copyUrl },
    { label: "Copy curl Command", onSelect: () => copyText("Command", `curl -sS ${url}`) },
    ...(route.kind === "custom"
      ? [
          { kind: "separator" as const },
          { label: "Edit Route…", onSelect: onEdit },
          { kind: "separator" as const },
          { label: "Remove Route…", danger: true, onSelect: onRemove },
        ]
      : []),
  ];
  return (
    <ContextMenu entries={entries}>
      <tr
        className={clsx(
          "group/row h-9 hover:bg-hover data-[state=open]:bg-hover [&>td]:border-b-[0.5px] [&>td]:border-line [&>td]:px-2.5",
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
          <span className={rowActions}>
            <IconAction label="Open in browser" target={route.host} disabled={!up} onClick={open}>
              <IconExternalLink />
            </IconAction>
            <IconAction label="Copy URL" target={route.host} onClick={copyUrl}>
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
    </ContextMenu>
  );
}
