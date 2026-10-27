import type { CommandError } from "./bindings";

export function isCommandError(error: unknown): error is CommandError {
  return typeof error === "object" && error !== null && "kind" in error && "message" in error;
}

/** A sentence for a toast or banner, whatever was thrown. */
export function errorMessage(error: unknown): string {
  if (isCommandError(error)) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
