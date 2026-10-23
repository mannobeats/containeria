import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { toast } from "sonner";

import { type CliTool, commands } from "@/lib/ipc/bindings";
import { errorMessage, isCommandError } from "@/lib/ipc/errors";
import { Button } from "@/ui/button";
import { Checkbox } from "@/ui/checkbox";
import { Chip } from "@/ui/chip";
import { Field, Input } from "@/ui/field";
import { Sheet } from "@/ui/sheet";

import { SettingsRow, SettingsSection } from "./settings-section";

const TOOLS_KEY = ["settings", "cli-tools"];

const STATES: Record<CliTool["state"], { label: string; tone: "ok" | "neutral" | "line" }> = {
  installed: { label: "Installed", tone: "ok" },
  missing: { label: "Not installed", tone: "neutral" },
  other: { label: "Your own copy", tone: "line" },
};

function useInstallTools() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: commands.cliToolsInstall,
    onSuccess: () => toast.success("Installed the command-line tools"),
    onError: (error) => {
      if (!(isCommandError(error) && error.kind === "cancelled")) {
        toast.error("The tools weren't installed", { description: errorMessage(error) });
      }
    },
    onSettled: () => client.invalidateQueries({ queryKey: TOOLS_KEY }),
  });
}

function CommandLineTools() {
  const { data: tools = [] } = useQuery({ queryKey: TOOLS_KEY, queryFn: commands.cliTools });
  const install = useInstallTools();
  const missing = tools.filter((tool) => tool.state === "missing").length;
  return (
    <SettingsSection
      title="Command-line tools"
      note="Linked into /usr/local after a macOS password prompt. A tool you installed yourself, with Homebrew or Docker Desktop, is never replaced."
    >
      {tools.map((tool) => (
        <SettingsRow
          key={tool.name}
          label={<span className="font-mono text-mono-13">{tool.name}</span>}
          hint={tool.target}
        >
          <Chip tone={STATES[tool.state].tone}>{STATES[tool.state].label}</Chip>
        </SettingsRow>
      ))}
      <SettingsRow
        label={missing > 0 ? `${missing} not installed` : "Everything is installed"}
        hint="cx starts, stops and tails containers from any terminal; docker and kubectl reach Containeria's engine once its context is chosen."
      >
        <Button
          size="sm"
          disabled={missing === 0}
          loading={install.isPending}
          onClick={() => install.mutate()}
        >
          Install…
        </Button>
      </SettingsRow>
    </SettingsSection>
  );
}

function ResetSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const id = useId();
  const [typed, setTyped] = useState("");
  const [machines, setMachines] = useState(false);
  const client = useQueryClient();
  const reset = useMutation({
    mutationFn: () => commands.engineReset(machines),
    onSuccess: () => {
      toast.success("The engine was reset", { description: "Start it to create a fresh one." });
      onClose();
    },
    onError: (error) =>
      toast.error("The engine wasn't reset", { description: errorMessage(error) }),
    onSettled: () => client.invalidateQueries(),
  });
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => (next ? undefined : onClose())}
      title="Reset the engine?"
      description="Every image, container, volume and the Kubernetes cluster are deleted. Settings stay, and the next start creates a fresh engine."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="danger"
            disabled={typed !== "reset"}
            loading={reset.isPending}
            onClick={() => reset.mutate()}
          >
            Reset Engine
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <span className="flex items-center gap-2 text-13 text-ink">
          <Checkbox
            checked={machines}
            onCheckedChange={setMachines}
            label="Also delete every Linux machine"
          />
          Also delete every Linux machine
        </span>
        <Field label='Type "reset" to confirm' htmlFor={id}>
          <Input
            id={id}
            value={typed}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setTyped(event.target.value)}
          />
        </Field>
      </div>
    </Sheet>
  );
}

function Reset() {
  const [open, setOpen] = useState(false);
  return (
    <SettingsSection title="Reset">
      <SettingsRow
        label="Reset the engine"
        hint="Deletes everything in the engine and starts over. Back up volumes you want to keep first."
      >
        <Button size="sm" variant="danger" onClick={() => setOpen(true)}>
          Reset Engine…
        </Button>
      </SettingsRow>
      <ResetSheet key={String(open)} open={open} onClose={() => setOpen(false)} />
    </SettingsSection>
  );
}

/** Rarely needed settings: the command-line tools and starting over. */
export function AdvancedPane() {
  return (
    <>
      <CommandLineTools />
      <Reset />
    </>
  );
}
