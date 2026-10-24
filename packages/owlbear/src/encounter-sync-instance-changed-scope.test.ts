import { describe, expect, it } from "vitest";
import { makeTestInstance } from "@ttrpg-agents/engine/testing";
import { createEncounterSync } from "./encounter-sync.js";
import { createFakeObr } from "./fake-adapter.js";
import type { SceneItem, SceneModel } from "./scene-model.js";
import { STAT_BUBBLES_METADATA_KEY } from "./stat-bubbles.js";
import { INSTANCE_METADATA_KEY } from "./sync-plan.js";

/** The token of the instance with `instanceId`. */
const tokenOf = (scene: SceneModel, instanceId: string): SceneItem => {
  const found = scene
    .getItems()
    .find(
      (i) =>
        (
          i.metadata[INSTANCE_METADATA_KEY] as
            { instanceId?: string } | undefined
        )?.instanceId === instanceId,
    );
  if (!found) throw new Error(`no token for ${instanceId}`);
  return found;
};

async function syncWithTwoInstances() {
  const { obr, scene } = createFakeObr();
  const sync = createEncounterSync(obr);
  await sync.handleMessage({
    v: 1,
    type: "encounter-snapshot",
    payload: {
      instances: [
        makeTestInstance({
          id: "i1",
          displayName: "Shadow 1",
          armorClass: 12,
        }),
        makeTestInstance({
          id: "i2",
          displayName: "Shadow 2",
          armorClass: 12,
        }),
      ],
      seq: 0,
    },
  });
  return { sync, scene };
}

describe("createEncounterSync instance-changed scope", () => {
  it("an instance-changed event changes only the instance it names", async () => {
    const { sync, scene } = await syncWithTwoInstances();

    await sync.handleMessage({
      v: 1,
      type: "encounter-event",
      payload: {
        type: "instance-changed",
        id: "i1",
        changes: { name: "Boss" },
        origin: { source: "mcp", commandId: "c1" },
        seq: 1,
      },
    });

    expect(tokenOf(scene, "i1").name).toBe("Boss");
    expect(tokenOf(scene, "i2").name).toBe("Shadow 2");
  });

  it("an instance-changed event without a name keeps the instance's name", async () => {
    const { sync, scene } = await syncWithTwoInstances();

    await sync.handleMessage({
      v: 1,
      type: "encounter-event",
      payload: {
        type: "instance-changed",
        id: "i1",
        changes: { armorClass: 18 },
        origin: { source: "mcp", commandId: "c2" },
        seq: 1,
      },
    });

    expect(tokenOf(scene, "i1").name).toBe("Shadow 1");
    expect(
      tokenOf(scene, "i1").metadata[STAT_BUBBLES_METADATA_KEY],
    ).toMatchObject({ "armor class": 18 });
  });

  it("a token the table renamed keeps that name after an instance-changed event without a name", async () => {
    const { sync, scene } = await syncWithTwoInstances();

    await sync.handleMessage({
      v: 1,
      type: "encounter-event",
      payload: {
        type: "instance-changed",
        id: "i1",
        changes: { armorClass: 18 },
        origin: { source: "mcp", commandId: "c3" },
        seq: 1,
      },
    });
    scene.updateItems([tokenOf(scene, "i1").id], { name: "Gargoyle" });
    await sync.handleMessage({
      v: 1,
      type: "encounter-snapshot",
      payload: {
        instances: [
          makeTestInstance({
            id: "i1",
            displayName: "Shadow 1",
            armorClass: 18,
          }),
          makeTestInstance({
            id: "i2",
            displayName: "Shadow 2",
            armorClass: 12,
          }),
        ],
        seq: 1,
      },
    });

    expect(tokenOf(scene, "i1").name).toBe("Gargoyle");
  });
});
