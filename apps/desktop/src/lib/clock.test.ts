import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { formatClock, formatDateTime, formatPreciseClock, useClock } from "./clock";

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

  it("shows the zone it is set to", () => {
    expect(formatDateTime(evening)).toMatch(/^Oct 18, 2026, 2:54\sAM$/);
    useClock.setState({ timeZone: undefined });
    expect(formatDateTime(evening)).toMatch(/^Oct 17, 2026, 7:54\sPM$/);
  });
});
