import { useQuery } from "@tanstack/react-query";

import { queryKeys } from "@/app/query-keys";
import { useToastedMutation } from "@/app/use-toasted-mutation";
import { isServing, useEngineStatus } from "@/features/engine/api";
import { commands, type NetworkSpec } from "@/lib/ipc/bindings";

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

export function useRemoveNetwork() {
  return useToastedMutation({
    run: ({ id }: { id: string; name: string }) => commands.networkRemove(id),
    done: ({ name }) => `Deleted ${name}`,
    failed: "The network wasn't deleted",
    invalidates: queryKeys.networks,
  });
}

type Link = { network: string; container: string; networkName: string };

export function useConnectNetwork() {
  return useToastedMutation({
    run: ({ network, container }: Link) => commands.networkConnect(network, container),
    done: ({ container, networkName }) => `${container} joined ${networkName}`,
    failed: "The container wasn't connected",
    invalidates: queryKeys.networks,
  });
}

export function useDisconnectNetwork() {
  return useToastedMutation({
    run: ({ network, container }: Link) => commands.networkDisconnect(network, container),
    done: ({ container, networkName }) => `${container} left ${networkName}`,
    failed: "The container wasn't disconnected",
    invalidates: queryKeys.networks,
  });
}
