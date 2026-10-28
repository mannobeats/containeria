import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { renderWithApp } from "@/test/harness";

import { FaceStack } from "./face-stack";

describe("FaceStack", () => {
  it("names every container, not only in the hover tip", async () => {
    renderWithApp(
      <FaceStack
        faces={[
          { id: "1", name: "web", running: true },
          { id: "2", name: "db", running: false },
        ]}
      />,
    );
    expect(await screen.findByText("web, db")).toBeDefined();
  });
});
