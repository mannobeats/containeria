import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { plural } from "@/lib/format";
import { errorMessage } from "@/lib/ipc/errors";

type RemoveMany<T> = {
  remove: (item: T) => Promise<unknown>;
  name: (item: T) => string;
  /** Singular, as `plural` takes it: "image". */
  noun: string;
  /** The query root the deletions make stale. */
  invalidates: readonly string[];
};

type Outcome = { deleted: number; failures: string[] };

/** Deletes the items together, then says how many went and why any didn't. */
export function useRemoveMany<T>({ remove, name, noun, invalidates }: RemoveMany<T>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (items: T[]): Promise<Outcome> => {
      const results = await Promise.allSettled(items.map((item) => remove(item)));
      const failures = items.flatMap((item, at) => {
        const result = results[at];
        return result?.status === "rejected"
          ? [`${name(item)}: ${errorMessage(result.reason)}`]
          : [];
      });
      return { deleted: items.length - failures.length, failures };
    },
    onSuccess: ({ deleted, failures }) => {
      if (failures.length === 0) {
        toast.success(`Deleted ${plural(deleted, noun)}`);
      } else {
        const verb = failures.length === 1 ? "wasn't" : "weren't";
        toast.error(`${plural(failures.length, noun)} ${verb} deleted`, {
          description: failures.join("\n"),
        });
      }
    },
    onSettled: () => client.invalidateQueries({ queryKey: invalidates }),
  });
}
