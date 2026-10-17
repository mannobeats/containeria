import type { StatsSample } from "@/lib/ipc/bindings";

/** How many readings the charts keep: five minutes at one reading a second. */
export const HISTORY = 300;

/** Rolling series for the charts. Network and disk are rates, worked out between readings. */
export type StatsHistory = {
  times: number[];
  cpu: number[];
  memory: number[];
  received: number[];
  sent: number[];
  read: number[];
  written: number[];
  last: { at: number; sample: StatsSample } | null;
};

export const emptyHistory: StatsHistory = {
  times: [],
  cpu: [],
  memory: [],
  received: [],
  sent: [],
  read: [],
  written: [],
  last: null,
};

const keep = (values: number[], value: number) => [...values.slice(-(HISTORY - 1)), value];

function rate(now: number, before: number | undefined, seconds: number): number {
  if (before === undefined || seconds <= 0 || now < before) {
    return 0;
  }
  return (now - before) / seconds;
}

/** Adds a reading taken at `at` (seconds since 1970). */
export function appendSample(history: StatsHistory, sample: StatsSample, at: number): StatsHistory {
  const previous = history.last?.sample;
  const seconds = history.last ? at - history.last.at : 0;
  return {
    times: keep(history.times, at),
    cpu: keep(history.cpu, sample.cpuPercent ?? 0),
    memory: keep(history.memory, sample.memoryBytes),
    received: keep(
      history.received,
      rate(sample.networkRxBytes, previous?.networkRxBytes, seconds),
    ),
    sent: keep(history.sent, rate(sample.networkTxBytes, previous?.networkTxBytes, seconds)),
    read: keep(history.read, rate(sample.diskReadBytes, previous?.diskReadBytes, seconds)),
    written: keep(history.written, rate(sample.diskWriteBytes, previous?.diskWriteBytes, seconds)),
    last: { at, sample },
  };
}
