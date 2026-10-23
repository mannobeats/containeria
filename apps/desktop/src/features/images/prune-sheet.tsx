import { useState } from "react";

import { formatBytes } from "@/lib/format";
import { Button } from "@/ui/button";
import { Segmented } from "@/ui/segmented";
import { Sheet } from "@/ui/sheet";

import { usePruneImages } from "./api";
import type { ImageStats } from "./model";

type Scope = "dangling" | "unused";

type PruneSheetProps = { open: boolean; onOpenChange: (open: boolean) => void; stats: ImageStats };

/** Frees disk the engine holds for images nothing runs. */
export function PruneSheet({ open, onOpenChange, stats }: PruneSheetProps) {
  const [scope, setScope] = useState<Scope>("unused");
  const prune = usePruneImages();
  const bytes = stats.dangling.bytes + (scope === "unused" ? stats.unused.bytes : 0);
  const count = stats.dangling.count + (scope === "unused" ? stats.unused.count : 0);
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={`Clean up ${formatBytes(bytes)}?`}
      description="Deleted images can be pulled again later. Images a container uses, running or stopped, are kept."
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant="danger"
            disabled={count === 0}
            loading={prune.isPending}
            onClick={() =>
              prune.mutate(scope === "unused", { onSuccess: () => onOpenChange(false) })
            }
          >
            Delete {count} {count === 1 ? "image" : "images"}
          </Button>
        </>
      }
    >
      <Segmented
        label="What to delete"
        value={scope}
        onChange={setScope}
        options={[
          {
            value: "unused",
            label: "Everything unused",
            count: stats.dangling.count + stats.unused.count,
          },
          { value: "dangling", label: "Dangling layers only", count: stats.dangling.count },
        ]}
      />
    </Sheet>
  );
}
