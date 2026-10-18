import { beforeEach, describe, expect, it } from "vitest";

import { formatClock, formatDateTime, formatPreciseClock, useClock } from "./clock";

const evening = Date.parse("2026-10-18T02:54:07.123Z");

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
    expect(formatDateTime(evening)).toMatch(/Oct 18, 2026.*2:54/);
    useClock.setState({ timeZone: undefined });
    expect(formatDateTime(evening)).toMatch(/2026/);
  });
});
