import { useEffect, useRef } from "react";

import { Button } from "@/ui/button";
import { Progress } from "@/ui/progress";
import { Sheet } from "@/ui/sheet";

import { type ComposeRun, type OutputLine, useCompose } from "./store";

function Output({ lines }: { lines: OutputLine[] }) {
  const log = useRef<HTMLDivElement>(null);
  const last = lines.at(-1)?.id ?? 0;
  useEffect(() => {
    const element = log.current;
    if (element && last > 0) {
      element.scrollTop = element.scrollHeight;
    }
  }, [last]);
  return (
    <div
      ref={log}
      role="log"
      aria-label="Compose output"
      className="selectable h-[280px] overflow-auto rounded-md bg-term-bg px-3 py-2 font-mono text-mono-12 leading-[1.55] text-term-fg"
    >
      {lines.length === 0 ? <p className="m-0 opacity-60">Starting Compose…</p> : null}
      {lines.map((line) => (
        <p key={line.id} className="m-0 break-all whitespace-pre-wrap">
          {line.text}
        </p>
      ))}
    </div>
  );
}

function Footer({ run }: { run: ComposeRun }) {
  const hideRun = useCompose((state) => state.hideRun);
  const edit = useCompose((state) => state.edit);
  if (run.status === "running") {
    return <Button onClick={hideRun}>Hide</Button>;
  }
  const draft = run.draft;
  return (
    <>
      {run.status === "failed" && draft ? (
        <Button
          onClick={() => {
            hideRun();
            edit(draft);
          }}
        >
          Edit File
        </Button>
      ) : null}
      <Button variant="brand" onClick={hideRun}>
        Done
      </Button>
    </>
  );
}

function status(run: ComposeRun): string {
  if (run.status === "running") {
    return "Compose is working. Hide this and it carries on.";
  }
  return run.status === "done" ? run.done : (run.message ?? "Compose failed");
}

/** Compose's own output while it deploys, rebuilds or removes a project. */
export function ComposeRunSheet() {
  const run = useCompose((state) => state.run);
  const visible = useCompose((state) => state.runVisible);
  const hideRun = useCompose((state) => state.hideRun);
  if (!run) {
    return null;
  }
  return (
    <Sheet
      open={visible}
      onOpenChange={(next) => (next ? undefined : hideRun())}
      title={run.title}
      description={
        <span className={run.status === "failed" ? "text-bad-ink" : undefined}>{status(run)}</span>
      }
      width="lg"
      footer={<Footer run={run} />}
    >
      {run.status === "running" ? <Progress label={run.title} className="mb-3" /> : null}
      <Output lines={run.lines} />
    </Sheet>
  );
}
