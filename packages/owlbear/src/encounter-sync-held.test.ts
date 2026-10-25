import { describe, expect, it } from "vitest";
import type { InstanceEdit } from "@ttrpg-agents/engine";
import { makeTestInstance } from "@ttrpg-agents/engine/testing";
import type { BridgeMessage } from "@ttrpg-agents/protocol";
import { EDIT_SETTLE_MS, createEncounterSync } from "./encounter-sync.js";
import { createFakeObr } from "./fake-adapter.js";
import { INITIATIVE_METADATA_KEY } from "./initiative.js";
import type { Timers } from "./reconnecting-socket.js";
import type { SceneItem, SceneModel } from "./scene-model.js";
import { STAT_BUBBLES_METADATA_KEY } from "./stat-bubbles.js";
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

/** Lets fire-and-forget reconciles (item changes) finish. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

/** Injected timers that fire only when advanced and remember what was scheduled. */
class FakeTimers implements Timers {
  readonly scheduled: number[] = [];
  private now = 0;
  private next = 1;
  private pending = new Map<number, { fn: () => void; due: number }>();
  setTimeout(fn: () => void, ms: number) {
    const id = this.next++;
    this.scheduled.push(ms);
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

const bubbles = (scene: SceneModel): Record<string, unknown> =>
  token(scene).metadata[STAT_BUBBLES_METADATA_KEY] as Record<string, unknown>;

const foreign: SceneItem = {
  id: "map",
  type: "IMAGE",
  name: "Map",
  visible: true,
  position: { x: 0, y: 0 },
  metadata: {},
};

async function setup(withSend = true) {
  const { obr, scene } = createFakeObr();
  const timers = new FakeTimers();
  const sent: BridgeMessage[] = [];
  const heard = { rejected: [] as string[], cleared: [] as string[] };
  const sync = createEncounterSync(obr, undefined, undefined, {
    timers,
    ...(withSend
      ? {
          send: (message: BridgeMessage) => {
            sent.push(message);
            return true;
          },
        }
      : {}),
    onEditRejected: (text) => heard.rejected.push(text),
    onEditRejectedCleared: (text) => heard.cleared.push(text),
  });
  const feed = createMessageFeed();
  await sync.handleMessage(feed.snapshot([inst()], { seq: 0 }));
  await settle();
  return {
    sync,
    feed,
    scene,
    timers,
    heard,
    sent,
    edits: () =>
      sent.flatMap((m) =>
        m.type === "instance-edit" ? [m.payload] : [],
      ) as InstanceEdit[],
    /** Lets the reconciles run, then moves the clock on by `ms` and lets the sends happen. */
    async wait(ms: number) {
      await settle();
      timers.advance(ms);
      await settle();
    },
    editAtTable(fields: Record<string, unknown>) {
      scene.setItemMetadata([
        {
          id: token(scene).id,
          key: STAT_BUBBLES_METADATA_KEY,
          value: { ...bubbles(scene), ...fields },
        },
      ]);
    },
    setTracker(value: unknown) {
      scene.setItemMetadata([
        { id: token(scene).id, key: INITIATIVE_METADATA_KEY, value },
      ]);
    },
    tracker: () => token(scene).metadata[INITIATIVE_METADATA_KEY],
  };
}

describe("createEncounterSync held initiative edits", () => {
  it("an mcp armor class change leaves a held tracker count edit alone", async () => {
    const { sync, feed, edits, wait, setTracker, tracker } = await setup();

    setTracker({ count: "14", active: false });
    await wait(500);
    await sync.handleMessage(
      feed.event(
        { type: "instance-changed", id: "i1", changes: { armorClass: 15 } },
        { seq: 1 },
      ),
    );
    await wait(EDIT_SETTLE_MS);

    expect(edits()).toEqual([{ instanceId: "i1", initiative: 14 }]);
    expect(tracker()).toEqual({ count: "14", active: false });
  });

  it("the acknowledgement of an armor class edit leaves a held tracker count edit alone", async () => {
    const { sync, feed, sent, edits, wait, editAtTable, setTracker, tracker } =
      await setup();

    editAtTable({ "armor class": 15 });
    await wait(1000);
    setTracker({ count: "14", active: false });
    await wait(EDIT_SETTLE_MS - 1000);
    const sentEdit = sent.find((m) => m.type === "instance-edit")!;
    await sync.handleMessage(
      feed.event(
        {
          type: "instance-changed",
          id: "i1",
          changes: { armorClass: 15 },
          origin: { source: "table", commandId: sentEdit.id! },
        },
        { seq: 1 },
      ),
    );
    await wait(EDIT_SETTLE_MS);

    expect(edits()).toEqual([
      { instanceId: "i1", armorClass: 15 },
      { instanceId: "i1", initiative: 14 },
    ]);
    expect(tracker()).toEqual({ count: "14", active: false });
  });

  it("an mcp initiative change replaces a held tracker count edit with the store's count", async () => {
    const { sync, feed, edits, wait, setTracker, tracker } = await setup();

    setTracker({ count: "14", active: false });
    await wait(500);
    await sync.handleMessage(
      feed.event(
        { type: "instance-changed", id: "i1", changes: { initiative: 7 } },
        { seq: 1 },
      ),
    );
    await wait(EDIT_SETTLE_MS * 2);

    expect(edits()).toEqual([]);
    expect(tracker()).toEqual({ count: "7", active: false });
  });
});

describe("createEncounterSync held edits", () => {
  it("a value edited again after an mcp change cancelled it is still sent", async () => {
    const { sync, feed, edits, wait, editAtTable } = await setup();

    editAtTable({ health: 5 });
    await wait(500);
    await sync.handleMessage(
      feed.event(
        { type: "hp-changed", id: "i1", currentHp: 7, maxHp: 16 },
        { seq: 1 },
      ),
    );
    await wait(0);
    editAtTable({ health: 5 });
    await wait(EDIT_SETTLE_MS);

    expect(edits()).toEqual([{ instanceId: "i1", currentHp: 5 }]);
  });

  it("a delay that ends while a reconcile cancels the edit sends nothing", async () => {
    const { sync, feed, timers, edits, wait, editAtTable } = await setup();

    editAtTable({ health: 5 });
    await wait(500);
    const applying = sync.handleMessage(
      feed.event(
        { type: "hp-changed", id: "i1", currentHp: 7, maxHp: 16 },
        { seq: 1 },
      ),
    );
    timers.advance(EDIT_SETTLE_MS);
    await applying;
    await settle();

    expect(edits()).toEqual([]);
  });

  it("starts no delay when commands cannot be sent", async () => {
    const { timers, wait, editAtTable } = await setup(false);

    editAtTable({ health: 5 });
    await wait(EDIT_SETTLE_MS);

    expect(timers.scheduled).not.toContain(EDIT_SETTLE_MS);
  });
});

describe("createEncounterSync held unreadable values", () => {
  it("an item change does not restart the delay of an unreadable value", async () => {
    const { scene, heard, wait, editAtTable } = await setup();

    editAtTable({ health: "lots" });
    await wait(1000);
    scene.addItems([foreign]);
    await wait(EDIT_SETTLE_MS - 1000);

    expect(heard.rejected).toHaveLength(1);
    expect(heard.rejected[0]).toContain("Shadow 1");
  });

  it("a value that reads and is unreadable again is reported again", async () => {
    const { heard, wait, editAtTable } = await setup();

    editAtTable({ health: "lots" });
    await wait(500);
    editAtTable({ health: 5 });
    await wait(0);
    editAtTable({ health: "lots" });
    await wait(EDIT_SETTLE_MS);

    expect(heard.rejected).toHaveLength(1);
  });

  it("a reported value that is still unreadable is neither cleared nor reported again by an item change", async () => {
    const { scene, heard, wait, editAtTable } = await setup();
    editAtTable({ health: "lots" });
    await wait(EDIT_SETTLE_MS);
    expect(heard.rejected).toHaveLength(1);

    scene.addItems([foreign]);
    await wait(EDIT_SETTLE_MS * 2);

    expect(heard.cleared).toEqual([]);
    expect(heard.rejected).toHaveLength(1);
  });

  it("a cleared value is cleared once, not again by a later reconcile", async () => {
    const { scene, heard, wait, editAtTable } = await setup();
    editAtTable({ health: "lots" });
    await wait(EDIT_SETTLE_MS);
    editAtTable({ health: 5 });
    await wait(0);
    expect(heard.cleared).toHaveLength(1);

    scene.addItems([foreign]);
    await wait(0);

    expect(heard.cleared).toHaveLength(1);
  });

  it("a delay that ends while a reconcile makes the value readable reports nothing", async () => {
    const { sync, feed, timers, heard, wait, editAtTable } = await setup();

    editAtTable({ health: "lots" });
    await wait(500);
    const applying = sync.handleMessage(
      feed.event(
        { type: "hp-changed", id: "i1", currentHp: 7, maxHp: 16 },
        { seq: 1 },
      ),
    );
    timers.advance(EDIT_SETTLE_MS);
    await applying;
    await settle();

    expect(heard.rejected).toEqual([]);
  });
});
