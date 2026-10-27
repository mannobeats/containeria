import { describe, expect, it } from "vitest";

import { diagnosticsName } from "./diagnostics";

describe("diagnosticsName", () => {
  it("dates the bundle so several don't overwrite each other", () => {
    expect(diagnosticsName(new Date("2026-10-17T15:04:00Z"))).toBe(
      "containeria-diagnostics-2026-10-17.tar.gz",
    );
  });
});
