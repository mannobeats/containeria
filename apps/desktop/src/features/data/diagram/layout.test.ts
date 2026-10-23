import { describe, expect, it } from "vitest";

import type { Column, Table } from "@/lib/ipc/bindings";

import { layout, links, nodeHeight } from "./layout";

function column(name: string, references: string | null = null): Column {
  return {
    name,
    typeName: "integer",
    kind: "number",
    nullable: true,
    primaryKey: name === "id",
    references: references ? { schema: null, table: references, column: "id" } : null,
    default: null,
  };
}

function table(name: string, columns: Column[], schema = "public"): Table {
  return {
    schema,
    name,
    kind: "table",
    rowEstimate: null,
    sizeBytes: null,
    columns,
    indexes: [],
  };
}

const customers = table("customers", [column("id")]);
const orders = table("orders", [
  column("id"),
  column("customer_id", "customers"),
  column("coupon_id", "coupons"),
]);

describe("schema diagram", () => {
  it("links foreign keys to tables that are drawn, and skips the rest", () => {
    expect(links([customers, orders])).toEqual([
      {
        id: "public.orders.customer_id",
        from: "public.orders",
        to: "public.customers",
        column: "customer_id",
      },
    ]);
  });

  it("resolves a key without a schema inside its own table's schema", () => {
    const auditUsers = table("users", [column("id")], "audit");
    const publicUsers = table("users", [column("id")]);
    const posts = table("posts", [column("id"), column("author_id", "users")]);
    expect(links([publicUsers, posts, auditUsers]).map((link) => link.to)).toEqual([
      "public.users",
    ]);
  });

  it("sizes nodes by their columns", () => {
    expect(nodeHeight(orders)).toBe(34 + 3 * 22);
  });

  it("places referenced tables before the tables that point at them", async () => {
    const positions = await layout([orders, customers]);
    expect(positions["public.customers"]?.x).toBeLessThan(positions["public.orders"]?.x ?? 0);
  });
});
