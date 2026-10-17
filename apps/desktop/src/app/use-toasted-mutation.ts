import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { errorMessage } from "@/lib/ipc/errors";

type ToastedMutation<T> = {
  run: (input: T) => Promise<unknown>;
  /** The toast after it worked, e.g. `Deleted shop_pgdata`. */
  done: (input: T) => string;
  /** The toast title when it failed; the error becomes the description. */
  failed: string;
  /** The query root the change makes stale. */
  invalidates: readonly string[];
};

/** A mutation that says what happened and refetches what it changed. */
export function useToastedMutation<T>({ run, done, failed, invalidates }: ToastedMutation<T>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: (_, input) => toast.success(done(input)),
    onError: (error) => toast.error(failed, { description: errorMessage(error) }),
    onSettled: () => client.invalidateQueries({ queryKey: invalidates }),
  });
}
