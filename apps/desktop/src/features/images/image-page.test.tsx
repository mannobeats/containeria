import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { containerFixture, engineFixture, imageFixture } from "@/test/fixtures";
import { mockCommands, renderWithApp } from "@/test/harness";

import { ImagePage } from "./image-page";

const route = { path: "images/$id", url: "/images/sha256:pg" };

describe("ImagePage", () => {
  it("lists layers in order, config and the containers using it", async () => {
    mockCommands({
      engineStatus: () => engineFixture(),
      imagesList: () => [
        imageFixture({ id: "sha256:pg", references: ["postgres:18"], containers: 1 }),
      ],
      containersList: () => [
        containerFixture({ id: "db", name: "shop-db-1", image: "postgres:18" }),
      ],
      imageDetail: () => ({
        id: "sha256:pg",
        references: ["postgres:18"],
        platform: "linux/arm64",
        user: "postgres",
        entrypoint: ["docker-entrypoint.sh"],
        command: ["postgres"],
        workingDir: "",
        exposedPorts: ["5432/tcp"],
        env: ["PGDATA=/var/lib/postgresql/data"],
        labels: {},
        layers: [
          { step: 1, createdBy: "ADD rootfs.tar.xz /", sizeBytes: 75_000_000 },
          { step: 2, createdBy: 'CMD ["postgres"]', sizeBytes: 0 },
        ],
      }),
    });
    renderWithApp(<ImagePage />, { route });
    expect(await screen.findByText("ADD rootfs.tar.xz /")).toBeDefined();
    expect(screen.getByText("linux/arm64")).toBeDefined();
    expect(screen.getByText("5432/tcp")).toBeDefined();
    expect(await screen.findByText("shop-db-1")).toBeDefined();
  });

  it("says when the image is gone", async () => {
    mockCommands({
      engineStatus: () => engineFixture(),
      imageDetail: () => {
        throw { kind: "notFound", message: "No such image" };
      },
    });
    renderWithApp(<ImagePage />, { route });
    expect(await screen.findByText(/isn't on this engine/)).toBeDefined();
  });
});
