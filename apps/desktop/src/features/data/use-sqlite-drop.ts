import { useNavigate } from "@tanstack/react-router";
import { useFileDrop } from "@/lib/use-file-drop";

import { useSaveConnection } from "./api";

const DATABASE_FILE = /\.(sqlite3?|db3?)$/i;

function isDatabaseFile(path: string): boolean {
  return DATABASE_FILE.test(path);
}

/**
 * Opens a SQLite file dropped on the window: saves it as a local connection and goes to it. Says
 * whether a file is being dragged over, for the drop zone.
 */
export function useSqliteDrop(): boolean {
  const navigate = useNavigate();
  const save = useSaveConnection();
  return useFileDrop(isDatabaseFile, (file) => {
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
        ssh: null,
        sshSecret: null,
      },
      {
        onSuccess: (connection) =>
          navigate({ to: "/data/$connection", params: { connection: connection.id } }).catch(
            () => undefined,
          ),
      },
    );
  });
}
