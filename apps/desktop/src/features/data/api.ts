import {
  keepPreviousData,
  type QueryClient,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Channel } from "@tauri-apps/api/core";
import { toast } from "sonner";

import {
  type ChangeSet,
  type ConnectionInput,
  commands,
  type ExportFormat,
  type HostKey,
  type ImportedRows,
  type ImportOptions,
  type ImportRequest,
  type RowsRequest,
  type SavedQuery,
  type ServerInfo,
  type SshTunnel,
  type TableRef,
} from "@/lib/ipc/bindings";
import { errorMessage } from "@/lib/ipc/errors";

export const dataKeys = {
  all: ["data"],
  connections: ["data", "connections"],
  detected: ["data", "detected"],
  history: ["data", "history"],
  saved: ["data", "saved"],
  session: (id: string) => ["data", "session", id],
  schema: (id: string) => ["data", "schema", id],
  rows: (id: string, request: RowsRequest) => ["data", "rows", id, request],
  importPreview: (path: string, options: ImportOptions) => ["data", "import", path, options],
  redisKeys: (id: string, pattern: string) => ["data", "redis", id, pattern],
  redisValue: (id: string, key: string) => ["data", "redis-value", id, key],
  hostKey: (ssh: SshTunnel) => ["data", "host-key", ssh],
} as const;

export function useConnections() {
  return useQuery({ queryKey: dataKeys.connections, queryFn: commands.dataConnections });
}

export function useDetected() {
  return useQuery({
    queryKey: dataKeys.detected,
    queryFn: commands.dataDetected,
    refetchInterval: 15_000,
  });
}

/** Connects once and keeps the session; the result says what the database can do. */
export function useSession(id: string) {
  return useQuery({
    queryKey: dataKeys.session(id),
    queryFn: () => commands.dataConnect(id),
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
  });
}

export function useSchema(id: string, enabled: boolean) {
  return useQuery({
    queryKey: dataKeys.schema(id),
    queryFn: () => commands.dataSchema(id, false),
    enabled,
    staleTime: Number.POSITIVE_INFINITY,
  });
}

export function useRefreshSchema(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => commands.dataSchema(id, true),
    onSuccess: (schema) => {
      client.setQueryData(dataKeys.schema(id), schema);
      return client.invalidateQueries({ queryKey: ["data", "rows", id] });
    },
    onError: (error) =>
      toast.error("Couldn't read the schema", { description: errorMessage(error) }),
  });
}

export function useRows(id: string, request: RowsRequest | null) {
  return useQuery({
    queryKey: request ? dataKeys.rows(id, request) : ["data", "rows", id, "none"],
    queryFn: () =>
      request ? commands.dataRows(id, request) : Promise.reject(new Error("No table")),
    enabled: request !== null,
    placeholderData: keepPreviousData,
  });
}

/** Drops what was read through a connection, so an edited or removed one never shows stale data. */
function forgetConnection(client: QueryClient, id: string) {
  for (const scope of ["session", "schema", "rows", "redis", "redis-value"]) {
    client.removeQueries({ queryKey: ["data", scope, id] });
  }
}

export function useSaveConnection() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: ConnectionInput) => commands.dataSaveConnection(input),
    onSuccess: (connection) => {
      forgetConnection(client, connection.id);
      return client.invalidateQueries({ queryKey: dataKeys.connections });
    },
    onError: (error) =>
      toast.error("The connection wasn't saved", { description: errorMessage(error) }),
  });
}

export function useRemoveConnection() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => commands.dataRemoveConnection(id),
    onSuccess: (_, id) => {
      forgetConnection(client, id);
      return client.invalidateQueries({ queryKey: dataKeys.connections });
    },
    onError: (error) =>
      toast.error("The connection wasn't removed", { description: errorMessage(error) }),
  });
}

export function useTestConnection() {
  return useMutation({
    mutationFn: (input: ConnectionInput) => commands.dataTestConnection(input),
  });
}

/** The key an SSH server offers, read fresh each time so a stale fingerprint is never trusted. */
export function useSshHostKey(ssh: SshTunnel) {
  return useQuery({
    queryKey: dataKeys.hostKey(ssh),
    queryFn: () => commands.dataSshHostKey(ssh),
    gcTime: 0,
  });
}

export function useTrustHostKey() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (key: HostKey) => commands.dataTrustHostKey(key),
    onSuccess: () => client.invalidateQueries({ queryKey: ["data", "host-key"] }),
    onError: (error) =>
      toast.error("The SSH key wasn't trusted", { description: errorMessage(error) }),
  });
}

export function useCommit(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (changes: ChangeSet) => commands.dataCommit(id, changes),
    onSuccess: () => client.invalidateQueries({ queryKey: ["data", "rows", id] }),
  });
}

export function usePreview(id: string) {
  return useMutation({
    mutationFn: (changes: ChangeSet) => commands.dataPreviewChanges(id, changes),
  });
}

/** Safe mode on or off; the session's read-only flag updates from the answer. */
export function useWrites(id: string) {
  const client = useQueryClient();
  const settle = (info: ServerInfo) => client.setQueryData(dataKeys.session(id), info);
  const allow = useMutation({
    mutationFn: (minutes: number) => commands.dataAllowWrites(id, minutes),
    onSuccess: settle,
    onError: (error) => toast.error("Writes weren't allowed", { description: errorMessage(error) }),
  });
  const protect = useMutation({
    mutationFn: () => commands.dataSafeMode(id),
    onSuccess: settle,
    onError: (error) =>
      toast.error("Safe mode didn't turn on", { description: errorMessage(error) }),
  });
  return { allow, protect };
}

