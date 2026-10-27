import { waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { mockCommands } from "@/test/harness";

import { applyAppearance, followAppearance } from "./theme";

const KEY = "containeria.appearance";

describe("appearance", () => {
  afterEach(() => {
    applyAppearance("system");
  });

  it("themes the page and the native materials together", async () => {
    const calls = mockCommands({});
    applyAppearance("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    await waitFor(() =>
      expect(calls).toContainEqual({
        command: "appSetAppearance",
        args: { appearance: "dark" },
      }),
    );
  });

  it("follows a change made in another window", () => {
    mockCommands({});
    followAppearance();
    localStorage.setItem(KEY, "light");
    dispatchEvent(new StorageEvent("storage", { key: KEY, newValue: "light" }));
    expect(document.documentElement.dataset.theme).toBe("light");
  });
});
