import { IconLock } from "@tabler/icons-react";
import { Link } from "@tanstack/react-router";

import { navItemClass } from "@/shell/nav-item-class";
import { Tile } from "@/ui/tile";
import { Tip } from "@/ui/tooltip";

import { useConnections } from "./api";
import { engineLogo } from "./engines";

/** The first saved connections, one click from the sidebar. */
export function SidebarConnections() {
  const { data: connections = [] } = useConnections();
  return connections.slice(0, 5).map((connection) => (
    <Link
      key={connection.id}
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
  ));
}
