import { afterAll, beforeAll, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";

import { formatClock, formatDateTime, formatFileDate, formatPreciseClock, useClock } from "./clock";

const evening = Date.parse("2026-10-18T02:54:07.123Z");

// A Mac in a zone other than UTC, so following the Mac and following UTC read differently.
beforeAll(() => vi.stubEnv("TZ", "America/Los_Angeles"));
afterAll(() => vi.unstubAllEnvs());
beforeEach(() => useClock.setState({ timeZone: "UTC", hour12: true }));

describe("clock", () => {
  it("follows the Mac's 12- or 24-hour clock", () => {
    expect(formatClock(evening)).toBe("2:54 AM");
    expect(formatClock(evening, true)).toBe("2:54:07 AM");
    useClock.setState({ hour12: false });
    expect(formatClock(evening)).toBe("02:54");
    expect(formatPreciseClock(evening)).toBe("02:54:07.123");
  });

  it("dates a file by the day in the clock's zone", () => {
    expect(formatFileDate(evening)).toBe("2026-10-18");
    useClock.setState({ timeZone: undefined });
    const local = new Date(evening);
    const pad = (value: number) => String(value).padStart(2, "0");
    expect(formatFileDate(evening)).toBe(
      `${local.getFullYear()}-${pad(local.getMonth() + 1)}-${pad(local.getDate())}`,
    );
  });

  it("dates a file on the Gregorian calendar in a region that uses another", async () => {
    const Real = Intl.DateTimeFormat;
    onTestFinished(() => {
      vi.restoreAllMocks();
    });
    vi.spyOn(Intl, "DateTimeFormat").mockImplementation(function thai(_locales, options) {
      return new Real("th-TH", options);
    });
    vi.resetModules();
    const clock = await import("./clock");
    clock.useClock.setState({ timeZone: "UTC" });
    expect(clock.formatFileDate(evening)).toBe("2026-10-18");
  });

  it("shows the zone it is set to", () => {
    expect(formatDateTime(evening)).toMatch(/^Oct 18, 2026, 2:54\sAM$/);
    useClock.setState({ timeZone: undefined });
    expect(formatDateTime(evening)).toMatch(/^Oct 17, 2026, 7:54\sPM$/);
  });
});
