import { describe, expect, it } from "vitest";

import { containerFixture, imageFixture } from "@/test/fixtures";

import {
  applyPullProgress,
  imageKind,
  imageName,
  imageStats,
  matchesImage,
  pullFraction,
  pullReference,
  shortId,
  usersOf,
} from "./model";

const used = imageFixture({
  id: "sha256:aaa",
  repository: "postgres",
  tag: "18",
  references: ["postgres:18"],
  containers: 2,
  sizeBytes: 400,
});
const unused = imageFixture({
  id: "sha256:bbb",
  repository: "redis",
  tag: "8",
  references: ["redis:8"],
  sizeBytes: 100,
});
const dangling = imageFixture({
  id: "sha256:ccc",
  repository: null,
  tag: null,
  references: [],
  dangling: true,
  sizeBytes: 50,
});

describe("images", () => {
  it("sorts images into used, unused and dangling, with sizes", () => {
    expect([used, unused, dangling].map(imageKind)).toEqual(["used", "unused", "dangling"]);
    const stats = imageStats([used, unused, dangling]);
    expect(stats.totalBytes).toBe(550);
    expect(stats.unused).toEqual({ count: 1, bytes: 100 });
  });

  it("names dangling layers and shortens ids", () => {
    expect(imageName(dangling)).toBe("Dangling build layer");
    expect(imageName(used)).toBe("postgres");
    expect(shortId("sha256:0123456789abcdef")).toBe("0123456789ab");
  });

  it("filters by kind and by reference or id", () => {
    expect(matchesImage(used, "used", "post")).toBe(true);
    expect(matchesImage(used, "unused", "")).toBe(false);
    expect(matchesImage(dangling, "all", "ccc")).toBe(true);
    expect(matchesImage(unused, "all", "mysql")).toBe(false);
  });
});

describe("pull progress", () => {
  it("tracks each layer until it's complete", () => {
    let layers = applyPullProgress([], {
      layer: "18",
      status: "Pulling from library/postgres",
      current: null,
      total: null,
    });
    expect(layers).toEqual([]);
    layers = applyPullProgress(layers, {
      layer: "a1",
      status: "Downloading",
      current: 50,
      total: 200,
    });
    layers = applyPullProgress(layers, {
      layer: "b2",
      status: "Already exists",
      current: null,
      total: null,
    });
    expect(pullFraction(layers)).toBeCloseTo(0.625);
    layers = applyPullProgress(layers, {
      layer: "a1",
      status: "Extracting",
      current: 200,
      total: 200,
    });
    layers = applyPullProgress(layers, {
      layer: "a1",
      status: "Pull complete",
      current: null,
      total: null,
    });
    expect(layers.every((layer) => layer.done)).toBe(true);
    expect(pullFraction(layers)).toBe(1);
  });

  it("ignores lines about the whole image", () => {
    expect(
      applyPullProgress([], {
        layer: null,
        status: "Status: Downloaded newer image",
        current: null,
        total: null,
      }),
    ).toEqual([]);
    expect(pullFraction([])).toBe(0);
  });
});

describe("usersOf", () => {
  it("matches containers by reference, implicit latest or id", () => {
    const redis = imageFixture({ id: "sha256:r", references: ["redis:latest"] });
    const containers = [
      containerFixture({ id: "1", image: "redis" }),
      containerFixture({ id: "2", image: "redis:latest" }),
      containerFixture({ id: "3", image: "sha256:r" }),
      containerFixture({ id: "4", image: "postgres:18" }),
    ];
    expect(usersOf(redis, containers).map((container) => container.id)).toEqual(["1", "2", "3"]);
  });
});

describe("pullReference", () => {
  it("adds the tag to a Hub pick and keeps a typed reference", () => {
    expect(pullReference("post", "postgres", "18")).toBe("postgres:18");
    expect(pullReference("post", "postgres", " ")).toBe("postgres:latest");
    expect(pullReference(" ghcr.io/acme/api:1 ", null, "latest")).toBe("ghcr.io/acme/api:1");
  });
});
