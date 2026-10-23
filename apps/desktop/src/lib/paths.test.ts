import { describe, expect, it } from "vitest";

import { childPath, pathSteps } from "./paths";

describe("pathSteps", () => {
  it("lists every folder from the root, ignoring a trailing slash", () => {
    expect(pathSteps("/root/notes/")).toEqual([
      { label: "/", path: "/" },
      { label: "root", path: "/root" },
      { label: "notes", path: "/root/notes" },
    ]);
    expect(pathSteps("/")).toEqual([{ label: "/", path: "/" }]);
  });
});

describe("childPath", () => {
  it("joins without doubling the root slash", () => {
    expect(childPath("/", "etc")).toBe("/etc");
    expect(childPath("/etc", "hosts")).toBe("/etc/hosts");
  });
});
