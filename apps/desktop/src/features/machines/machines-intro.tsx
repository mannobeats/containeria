import { IconPlus } from "@tabler/icons-react";

import { Button } from "@/ui/button";
import { EmptyState } from "@/ui/empty-state";
import { Tile } from "@/ui/tile";

/** What the area shows before the first machine: what a machine is, and how to make one. */
export function MachinesIntro({ onNew }: { onNew: () => void }) {
  return (
    <EmptyState
      art={<Tile icon="machine" size="xl" />}
      title="No Linux machines yet"
      className="h-full"
      actions={
        <Button variant="brand" size="lg" onClick={onNew}>
          <IconPlus />
          New machine
        </Button>
      }
    >
      A full Ubuntu, Debian, Fedora or Alpine system with its own services, your user and your Mac's
      files. Machines run in the engine beside your containers, so they add no VM of their own.
    </EmptyState>
  );
}
