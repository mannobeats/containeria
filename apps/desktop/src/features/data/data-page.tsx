import { IconFileDatabase, IconPlus } from "@tabler/icons-react";
import { useState } from "react";

import type { Connection } from "@/lib/ipc/bindings";
import { Crumb, Page } from "@/shell/page";
import { Button } from "@/ui/button";
import { ConfirmSheet } from "@/ui/confirm-sheet";
import { EmptyState } from "@/ui/empty-state";
import { SearchField } from "@/ui/search-field";
import { Tile } from "@/ui/tile";

import {
  useConnections,
  useDetected,
  useHistory,
  useRemoveConnection,
  useSavedQueries,
} from "./api";
import { ConnectionSheet } from "./connection-sheet";
import { DetectedTable, SavedTable } from "./connection-tables";
import { QueryRail } from "./query-rail";
import { useSqliteDrop } from "./use-sqlite-drop";

function Section({
  title,
  note,
  children,
}: {
  title: string;
  note: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-8">
      <div className="flex items-baseline gap-3 px-5 pt-1 pb-2.5">
        <h2 className="m-0 text-14 font-semibold text-ink">{title}</h2>
        <span className="text-12 text-ink-3">{note}</span>
      </div>
      {children}
    </section>
  );
}

const matchesQuery = (query: string, ...fields: (string | null)[]) =>
  query.trim() === "" ||
  fields.some((field) => field?.toLowerCase().includes(query.trim().toLowerCase()));

type ConnectionsProps = {
  query: string;
  onNew: () => void;
  onEdit: (connection: Connection) => void;
  onRemove: (connection: Connection) => void;
};

/** Databases found in containers and saved ones, beside recent and saved queries. */
function Connections({ query, onNew, onEdit, onRemove }: ConnectionsProps) {
  const connections = useConnections();
  const detected = useDetected();
  const { data: history = [] } = useHistory();
  const { data: saved = [] } = useSavedQueries();
  if (!(connections.data && detected.data)) {
    return null;
  }
  if (connections.data.length === 0 && detected.data.length === 0) {
    return (
      <EmptyState
        art={<Tile icon="data" size="xl" />}
        title="No databases yet"
        actions={<Button onClick={onNew}>New connection</Button>}
      >
        Databases running in your containers appear here on their own. Add any other with a
        connection string.
      </EmptyState>
    );
  }
  const shownDetected = detected.data.filter((found) =>
    matchesQuery(query, found.containerName, found.engine, found.image),
  );
  const shownSaved = connections.data.filter((connection) =>
    matchesQuery(query, connection.name, connection.engine, connection.provider),
  );
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_300px] gap-8 pr-5 pb-10 max-[1180px]:grid-cols-1">
      <div className="min-w-0">
        <Section
          title="In your containers"
          note="Found automatically. Credentials come from each container's environment."
        >
          {shownDetected.length > 0 ? (
            <DetectedTable detected={shownDetected} />
          ) : (
            <p className="m-0 px-5 text-13 text-ink-3">No database containers are running.</p>
          )}
        </Section>
        <Section title="Saved connections" note="Passwords are stored in your macOS Keychain.">
          <SavedTable connections={shownSaved} onEdit={onEdit} onRemove={onRemove} />
          <p className="mx-5 mt-3 flex items-center gap-2 rounded-md border border-dashed border-line-strong px-3 py-2.5 text-12 text-ink-3">
            <IconFileDatabase aria-hidden />
            Drop a .sqlite or .db file anywhere here to open it.
          </p>
        </Section>
      </div>
      <div className="max-[1180px]:px-5">
        <QueryRail history={history} saved={saved} />
      </div>
    </div>
  );
}

function RemoveSheet({ removing, onDone }: { removing: Connection | null; onDone: () => void }) {
  const remove = useRemoveConnection();
  return (
    <ConfirmSheet
      open={removing !== null}
      onOpenChange={(open) => (open ? undefined : onDone())}
      title={`Remove ${removing?.name ?? "connection"}?`}
      action="Remove connection"
      onConfirm={() => {
        if (removing) {
          remove.mutate(removing.id);
        }
        onDone();
      }}
    >
      The saved connection and its Keychain password are removed. The database itself is not
      touched.
    </ConfirmSheet>
  );
}

/** All connections: databases found in containers, saved ones, and recent and saved queries. */
export function DataPage() {
  const [query, setQuery] = useState("");
  const [sheet, setSheet] = useState<{ open: boolean; connection?: Connection | undefined }>({
    open: false,
  });
  const [removing, setRemoving] = useState<Connection | null>(null);
  const dropping = useSqliteDrop();
  return (
    <Page crumbs={<Crumb>Data</Crumb>}>
      <div className="relative min-h-full">
        <div className="flex items-center gap-3 px-5 pt-[18px] pb-3.5">
          <h1 className="m-0 mr-auto text-20 font-semibold tracking-[-0.012em] text-ink">Data</h1>
          <SearchField
            value={query}
            onChange={setQuery}
            placeholder="Filter connections"
            className="w-60"
          />
          <Button variant="brand" onClick={() => setSheet({ open: true })}>
            <IconPlus />
            New connection
          </Button>
        </div>
        <Connections
          query={query}
          onNew={() => setSheet({ open: true })}
          onEdit={(connection) => setSheet({ open: true, connection })}
          onRemove={setRemoving}
        />
        {dropping ? (
          <div className="absolute inset-3 z-10 flex flex-col items-center justify-center gap-2.5 rounded-lg border-2 border-dashed border-brand bg-brand-soft text-brand-ink animate-fade">
            <IconFileDatabase className="size-7" aria-hidden />
            <b>Drop to open the database file</b>
          </div>
        ) : null}
      </div>
      <ConnectionSheet
        key={sheet.connection?.id ?? "new"}
        open={sheet.open}
        connection={sheet.connection}
        onOpenChange={(open) => setSheet({ ...sheet, open })}
      />
      <RemoveSheet removing={removing} onDone={() => setRemoving(null)} />
    </Page>
  );
}