export function useRunQuery(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ sql, runId }: { sql: string; runId: string }) =>
      commands.dataRun(id, sql, runId),
    onSettled: () => client.invalidateQueries({ queryKey: dataKeys.history }),
  });
}

export function useCancelQuery() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (runId: string) => commands.dataCancel(runId),
    onSettled: () => client.invalidateQueries({ queryKey: dataKeys.history }),
  });
}

export function useHistory() {
  return useQuery({ queryKey: dataKeys.history, queryFn: commands.dataHistory });
}

export function useSavedQueries() {
  return useQuery({ queryKey: dataKeys.saved, queryFn: commands.dataSavedQueries });
}

export function useSaveQuery() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (query: SavedQuery) => commands.dataSaveQuery(query),
    onSuccess: (query) => {
      toast.success(`Saved “${query.name}”`);
      return client.invalidateQueries({ queryKey: dataKeys.saved });
    },
    onError: (error) => toast.error("The query wasn't saved", { description: errorMessage(error) }),
  });
}

export function useDeleteQuery() {
  const client = useQueryClient();
  const restore = useSaveQuery();
  return useMutation({
    mutationFn: (query: SavedQuery) => commands.dataDeleteQuery(query.id),
    onSuccess: (_, query) => {
      toast.success(`Deleted “${query.name}”`, {
        action: { label: "Undo", onClick: () => restore.mutate(query) },
      });
      return client.invalidateQueries({ queryKey: dataKeys.saved });
    },
    onError: (error) =>
      toast.error("The query wasn't deleted", { description: errorMessage(error) }),
  });
}

export function useExport(id: string) {
  return useMutation({
    mutationFn: ({
      request,
      format,
      path,
    }: {
      request: RowsRequest;
      format: ExportFormat;
      path: string;
    }) => commands.dataExport(id, request, format, path),
    onSuccess: (rows, { path }) =>
      toast.success(`Exported ${rows.toLocaleString("en-US")} rows`, { description: path }),
    onError: (error) => toast.error("The export failed", { description: errorMessage(error) }),
  });
}

/** The columns and first rows of a file about to be imported. */
export function useImportPreview(path: string, options: ImportOptions) {
  return useQuery({
    queryKey: dataKeys.importPreview(path, options),
    queryFn: () => commands.dataImportPreview(path, options),
    placeholderData: keepPreviousData,
  });
}

/** Imports a file into a table in one transaction, reporting each batch to `onProgress`. */
export function useImport(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      request,
      onProgress,
    }: {
      request: ImportRequest;
      onProgress: (step: ImportedRows) => void;
    }) => commands.dataImport(id, request, new Channel<ImportedRows>(onProgress)),
    onSuccess: (rows, { request }) => {
      toast.success(`Imported ${rows.toLocaleString("en-US")} rows into ${request.table.name}`);
      return commands
        .dataSchema(id, true)
        .then((schema) => {
          client.setQueryData(dataKeys.schema(id), schema);
          return client.invalidateQueries({ queryKey: ["data", "rows", id] });
        })
        .catch(() => undefined);
    },
  });
}

type TableChange = {
  run: (table: TableRef) => ReturnType<typeof commands.dataTruncate>;
  done: string;
  failed: string;
};

/** A change to a whole table: the command answers with the new schema, so rows refetch after it. */
function useTableChange(id: string, { run, done, failed }: TableChange) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: (schema, table) => {
      toast.success(`${done} ${table.name}`);
      client.setQueryData(dataKeys.schema(id), schema);
      return client.invalidateQueries({ queryKey: ["data", "rows", id] });
    },
    onError: (error) => toast.error(failed, { description: errorMessage(error) }),
  });
}

export function useTruncateTable(id: string) {
  return useTableChange(id, {
    run: (table) => commands.dataTruncate(id, table),
    done: "Emptied",
    failed: "The table wasn't emptied",
  });
}

export function useDropTable(id: string) {
  return useTableChange(id, {
    run: (table) => commands.dataDropTable(id, table),
    done: "Dropped",
    failed: "The table wasn't dropped",
  });
}

/** Keys matching a pattern, a SCAN page at a time. */
export function useRedisKeys(id: string, pattern: string) {
  return useInfiniteQuery({
    queryKey: dataKeys.redisKeys(id, pattern),
    queryFn: ({ pageParam }) => commands.dataRedisKeys(id, pattern, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.cursor,
  });
}

export function useRedisValue(id: string, key: string) {
  return useQuery({
    queryKey: dataKeys.redisValue(id, key),
    queryFn: () => commands.dataRedisValue(id, key),
  });
}

export function useDeleteRedisKey(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (key: string) => commands.dataRedisDelete(id, key),
    onSuccess: (_, key) => {
      toast.success(`Deleted ${key}`);
      return client.invalidateQueries({ queryKey: ["data", "redis", id] });
    },
    onError: (error) => toast.error("The key wasn't deleted", { description: errorMessage(error) }),
  });
}
