import type { NetworkSpec, NetworkSummary } from "@/lib/ipc/bindings";

export function matchesNetwork(network: NetworkSummary, query: string): boolean {
  const needle = query.trim().toLowerCase();
  const fields = [network.name, network.driver, network.subnet ?? "", ...network.containers];
  return needle === "" || fields.some((field) => field.toLowerCase().includes(needle));
}

const CIDR = /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/;
const IP = /^(\d{1,3}\.){3}\d{1,3}$/;

/** The first thing wrong with a new network, or `null`. */
export function specProblem(spec: NetworkSpec, taken: string[]): string | null {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(spec.name)) {
    return "Use letters, numbers, dots, dashes and underscores, starting with a letter or number.";
  }
  if (taken.includes(spec.name)) {
    return "A network with this name exists.";
  }
  if (spec.subnet && !CIDR.test(spec.subnet)) {
    return "Write the subnet as an address and prefix, like 172.23.0.0/16.";
  }
  if (spec.gateway && !(spec.subnet && IP.test(spec.gateway))) {
    return "A gateway needs a subnet and an address like 172.23.0.1.";
  }
  return null;
}
