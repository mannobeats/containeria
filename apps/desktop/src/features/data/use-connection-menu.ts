import { useNavigate } from "@tanstack/react-router";

import type { Connection } from "@/lib/ipc/bindings";

import { connectionMenu } from "./connection-menu";

type Handlers = {
  edit: (connection: Connection) => void;
  remove: (connection: Connection) => void;
};

/** A saved connection's menu, wherever it's listed: Open goes to its workspace. */
export function useConnectionMenu({ edit, remove }: Handlers) {
  const navigate = useNavigate();
  return (connection: Connection) =>
    connectionMenu(connection, {
      open: () =>
        navigate({ to: "/data/$connection", params: { connection: connection.id } }).catch(
          () => undefined,
        ),
      edit: () => edit(connection),
      remove: () => remove(connection),
    });
}
