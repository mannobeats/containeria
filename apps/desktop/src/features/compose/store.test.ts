import { beforeEach, describe, expect, it } from "vitest";

import { mockCommands, sendToChannel } from "@/test/harness";

import { startRun, useCompose } from "./store";

beforeEach(() => {
  mockCommands({});
  useCompose.setState({ draft: null, run: null, runVisible: false });
});

describe("startRun", () => {
  it("ignores output from a run that a newer run replaced", () => {
    let first: unknown;
    startRun({
      title: "Building web",
      done: "web was built",
      start: (channel) => {
        first = channel;
        return new Promise(() => undefined);
      },
    });
    startRun({
      title: "Pushing web",
      done: "web was pushed",
      start: () => new Promise(() => undefined),
    });
    sendToChannel(first, { kind: "line", text: "Step 1/3" });
    sendToChannel(first, { kind: "done" });
    expect(useCompose.getState().run).toMatchObject({
      title: "Pushing web",
      lines: [],
      status: "running",
    });
  });

  it("keeps the first failure when the channel and the command both report one", async () => {
    let reject: (error: unknown) => void = () => undefined;
    startRun({
      title: "Updating shop",
      done: "shop is up to date",
      start: (channel) => {
        sendToChannel(channel, { kind: "failed", message: "pull access denied" });
        return new Promise((_, fail) => {
          reject = fail;
        });
      },
    });
    reject({ kind: "engine", message: "compose exited with 1" });
    await new Promise((resolve) => setTimeout(resolve));
    expect(useCompose.getState().run).toMatchObject({
      status: "failed",
      message: "pull access denied",
    });
  });
});
