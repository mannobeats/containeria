import { describe, expect, it } from "vitest";

import type { ContainerSummary } from "@/lib/ipc/bindings";

import { emptyTitle, exitCode, filterOptions, groupByProject, isCrashed, matches } from "./model";

function container(overrides: Partial<ContainerSummary>): ContainerSummary {
  return {
    id: "id",
    name: "web",
    image: "nginx:1.29",
    state: "running",
    status: "Up 2 hours",
    project: null,
    service: null,
    pod: null,
    ports: [],
    createdAt: 0,
    ...overrides,
  };
}

describe("exitCode", () => {
  it("reads the code from Docker's status line", () => {
    expect(exitCode(container({ state: "exited", status: "Exited (137) 2 minutes ago" }))).toBe(
      137,
    );
    expect(exitCode(container({ state: "exited", status: "Exited (0) 1 hour ago" }))).toBeNull();
    expect(exitCode(container({}))).toBeNull();
  });

  it("treats a non-zero exit as a crash", () => {
    expect(isCrashed(container({ state: "exited", status: "Exited (1) now" }))).toBe(true);
    expect(isCrashed(container({ state: "exited", status: "Exited (0) now" }))).toBe(false);
  });

  it("doesn't call a container that docker stop ended with SIGTERM crashed", () => {
    expect(isCrashed(container({ state: "exited", status: "Exited (143) now" }))).toBe(false);
    expect(isCrashed(container({ state: "exited", status: "Exited (137) now" }))).toBe(true);
  });
});

describe("matches", () => {
  it("filters by state and searches name, image and project", () => {
    const db = container({ name: "shop-db-1", image: "postgres:18", project: "shop" });
    expect(matches(db, "all", "post")).toBe(true);
    expect(matches(db, "all", "SHOP")).toBe(true);
    expect(matches(db, "stopped", "")).toBe(false);
    expect(matches(db, "running", "redis")).toBe(false);
  });
});

describe("groupByProject", () => {
  it("sorts projects by name and keeps standalone containers last", () => {
    const groups = groupByProject([
      container({ name: "loose" }),
      container({ name: "b1", project: "blog" }),
      container({ name: "s1", project: "shop" }),
      container({ name: "b2", project: "blog" }),
    ]);
    expect(groups.map((group) => [group.id, group.containers.map((c) => c.name)])).toEqual([
      ["blog", ["b1", "b2"]],
      ["shop", ["s1"]],
      ["standalone", ["loose"]],
    ]);
  });
});

describe("filterOptions", () => {
  it("counts running and stopped containers", () => {
    const options = filterOptions([
      container({}),
      container({ state: "exited", status: "Exited (0) now" }),
    ]);
    expect(options.map((option) => option.count)).toEqual([2, 1, 1]);
  });
});

describe("emptyTitle", () => {
  it("names the search, or what the filter hides", () => {
    expect(emptyTitle("all", "redis")).toBe("No containers match “redis”");
    expect(emptyTitle("running", "")).toBe("Nothing is running");
    expect(emptyTitle("stopped", "")).toBe("No stopped containers");
  });
});
