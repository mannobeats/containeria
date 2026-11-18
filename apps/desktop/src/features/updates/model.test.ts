import { describe, expect, it } from "vitest";

import { fetched, lookOf } from "./model";

describe("lookOf", () => {
  const settled = { isFetching: false, isError: false, error: null, data: null };

  it("shows a look in progress, whatever the last one found", () => {
    const update = { version: "0.2.0", notes: null };
    expect(lookOf({ ...settled, isFetching: true, data: update })).toEqual({ state: "looking" });
  });

  it("tells a newer version from none, and a look that failed from both", () => {
    const update = { version: "0.2.0", notes: null };
    expect(lookOf(settled)).toEqual({ state: "newest" });
    expect(lookOf({ ...settled, data: update })).toEqual({ state: "available", update });
    expect(lookOf({ ...settled, isError: true, error: "offline" })).toEqual({
      state: "failed",
      error: "offline",
    });
  });
});

describe("fetched", () => {
  it("is the share of the update that has arrived", () => {
    expect(fetched({ downloadedBytes: 50, totalBytes: 200 })).toBe(0.25);
  });

  it("isn't known before the download starts or when the server doesn't say its size", () => {
    expect(fetched(null)).toBeUndefined();
    expect(fetched({ downloadedBytes: 50, totalBytes: null })).toBeUndefined();
  });
});
