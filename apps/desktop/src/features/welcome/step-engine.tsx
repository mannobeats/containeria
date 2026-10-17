import { IconCircleCheck, IconPlayerPlay } from "@tabler/icons-react";

import { isServing, useBootLog, useEngineControl, useEngineStatus } from "@/features/engine/api";
import { Banner } from "@/ui/banner";
import { Button } from "@/ui/button";
import { Progress } from "@/ui/progress";

function BootLog() {
  const lines = useBootLog((state) => state.lines).slice(-6);
  return (
    <ol className="m-0 mt-4 list-none rounded-md bg-fill px-3 py-2.5 font-mono text-mono-12 leading-relaxed text-ink-2 select-text">
      {lines.map((line) => (
        <li key={line.id} className={line.level === "error" ? "text-bad-ink" : undefined}>
          {line.message}
        </li>
      ))}
    </ol>
  );
}

/** Creates the engine, showing Colima's own progress lines as they come. */
export function StepEngine({ onDone }: { onDone: () => void }) {
  const { data: status } = useEngineStatus();
  const control = useEngineControl();
  const ready = isServing(status?.phase);
  return (
    <>
      <h1 className="m-0 text-24 font-semibold tracking-[-0.016em] text-ink">Create the engine</h1>
      <p className="m-0 mt-2 mb-6 text-14 text-ink-2">
        Containeria sets up a small Linux VM with Docker. The first start downloads its disk image
        and takes about a minute.
      </p>
      {ready ? (
        <Banner tone="ok" icon={<IconCircleCheck aria-hidden />}>
          The engine is running.
        </Banner>
      ) : null}
      {control.isPending ? (
        <>
          <Progress label="Creating the engine" />
          <BootLog />
        </>
      ) : null}
      {control.isError ? <BootLog /> : null}
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
