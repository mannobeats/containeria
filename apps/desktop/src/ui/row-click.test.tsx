import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { renderWithApp } from "@/test/harness";

import { Row, Table } from "./table";

function images(opened: (name: string) => void, acted = () => undefined) {
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
          <td />
        </Row>
        <Row>
          <td>
            <button type="button" data-row-link onClick={() => opened("redis")}>
              redis
            </button>
          </td>
          <td>117 MB</td>
          <td>
            <button type="button" onClick={acted}>
              Delete redis
            </button>
          </td>
        </Row>
      </tbody>
    </Table>,
  );
}

describe("openRowOnClick", () => {
  it("opens the link of the row whose cell was clicked", async () => {
    const opened = vi.fn();
    images(opened);
    await userEvent.click(await screen.findByText("117 MB"));
    expect(opened).toHaveBeenCalledExactlyOnceWith("redis");
  });

  it("leaves a click on a row's own button to that button", async () => {
    const opened = vi.fn();
    const acted = vi.fn();
    images(opened, acted);
    await userEvent.click(await screen.findByRole("button", { name: "Delete redis" }));
    expect(acted).toHaveBeenCalledOnce();
    expect(opened).not.toHaveBeenCalled();
  });

  it("doesn't open the row on a ⌘-click, which selects it instead", async () => {
    const opened = vi.fn();
    images(opened);
    const user = userEvent.setup();
    await user.keyboard("{Meta>}");
    await user.click(await screen.findByText("117 MB"));
    await user.keyboard("{/Meta}");
    expect(opened).not.toHaveBeenCalled();
  });
});
