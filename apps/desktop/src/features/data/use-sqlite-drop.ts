import { useNavigate } from "@tanstack/react-router";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useEffect, useEffectEvent, useState } from "react";

import { useSaveConnection } from "./api";

const DATABASE_FILE = /\.(sqlite3?|db3?)$/i;

/** The first database file in a drop, if there is one. */
function databaseFile(paths: string[]): string | undefined {
  return paths.find((path) => DATABASE_FILE.test(path));
}

/**
 * Opens a SQLite file dropped on the window: saves it as a local connection and goes to it. Says
 * whether a file is being dragged over, for the drop zone.
 */
export function useSqliteDrop(): boolean {
  const navigate = useNavigate();
  const save = useSaveConnection();
  const [dragging, setDragging] = useState(false);
  const dropped = useEffectEvent((paths: string[]) => {
    const file = databaseFile(paths);
    if (!file) {
      return;
    }
    const name = file.split("/").at(-1)?.replace(DATABASE_FILE, "") ?? "database";
    save.mutate(
      {
        id: null,
        name,
        engine: "sqlite",
        host: "",
        port: null,
        user: null,
        database: null,
        file,
        tls: false,
        environment: "local",
        password: null,
      },
      {
        onSuccess: (connection) =>
          navigate({ to: "/data/$connection", params: { connection: connection.id } }).catch(
            () => undefined,
          ),
      },
    );
  });
  useEffect(() => {
    let stop: (() => void) | undefined;
    let active = true;
    getCurrentWebview()
      .onDragDropEvent(({ payload }) => {
        setDragging(payload.type === "enter" || payload.type === "over");
        if (payload.type === "drop") {
          dropped(payload.paths);
        }
      })
      .then((unlisten) => {
        stop = unlisten;
        if (!active) {
          unlisten();
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
      stop?.();
    };
  }, []);
  return dragging;
}
