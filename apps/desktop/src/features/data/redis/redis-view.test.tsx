import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import type { RedisValue } from "@/lib/ipc/bindings";
import { infoFixture } from "@/test/data-fixtures";
import { mockCommands, renderWithApp } from "@/test/harness";

import { RedisView } from "./redis-view";

const VALUES: Record<string, RedisValue> = {
  "config:flags": { kind: "text", value: '{"beta":true}' },
  "user:1": { kind: "pairs", pairs: [["name", "Ada"]] },
  queue: { kind: "items", items: ["job-1", "job-2"], truncated: true },
  gone: { kind: "missing" },
};

const FIRST_PAGE = {
  keys: [
    { key: "config:flags", kind: "string", ttlSeconds: null },
    { key: "user:1", kind: "hash", ttlSeconds: 90 },
    { key: "queue", kind: "list", ttlSeconds: null },
    { key: "gone", kind: "none", ttlSeconds: null },
  ],
  cursor: "42",
};

const NEXT_PAGE = {
  keys: [
    { key: "queue", kind: "list", ttlSeconds: null },
    { key: "user:2", kind: "hash", ttlSeconds: null },
  ],
  cursor: null,
};

function setup() {
  const calls = mockCommands({
    dataRedisKeys: (args) => (args.cursor === "42" ? NEXT_PAGE : FIRST_PAGE),
    dataRedisValue: (args) => VALUES[String(args.key)] ?? { kind: "missing" },
  });
  const info = infoFixture({
    engine: "redis",
    capabilities: { query: false, sql: false, editRows: false, tables: false, keys: true },
  });
  renderWithApp(<RedisView info={info} />);
  return calls;
}

describe("RedisView", () => {
  it("shows each kind of value", async () => {
    setup();
    await userEvent.click(await screen.findByRole("button", { name: /config:flags/ }));
    expect((await screen.findByText(/"beta": true/)).tagName).toBe("PRE");
    await userEvent.click(screen.getByRole("button", { name: /user:1/ }));
    expect(await screen.findByText("Ada")).toBeDefined();
    await userEvent.click(screen.getByRole("button", { name: /queue/ }));
    expect(await screen.findByText("Showing the first 500 items.")).toBeDefined();
    await userEvent.click(screen.getByRole("button", { name: /gone/ }));
    expect(await screen.findByText("This key no longer exists")).toBeDefined();
  });

  it("loads the next page and lists a key SCAN returns twice once", async () => {
    const calls = setup();
    await userEvent.click(await screen.findByRole("button", { name: "Load more" }));
    expect(await screen.findByRole("button", { name: /user:2/ })).toBeDefined();
    expect(screen.getAllByRole("button", { name: /queue/ })).toHaveLength(1);
    expect(screen.getByText("5 keys")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
    expect(calls).toContainEqual({
      command: "dataRedisKeys",
      args: { id: "pg", pattern: "*", cursor: "42" },
    });
  });

  it("scans by the pattern typed", async () => {
    const calls = setup();
    await screen.findByRole("button", { name: /queue/ });
    await userEvent.clear(screen.getByPlaceholderText("Key pattern, like session:*"));
    await userEvent.type(screen.getByPlaceholderText("Key pattern, like session:*"), "user:*");
    await waitFor(() =>
      expect(calls).toContainEqual({
        command: "dataRedisKeys",
        args: { id: "pg", pattern: "user:*", cursor: null },
      }),
    );
  });

  it("asks before deleting a key", async () => {
    const calls = setup();
    await userEvent.click(await screen.findByRole("button", { name: /user:1/ }));
    await userEvent.click(screen.getByRole("button", { name: "Delete key" }));
    const sheet = await screen.findByRole("dialog");
    expect(calls.some((call) => call.command === "dataRedisDelete")).toBe(false);
    await userEvent.click(within(sheet).getByRole("button", { name: "Delete key" }));
    await waitFor(() =>
      expect(calls).toContainEqual({
        command: "dataRedisDelete",
        args: { id: "pg", key: "user:1" },
      }),
    );
  });

  it("deletes a key from its right-click menu after asking", async () => {
    const calls = setup();
    fireEvent.contextMenu(await screen.findByRole("button", { name: /queue/ }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Delete…" }));
    const sheet = await screen.findByRole("dialog");
    expect(calls.some((call) => call.command === "dataRedisDelete")).toBe(false);
    await userEvent.click(within(sheet).getByRole("button", { name: "Delete key" }));
    await waitFor(() =>
      expect(calls).toContainEqual({
        command: "dataRedisDelete",
        args: { id: "pg", key: "queue" },
      }),
    );
  });
});
