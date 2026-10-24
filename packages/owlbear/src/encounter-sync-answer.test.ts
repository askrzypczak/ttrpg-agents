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
    displayName: "Goblin 2",
    maxHp: 16,
    currentHp: 10,
    armorClass: 12,
    ...over,
  });

const snapshot = (instance: EncounterInstance): BridgeMessage => ({
  v: 1,
  type: "encounter-snapshot",
  payload: { instances: [instance] },
});

/** The bridge's snapshot answering the accepted `instance-edit` for `id`. */
const answer = (instance: EncounterInstance, id = "i1"): BridgeMessage => ({
  v: 1,
  type: "encounter-snapshot",
  payload: { instances: [instance], cause: `instance-edit:${id}` },
});

const hpChanged = (currentHp: number): BridgeMessage => ({
  v: 1,
  type: "encounter-event",
  payload: { type: "hp-changed", id: "i1", currentHp, maxHp: 16 },
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

/** Edits the token's stat bubbles at the table, as the GM would. */
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
  const notes: string[] = [];
  const sync = createEncounterSync(obr, undefined, undefined, {
    onInstanceEdit: (edit) => edits.push(edit),
    onEditDiffers: (text) => notes.push(text),
  });
  await sync.handleMessage(snapshot(inst()));
  await settle();
  return { sync, scene, edits, notes };
}

describe("createEncounterSync after a write-back answer", () => {
  it("a clamped answer leaves the typed value on the token", async () => {
    const { sync, scene, edits } = await setup();
    editAtTable(scene, { health: 99 });
    await settle();
    expect(edits).toEqual([{ instanceId: "i1", currentHp: 99 }]);

    // The store clamped 99 to max HP.
    await sync.handleMessage(answer(inst({ currentHp: 16 })));
    await settle();

    expect(bubbles(scene).health).toBe(99);
    expect(edits).toHaveLength(1);
  });

  it("two edits before the answers are not overwritten by the older answer", async () => {
    const { sync, scene, edits } = await setup();
    editAtTable(scene, { health: 5 });
    await settle();
    editAtTable(scene, { health: 7 });
    await settle();
    expect(edits).toEqual([
      { instanceId: "i1", currentHp: 5 },
      { instanceId: "i1", currentHp: 7 },
    ]);

    await sync.handleMessage(answer(inst({ currentHp: 5 })));
    await settle();
    expect(bubbles(scene).health).toBe(7);

    await sync.handleMessage(answer(inst({ currentHp: 7 })));
    await settle();
    expect(bubbles(scene).health).toBe(7);
    expect(edits).toHaveLength(2);
  });

  it("a clamped answer is not sent again on later reconciles", async () => {
    const { sync, scene, edits } = await setup();
    editAtTable(scene, { health: 99 });
    await settle();
    await sync.handleMessage(answer(inst({ currentHp: 16 })));
    await settle();

    // Later reconciles: an item change, then a snapshot of the unchanged store.
    scene.addItems([foreign]);
    await settle();
    await sync.handleMessage(snapshot(inst({ currentHp: 16 })));
    await settle();
    scene.addItems([{ ...foreign, id: "map2" }]);
    await settle();

    expect(edits).toEqual([{ instanceId: "i1", currentHp: 99 }]);
    expect(bubbles(scene).health).toBe(99);
  });

  it("a clamped answer reports the note once through onEditDiffers", async () => {
    const { sync, scene, notes } = await setup();
    editAtTable(scene, { health: 99 });
    await settle();
    expect(notes).toEqual([]);

    await sync.handleMessage(answer(inst({ currentHp: 16 })));
    await settle();

    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain("HP");
    expect(notes[0]).toContain("16");
    expect(notes[0]).toContain("99");
    expect(notes[0]).toContain("Goblin 2");

    // Later reconciles report nothing more.
    scene.addItems([foreign]);
    await settle();
    expect(notes).toHaveLength(1);
  });

  it("an MCP event after an answer is pushed", async () => {
    const { sync, scene, edits } = await setup();
    editAtTable(scene, { health: 99 });
    await settle();
    await sync.handleMessage(answer(inst({ currentHp: 16 })));
    await settle();
    expect(bubbles(scene).health).toBe(99);

    await sync.handleMessage(hpChanged(12));
    await settle();

    expect(bubbles(scene).health).toBe(12);
    expect(edits).toHaveLength(1);
  });

  it("an MCP event folded in before the answer's reconcile still pushes", async () => {
    const { sync, scene } = await setup();
    editAtTable(scene, { health: 99 });
    await settle();

    // Both arrive before either reconcile runs.
    await Promise.all([
      sync.handleMessage(answer(inst({ currentHp: 16 }))),
      sync.handleMessage(hpChanged(12)),
    ]);
    await settle();

    expect(bubbles(scene).health).toBe(12);
  });

  it("a snapshot without a cause still pushes store changes", async () => {
    const { sync, scene, edits } = await setup();
    editAtTable(scene, { health: 5 });
    await settle();
    expect(edits).toEqual([{ instanceId: "i1", currentHp: 5 }]);

    // A snapshot of the unchanged store is no answer: the typed value stays.
    await sync.handleMessage(snapshot(inst()));
    await settle();
    expect(bubbles(scene).health).toBe(5);
    expect(edits).toHaveLength(1);

    // A store change is pushed.
    await sync.handleMessage(snapshot(inst({ currentHp: 12 })));
    await settle();
    expect(bubbles(scene).health).toBe(12);
  });

  it("a cause naming an instance missing from the snapshot is ignored", async () => {
    const { sync, scene, edits, notes } = await setup();
    editAtTable(scene, { health: 5 });
    await settle();

    await sync.handleMessage(answer(inst(), "ghost"));
    await settle();

    expect(bubbles(scene).health).toBe(5);
    expect(edits).toHaveLength(1);
    expect(notes).toEqual([]);
  });
});
