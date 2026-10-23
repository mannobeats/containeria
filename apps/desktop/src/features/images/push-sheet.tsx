import { startRun } from "@/features/compose/store";
import { commands } from "@/lib/ipc/bindings";
import { Button } from "@/ui/button";
import { Sheet } from "@/ui/sheet";

import { registryOf } from "./build-model";

type PushSheetProps = { reference: string | null; onClose: () => void };

/** Asks before an image leaves the Mac: pushing publishes it to a registry. */
export function PushSheet({ reference, onClose }: PushSheetProps) {
  return (
    <Sheet
      open={reference !== null}
      onOpenChange={(next) => (next ? undefined : onClose())}
      title={`Push ${reference ?? ""}?`}
      description={
        <>
          It's uploaded to <b>{reference ? registryOf(reference) : ""}</b> with the login saved by{" "}
          <code className="font-mono text-mono-12">docker login</code>. Anyone with access to that
          repository can pull it.
        </>
      }
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="brand"
            onClick={() => {
              onClose();
              if (reference) {
                startRun({
                  title: `Pushing ${reference}`,
                  done: `Pushed ${reference}`,
                  start: (channel) => commands.imagePush(reference, channel),
                });
              }
            }}
          >
            Push
          </Button>
        </>
      }
    />
  );
}
