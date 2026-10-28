import { useQuery } from "@tanstack/react-query";

import { queryKeys } from "@/app/query-keys";
import { useRemoveMany } from "@/app/use-remove-many";
import { useToastedMutation } from "@/app/use-toasted-mutation";
import { isServing, useEngineStatus } from "@/features/engine/api";
import { commands, type NetworkSpec, type NetworkSummary } from "@/lib/ipc/bindings";

export function useNetworks() {
  const { data: engine } = useEngineStatus();
  return useQuery({
    queryKey: queryKeys.networks,
    queryFn: commands.networksList,
    enabled: isServing(engine?.phase),
  });
}

export function useNetwork(id: string) {
  return useQuery({
    queryKey: [...queryKeys.networks, id],
    queryFn: () => commands.networkDetail(id),
  });
}

export function useCreateNetwork() {
  return useToastedMutation({
    run: (spec: NetworkSpec) => commands.networkCreate(spec),
    done: (spec) => `Created ${spec.name}`,
    failed: "The network wasn't created",
    invalidates: queryKeys.networks,
  });
}

export function useRemoveNetworks() {
  return useRemoveMany({
    remove: (network: NetworkSummary) => commands.networkRemove(network.id),
    name: (network) => network.name,
    noun: "network",
    invalidates: queryKeys.networks,
  });
}

export function useRemoveNetwork() {
  return useToastedMutation({
    run: ({ id }: { id: string; name: string }) => commands.networkRemove(id),
    done: ({ name }) => `Deleted ${name}`,
    failed: "The network wasn't deleted",
    invalidates: queryKeys.networks,
  });
}

/** `container` is what Docker is given, an id or a name; `containerName` is what the toast says. */
type Link = { network: string; container: string; networkName: string; containerName: string };

export function useConnectNetwork() {
  return useToastedMutation({
    run: ({ network, container }: Link) => commands.networkConnect(network, container),
    done: ({ containerName, networkName }) => `${containerName} joined ${networkName}`,
    failed: "The container wasn't connected",
    invalidates: queryKeys.networks,
  });
}

export function useDisconnectNetwork() {
  return useToastedMutation({
    run: ({ network, container }: Link) => commands.networkDisconnect(network, container),
    done: ({ containerName, networkName }) => `${containerName} left ${networkName}`,
    failed: "The container wasn't disconnected",
    invalidates: queryKeys.networks,
  });
}
