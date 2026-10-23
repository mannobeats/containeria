import { describe, expect, it } from "vitest";

import { networkFixture } from "@/test/fixtures";

import { matchesNetwork, specProblem } from "./model";

const spec = {
  name: "payments_net",
  driver: "bridge",
  subnet: null,
  gateway: null,
  internal: false,
  ipv6: false,
};

describe("networks", () => {
  it("searches names, drivers, subnets and attached containers", () => {
    const network = networkFixture({ containers: ["shop-db-1"] });
    expect(matchesNetwork(network, "172.18")).toBe(true);
    expect(matchesNetwork(network, "shop-db")).toBe(true);
    expect(matchesNetwork(network, "overlay")).toBe(false);
    expect(matchesNetwork(network, "")).toBe(true);
  });

  it("checks a new network before creating it", () => {
    expect(specProblem(spec, [])).toBeNull();
    expect(specProblem({ ...spec, name: "-x" }, [])).toMatch(/letters/);
    expect(specProblem(spec, ["payments_net"])).toMatch(/exists/);
    expect(specProblem({ ...spec, subnet: "172.23.0.0" }, [])).toMatch(/prefix/);
    expect(specProblem({ ...spec, gateway: "172.23.0.1" }, [])).toMatch(/needs a subnet/);
    expect(specProblem({ ...spec, subnet: "172.23.0.0/16", gateway: "172.23.0.1" }, [])).toBeNull();
  });
});
