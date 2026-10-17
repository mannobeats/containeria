import { IconLock, IconLockOpen } from "@tabler/icons-react";
import { useState } from "react";

import type { ServerInfo } from "@/lib/ipc/bindings";
import { Button } from "@/ui/button";
import { ConfirmSheet } from "@/ui/confirm-sheet";

import { useWrites } from "./api";

const time = (ms: number) =>
  new Date(ms).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

/** A production connection says it is read-only, and offers writes for 15 minutes. */
export function SafeBanner({ info }: { info: ServerInfo }) {
  const { allow, protect } = useWrites(info.id);
  const [asking, setAsking] = useState(false);
  if (info.environment !== "production") {
    return null;
  }
  if (!info.readOnly) {
    return (
      <div
        role="status"
        className="flex shrink-0 items-center gap-2.5 border-b-[0.5px] border-line bg-warn-soft py-[7px] pr-3 pl-4 text-13 text-warn-ink"
      >
        <IconLockOpen aria-hidden />
        <span>
          <b className="font-semibold">Writes allowed</b> until{" "}
          {time(info.writableUntilMs ?? Date.now())}. Commits run against production.
        </span>
        <Button size="sm" className="ml-auto" onClick={() => protect.mutate()}>
          Turn safe mode back on
        </Button>
      </div>
    );
  }
  return (
    <div
      role="status"
      className="flex shrink-0 items-center gap-2.5 border-b-[0.5px] border-line bg-bad-soft py-[7px] pr-3 pl-4 text-13 text-bad-ink"
    >
      <IconLock aria-hidden />
      <span>
        <b className="font-semibold">Production, read-only.</b> Safe mode blocks inserts, updates,
        deletes and DDL on {info.name}.
      </span>
      <Button size="sm" className="ml-auto" onClick={() => setAsking(true)}>
        Allow writes for 15 min
      </Button>
      <ConfirmSheet
        open={asking}
        onOpenChange={setAsking}
        title={`Allow writes to ${info.name} for 15 minutes?`}
        action="Allow writes"
        onConfirm={() => {
          allow.mutate(15);
          setAsking(false);
        }}
      >
        This is a production database. Every commit runs against live data. Safe mode turns back on
        by itself after 15 minutes.
      </ConfirmSheet>
    </div>
  );
}
