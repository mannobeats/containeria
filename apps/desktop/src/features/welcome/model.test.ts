import { describe, expect, it } from "vitest";

import type { Inventory } from "@/lib/ipc/bindings";

import { listed, sourceKey, volumesInUse } from "./model";

const inventory: Inventory = {
  images: [],
  volumes: [
    { name: "shop_pgdata", inUseBy: ["shop-db-1"] },
    { name: "shop_media", inUseBy: [] },
  ],
  containers: [
    { id: "c1", name: "shop-db-1", image: "postgres:18", project: "shop", running: true },
  ],
};

const names = (volumes: { name: string }[]) => volumes.map((volume) => volume.name);

describe("volumesInUse", () => {
  it("names a picked volume a running container uses", () => {
    const picked = new Set(["shop_pgdata", "shop_media"]);
    expect(names(volumesInUse(inventory, picked, new Set()))).toEqual(["shop_pgdata"]);
  });

  it("names the volume a picked running container brings along", () => {
    expect(names(volumesInUse(inventory, new Set(), new Set(["c1"])))).toEqual(["shop_pgdata"]);
  });

  it("is empty when nothing picked is in use", () => {
    expect(volumesInUse(inventory, new Set(["shop_media"]), new Set())).toEqual([]);
  });
});

describe("listed", () => {
  it("joins names the way a sentence does", () => {
    expect(listed(["Colima (default)"])).toBe("Colima (default)");
    expect(listed(["a", "b", "c"])).toBe("a, b and c");
  });
});

describe("sourceKey", () => {
  it("tells Colima profiles apart", () => {
    expect(sourceKey({ kind: "colima", instance: "default" })).not.toBe(
      sourceKey({ kind: "colima", instance: "work" }),
    );
    expect(sourceKey({ kind: "orbStack", instance: null })).toBe("orbStack:");
  });
});
