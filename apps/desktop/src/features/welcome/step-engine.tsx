import { IconCircleCheck, IconPlayerPlay } from "@tabler/icons-react";

import { isServing, useEngineControl, useEngineStatus } from "@/features/engine/api";
import { errorMessage } from "@/lib/ipc/errors";
import { Banner } from "@/ui/banner";
import { Button } from "@/ui/button";
import { Progress } from "@/ui/progress";

/** Creates the engine, and says why when it doesn't start. */
export function StepEngine({ onDone }: { onDone: () => void }) {
  const { data: status } = useEngineStatus();
  const control = useEngineControl();
  const ready = isServing(status?.phase);
  return (
    <>
      <h1 className="m-0 text-24 font-semibold tracking-[-0.016em] text-ink">Create the engine</h1>
      <p className="m-0 mt-2 mb-6 text-14 text-ink-2">
        Contena runs Docker in a small Linux VM of its own. It starts in about a second, and turns
        itself off again when nothing runs in it.
      </p>
      {ready ? (
        <Banner tone="ok" icon={<IconCircleCheck aria-hidden />}>
          The engine is running.
        </Banner>
      ) : null}
      {control.isPending ? <Progress label="Creating the engine" /> : null}
      {control.isError ? <Banner tone="bad">{errorMessage(control.error)}</Banner> : null}
      <div className="mt-8 flex justify-end gap-2">
        {ready ? (
          <Button variant="brand" size="lg" onClick={onDone}>
            Continue
          </Button>
        ) : (
          <Button
            variant="brand"
            size="lg"
            loading={control.isPending}
            onClick={() => control.mutate("start", { onSuccess: onDone })}
          >
            <IconPlayerPlay />
            {control.isError ? "Try again" : "Create engine"}
          </Button>
        )}
      </div>
    </>
  );
}
