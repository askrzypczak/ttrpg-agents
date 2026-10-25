import { describe, expect, it } from "vitest";
import { makeTestInstance } from "@ttrpg-agents/engine/testing";
import { createEncounterSync } from "./encounter-sync.js";
import { createFakeObr } from "./fake-adapter.js";
import { createMessageFeed } from "./testing/messages.js";
import type { SceneItem, SceneModel } from "./scene-model.js";
import { STAT_BUBBLES_METADATA_KEY } from "./stat-bubbles.js";
import { INSTANCE_METADATA_KEY } from "./sync-plan.js";

/** Our token for instance `n`. */
const tokenOf = (scene: SceneModel, n: number): SceneItem => {
  const found = scene
    .getItems()
    .find(
      (i) =>
        (
          i.metadata[INSTANCE_METADATA_KEY] as
            { instanceId?: string } | undefined
        )?.instanceId === `i${n}`,
    );
  if (!found) throw new Error(`no token for i${n}`);
  return found;
};

describe("createEncounterSync stat bubbles", () => {
  it("an hp-changed event updates the token's stat bubbles health", async () => {
    const { obr, scene } = createFakeObr();
    const sync = createEncounterSync(obr);
    const feed = createMessageFeed();
    await sync.handleMessage(
      feed.snapshot([
        makeTestInstance({
          id: "i1",
          displayName: "Shadow 1",
          maxHp: 16,
          currentHp: 16,
        }),
      ]),
    );
    await sync.handleMessage(
      feed.event({ type: "hp-changed", id: "i1", currentHp: 3, maxHp: 20 }),
    );

    const metadata = tokenOf(scene, 1).metadata;
    expect(metadata[STAT_BUBBLES_METADATA_KEY]).toMatchObject({
      health: 3,
      "max health": 20,
    });
    expect(metadata[INSTANCE_METADATA_KEY]).toEqual({ instanceId: "i1" });
  });
});
