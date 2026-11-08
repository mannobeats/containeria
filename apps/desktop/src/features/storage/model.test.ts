import { describe, expect, it } from "vitest";

import { dockerBytes, offersTrim } from "./model";

const GB = 1_000_000_000;

describe("dockerBytes", () => {
  it("adds up every kind of Docker data", () => {
    const group = (sizeBytes: number) => ({ count: 1, active: 0, sizeBytes, reclaimableBytes: 0 });
    expect(
      dockerBytes({
        images: group(4 * GB),
        containers: group(GB),
        volumes: group(2 * GB),
        buildCache: group(3 * GB),
      }),
    ).toBe(10 * GB);
  });
});

describe("offersTrim", () => {
  it("offers a trim once the disk holds over 5 GB more than Docker's data", () => {
    expect(offersTrim(48 * GB, 4 * GB)).toBe(true);
    expect(offersTrim(9 * GB, 4 * GB)).toBe(false);
    expect(offersTrim(0, 4 * GB)).toBe(false);
  });
});
