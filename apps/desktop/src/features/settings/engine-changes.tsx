import { IconRefresh } from "@tabler/icons-react";

import { useEngineControl } from "@/features/engine/api";
import { Banner } from "@/ui/banner";
import { Button } from "@/ui/button";

import { sizeOutOfDate } from "./model";
import { useEngineDraft } from "./use-engine-draft";

/** Unsaved edits get Save and Discard; saved ones that need a restart get Restart. */
export function EngineChanges() {
  const engine = useEngineDraft();
  const control = useEngineControl();
  if (engine.changes.length > 0) {
    return (
      <div className="sticky bottom-4 z-10 mt-5 flex items-center gap-2 rounded-[10px] bg-[light-dark(oklch(0.995_0_0/0.9),oklch(0.28_0.005_255/0.92))] py-2 pr-2 pl-3.5 shadow-3 backdrop-blur-xl">
        <span className="min-w-0 flex-1 text-13 text-ink-2">
          Not saved: {engine.changes.join(", ")}
        </span>
        <Button variant="ghost" size="sm" onClick={engine.discard}>
          Discard
        </Button>
        <Button variant="brand" size="sm" loading={engine.saving} onClick={engine.save}>
          Save
        </Button>
      </div>
    );
  }
  const running = engine.status?.phase === "running";
  if (!(engine.savedSinceStart || sizeOutOfDate(engine.status))) {
    return null;
  }
  if (!running) {
    return (
      <Banner tone="brand" className="mt-5">
        Saved. The engine uses these settings the next time it starts.
      </Banner>
    );
  }
  return (
    <Banner
      tone="brand"
      className="mt-5"
      icon={<IconRefresh aria-hidden />}
      action={
        <Button
          size="sm"
          loading={control.isPending}
          onClick={() => control.mutate("restart", { onSuccess: engine.clearSaved })}
        >
          Restart engine
        </Button>
      }
    >
      Saved. Restart the engine to apply the new settings. Running containers stop and start again.
    </Banner>
  );
}
