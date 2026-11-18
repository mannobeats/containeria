import type { AppUpdate, UpdateProgress } from "@/lib/ipc/bindings";

/** Where a look for a newer version stands. */
export type Look =
  | { state: "looking" }
  | { state: "failed"; error: unknown }
  | { state: "newest" }
  | { state: "available"; update: AppUpdate };

/** What to show of a look, from the query that makes it. A look in progress hides the last answer. */
export function lookOf(check: {
  isFetching: boolean;
  isError: boolean;
  error: unknown;
  data: AppUpdate | null | undefined;
}): Look {
  if (check.isFetching) {
    return { state: "looking" };
  }
  if (check.isError) {
    return { state: "failed", error: check.error };
  }
  return check.data ? { state: "available", update: check.data } : { state: "newest" };
}

/** The share of an update fetched so far, or `undefined` while its size isn't known. */
export function fetched(progress: UpdateProgress | null): number | undefined {
  if (!progress?.totalBytes) {
    return undefined;
  }
  return progress.downloadedBytes / progress.totalBytes;
}
