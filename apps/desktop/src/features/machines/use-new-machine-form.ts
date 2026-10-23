import { useState } from "react";

import type { CreateMachine, Distro, MachineKind } from "@/lib/ipc/bindings";

import { nameProblem, suggestName } from "./model";

/**
 * The new-machine form. Release and name start as `null`, meaning "follow the distribution": the
 * newest release and a free name, until the person picks their own.
 */
export function useNewMachineForm(distros: Distro[], taken: string[]) {
  const [distroId, setDistroId] = useState(distros[0]?.id ?? "ubuntu");
  const [release, setRelease] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [kind, setKind] = useState<MachineKind>("container");
  const [cpus, setCpus] = useState("2");
  const [memoryGib, setMemoryGib] = useState("4");
  const [mountHome, setMountHome] = useState(true);
  const distro = distros.find((candidate) => candidate.id === distroId) ?? distros[0];
  const request: CreateMachine = {
    name: name ?? suggestName(distroId, taken),
    distro: distroId,
    release: release ?? distro?.releases[0]?.alias ?? "",
    kind,
    cpus: Number(cpus),
    memoryGib: Number(memoryGib),
    mountHome,
  };
  return {
    distro,
    request,
    problem: nameProblem(request.name, taken),
    pickDistro: (id: string) => {
      setDistroId(id);
      setRelease(null);
    },
    setRelease,
    setName,
    setKind,
    cpus,
    setCpus,
    memoryGib,
    setMemoryGib,
    setMountHome,
  };
}
