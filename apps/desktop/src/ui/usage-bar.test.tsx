import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { renderWithApp } from "@/test/harness";

import { UsageBar } from "./usage-bar";

describe("UsageBar", () => {
  it("sizes segments by the positive values only", async () => {
    renderWithApp(
      <UsageBar
        label="Memory"
        format={(value) => `${value} GB`}
        segments={[
          { id: "used", label: "Used", value: 5, color: "var(--s1)" },
          { id: "free", label: "Free", value: -10 },
        ]}
      />,
    );
    const bar = await screen.findByRole("img", { name: "Memory" });
    expect(bar.querySelector("span")?.style.width).toBe("100%");
  });
});
