import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LogView } from "./log-view";

let height = 0;

beforeEach(() => {
  height = 1000;
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(() => height);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(200);
});

afterEach(() => vi.restoreAllMocks());

const lines = (count: number) => Array.from({ length: count }, (_, index) => `line ${index}`);

describe("LogView", () => {
  it("opens at the end", () => {
    render(<LogView label="Build" lines={lines(50)} />);
    expect(screen.getByRole("log", { name: "Build" }).scrollTop).toBe(1000);
  });

  it("follows a batch of new lines taller than the threshold", () => {
    const { rerender } = render(<LogView label="Build" lines={lines(50)} />);
    height = 1400;
    rerender(<LogView label="Build" lines={lines(70)} />);
    expect(screen.getByRole("log", { name: "Build" }).scrollTop).toBe(1400);
  });

  it("stays put once scrolled up", () => {
    const { rerender } = render(<LogView label="Build" lines={lines(50)} />);
    const log = screen.getByRole("log", { name: "Build" });
    log.scrollTop = 100;
    fireEvent.scroll(log);
    height = 1400;
    rerender(<LogView label="Build" lines={lines(70)} />);
    expect(log.scrollTop).toBe(100);
  });
});
