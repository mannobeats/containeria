import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { describe, expect, it, vi } from "vitest";

import { useRemoveMany } from "./use-remove-many";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
);

function render(remove: (name: string) => Promise<unknown>) {
  return renderHook(
    () => useRemoveMany({ remove, name: (item) => item, noun: "image", invalidates: ["images"] }),
    { wrapper },
  ).result;
}

describe("useRemoveMany", () => {
  it("deletes each one and says how many went", async () => {
    const remove = vi.fn(() => Promise.resolve());
    const result = render(remove);
    await act(() => result.current.mutateAsync(["a", "b"]));
    expect(remove.mock.calls).toEqual([["a"], ["b"]]);
    expect(toast.success).toHaveBeenCalledWith("Deleted 2 images");
  });

  it("keeps going past a failure and says why it failed", async () => {
    const result = render((name) =>
      name === "busy" ? Promise.reject(new Error("in use")) : Promise.resolve(),
    );
    await act(() => result.current.mutateAsync(["busy", "free"]));
    expect(toast.error).toHaveBeenCalledWith("1 image wasn't deleted", {
      description: "busy: in use",
    });
  });
});
