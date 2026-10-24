import { describe, expect, it } from "vitest";
import type { InstanceEdit } from "@ttrpg-agents/engine";
import { makeTestInstance } from "@ttrpg-agents/engine/testing";
import type { BridgeMessage } from "@ttrpg-agents/protocol";
import { createEncounterSync } from "./encounter-sync.js";
import { createFakeObr } from "./fake-adapter.js";
import type { SceneItem, SceneModel } from "./scene-model.js";
import { STAT_BUBBLES_METADATA_KEY } from "./stat-bubbles.js";
import { INSTANCE_METADATA_KEY, type EncounterInstance } from "./sync-plan.js";

const inst = (over: Partial<EncounterInstance> = {}): EncounterInstance =>
  makeTestInstance({
    id: "i1",
    displayName: "Shadow 1",
    maxHp: 16,
    currentHp: 10,
    armorClass: 12,
    ...over,
  });

const snapshot = (instance: EncounterInstance): BridgeMessage => ({
  v: 1,
  type: "encounter-snapshot",
  payload: { instances: [instance], seq: 0 },
});

/** The bridge's snapshot answering the accepted `instance-edit` for i1. */
const answer = (instance: EncounterInstance): BridgeMessage => ({
  v: 1,
  type: "encounter-snapshot",
  payload: { instances: [instance], cause: "instance-edit:i1", seq: 0 },
});

const foreign: SceneItem = {
  id: "map",
  type: "IMAGE",
  name: "Map",
  visible: true,
  position: { x: 0, y: 0 },
  metadata: {},
};

/** Lets fire-and-forget reconciles (item changes) finish. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

/** Our token for instance i1. */
const token = (scene: SceneModel): SceneItem =>
  scene
    .getItems()
    .find(
      (i) =>
        (
          i.metadata[INSTANCE_METADATA_KEY] as
            { instanceId?: string } | undefined
        )?.instanceId === "i1",
    )!;

const bubbles = (scene: SceneModel): Record<string, unknown> =>
  token(scene).metadata[STAT_BUBBLES_METADATA_KEY] as Record<string, unknown>;

/** Edits the token's stat bubbles at the table, as the GM or a player would. */
function editAtTable(scene: SceneModel, fields: Record<string, unknown>) {
  scene.setItemMetadata([
    {
      id: token(scene).id,
      key: STAT_BUBBLES_METADATA_KEY,
      value: { ...bubbles(scene), ...fields },
    },
  ]);
}

async function setup() {
  const { obr, scene } = createFakeObr();
  const edits: InstanceEdit[] = [];
  const rejected: string[] = [];
  const sync = createEncounterSync(obr, undefined, undefined, {
    onInstanceEdit: (edit) => edits.push(edit),
    onEditRejected: (text) => rejected.push(text),
  });
  await sync.handleMessage(snapshot(inst()));
  await settle();
  return { sync, scene, edits, rejected };
}

describe("createEncounterSync table edit write-back", () => {
  it("createEncounterSync sends one instance-edit per table edit and not again on the next item change", async () => {
    const { sync, scene, edits } = await setup();
    expect(edits).toEqual([]);

    editAtTable(scene, { health: 5 });
    await settle();
    expect(edits).toEqual([{ instanceId: "i1", currentHp: 5 }]);

    // An unrelated item change does not send it again.
    scene.addItems([foreign]);
    await settle();
    expect(edits).toHaveLength(1);

    // The bridge answers with the stored edit: nothing more is sent and the
    // table keeps the value.
    await sync.handleMessage(answer(inst({ currentHp: 5 })));
    await settle();
    expect(edits).toHaveLength(1);
    expect(bubbles(scene).health).toBe(5);

    // A second table edit is sent once too.
    editAtTable(scene, { "max health": 20 });
    await settle();
    expect(edits).toEqual([
      { instanceId: "i1", currentHp: 5 },
      { instanceId: "i1", maxHp: 20 },
    ]);
  });

  it("a refused edit leaves the token unchanged and causes no reconcile", async () => {
    const { obr, scene } = createFakeObr();
    const edits: InstanceEdit[] = [];
    let applied = 0;
    const sync = createEncounterSync(obr, undefined, () => applied++, {
      onInstanceEdit: (edit) => edits.push(edit),
    });
    await sync.handleMessage(snapshot(inst()));
    await settle();
    editAtTable(scene, { health: 5 });
    await settle();
    expect(edits).toEqual([{ instanceId: "i1", currentHp: 5 }]);
    const appliedBefore = applied;
    const itemsBefore = JSON.stringify(scene.getItems());

    await sync.handleMessage({
      v: 1,
      type: "error",
      id: "instance-edit:i1",
      payload: { code: "unknown_instance", message: "gone", fatal: false },
    });
    await settle();

    expect(applied).toBe(appliedBefore);
    expect(JSON.stringify(scene.getItems())).toBe(itemsBefore);
    expect(bubbles(scene).health).toBe(5);
    expect(edits).toHaveLength(1);
  });

  it("createEncounterSync reports an unparseable value once per snapshot", async () => {
    const { sync, scene, edits, rejected } = await setup();

    editAtTable(scene, { health: "lots" });
    await settle();
    expect(rejected).toHaveLength(1);

    // More reconciles without a new snapshot report nothing new.
    scene.addItems([foreign]);
    await settle();
    expect(rejected).toHaveLength(1);

    // A new snapshot reports it again; the value stays on the table.
    await sync.handleMessage(snapshot(inst()));
    await settle();
    expect(rejected).toHaveLength(2);
    expect(bubbles(scene).health).toBe("lots");
    expect(edits).toEqual([]);
  });
});
