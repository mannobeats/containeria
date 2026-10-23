import { describe, expect, it } from "vitest";

import { volumeFixture } from "@/test/fixtures";

import { joinPath, matchesVolume, nameProblem, volumeName, volumeStats } from "./model";

const user = {
  containerId: "c1",
  container: "shop-db-1",
  mountedAt: "/var/lib/postgresql/data",
  running: true,
};
const attached = volumeFixture({ name: "shop_pgdata", usedBy: [user], sizeBytes: 300 });
const orphan = volumeFixture({
  name: "a".repeat(64),
  anonymous: true,
  project: null,
  sizeBytes: 100,
});

describe("volumes", () => {
  it("shortens anonymous names", () => {
    expect(volumeName(orphan)).toBe("aaaaaaaaaaaa…");
    expect(volumeName(attached)).toBe("shop_pgdata");
  });

  it("filters by attachment and searches names, projects and containers", () => {
    expect(matchesVolume(attached, "used", "shop-db")).toBe(true);
    expect(matchesVolume(attached, "unused", "")).toBe(false);
    expect(matchesVolume(orphan, "unused", "")).toBe(true);
    expect(matchesVolume(orphan, "all", "shop")).toBe(false);
  });

  it("totals sizes and what nothing uses", () => {
    expect(volumeStats([attached, orphan, volumeFixture({ sizeBytes: null })])).toEqual({
      count: 3,
      totalBytes: 400,
      unattached: 2,
      unattachedBytes: 100,
    });
  });

  it("checks new names", () => {
    expect(nameProblem("", [])).toBeNull();
    expect(nameProblem("shop_uploads", ["shop_pgdata"])).toBeNull();
    expect(nameProblem("-bad", [])).toMatch(/letters/);
    expect(nameProblem("shop_pgdata", ["shop_pgdata"])).toMatch(/exists/);
  });

  it("walks folders", () => {
    expect(joinPath("", "pg")).toBe("pg");
    expect(joinPath("pg/base", "16384")).toBe("pg/base/16384");
    expect(joinPath("pg/base", "..")).toBe("pg");
    expect(joinPath("", "..")).toBe("");
  });
});
