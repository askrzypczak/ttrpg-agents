import { describe, expect, it } from "vitest";
import { replyToQuery } from "./queries.js";
import { createEncounterSync } from "./encounter-sync.js";
import { createFakeObr } from "./fake-adapter.js";
import { TEST_SCENE_ID } from "./testing/messages.js";
import type { ObrAdapter } from "./obr-adapter.js";
import { PROTOCOL_VERSION } from "@ttrpg-agents/protocol";

describe("replyToQuery", () => {
  it("returns the query-result carrying the id", async () => {
    const { obr } = createFakeObr();
    const sync = createEncounterSync(obr);
    expect(
      await replyToQuery(obr, sync, "c1", { name: "scene-status" }),
    ).toEqual({
      v: PROTOCOL_VERSION,
      type: "query-result",
      id: "c1",
      payload: {
        name: "scene-status",
        result: {
          sceneReady: true,
          tokenCount: 0,
          appliedInstanceCount: 0,
          artWaits: [],
          roomId: "fake-room",
          sceneId: TEST_SCENE_ID,
          heldEncounterId: null,
          unmanagedTokenCount: 0,
        },
      },
    });
  });

  it("turns a throwing handler into a non-fatal `query-failed` error with the id", async () => {
    const { obr: inner } = createFakeObr();
    const obr: ObrAdapter = {
      ...inner,
      isSceneReady: () => Promise.reject(new Error("host went away")),
    };
    const sync = createEncounterSync(inner);
    expect(
      await replyToQuery(obr, sync, "c2", { name: "scene-status" }),
    ).toEqual({
      v: PROTOCOL_VERSION,
      type: "error",
      id: "c2",
      payload: {
        code: "query-failed",
        message: "host went away",
        fatal: false,
      },
    });
  });
});
