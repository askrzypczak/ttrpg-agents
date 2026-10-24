import { describe, expect, it } from "vitest";
import type { InstanceEdit } from "@ttrpg-agents/engine";
import { makeTestInstance } from "@ttrpg-agents/engine/testing";
import type { BridgeMessage } from "@ttrpg-agents/protocol";
import { EDIT_SETTLE_MS } from "./edit-settle.js";
import { createEncounterSync } from "./encounter-sync.js";
import { createFakeObr } from "./fake-adapter.js";
import type { Timers } from "./reconnecting-socket.js";
import type { SceneItem, SceneModel } from "./scene-model.js";
import { STAT_BUBBLES_METADATA_KEY } from "./stat-bubbles.js";
import { INSTANCE_METADATA_KEY, type EncounterInstance } from "./sync-plan.js";

/** Timers on a fake clock that only moves when `advance` is called. */
class FakeTimers implements Timers {
  private now = 0;
  private next = 1;
  private readonly pending = new Map<number, { fn: () => void; at: number }>();
  setTimeout(fn: () => void, ms: number) {
    const id = this.next++;
    this.pending.set(id, { fn, at: this.now + ms });
    return id;
  }
  clearTimeout(handle: unknown) {
    this.pending.delete(handle as number);
  }
  /** Moves the clock forward, firing due timers in order. */
  advance(ms: number) {
    const end = this.now + ms;
    for (;;) {
      const due = [...this.pending.entries()]
        .filter(([, t]) => t.at <= end)
        .sort(([, a], [, b]) => a.at - b.at)[0];
      if (due === undefined) break;
      const [id, t] = due;
      this.pending.delete(id);
      this.now = t.at;
      t.fn();
    }
    this.now = end;
  }
}

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
  payload: { instances: [instance] },
});

const editError: BridgeMessage = {
  v: 1,
  type: "error",
  id: "instance-edit:i1",
  payload: { code: "unknown_instance", message: "gone", fatal: false },
};

/** An unrelated item; adding one makes the sync reconcile quietly. */
let foreignCount = 0;
const foreign = (): SceneItem => ({
  id: `map-${++foreignCount}`,
  type: "IMAGE",
  name: "Map",
  visible: true,
  position: { x: 0, y: 0 },
  metadata: {},
});

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

/** Edits the token's stat bubbles at the table and lets the sync react. */
async function editAtTable(scene: SceneModel, fields: Record<string, unknown>) {
  scene.setItemMetadata([
    {
      id: token(scene).id,
      key: STAT_BUBBLES_METADATA_KEY,
      value: { ...bubbles(scene), ...fields },
    },
  ]);
  await settle();
}

/** Makes an unrelated table change and lets the sync reconcile. */
async function unrelatedChange(scene: SceneModel) {
  scene.addItems([foreign()]);
  await settle();
}

async function setup() {
  const { obr, scene } = createFakeObr();
  const timers = new FakeTimers();
  const edits: InstanceEdit[] = [];
  const sync = createEncounterSync(obr, undefined, undefined, {
    timers,
    onInstanceEdit: (edit) => edits.push(edit),
  });
  await sync.handleMessage(snapshot(inst()));
  await settle();
  // Every health value the token shows, in order, from here on.
  const healthSeen: unknown[] = [];
  scene.onChange((change) => {
    if (change.kind === "items") healthSeen.push(bubbles(scene).health);
  });
  return { sync, scene, timers, edits, healthSeen };
}

