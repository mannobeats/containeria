import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CodeEditor } from "./code-editor";

describe("CodeEditor", () => {
  it("shows the latest value when it changed while the editor was still loading", async () => {
    const { rerender } = render(<CodeEditor label="Query" value="select 1" />);
    rerender(<CodeEditor label="Query" value="select 2" />);
    const editor = await screen.findByRole("textbox", { name: "Query" });
    await waitFor(() => expect(editor.textContent).toBe("select 2"));
  });
});
