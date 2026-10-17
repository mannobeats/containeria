import { describe, expect, it } from "vitest";
import { buildArgs, defaultTag, isDockerfile, registryOf } from "./build-model";
import { archiveName } from "./image-actions";

describe("image build and push helpers", () => {
  it("names an image after the folder it's built from", () => {
    expect(defaultTag("/Users/ada/My Shop")).toBe("my-shop:latest");
    expect(defaultTag("/")).toBe("image:latest");
  });

  it("reads build arguments one per line", () => {
    expect(buildArgs("NODE_ENV=production\n\n# a comment\nPORT=3000\nnot-an-arg")).toEqual([
      "NODE_ENV=production",
      "PORT=3000",
    ]);
  });

  it("says which registry a push goes to", () => {
    expect(registryOf("nginx:1.29")).toBe("Docker Hub");
    expect(registryOf("ada/shop:1")).toBe("Docker Hub");
    expect(registryOf("ghcr.io/ada/shop:1")).toBe("ghcr.io");
    expect(registryOf("localhost:5000/shop")).toBe("localhost:5000");
  });

  it("recognises Dockerfiles by name", () => {
    expect(isDockerfile("/a/Dockerfile")).toBe(true);
    expect(isDockerfile("/a/Dockerfile.dev")).toBe(true);
    expect(isDockerfile("/a/api.Dockerfile")).toBe(true);
    expect(isDockerfile("/a/compose.yaml")).toBe(false);
    expect(isDockerfile("/a/Dockerfiles")).toBe(false);
  });

  it("names an export after the image", () => {
    expect(archiveName("ghcr.io/acme/api:1.2")).toBe("api-1.2.tar");
  });
});
