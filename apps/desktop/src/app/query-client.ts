import { QueryClient } from "@tanstack/react-query";

import { isCommandError } from "@/lib/ipc/errors";

/** Data comes from local IPC: no network to retry, no window focus to refetch on. */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5000,
      refetchOnWindowFocus: false,
      retry: (failures, error) =>
        failures < 2 && !(isCommandError(error) && error.kind !== "internal"),
    },
  },
});
