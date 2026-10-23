import { IconDots, IconKey, IconLock } from "@tabler/icons-react";
import { Link, useNavigate } from "@tanstack/react-router";
import clsx from "clsx";
import type { ReactNode } from "react";

import { copyText } from "@/lib/clipboard";
import type { Connection, Detected, Environment } from "@/lib/ipc/bindings";
import { Button } from "@/ui/button";
import { buttonClass } from "@/ui/button-class";
import { Chip } from "@/ui/chip";
import { Dash } from "@/ui/dash";
import { ContextMenu, Menu, type MenuEntry } from "@/ui/menu";
import { Tile } from "@/ui/tile";

import { address } from "./connection-menu";
import { engineLabel, engineLogo } from "./engines";
import { useConnectionMenu } from "./use-connection-menu";

const tableClass =
  "w-full table-fixed border-separate border-spacing-0 text-13 [&_td]:h-12 [&_td]:border-b-[0.5px] [&_td]:border-line [&_td]:px-2.5 [&_td:first-child]:pl-5 [&_td:last-child]:pr-5 [&_th]:h-[30px] [&_th]:border-b-[0.5px] [&_th]:border-line [&_th]:px-2.5 [&_th]:text-left [&_th]:text-12 [&_th]:font-medium [&_th]:text-ink-3 [&_th:first-child]:w-[26%] [&_th:first-child]:pl-5 [&_th:nth-child(2)]:w-24 [&_th:nth-child(3)]:w-[140px] [&_th:last-child]:w-[88px]";

function Head({ fourth, last }: { fourth: string; last: string }) {
  return (
    <thead>
      <tr>
        <th>Name</th>
        <th>Engine</th>
        <th>Address</th>
        <th>{fourth}</th>
        <th>
          <span className="sr-only">{last}</span>
        </th>
      </tr>
    </thead>
  );
}

function NameCell({
  logo,
  name,
  line,
  off = false,
}: {
  logo: ReactNode;
  name: string;
  line: ReactNode;
  off?: boolean;
}) {
  return (
    <span className={clsx("flex min-w-0 items-center gap-2", off && "opacity-60")}>
      {logo}
      <span className="flex min-w-0 flex-col">
        <b className="truncate font-medium text-ink">{name}</b>
        <span className="truncate text-12 text-ink-3">{line}</span>
      </span>
    </span>
  );
}

function OpenLink({ id, children }: { id: string; children: ReactNode }) {
  return (
    <Link
      to="/data/$connection"
      params={{ connection: id }}
      className={buttonClass({ size: "sm", variant: "soft" })}
    >
      {children}
    </Link>
  );
}

const rowClass = "transition-colors duration-140 hover:bg-hover data-[state=open]:bg-hover";

function detectedMenu(found: Detected, connect: () => void): MenuEntry[] {
  return [
    { label: "Connect", onSelect: connect, disabled: !(found.running && found.port) },
    { kind: "separator" },
    ...(found.port
      ? [{ label: "Copy Address", onSelect: () => copyText("Address", `localhost:${found.port}`) }]
      : []),
    { label: "Copy Container Name", onSelect: () => copyText("Name", found.containerName) },
  ];
}

/** Databases running in containers; their credentials come from each container's environment. */
export function DetectedTable({ detected }: { detected: Detected[] }) {
  const navigate = useNavigate();
  const open = (id: string) =>
    navigate({ to: "/data/$connection", params: { connection: id } }).catch(() => undefined);
  return (
    <table className={tableClass}>
      <Head fourth="Credentials" last="Open" />
      <tbody>
        {detected.map((found) => (
          <ContextMenu key={found.id} entries={detectedMenu(found, () => open(found.id))}>
            <tr className={rowClass}>
              <td>
                <NameCell
                  logo={
                    <Tile logo={engineLogo(found.engine)} state={found.running ? "on" : "off"} />
                  }
                  name={found.containerName}
                  line={found.running ? found.image : "Container stopped"}
                  off={!found.running}
                />
              </td>
              <td>{engineLabel(found.engine)}</td>
              <td className="truncate font-mono text-mono-12 text-ink-3">
                {found.port ? `localhost:${found.port}` : "Not published"}
              </td>
              <td className="truncate text-12 text-ink-3">
                {found.passwordSource ? (
                  <span className="inline-flex items-center gap-1">
                    <IconKey className="size-3.5" aria-hidden /> from{" "}
                    <code className="font-mono">{found.passwordSource}</code>
                  </span>
                ) : (
                  "No password"
                )}
              </td>
              <td className="text-right">
                {found.running && found.port ? (
                  <OpenLink id={found.id}>Connect</OpenLink>
                ) : (
                  <Dash />
                )}
              </td>
            </tr>
          </ContextMenu>
        ))}
      </tbody>
    </table>
  );
}

const ENVIRONMENT: Record<Environment, ReactNode> = {
  production: (
    <Chip tone="bad">
      <IconLock aria-hidden />
      Production
    </Chip>
  ),
  staging: <Chip tone="warn">Staging</Chip>,
  local: <Chip>Local</Chip>,
};

type SavedTableProps = {
  connections: Connection[];
  onEdit: (connection: Connection) => void;
  onRemove: (connection: Connection) => void;
};

export function SavedTable({ connections, onEdit, onRemove }: SavedTableProps) {
  const menu = useConnectionMenu({ edit: onEdit, remove: onRemove });
  return (
    <table className={tableClass}>
      <Head fourth="Environment" last="Actions" />
      <tbody>
        {connections.map((connection) => (
          <ContextMenu key={connection.id} entries={menu(connection)}>
            <tr className={clsx("group/row", rowClass)}>
              <td>
                <NameCell
                  logo={<Tile logo={engineLogo(connection.engine, connection.provider)} />}
                  name={connection.name}
                  line={
                    connection.engine === "sqlite"
                      ? "Local file"
                      : (connection.provider ??
                        connection.database ??
                        engineLabel(connection.engine))
                  }
                />
              </td>
              <td>{engineLabel(connection.engine)}</td>
              <td className="truncate font-mono text-mono-12 text-ink-3">{address(connection)}</td>
              <td>{ENVIRONMENT[connection.environment]}</td>
              <td className="text-right">
                <span className="inline-flex items-center gap-1">
                  <Menu entries={menu(connection)} align="end">
                    <Button
                      variant="ghost"
                      size="sm"
                      iconOnly
                      aria-label={`More for ${connection.name}`}
                      className="text-ink-3"
                    >
                      <IconDots />
                    </Button>
                  </Menu>
                  <OpenLink id={connection.id}>Open</OpenLink>
                </span>
              </td>
            </tr>
          </ContextMenu>
        ))}
      </tbody>
    </table>
  );
}
