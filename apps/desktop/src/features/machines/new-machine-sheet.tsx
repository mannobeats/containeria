import { useNavigate } from "@tanstack/react-router";
import { useId, useState } from "react";

import type { Distro } from "@/lib/ipc/bindings";
import { Button } from "@/ui/button";
import { Field, Input } from "@/ui/field";
import { Select } from "@/ui/select";
import { Sheet } from "@/ui/sheet";
import { Switch } from "@/ui/switch";

import { useCreateMachine, useDistros } from "./api";
import { DistroPicker } from "./distro-picker";
import { useNewMachineForm } from "./use-new-machine-form";

const CPUS = ["1", "2", "4", "8"].map((value) => ({
  value,
  label: value === "1" ? "1 CPU" : `${value} CPUs`,
}));
const MEMORY = ["1", "2", "4", "8", "16"].map((value) => ({ value, label: `${value} GB` }));

type Form = ReturnType<typeof useNewMachineForm>;

function Options({ form, distro }: { form: Form; distro: Distro }) {
  const ids = useId();
  const releases = distro.releases.map((release) => ({
    value: release.alias,
    label: release.label,
  }));
  return (
    <div className="grid grid-cols-2 items-start gap-4">
      <Field label="Version" htmlFor={`${ids}-release`}>
        <Select
          id={`${ids}-release`}
          label="Version"
          value={form.request.release}
          options={releases}
          onChange={form.setRelease}
        />
      </Field>
      <Field
        label="Name"
        htmlFor={`${ids}-name`}
        error={form.problem ?? undefined}
        hint="Also its host name"
      >
        <Input
          id={`${ids}-name`}
          value={form.request.name}
          onChange={(event) => form.setName(event.target.value)}
          aria-invalid={form.problem !== null}
          spellCheck={false}
          className="font-mono text-mono-13"
        />
      </Field>
      <Field label="CPUs" htmlFor={`${ids}-cpus`}>
        <Select
          id={`${ids}-cpus`}
          label="CPUs"
          value={form.cpus}
          options={CPUS}
          onChange={form.setCpus}
        />
      </Field>
      <Field
        label="Memory"
        htmlFor={`${ids}-memory`}
        hint="A limit; unused memory stays with the VM"
      >
        <Select
          id={`${ids}-memory`}
          label="Memory"
          value={form.memoryGib}
          options={MEMORY}
          onChange={form.setMemoryGib}
        />
      </Field>
    </div>
  );
}

type NewMachineSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  taken: string[];
};

export function NewMachineSheet({ open, onOpenChange, taken }: NewMachineSheetProps) {
  const { data: distros = [] } = useDistros();
  const navigate = useNavigate();
  const [step, setStep] = useState("");
  const create = useCreateMachine(setStep);
  const form = useNewMachineForm(distros, taken);
  const submit = () =>
    create.mutate(form.request, {
      onSuccess: () => {
        onOpenChange(false);
        form.reset();
        navigate({
          to: "/machines/$name",
          params: { name: form.request.name },
          search: { tab: "terminal" },
        }).catch(() => undefined);
      },
    });
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="New Linux machine"
      width="lg"
      footer={
        <>
          <span className="mr-auto truncate text-12 text-ink-3">
            {create.isPending
              ? step || "Starting…"
              : "Downloads the image once, then starts in seconds."}
          </span>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant="brand"
            loading={create.isPending}
            disabled={form.problem !== null || form.request.release === ""}
            onClick={submit}
          >
            Create machine
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <DistroPicker distros={distros} value={form.request.distro} onChange={form.pickDistro} />
        {form.distro ? <Options form={form} distro={form.distro} /> : null}
        <div className="flex items-center gap-2.5 text-13 text-ink">
          <Switch
            checked={form.request.mountHome}
            onCheckedChange={form.setMountHome}
            label="Mount my Mac home folder"
          />
          Mount my Mac home folder{" "}
          <span className="text-12 text-ink-3">read and write, at the same path</span>
        </div>
      </div>
    </Sheet>
  );
}
