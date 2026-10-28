import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Progress } from "./progress";

const reading = () =>
  screen.getByRole("progressbar", { name: "Pulling" }).getAttribute("aria-valuenow");

describe("Progress", () => {
  it("reads 100% when the value overshoots 1", () => {
    render(<Progress label="Pulling" value={1.2} />);
    expect(reading()).toBe("100");
  });

  it("reads 0% for a negative value", () => {
    render(<Progress label="Pulling" value={-0.1} />);
    expect(reading()).toBe("0");
  });
});
