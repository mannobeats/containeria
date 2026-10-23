import { describe, expect, it } from "vitest";

import type { DomainRoute } from "@/lib/ipc/bindings";

import { groupRoutes, isValidHost, routeState, routeUrl } from "./model";

function route(overrides: Partial<DomainRoute> = {}): DomainRoute {
  return {
    host: "web.shop.containeria.local",
    kind: "container",
    container: "shop-web-1",
    port: 3000,
    https: true,
    down: null,
    ...overrides,
  };
}

describe("routeUrl", () => {
  it("leaves out standard ports and keeps fallback ones", () => {
    expect(routeUrl(route(), { dns: 15353, http: 80, https: 443 })).toBe(
      "https://web.shop.containeria.local",
    );
    expect(routeUrl(route({ https: false }), { dns: 15353, http: 7080, https: 7443 })).toBe(
      "http://web.shop.containeria.local:7080",
    );
    expect(routeUrl(route(), null)).toBe("https://web.shop.containeria.local");
  });
});

describe("groupRoutes", () => {
  it("lists Kubernetes services after containers", () => {
    const groups = groupRoutes([
      route({ host: "web.shop.k8s.containeria.local", kind: "service", container: "shop/web" }),
      route(),
    ]);
    expect(groups.map((group) => group.label)).toEqual(["Containers", "Kubernetes services"]);
  });

  it("puts the user's routes first and drops empty groups", () => {
    const groups = groupRoutes([route(), route({ host: "shop.test", kind: "custom" })]);
    expect(groups.map((group) => [group.label, group.routes.length])).toEqual([
      ["Your routes", 1],
      ["Containers", 1],
    ]);
    expect(groupRoutes([route()]).map((group) => group.label)).toEqual(["Containers"]);
  });
});

describe("routeState", () => {
  it("names why a route is down", () => {
    expect(routeState(route())).toBe("Up");
    expect(routeState(route({ down: "stopped" }))).toBe("Stopped");
    expect(routeState(route({ down: "notPublished" }))).toBe("Port not published");
  });
});

describe("isValidHost", () => {
  it("accepts host names and refuses the rest", () => {
    expect(isValidHost("shop.test")).toBe(true);
    expect(isValidHost("API.Shop.test")).toBe(true);
    expect(isValidHost("localhost")).toBe(false);
    expect(isValidHost("-a.test")).toBe(false);
    expect(isValidHost("shop test.dev")).toBe(false);
  });
});
