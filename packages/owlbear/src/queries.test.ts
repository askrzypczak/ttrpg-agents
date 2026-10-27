import { describe, expect, it, vi } from "vitest";
import { makeTestInstance } from "@ttrpg-agents/engine/testing";
import { PROTOCOL_VERSION, type QueryResult } from "@ttrpg-agents/protocol";
import { describeError } from "./panel-state.js";
import { queryReply, handleQuery, replyToQuery } from "./queries.js";
import { createEncounterSync } from "./encounter-sync.js";
import { createFakeObr } from "./fake-adapter.js";
import { createMessageFeed } from "./testing/messages.js";
import {
  MissingSceneError,
  SceneModel,
  type ItemBounds,
  type Layer,
  type SceneItem,
} from "./scene-model.js";
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
      result: {
        sceneReady: true,
        tokenCount: 3,
        appliedInstanceCount: 2,
        artWaits: [],
      },
    });
  });

  it("`scene-status` on a scene that is not ready reports `sceneReady: false` and zero tokens", async () => {
    const { obr } = createFakeObr(new SceneModel("gm", false));
    const sync = createEncounterSync(obr);

    expect(await handleQuery(obr, sync, { name: "scene-status" })).toEqual({
      name: "scene-status",
      result: {
        sceneReady: false,
        tokenCount: 0,
        appliedInstanceCount: 0,
        artWaits: [],
      },
    });
  });

  it("scene-status reports the sync's art waits", async () => {
    const { obr } = createFakeObr();
    const artWaits = [
      { monsterKey: "ogre", monsterName: "Ogre", step: "pick" as const },
      { monsterKey: "wolf", monsterName: "Wolf", step: "reupload" as const },
    ];
    const sync = {
      appliedInstanceCount: () => 0,
      artWaits: () => artWaits.map((wait) => ({ ...wait })),
    };

    expect(await handleQuery(obr, sync, { name: "scene-status" })).toEqual({
      name: "scene-status",
      result: {
        sceneReady: true,
        tokenCount: 0,
        appliedInstanceCount: 0,
        artWaits,
      },
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

function itemOn(
  id: string,
  layer: Layer,
  position: { x: number; y: number },
  extra: Partial<SceneItem> = {},
): SceneItem {
  return {
    id,
    type: "IMAGE",
    name: id,
    visible: true,
    position,
    metadata: {},
    layer,
    ...extra,
  };
}

describe("handleQuery scene-tokens", () => {
  it("`scene-tokens` reports the bounds of every item on the CHARACTER and MOUNT layers, hidden ones and our own tokens included", async () => {
    const bounds: Record<string, ItemBounds> = {
      player: { min: { x: -65, y: -55 }, max: { x: 85, y: 95 } },
      hidden: { min: { x: -105, y: -29.5 }, max: { x: 45, y: 120.5 } },
      "ttrpg-instance-i1": { min: { x: 0, y: 150 }, max: { x: 300, y: 450 } },
      horse: { min: { x: 525, y: -150 }, max: { x: 675, y: 0 } },
    };
    const { obr, scene } = createFakeObr(undefined, undefined, {
      itemBounds: bounds,
    });
    scene.addItems([
      itemOn("player", "CHARACTER", { x: 10, y: 20 }),
      itemOn("hidden", "CHARACTER", { x: -30, y: 45.5 }, { visible: false }),
      itemOn(
        "ttrpg-instance-i1",
        "CHARACTER",
        { x: 150, y: 300 },
        {
          type: "SHAPE",
          metadata: { [INSTANCE_METADATA_KEY]: { instanceId: "i1" } },
        },
      ),
      itemOn("horse", "MOUNT", { x: 600, y: -75 }),
    ]);
    const sync = createEncounterSync(obr);

    expect(await handleQuery(obr, sync, { name: "scene-tokens" })).toEqual({
      name: "scene-tokens",
      result: {
        tokens: [
          { bounds: bounds["player"] },
          { bounds: bounds["hidden"] },
          { bounds: bounds["ttrpg-instance-i1"] },
          { bounds: bounds["horse"] },
        ],
      },
    });
  });

  it("`scene-tokens` leaves out items on the MAP, PROP, DRAWING, ATTACHMENT and other layers", async () => {
    const goblin: ItemBounds = {
      min: { x: 0, y: 150 },
      max: { x: 150, y: 300 },
    };
    const { obr, scene } = createFakeObr(undefined, undefined, {
      itemBounds: { goblin },
    });
    const others: Layer[] = [
      "MAP",
      "GRID",
      "DRAWING",
      "PROP",
      "ATTACHMENT",
      "NOTE",
      "TEXT",
      "RULER",
      "FOG",
      "POINTER",
      "POST_PROCESS",
      "CONTROL",
      "POPOVER",
    ];
    scene.addItems([
      ...others.map((layer, i) =>
        itemOn(`other-${layer}`, layer, { x: i, y: i }),
      ),
      itemOn("goblin", "CHARACTER", { x: 75, y: 225 }),
    ]);
    const sync = createEncounterSync(obr);

    expect(await handleQuery(obr, sync, { name: "scene-tokens" })).toEqual({
      name: "scene-tokens",
      result: { tokens: [{ bounds: goblin }] },
    });
  });

  it("`scene-tokens` on a scene that is not ready replies with a non-fatal `query-failed`", async () => {
    const { obr } = createFakeObr(new SceneModel("gm", false));
    const sync = createEncounterSync(obr);

    expect(
      await replyToQuery(obr, sync, "c9", { name: "scene-tokens" }),
    ).toEqual({
      v: PROTOCOL_VERSION,
      type: "error",
      id: "c9",
      payload: {
        code: "query-failed",
        message: describeError(new MissingSceneError()),
        fatal: false,
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
    const tokens = await handleQuery(obr, sync, { name: "scene-tokens" });

    expect(status.name).toBe("scene-status");
    expect(map.name).toBe("scene-map");
    expect(tokens.name).toBe("scene-tokens");
    expect(write).not.toHaveBeenCalled();
  });
});

describe("queryReply", () => {
  it("`queryReply` carries the query's id and result", () => {
    const result: QueryResult = {
      name: "scene-status",
      result: {
        sceneReady: true,
        tokenCount: 4,
        appliedInstanceCount: 4,
        artWaits: [],
      },
    };
    expect(queryReply("c7", result)).toEqual({
      v: PROTOCOL_VERSION,
      type: "query-result",
      id: "c7",
      payload: result,
    });
  });
});
