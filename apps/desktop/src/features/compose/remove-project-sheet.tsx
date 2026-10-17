import { useState } from "react";

import { Button } from "@/ui/button";
import { Checkbox } from "@/ui/checkbox";
import { Sheet } from "@/ui/sheet";

type RemoveSheetProps = {
  project: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRemove: (volumes: boolean) => void;
};

export function RemoveProjectSheet({ project, open, onOpenChange, onRemove }: RemoveSheetProps) {
  const [volumes, setVolumes] = useState(false);
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={`Remove ${project}?`}
      description="Its containers and networks are deleted. Images and the Compose file stay."
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant="danger"
            onClick={() => {
              onOpenChange(false);
              onRemove(volumes);
            }}
          >
            Remove Project
          </Button>
        </>
      }
    >
      <span className="flex items-center gap-2 text-13 text-ink">
        <Checkbox checked={volumes} onCheckedChange={setVolumes} label="Also delete its volumes" />
        Also delete its volumes, and the data in them
      </span>
    </Sheet>
  );
}
