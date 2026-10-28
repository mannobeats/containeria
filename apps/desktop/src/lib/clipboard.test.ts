import { toast } from "sonner";
import { describe, expect, it, vi } from "vitest";

import { copyText } from "./clipboard";

vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  writeText: () => Promise.reject(new Error("The pasteboard is locked")),
}));

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));

describe("copyText", () => {
  it("says when the clipboard refused the text", async () => {
    copyText("Command", "kubectl get pods");
    await vi.waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Command wasn't copied", {
        description: "The pasteboard is locked",
      }),
    );
    expect(toast).not.toHaveBeenCalled();
  });
});
