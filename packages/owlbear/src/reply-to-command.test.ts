import { describe, expect, it } from "vitest";
import { replyToCommand } from "./commands.js";
import { createEncounterSync } from "./encounter-sync.js";
import { createFakeObr } from "./fake-adapter.js";
import type { ObrAdapter } from "./obr-adapter.js";

describe("replyToCommand", () => {
  it("returns the command-result carrying the id", async () => {
    const { obr } = createFakeObr();
    const sync = createEncounterSync(obr);
    expect(
      await replyToCommand(obr, sync, "c1", { name: "scene-status" }),
    ).toEqual({
      v: 1,
      type: "command-result",
      id: "c1",
      payload: {
        name: "scene-status",
        result: { sceneReady: true, tokenCount: 0, appliedInstanceCount: 0 },
      },
    });
  });

  it("turns a throwing handler into a non-fatal `command-failed` error with the id", async () => {
    const { obr: inner } = createFakeObr();
    const obr: ObrAdapter = {
      ...inner,
      isSceneReady: () => Promise.reject(new Error("host went away")),
    };
    const sync = createEncounterSync(inner);
    expect(
      await replyToCommand(obr, sync, "c2", { name: "scene-status" }),
    ).toEqual({
      v: 1,
      type: "error",
      id: "c2",
      payload: {
        code: "command-failed",
        message: "host went away",
        fatal: false,
      },
    });
  });
});
