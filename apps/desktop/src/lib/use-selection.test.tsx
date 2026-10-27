import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useSelection, useSelectionKeys } from "./use-selection";

const ids = ["a", "b", "c", "d"];
const plain = { metaKey: false, shiftKey: false };

describe("useSelection", () => {
  it("toggles with ⌘-click and selects a range with ⇧-click", () => {
    const { result } = renderHook(() => useSelection(ids));
    act(() => result.current.click("b", { ...plain, metaKey: true }));
    act(() => result.current.click("d", { ...plain, shiftKey: true }));
    expect(result.current.chosen).toEqual(["b", "c", "d"]);
    expect(result.current.all).toBe("indeterminate");
    act(() => result.current.click("a", plain));
    expect(result.current.chosen).toHaveLength(3);
  });

  it("selects only what can be selected, and forgets rows that go away", () => {
    const { result, rerender } = renderHook(({ shown }) => useSelection(shown), {
      initialProps: { shown: ids },
    });
    act(() => result.current.setAll(true));
    expect(result.current.all).toBe(true);
    rerender({ shown: ["a", "b"] });
    expect(result.current.chosen).toEqual(["a", "b"]);
    act(() => result.current.clear());
    expect(result.current.all).toBe(false);
  });

  it("deletes with ⌘⌫ and lets go with Esc", () => {
    const onDelete = vi.fn();
    const { result } = renderHook(() => {
      const selection = useSelection(ids);
      useSelectionKeys(selection, onDelete);
      return selection;
    });
    act(() => result.current.toggle("a"));
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", metaKey: true }));
    });
    expect(onDelete).toHaveBeenCalledOnce();
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(result.current.chosen).toEqual([]);
  });
});
