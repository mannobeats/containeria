import type { RedisKey } from "@/lib/ipc/bindings";

/** Time to live as people read it: 42s, 15m, 3h. Nothing when the key never expires. */
export function ttlText(seconds: number | null): string {
  if (seconds === null) {
    return "";
  }
  if (seconds < 60) {
    return `${seconds}s`;
  }
  return seconds < 3600 ? `${Math.round(seconds / 60)}m` : `${Math.round(seconds / 3600)}h`;
}

/** JSON formatted for reading; any other text as it is. */
export function pretty(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

/** Each key once: SCAN can return a key on more than one page. */
export function uniqueKeys(keys: RedisKey[]): RedisKey[] {
  return [...new Map(keys.map((key) => [key.key, key])).values()];
}
