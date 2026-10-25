import { describe, expect, it } from "vitest";
import type { ChangeOrigin, InstanceEdit } from "@ttrpg-agents/engine";
import { makeTestInstance } from "@ttrpg-agents/engine/testing";
import type { BridgeMessage } from "@ttrpg-agents/protocol";
import { EDIT_SETTLE_MS, createEncounterSync } from "./encounter-sync.js";
import { createFakeObr } from "./fake-adapter.js";
import { INITIATIVE_METADATA_KEY } from "./initiative.js";
import type { ObrAdapter } from "./obr-adapter.js";
import type { Timers } from "./reconnecting-socket.js";
import type { SceneItem, SceneModel } from "./scene-model.js";
import { createMessageFeed } from "./testing/messages.js";
import { INSTANCE_METADATA_KEY, type EncounterInstance } from "./sync-plan.js";

const inst = (over: Partial<EncounterInstance> = {}): EncounterInstance =>
  makeTestInstance({
    id: "i1",
    displayName: "Shadow 1",
    maxHp: 16,
    currentHp: 10,
    armorClass: 12,
    initiative: 10,
    ...over,
  });

const tableOf = (commandId: string): ChangeOrigin => ({
  source: "table",
  commandId,
});

/** Lets fire-and-forget reconciles (item changes) finish. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

/** Injected timers that fire only when advanced. */
class FakeTimers implements Timers {
  private now = 0;
  private next = 1;
  private pending = new Map<number, { fn: () => void; due: number }>();
  setTimeout(fn: () => void, ms: number) {
    const id = this.next++;
    this.pending.set(id, { fn, due: this.now + ms });
    return id;
  }
  clearTimeout(handle: unknown) {
    this.pending.delete(handle as number);
  }
  advance(ms: number) {
    this.now += ms;
    const due = [...this.pending.entries()]
      .filter(([, t]) => t.due <= this.now)
      .sort((a, b) => a[1].due - b[1].due);
    for (const [id, t] of due) {
      this.pending.delete(id);
      t.fn();
    }
  }
}

const token = (scene: SceneModel): SceneItem =>
  scene
    .getItems()
    .find(
      (i) =>
        (i.metadata[INSTANCE_METADATA_KEY] as { instanceId?: string })
          ?.instanceId === "i1",
    )!;

const foreign: SceneItem = {
  id: "map",
  type: "IMAGE",
  name: "Map",
  visible: true,
  position: { x: 0, y: 0 },
  metadata: {},
};

async function setup(instance: EncounterInstance = inst()) {
  const fake = createFakeObr();
  const scene = fake.scene;
  const writes: { id: string; key: string; value: unknown }[] = [];
  const obr: ObrAdapter = {
    ...fake.obr,
    setItemMetadata: (updates) => {
      writes.push(...updates);
      return fake.obr.setItemMetadata(updates);
    },
  };
  const timers = new FakeTimers();
  const sent: BridgeMessage[] = [];
  const sync = createEncounterSync(obr, undefined, undefined, {
    timers,
    send: (message) => {
      sent.push(message);
      return true;
    },
  });
  const feed = createMessageFeed();
  await sync.handleMessage(feed.snapshot([instance], { seq: 0 }));
  await settle();
  writes.length = 0;
  return {
    sync,
    feed,
    scene,
    /** Every `instance-edit` sent so far. */
    edits: () =>
      sent.flatMap((m) =>
        m.type === "instance-edit" ? [{ id: m.id, edit: m.payload }] : [],
      ) as { id: string; edit: InstanceEdit }[],
    /** The tracker writes since setup. */
    trackerWrites: () =>
      writes.filter((u) => u.key === INITIATIVE_METADATA_KEY),
    /** Lets the reconcile plan, waits out the settle delay, lets the send happen. */
    async elapse() {
      await settle();
      timers.advance(EDIT_SETTLE_MS);
      await settle();
    },
    tracker: () => token(scene).metadata[INITIATIVE_METADATA_KEY],
    setTracker(value: unknown) {
      scene.setItemMetadata([
        { id: token(scene).id, key: INITIATIVE_METADATA_KEY, value },
      ]);
    },
  };
}

describe("createEncounterSync initiative write-back", () => {
  it("a tracker count edit is sent once as an instance-edit with initiative after the settle delay", async () => {
    const { scene, edits, elapse, setTracker, tracker } = await setup();

    setTracker({ count: "14", active: false });
    await settle();
    expect(edits()).toEqual([]);
    await elapse();

    expect(edits().map((e) => e.edit)).toEqual([
      { instanceId: "i1", initiative: 14 },
    ]);
    expect(tracker()).toEqual({ count: "14", active: false });

    // An unrelated item change does not send it again.
    scene.addItems([foreign]);
    await elapse();
    expect(edits()).toHaveLength(1);
  });

  it("the table event acknowledging an initiative edit pushes nothing and sends nothing again", async () => {
    const {
      sync,
      feed,
      scene,
      edits,
      trackerWrites,
      elapse,
      setTracker,
      tracker,
    } = await setup();
    setTracker({ count: "14", active: true });
    await elapse();
    expect(edits()).toHaveLength(1);

    await sync.handleMessage(
      feed.event(
        {
          type: "instance-changed",
          id: "i1",
          changes: { initiative: 14 },
          origin: tableOf(edits()[0]!.id),
        },
        { seq: 1 },
      ),
    );
    await elapse();
    scene.addItems([foreign]);
    await elapse();

    expect(edits()).toHaveLength(1);
    expect(trackerWrites()).toEqual([]);
    expect(tracker()).toEqual({ count: "14", active: true });
  });

  it("the table event acknowledging a clear settles it", async () => {
    const { sync, feed, edits, trackerWrites, elapse, setTracker, tracker } =
      await setup();
    setTracker(undefined);
    await elapse();
    expect(edits().map((e) => e.edit)).toEqual([
      { instanceId: "i1", initiative: null },
    ]);

    await sync.handleMessage(
      feed.event(
        {
          type: "instance-changed",
          id: "i1",
          changes: { initiative: null },
          origin: tableOf(edits()[0]!.id),
        },
        { seq: 1 },
      ),
    );
    await elapse();

    expect(edits()).toHaveLength(1);
    expect(trackerWrites()).toEqual([]);
    expect(tracker()).toBeUndefined();

    // Adding the token to the tracker again is a new edit, not a settled one.
    setTracker({ count: "2", active: false });
    await elapse();
    expect(edits().map((e) => e.edit)).toEqual([
      { instanceId: "i1", initiative: null },
      { instanceId: "i1", initiative: 2 },
    ]);
  });
});
