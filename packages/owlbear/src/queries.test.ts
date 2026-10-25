import { describe, expect, it, vi } from "vitest";
import { makeTestInstance } from "@ttrpg-agents/engine/testing";
import { PROTOCOL_VERSION, type QueryResult } from "@ttrpg-agents/protocol";
import { queryReply, handleQuery } from "./queries.js";
import { createEncounterSync } from "./encounter-sync.js";
import { createFakeObr } from "./fake-adapter.js";
import { createMessageFeed } from "./testing/messages.js";
import { SceneModel, type SceneItem } from "./scene-model.js";
import { INSTANCE_METADATA_KEY, type EncounterInstance } from "./sync-plan.js";

const inst = (n: number): EncounterInstance =>
  makeTestInstance({ id: `i${n}`, displayName: `Shadow ${n}`, createdAt: n });

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
    await sync.handleMessage(createMessageFeed().snapshot([inst(1), inst(2)]));
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

describe("handleQuery scene-map", () => {
  it("`scene-map` answers the scene grid and, for each image on the map layer, its id, name, image size, image grid and transform", async () => {
    const { obr, scene } = createFakeObr(new SceneModel(), undefined, {
      grid: { dpi: 140, type: "HEX_VERTICAL" },
    });
    const map: SceneItem = {
      id: "map-1",
      type: "IMAGE",
      name: "Trollskull Manor",
      visible: true,
      position: { x: 300, y: -150 },
      metadata: {},
      layer: "MAP",
      rotation: 270,
      scale: { x: 1.5, y: 1.5 },
      image: {
        url: "https://example.test/map.png",
        mime: "image/png",
        width: 3000,
        height: 4000,
      },
      grid: { dpi: 125, offset: { x: 40, y: 60 } },
    };
    const token: SceneItem = {
      id: "token-1",
      type: "IMAGE",
      name: "Goblin",
      visible: true,
      position: { x: 10, y: 20 },
      metadata: {},
      layer: "CHARACTER",
      rotation: 0,
      scale: { x: 1, y: 1 },
      image: {
        url: "https://example.test/goblin.png",
        mime: "image/png",
        width: 300,
        height: 300,
      },
      grid: { dpi: 300, offset: { x: 150, y: 150 } },
    };
    const shape: SceneItem = {
      id: "shape-1",
      type: "SHAPE",
      name: "Area",
      visible: true,
      position: { x: 0, y: 0 },
      metadata: {},
      layer: "MAP",
      shape: { shapeType: "RECTANGLE", width: 100, height: 100 },
    };
    scene.addItems([map, token, shape]);
    const sync = createEncounterSync(obr);

    expect(await handleQuery(obr, sync, { name: "scene-map" })).toEqual({
      name: "scene-map",
      result: {
        grid: { dpi: 140, type: "HEX_VERTICAL" },
        maps: [
          {
            id: "map-1",
            name: "Trollskull Manor",
            imageWidth: 3000,
            imageHeight: 4000,
            imageDpi: 125,
            imageOffset: { x: 40, y: 60 },
            position: { x: 300, y: -150 },
            rotation: 270,
            scale: { x: 1.5, y: 1.5 },
          },
        ],
      },
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

    const status = await handleQuery(obr, sync, { name: "scene-status" });
    const map = await handleQuery(obr, sync, { name: "scene-map" });

    expect(status.name).toBe("scene-status");
    expect(map.name).toBe("scene-map");
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
