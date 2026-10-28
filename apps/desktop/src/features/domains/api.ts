import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { queryKeys } from "@/app/query-keys";
import { type CustomRoute, commands } from "@/lib/ipc/bindings";
import { errorMessage, isCommandError } from "@/lib/ipc/errors";

/** Routes follow the containers, which the app re-reads every few seconds. */
const REFRESH_MS = 3000;

export function useDomains() {
  return useQuery({
    queryKey: queryKeys.domains,
    queryFn: commands.domainsStatus,
    refetchInterval: REFRESH_MS,
  });
}

type Change<T> = { run: (input: T) => Promise<null>; done: (input: T) => string; failed: string };

/** A change to domains: says what happened, stays quiet when the user cancels a macOS prompt. */
function useDomainsChange<T>({ run, done, failed }: Change<T>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: (_, input) => toast.success(done(input)),
    onError: (error) => {
      if (!(isCommandError(error) && error.kind === "cancelled")) {
        toast.error(failed, { description: errorMessage(error) });
      }
    },
    onSettled: () => client.invalidateQueries({ queryKey: queryKeys.domains }),
  });
}

export function useSetDomainsEnabled() {
  return useDomainsChange<boolean>({
    run: commands.domainsSetEnabled,
    done: (enabled) => (enabled ? "Domains are on" : "Domains are off"),
    failed: "Domains couldn't change",
  });
}

/** `replaces` is the host the route had before an edit, removed in the same save. */
export function useSaveRoute() {
  return useDomainsChange<{ route: CustomRoute; replaces: string | null }>({
    run: ({ route, replaces }) => commands.domainsAddRoute(route, replaces),
    done: ({ route }) => `${route.host} points to ${route.container}:${route.port}`,
    failed: "The route wasn't saved",
  });
}

export function useRemoveRoute() {
  return useDomainsChange<string>({
    run: commands.domainsRemoveRoute,
    done: (host) => `Removed ${host}`,
    failed: "The route wasn't removed",
  });
}

export function useResolver() {
  return {
    install: useDomainsChange<void>({
      run: commands.domainsInstallResolver,
      done: () => "Your Mac now finds .containeria.local names",
      failed: "Name resolution wasn't set up",
    }),
    uninstall: useDomainsChange<void>({
      run: commands.domainsUninstallResolver,
      done: () => "Removed the resolver",
      failed: "The resolver wasn't removed",
    }),
  };
}

export function useCertificate() {
  return {
    trust: useDomainsChange<void>({
      run: commands.domainsTrustCa,
      done: () => "Certificate trusted. https:// works in Safari, Chrome and Firefox.",
      failed: "The certificate wasn't trusted",
    }),
    untrust: useDomainsChange<void>({
      run: commands.domainsUntrustCa,
      done: () => "Removed the local certificate",
      failed: "The certificate wasn't removed",
    }),
  };
}
