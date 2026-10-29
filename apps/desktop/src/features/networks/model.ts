import { plural } from "@/lib/format";
import type { NetworkSpec, NetworkSummary } from "@/lib/ipc/bindings";

export function matchesNetwork(network: NetworkSummary, query: string): boolean {
  const needle = query.trim().toLowerCase();
  const fields = [network.name, network.driver, network.subnet ?? "", ...network.containers];
  return needle === "" || fields.some((field) => field.toLowerCase().includes(needle));
}

function isIp(value: string): boolean {
  const octets = value.split(".");
  return octets.length === 4 && octets.every((octet) => /^\d{1,3}$/.test(octet) && +octet <= 255);
}

function isCidr(value: string): boolean {
  const [address = "", prefix = "", ...rest] = value.split("/");
  return rest.length === 0 && isIp(address) && /^\d{1,2}$/.test(prefix) && +prefix <= 32;
}

/** What's wrong with a new network, and the field to show it under. */
type SpecProblem = { field: "name" | "subnet" | "gateway"; message: string };

/** The first thing wrong with a new network, or `null`. */
export function specProblem(spec: NetworkSpec, taken: string[]): SpecProblem | null {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(spec.name)) {
    return {
      field: "name",
      message:
        "Use letters, numbers, dots, dashes and underscores, starting with a letter or number.",
    };
  }
  if (taken.includes(spec.name)) {
    return { field: "name", message: "A network with this name exists." };
  }
  if (spec.subnet && !isCidr(spec.subnet)) {
    return {
      field: "subnet",
      message: "Write the subnet as an address and prefix, like 172.23.0.0/16.",
    };
  }
  if (spec.gateway && !(spec.subnet && isIp(spec.gateway))) {
    return {
      field: "gateway",
      message: "A gateway needs a subnet and an address like 172.23.0.1.",
    };
  }
  return null;
}

/** `172.18.0.2/16` → `172.18.0.2`: Docker reports an endpoint's address with its prefix. */
export function hostAddress(address: string): string {
  return address.split("/")[0] ?? address;
}

/** Why Docker would refuse to delete the network, or `undefined` when it can go. */
export function undeletable(network: NetworkSummary): string | undefined {
  if (network.builtIn) {
    return "Built-in networks can't be deleted.";
  }
  const connected = network.containers.length;
  return connected > 0
    ? `${plural(connected, "container")} ${connected === 1 ? "is" : "are"} connected. Disconnect or stop ${connected === 1 ? "it" : "them"} first.`
    : undefined;
}
