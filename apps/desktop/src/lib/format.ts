const UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

/** 1 536 000 → "1.5 MB". Decimal units, as macOS shows sizes. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }
  const exponent = Math.min(Math.floor(Math.log10(bytes) / 3), UNITS.length - 1);
  const value = bytes / 1000 ** exponent;
  const digits = value >= 100 || exponent === 0 ? 0 : 1;
  return `${value.toFixed(digits)} ${UNITS[exponent]}`;
}

/** Memory the way Activity Monitor shows it: binary units, labelled GB. 8 GiB → "8 GB". */
export function formatMemory(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 MB";
  }
  const exponent = Math.min(Math.max(Math.floor(Math.log2(bytes) / 10), 2), 4);
  const value = bytes / 1024 ** exponent;
  const digits = value >= 100 || Number.isInteger(value) ? 0 : 1;
  return `${value.toFixed(digits)} ${UNITS[exponent]}`;
}

/** 0.4 → "0.4%", 12.345 → "12%". */
export function formatPercent(percent: number | null): string {
  if (percent === null || !Number.isFinite(percent)) {
    return "—";
  }
  return `${percent < 10 ? percent.toFixed(1) : Math.round(percent)}%`;
}

const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto", style: "long" });
const STEPS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 31_536_000],
  ["month", 2_592_000],
  ["week", 604_800],
  ["day", 86_400],
  ["hour", 3600],
  ["minute", 60],
];

/** Seconds since the epoch → "3 hours ago". */
export function formatRelative(epochSeconds: number, now: number = Date.now()): string {
  const delta = epochSeconds - now / 1000;
  const step = STEPS.find(([, seconds]) => Math.abs(delta) >= seconds);
  if (!step) {
    return "just now";
  }
  return relative.format(Math.round(delta / step[1]), step[0]);
}

const AGE_UNITS: [string, number][] = [
  ["d", 86_400],
  ["h", 3600],
  ["m", 60],
];

/** Seconds since the epoch → kubectl's AGE column: "6d", "3h", "12m", "40s". */
export function formatAge(epochSeconds: number, now: number = Date.now()): string {
  const seconds = Math.max(0, Math.floor(now / 1000 - epochSeconds));
  const unit = AGE_UNITS.find(([, size]) => seconds >= size);
  return unit ? `${Math.floor(seconds / unit[1])}${unit[0]}` : `${seconds}s`;
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}
