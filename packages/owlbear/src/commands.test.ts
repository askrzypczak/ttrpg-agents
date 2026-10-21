import { describe, expect, it } from "vitest";
import { PROTOCOL_VERSION, type CommandResult } from "@ttrpg-agents/protocol";
import { commandReply, handleCommand } from "./commands.js";
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

describe("handleCommand scene-status", () => {
  it("`scene-status` on a ready scene counts only our tokens and reports `sceneReady: true` (AC4)", async () => {
    const { obr, scene } = createFakeObr();
    const sync = createEncounterSync(obr);
    await sync.handleMessage({
      v: 1,
      type: "encounter-snapshot",
      payload: { instances: [inst(1), inst(2)] },
    });
    // A foreign item, and one of our tokens the sync did not place.
    scene.addItems([foreign, unplaced]);

    expect(await handleCommand(obr, sync, { name: "scene-status" })).toEqual({
      name: "scene-status",
      result: { sceneReady: true, tokenCount: 3, appliedInstanceCount: 2 },
    });
  });

  it("`scene-status` on a scene that is not ready reports `sceneReady: false` and zero tokens (AC4)", async () => {
    const { obr } = createFakeObr(new SceneModel("gm", false));
    const sync = createEncounterSync(obr);

    expect(await handleCommand(obr, sync, { name: "scene-status" })).toEqual({
      name: "scene-status",
      result: { sceneReady: false, tokenCount: 0, appliedInstanceCount: 0 },
    });
  });
});

describe("commandReply", () => {
  it("`commandReply` carries the command's id and result (AC4)", () => {
    const result: CommandResult = {
      name: "scene-status",
      result: { sceneReady: true, tokenCount: 4, appliedInstanceCount: 4 },
    };
    expect(commandReply("c7", result)).toEqual({
      v: PROTOCOL_VERSION,
      type: "command-result",
      id: "c7",
      payload: result,
    });
  });
});
