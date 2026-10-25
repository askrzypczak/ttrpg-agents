import { describe, expect, it } from "vitest";
import { makeTestInstance } from "@ttrpg-agents/engine/testing";
import { createEncounterSync } from "./encounter-sync.js";
import { createFakeObr } from "./fake-adapter.js";
import { createMessageFeed } from "./testing/messages.js";
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
  const feed = createMessageFeed();
  await sync.handleMessage(
    feed.snapshot([
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
    ]),
  );
  return { sync, scene, feed };
}

describe("createEncounterSync instance-changed scope", () => {
  it("an instance-changed event changes only the instance it names", async () => {
    const { sync, scene, feed } = await syncWithTwoInstances();

    await sync.handleMessage(
      feed.event({
        type: "instance-changed",
        id: "i1",
        changes: { name: "Boss" },
      }),
    );

    expect(tokenOf(scene, "i1").name).toBe("Boss");
    expect(tokenOf(scene, "i2").name).toBe("Shadow 2");
  });

  it("an instance-changed event without a name keeps the instance's name", async () => {
    const { sync, scene, feed } = await syncWithTwoInstances();

    await sync.handleMessage(
      feed.event({
        type: "instance-changed",
        id: "i1",
        changes: { armorClass: 18 },
      }),
    );

    expect(tokenOf(scene, "i1").name).toBe("Shadow 1");
    expect(
      tokenOf(scene, "i1").metadata[STAT_BUBBLES_METADATA_KEY],
    ).toMatchObject({ "armor class": 18 });
  });

  it("a token the table renamed keeps that name after an instance-changed event without a name", async () => {
    const { sync, scene, feed } = await syncWithTwoInstances();

    await sync.handleMessage(
      feed.event({
        type: "instance-changed",
        id: "i1",
        changes: { armorClass: 18 },
      }),
    );
    scene.updateItems([tokenOf(scene, "i1").id], { name: "Gargoyle" });
    await sync.handleMessage(
      feed.snapshot([
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
      ]),
    );

    expect(tokenOf(scene, "i1").name).toBe("Gargoyle");
  });
});