describe("createEncounterSync settling table edits", () => {
  it("does not send a table edit until the settle period ends", async () => {
    const { scene, timers, edits } = await setup();
    await editAtTable(scene, { health: 5 });
    expect(edits).toEqual([]);

    timers.advance(EDIT_SETTLE_MS - 1);
    // A later reconcile without a new edit does not restart the period.
    await unrelatedChange(scene);
    expect(edits).toEqual([]);

    timers.advance(1);
    expect(edits).toEqual([{ instanceId: "i1", currentHp: 5 }]);
  });

  it("sends one edit with the last value when the GM edits twice within the period", async () => {
    const { scene, timers, edits } = await setup();
    await editAtTable(scene, { health: 5 });
    timers.advance(EDIT_SETTLE_MS / 2);
    await editAtTable(scene, { health: 7 });
    timers.advance(EDIT_SETTLE_MS);

    expect(edits).toEqual([{ instanceId: "i1", currentHp: 7 }]);
  });

  it("never sends a value replaced within the period", async () => {
    const { scene, timers, edits } = await setup();
    await editAtTable(scene, { health: 5 });
    await editAtTable(scene, { health: 7 });
    await editAtTable(scene, { health: 9 });
    timers.advance(EDIT_SETTLE_MS);
    await unrelatedChange(scene);
    timers.advance(EDIT_SETTLE_MS);

    const sentHp = edits.map((e) => e.currentHp);
    expect(sentHp).not.toContain(5);
    expect(sentHp).not.toContain(7);
    expect(sentHp).toEqual([9]);
  });

  it("a second edit before the period ends is not overwritten by the encounter's old value", async () => {
    const { scene, timers, edits, healthSeen } = await setup();
    await editAtTable(scene, { health: 5 });
    await unrelatedChange(scene);
    expect(bubbles(scene).health).toBe(5);

    await editAtTable(scene, { health: 7 });
    await unrelatedChange(scene);
    expect(bubbles(scene).health).toBe(7);
    // The planner never wrote the encounter's old value back.
    expect(healthSeen).not.toContain(10);

    timers.advance(EDIT_SETTLE_MS);
    expect(edits).toEqual([{ instanceId: "i1", currentHp: 7 }]);
  });

  it("a second edit after the send and before the snapshot is not overwritten", async () => {
    const { scene, timers, edits, healthSeen } = await setup();
    await editAtTable(scene, { health: 5 });
    timers.advance(EDIT_SETTLE_MS);
    expect(edits).toEqual([{ instanceId: "i1", currentHp: 5 }]);

    await editAtTable(scene, { health: 7 });
    await unrelatedChange(scene);
    expect(bubbles(scene).health).toBe(7);
    expect(healthSeen).not.toContain(10);

    timers.advance(EDIT_SETTLE_MS);
    expect(edits).toEqual([
      { instanceId: "i1", currentHp: 5 },
      { instanceId: "i1", currentHp: 7 },
    ]);
  });

  it("a snapshot that arrives before the edit's answer ends the hold (accepted behaviour)", async () => {
    const { sync, scene, timers, edits } = await setup();
    await editAtTable(scene, { health: 5 });
    timers.advance(EDIT_SETTLE_MS);
    expect(edits).toEqual([{ instanceId: "i1", currentHp: 5 }]);
    // Until the store answers, the table keeps the sent value.
    await unrelatedChange(scene);
    expect(bubbles(scene).health).toBe(5);

    // A snapshot the store sent before applying the edit still counts as
    // its answer: the table shows the snapshot's value.
    await sync.handleMessage(snapshot(inst({ currentHp: 10 })));
    await settle();
    expect(bubbles(scene).health).toBe(10);
    expect(edits).toHaveLength(1);
  });

  it.each([
    ["health", "currentHp", 5, 4],
    ["max health", "maxHp", 20, 18],
    ["armor class", "armorClass", 15, 14],
  ] as const)(
    "HP, max HP and armor class each settle (%s)",
    async (key, field, first, last) => {
      const { scene, timers, edits } = await setup();
      await editAtTable(scene, { [key]: first });
      await editAtTable(scene, { [key]: last });
      expect(edits).toEqual([]);

      timers.advance(EDIT_SETTLE_MS);
      expect(edits).toEqual([{ instanceId: "i1", [field]: last }]);
      expect(bubbles(scene)[key]).toBe(last);
    },
  );

  it("the table gets the store's value when the bridge answers with an error", async () => {
    const { sync, scene, timers, edits } = await setup();
    await editAtTable(scene, { health: 5 });
    expect(edits).toEqual([]);
    timers.advance(EDIT_SETTLE_MS);
    await unrelatedChange(scene);
    expect(bubbles(scene).health).toBe(5);

    await sync.handleMessage(editError);
    await settle();
    expect(bubbles(scene).health).toBe(10);
    await unrelatedChange(scene);
    timers.advance(EDIT_SETTLE_MS);
    expect(bubbles(scene).health).toBe(10);
    expect(edits).toEqual([{ instanceId: "i1", currentHp: 5 }]);
  });

  it("a clamped store answer ends up on the table", async () => {
    const { sync, scene, timers, edits } = await setup();
    await editAtTable(scene, { health: 30 });
    expect(edits).toEqual([]);
    timers.advance(EDIT_SETTLE_MS);
    expect(edits).toEqual([{ instanceId: "i1", currentHp: 30 }]);
    await unrelatedChange(scene);
    expect(bubbles(scene).health).toBe(30);

    // The store clamps HP to max HP and answers with the stored value.
    await sync.handleMessage(snapshot(inst({ currentHp: 16 })));
    await settle();
    expect(bubbles(scene).health).toBe(16);
    await unrelatedChange(scene);
    timers.advance(EDIT_SETTLE_MS);
    expect(bubbles(scene).health).toBe(16);
    expect(edits).toHaveLength(1);
  });
});
