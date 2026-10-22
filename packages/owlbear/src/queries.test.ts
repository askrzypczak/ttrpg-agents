import { describe, expect, it, vi } from "vitest";
import { PROTOCOL_VERSION, type QueryResult } from "@ttrpg-agents/protocol";
import { queryReply, handleQuery } from "./queries.js";
import { createEncounterSync } from "./encounter-sync.js";
import { createFakeObr } from "./fake-adapter.js";
import { SceneModel, type SceneItem } from "./scene-model.js";
import { INSTANCE_METADATA_KEY, type EncounterInstance } from "./sync-plan.js";

const inst = (n: number): EncounterInstance => ({
  id: `i${n}`,
  encounterId: "e1",
  monsterKey: "shadow",
  displayName: `Shadow ${n}`,
  maxHp: 16,
  currentHp: 16,
  initiative: null,
  groupId: null,
  createdAt: n,
});

const foreign: SceneItem = {
  id: "map",
  type: "IMAGE",
  name: "Map",
  visible: true,
  position: { x: 0, y: 0 },
  metadata: { "other.ext/thing": { instanceId: "i9" } },
};

const unplaced: SceneItem = {
  id: "ttrpg-instance-i3",
  type: "SHAPE",
  name: "Shadow 3",
  visible: false,
  position: { x: 0, y: 0 },
  metadata: { [INSTANCE_METADATA_KEY]: { instanceId: "i3" } },
};

describe("handleQuery scene-status", () => {
  it("`scene-status` on a ready scene counts only our tokens and reports `sceneReady: true`", async () => {
    const { obr, scene } = createFakeObr();
    const sync = createEncounterSync(obr);
    await sync.handleMessage({
      v: 1,
      type: "encounter-snapshot",
      payload: { instances: [inst(1), inst(2)] },
    });
    // A foreign item, and one of our tokens the sync did not place.
    scene.addItems([foreign, unplaced]);

    expect(await handleQuery(obr, sync, { name: "scene-status" })).toEqual({
      name: "scene-status",
      result: { sceneReady: true, tokenCount: 3, appliedInstanceCount: 2 },
    });
  });

  it("`scene-status` on a scene that is not ready reports `sceneReady: false` and zero tokens", async () => {
    const { obr } = createFakeObr(new SceneModel("gm", false));
    const sync = createEncounterSync(obr);

    expect(await handleQuery(obr, sync, { name: "scene-status" })).toEqual({
      name: "scene-status",
      result: { sceneReady: false, tokenCount: 0, appliedInstanceCount: 0 },
    });
  });
});

describe("handleQuery read-only guard", () => {
  it("handleQuery makes no write call on the adapter", async () => {
    const { obr: base } = createFakeObr();
    const write = vi.fn(() => {
      throw new Error("write call during a query");
    });
    const obr = {
      ...base,
      addItems: write,
      updateItems: write,
      setItemMetadata: write,
      deleteItems: write,
      setSceneMetadata: write,
    };

    const sync = createEncounterSync(obr);

    const result = await handleQuery(obr, sync, { name: "scene-status" });

    expect(result.name).toBe("scene-status");
    expect(write).not.toHaveBeenCalled();
  });
});

describe("queryReply", () => {
  it("`queryReply` carries the query's id and result", () => {
    const result: QueryResult = {
      name: "scene-status",
      result: { sceneReady: true, tokenCount: 4, appliedInstanceCount: 4 },
    };
    expect(queryReply("c7", result)).toEqual({
      v: PROTOCOL_VERSION,
      type: "query-result",
      id: "c7",
      payload: result,
    });
  });
});
