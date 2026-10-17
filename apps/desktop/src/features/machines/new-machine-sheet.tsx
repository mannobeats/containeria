import { useNavigate } from "@tanstack/react-router";
import { useId, useState } from "react";

import type { Distro, MachineKind } from "@/lib/ipc/bindings";
import { Button } from "@/ui/button";
import { Field, Input } from "@/ui/field";
import { Segmented } from "@/ui/segmented";
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

function KindField({ form, supportsVms }: { form: Form; supportsVms: boolean }) {
  const options: { value: MachineKind; label: string }[] = [
    { value: "container", label: "System container" },
  ];
  if (supportsVms) {
    options.push({ value: "vm", label: "Full VM" });
  }
  return (
    <div className="flex flex-col gap-1.5">
      <Segmented label="Kind" value={form.request.kind} onChange={form.setKind} options={options} />
      <p className="m-0 text-12 text-ink-3">
        {supportsVms
          ? "A system container boots in about a second. A full VM runs its own kernel, for Docker-in-Linux or kernel modules."
          : "Full VMs need nested virtualization, which needs an M3 or newer Mac on macOS 15. This Mac runs system containers, which boot in about a second."}
      </p>
    </div>
  );
}

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
  supportsVms: boolean;
  taken: string[];
};

export function NewMachineSheet({ open, onOpenChange, supportsVms, taken }: NewMachineSheetProps) {
  const { data: distros = [] } = useDistros();
  const navigate = useNavigate();
  const [step, setStep] = useState("");
  const create = useCreateMachine(setStep);
  const form = useNewMachineForm(distros, taken);
  const submit = () =>
    create.mutate(form.request, {
      onSuccess: () => {
        onOpenChange(false);
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
            disabled={form.problem !== null}
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
        <KindField form={form} supportsVms={supportsVms} />
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
