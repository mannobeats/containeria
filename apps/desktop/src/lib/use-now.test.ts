import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useNow } from "./use-now";

afterEach(() => vi.useRealTimers());

describe("useNow", () => {
  it("reads the time afresh when it starts ticking", () => {
    vi.useFakeTimers({ now: 1000 });
    const { result, rerender } = renderHook(({ active }) => useNow(active), {
      initialProps: { active: false },
    });
    vi.setSystemTime(5000);
    rerender({ active: true });
    expect(result.current).toBe(5000);
  });
});
