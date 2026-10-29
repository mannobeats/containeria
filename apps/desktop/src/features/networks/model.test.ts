import { describe, expect, it } from "vitest";

import { networkFixture } from "@/test/fixtures";

import { hostAddress, matchesNetwork, specProblem, undeletable } from "./model";

const spec = {
  name: "payments_net",
  driver: "bridge",
  subnet: null,
  gateway: null,
  internal: false,
  ipv6: false,
};

describe("matchesNetwork", () => {
  const network = networkFixture({
    name: "shop_default",
    driver: "bridge",
    subnet: "172.18.0.0/16",
    containers: ["shop-db-1"],
  });

  it("searches names, drivers, subnets and attached containers", () => {
    for (const query of ["default", "bridge", "172.18", "shop-db"]) {
      expect(matchesNetwork(network, query)).toBe(true);
    }
  });

  it("shows everything for a blank search and nothing for an unknown one", () => {
    expect(matchesNetwork(network, "")).toBe(true);
    expect(matchesNetwork(network, "overlay")).toBe(false);
  });
});

describe("specProblem", () => {
  it("accepts a valid network", () => {
    expect(specProblem(spec, [])).toBeNull();
    expect(specProblem({ ...spec, subnet: "172.23.0.0/16", gateway: "172.23.0.1" }, [])).toBeNull();
  });

  it("rejects a name Docker won't take, under the name", () => {
    expect(specProblem({ ...spec, name: "-x" }, [])).toMatchObject({
      field: "name",
      message: expect.stringMatching(/letters/),
    });
  });

  it("rejects a name already in use", () => {
    expect(specProblem(spec, ["payments_net"])?.message).toMatch(/exists/);
  });

  it("rejects a subnet without a valid address and prefix, under the subnet", () => {
    for (const subnet of ["172.23.0.0", "300.23.0.0/16", "172.23.0.0/33", "172.23.0/16"]) {
      expect(specProblem({ ...spec, subnet }, [])).toMatchObject({ field: "subnet" });
    }
  });

  it("rejects a gateway without a subnet or a valid address, under the gateway", () => {
    expect(specProblem({ ...spec, gateway: "172.23.0.1" }, [])).toMatchObject({
      field: "gateway",
    });
    expect(
      specProblem({ ...spec, subnet: "172.23.0.0/16", gateway: "172.23.0.256" }, []),
    ).toMatchObject({ field: "gateway" });
  });
});

describe("undeletable", () => {
  it("keeps built-in networks", () => {
    expect(undeletable(networkFixture({ builtIn: true }))).toMatch(/Built-in/);
  });

  it("keeps a network with containers on it, counting them", () => {
    expect(undeletable(networkFixture({ containers: ["a"] }))).toBe(
      "1 container is connected. Disconnect or stop it first.",
    );
    expect(undeletable(networkFixture({ containers: ["a", "b"] }))).toBe(
      "2 containers are connected. Disconnect or stop them first.",
    );
  });

  it("lets an empty project network go", () => {
    expect(undeletable(networkFixture())).toBeUndefined();
  });
});

describe("hostAddress", () => {
  it("drops the prefix Docker reports with an endpoint's address", () => {
    expect(hostAddress("172.18.0.2/16")).toBe("172.18.0.2");
    expect(hostAddress("172.18.0.2")).toBe("172.18.0.2");
  });
});
