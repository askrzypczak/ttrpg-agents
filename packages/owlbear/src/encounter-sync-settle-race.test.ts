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

const inst = (currentHp: number): EncounterInstance =>
  makeTestInstance({
    id: "i1",
    displayName: "Shadow 1",
    maxHp: 16,
    currentHp,
    armorClass: 12,
  });

const snapshot = (instance: EncounterInstance): BridgeMessage => ({
  v: 1,
  type: "encounter-snapshot",
  payload: { instances: [instance] },
});

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

async function editAtTable(scene: SceneModel, health: number) {
  scene.setItemMetadata([
    {
      id: token(scene).id,
      key: STAT_BUBBLES_METADATA_KEY,
      value: { ...bubbles(scene), health },
    },
  ]);
  await settle();
}

describe("createEncounterSync settling edits racing a snapshot", () => {
  it("an answer that lands mid-reconcile does not lose the edit made after the send", async () => {
    const { obr, scene } = createFakeObr();
    const timers = new FakeTimers();
    const edits: InstanceEdit[] = [];
    const sync = createEncounterSync(obr, undefined, undefined, {
      timers,
      onInstanceEdit: (edit) => edits.push(edit),
    });
    await sync.handleMessage(snapshot(inst(10)));
    await settle();

    await editAtTable(scene, 5);
    timers.advance(EDIT_SETTLE_MS);
    expect(edits).toEqual([{ instanceId: "i1", currentHp: 5 }]);

    // The reconcile for the GM's next edit stalls reading the scene.
    const realGetItems = obr.getItems.bind(obr);
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    obr.getItems = async () => {
      await gate;
      return realGetItems();
    };
    await editAtTable(scene, 10);

    // Meanwhile the store answers the first edit.
    const answered = sync.handleMessage(snapshot(inst(5)));
    release();
    await answered;
    await settle();

    timers.advance(EDIT_SETTLE_MS);
    expect(edits).toEqual([
      { instanceId: "i1", currentHp: 5 },
      { instanceId: "i1", currentHp: 10 },
    ]);
    expect(bubbles(scene).health).toBe(10);
  });
});
