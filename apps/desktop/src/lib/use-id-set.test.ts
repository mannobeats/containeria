import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useIdSet } from "./use-id-set";

describe("useIdSet", () => {
  it("adds, removes, toggles and clears", () => {
    const { result } = renderHook(() => useIdSet());
    act(() => result.current.set(["a", "b"], true));
    expect([...result.current.ids]).toEqual(["a", "b"]);
    act(() => result.current.set(["a"], false));
    act(() => result.current.toggle("c"));
    act(() => result.current.toggle("b"));
    expect([...result.current.ids]).toEqual(["c"]);
    act(() => result.current.clear());
    expect(result.current.ids.size).toBe(0);
  });
});
