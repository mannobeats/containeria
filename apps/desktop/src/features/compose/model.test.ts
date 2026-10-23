import { describe, expect, it } from "vitest";

import {
  fileDraft,
  isComposeFile,
  isProjectName,
  newDraft,
  projectNameFor,
  sourceOf,
} from "./model";

describe("compose model", () => {
  it("recognises Compose file names", () => {
    expect(isComposeFile("/Users/ada/shop/compose.yaml")).toBe(true);
    expect(isComposeFile("/Users/ada/shop/docker-compose.yml")).toBe(true);
    expect(isComposeFile("/Users/ada/shop/compose.prod.yaml")).toBe(true);
    expect(isComposeFile("/Users/ada/shop/shop.compose.yml")).toBe(true);
    expect(isComposeFile("/Users/ada/shop/values.yaml")).toBe(false);
    expect(isComposeFile("/Users/ada/shop/app.db")).toBe(false);
  });

  it("names a project after its folder, as Compose does", () => {
    expect(projectNameFor("/Users/ada/My Shop/compose.yaml")).toBe("myshop");
    expect(isProjectName("myshop")).toBe(true);
    expect(isProjectName("My Shop")).toBe(false);
  });

  it("sends a file as is until it's edited", () => {
    const draft = fileDraft("/a/compose.yaml", "services: {}");
    expect(sourceOf(draft)).toEqual({ kind: "file", path: "/a/compose.yaml", text: null });
    expect(sourceOf({ ...draft, text: "services: {web: {}}" })).toEqual({
      kind: "file",
      path: "/a/compose.yaml",
      text: "services: {web: {}}",
    });
    expect(sourceOf(newDraft()).kind).toBe("text");
  });
});
