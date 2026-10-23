import { create } from "zustand";

type Clock = {
  /** `undefined` is the Mac's own zone. */
  timeZone: "UTC" | undefined;
  hour12: boolean;
};

/** The region's clock, until Rust reads the Mac's 24-hour switch. */
const regionHour12 =
  new Intl.DateTimeFormat(undefined, { hour: "numeric" }).resolvedOptions().hour12 ?? false;

/** How every time in the app reads: the Mac's zone and 12- or 24-hour clock unless set to UTC. */
export const useClock = create<Clock>(() => ({ timeZone: undefined, hour12: regionHour12 }));

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const { timeZone, hour12 } = useClock.getState();
  const key = JSON.stringify([options, timeZone, hour12]);
  let format = formatters.get(key);
  if (!format) {
    format = new Intl.DateTimeFormat(undefined, { ...options, timeZone, hour12 });
    formatters.set(key, format);
  }
  return format;
}

/** `10:54 PM`, or `22:54` on a 24-hour Mac; with `seconds`, `10:54:07 PM`. */
export function formatClock(ms: number, seconds = false): string {
  return formatter({
    hour: "numeric",
    minute: "2-digit",
    ...(seconds ? { second: "2-digit" } : {}),
  }).format(ms);
}

/** A log line's time to the millisecond: `10:54:07.123 PM`. */
export function formatPreciseClock(ms: number): string {
  return formatter({
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    fractionalSecondDigits: 3,
  }).format(ms);
}

/** `Oct 17, 2026, 10:54 PM`. */
export function formatDateTime(ms: number): string {
  return formatter({ dateStyle: "medium", timeStyle: "short" }).format(ms);
}
