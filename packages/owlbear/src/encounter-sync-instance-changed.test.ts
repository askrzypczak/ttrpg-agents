import { describe, expect, it } from "vitest";
import { makeTestInstance } from "@ttrpg-agents/engine/testing";
import { createEncounterSync } from "./encounter-sync.js";
import { createFakeObr } from "./fake-adapter.js";
import type { SceneItem, SceneModel } from "./scene-model.js";
import { STAT_BUBBLES_METADATA_KEY } from "./stat-bubbles.js";
import { INSTANCE_METADATA_KEY } from "./sync-plan.js";

/** Our token for instance `i1`. */
const token = (scene: SceneModel): SceneItem => {
  const found = scene
    .getItems()
    .find(
      (i) =>
        (
          i.metadata[INSTANCE_METADATA_KEY] as
            { instanceId?: string } | undefined
        )?.instanceId === "i1",
    );
  if (!found) throw new Error("no token for i1");
  return found;
};

describe("createEncounterSync instance-changed", () => {
  it("the extension fold applies instance-changed fields to the instance", async () => {
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
            statsVisible: false,
          }),
        ],
        seq: 0,
      },
    });
    expect(token(scene).name).toBe("Shadow 1");

    await sync.handleMessage({
      v: 1,
      type: "encounter-event",
      payload: {
        type: "instance-changed",
        id: "i1",
        changes: { name: "Boss", armorClass: 18, statsVisible: true },
        origin: { source: "mcp", commandId: "c1" },
        seq: 1,
      },
    });

    const changed = token(scene);
    expect(changed.name).toBe("Boss");
    expect(changed.metadata[STAT_BUBBLES_METADATA_KEY]).toMatchObject({
      "armor class": 18,
      hide: false,
    });
  });
});
