import { useId, useState } from "react";

import type { NetworkSpec } from "@/lib/ipc/bindings";
import { Button } from "@/ui/button";
import { Field, Input } from "@/ui/field";
import { Segmented } from "@/ui/segmented";
import { Sheet } from "@/ui/sheet";
import { Switch } from "@/ui/switch";

import { useCreateNetwork } from "./api";
import { specProblem } from "./model";

type Driver = "bridge" | "macvlan" | "ipvlan";

const EMPTY: NetworkSpec = {
  name: "",
  driver: "bridge",
  subnet: null,
  gateway: null,
  internal: false,
  ipv6: false,
};

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <Switch label={label} checked={checked} onCheckedChange={onChange} />
      <span className="text-13 text-ink">
        {label} <span className="text-12 text-ink-3">{hint}</span>
      </span>
    </div>
  );
}

/** A user-defined network: containers on it reach each other by name. */
export function NewNetworkSheet({
  open,
  taken,
  onClose,
}: {
  open: boolean;
  taken: string[];
  onClose: () => void;
}) {
  const ids = useId();
  const [spec, setSpec] = useState<NetworkSpec>(EMPTY);
  const create = useCreateNetwork();
  const problem = spec.name === "" ? null : specProblem(spec, taken);
  const set = (change: Partial<NetworkSpec>) => setSpec((current) => ({ ...current, ...change }));
  const text = (value: string) => (value.trim() === "" ? null : value.trim());
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => (next ? undefined : onClose())}
      title="New network"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="brand"
            type="submit"
            form={`${ids}-new-network`}
            disabled={spec.name === "" || problem !== null}
            loading={create.isPending}
          >
            Create network
          </Button>
        </>
      }
    >
      <form
        id={`${ids}-new-network`}
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          create.mutate(spec, { onSuccess: onClose });
        }}
      >
        <Field label="Name" htmlFor={`${ids}-network-name`} error={problem ?? undefined}>
          <Input
            id={`${ids}-network-name`}
            autoFocus
            className="font-mono text-mono-13"
            placeholder="payments_net"
            value={spec.name}
            onChange={(event) => set({ name: event.target.value })}
          />
        </Field>
        <Segmented<Driver>
          label="Driver"
          value={spec.driver as Driver}
          onChange={(driver) => set({ driver })}
          options={[
            { value: "bridge", label: "bridge" },
            { value: "macvlan", label: "macvlan" },
            { value: "ipvlan", label: "ipvlan" },
          ]}
        />
        <div className="grid grid-cols-2 gap-4">
          <Field label="Subnet" htmlFor={`${ids}-network-subnet`} hint="Optional">
            <Input
              id={`${ids}-network-subnet`}
              className="font-mono text-mono-13"
              placeholder="172.23.0.0/16"
              onChange={(event) => set({ subnet: text(event.target.value) })}
            />
          </Field>
          <Field label="Gateway" htmlFor={`${ids}-network-gateway`} hint="Optional">
            <Input
              id={`${ids}-network-gateway`}
              className="font-mono text-mono-13"
              placeholder="172.23.0.1"
              onChange={(event) => set({ gateway: text(event.target.value) })}
            />
          </Field>
        </div>
        <Toggle
          label="Internal only"
          hint="no access to the internet"
          checked={spec.internal}
          onChange={(internal) => set({ internal })}
        />
        <Toggle
          label="IPv6"
          hint="give containers IPv6 addresses too"
          checked={spec.ipv6}
          onChange={(ipv6) => set({ ipv6 })}
        />
      </form>
    </Sheet>
  );
}
