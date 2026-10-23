import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { renderWithApp } from "@/test/harness";

import { Row, Table } from "./table";

describe("openRowOnClick", () => {
  it("opens the row that was clicked, and leaves the row's own buttons to themselves", async () => {
    const opened = vi.fn();
    const acted = vi.fn();
    renderWithApp(
      <Table label="Images">
        <tbody>
          <Row>
            <td>
              <button type="button" data-row-link onClick={() => opened("alpine")}>
                alpine
              </button>
            </td>
            <td>13.6 MB</td>
          </Row>
          <Row>
            <td>
              <button type="button" data-row-link onClick={() => opened("redis")}>
                redis
              </button>
            </td>
            <td>
              <button type="button" onClick={acted}>
                Delete redis
              </button>
            </td>
          </Row>
        </tbody>
      </Table>,
    );
    await userEvent.click(await screen.findByText("13.6 MB"));
    expect(opened).toHaveBeenCalledWith("alpine");
    await userEvent.click(screen.getByRole("button", { name: "Delete redis" }));
    expect(acted).toHaveBeenCalledOnce();
    expect(opened).toHaveBeenCalledOnce();
  });
});
