import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Slider } from "./slider";

describe("Slider", () => {
  it("names the slider screen readers land on", () => {
    render(
      <Slider
        label="Memory"
        value={8}
        min={2}
        max={16}
        format={(gb) => `${gb} GB`}
        onChange={() => undefined}
      />,
    );
    expect(screen.queryByRole("slider", { name: "Memory" })).not.toBeNull();
  });
});
