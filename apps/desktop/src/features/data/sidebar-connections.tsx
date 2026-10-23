import { IconLock } from "@tabler/icons-react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import type { Connection } from "@/lib/ipc/bindings";
import { navItemClass } from "@/shell/nav-item-class";
import { ContextMenu } from "@/ui/menu";
import { Tile } from "@/ui/tile";
import { Tip } from "@/ui/tooltip";

import { useConnections } from "./api";
import { useConnectionSheet } from "./connection-sheet-store";
import { engineLogo } from "./engines";
import { RemoveConnectionSheet } from "./remove-connection-sheet";
import { useConnectionMenu } from "./use-connection-menu";

/** The first saved connections, one click from the sidebar. */
export function SidebarConnections() {
  const { data: connections = [] } = useConnections();
  const navigate = useNavigate();
  const [removing, setRemoving] = useState<Connection | null>(null);
  const menu = useConnectionMenu({
    edit: (connection) =>
      navigate({ to: "/data" })
        .then(() => useConnectionSheet.getState().show(connection))
        .catch(() => undefined),
    remove: setRemoving,
  });
  return (
    <>
      {connections.slice(0, 5).map((connection) => (
        <ContextMenu key={connection.id} entries={menu(connection)}>
          <Link
            to="/data/$connection"
            params={{ connection: connection.id }}
            className={navItemClass}
          >
            <Tile
              logo={engineLogo(connection.engine, connection.provider)}
              icon="data"
              className="size-4 rounded-none bg-transparent shadow-none [&>img]:size-full"
            />
            <span className="truncate">{connection.name}</span>
            {connection.environment === "production" ? (
              <Tip label="Production, read-only">
                <IconLock className="ml-auto size-3.5 text-ink-3" aria-label="Production" />
              </Tip>
            ) : null}
          </Link>
        </ContextMenu>
      ))}
      <RemoveConnectionSheet removing={removing} onDone={() => setRemoving(null)} />
    </>
  );
}
