import { describe, expect, it } from "vitest";
import type { InstanceEdit } from "@ttrpg-agents/engine";
import { makeTestInstance } from "@ttrpg-agents/engine/testing";
import type { BridgeMessage } from "@ttrpg-agents/protocol";
import { EDIT_SETTLE_MS, createEncounterSync } from "./encounter-sync.js";
import { createFakeObr } from "./fake-adapter.js";
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

async function setup() {
  const { obr, scene } = createFakeObr();
  const timers = new FakeTimers();
  const sent: BridgeMessage[] = [];
  const heard = { rejected: [] as string[], cleared: [] as string[] };
  const sync = createEncounterSync(obr, undefined, undefined, {
    timers,
    send: (message) => {
      sent.push(message);
      return true;
    },
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
    heard,
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
  };
}

describe("createEncounterSync settle delay", () => {
  it("a table HP edit is sent only after it has stayed unchanged for the settle delay", async () => {
    const { edits, wait, editAtTable } = await setup();

    editAtTable({ health: 5 });
    await wait(EDIT_SETTLE_MS - 1);
    expect(edits()).toEqual([]);

    await wait(1);
    expect(edits()).toEqual([{ instanceId: "i1", currentHp: 5 }]);
  });

  it("a different value within the delay restarts it and only the last value is sent", async () => {
    const { edits, wait, editAtTable } = await setup();

    editAtTable({ health: 5 });
    await wait(1000);
    editAtTable({ health: 3 });
    await wait(1000);
    expect(edits()).toEqual([]);

    await wait(EDIT_SETTLE_MS - 1000);
    expect(edits()).toEqual([{ instanceId: "i1", currentHp: 3 }]);
  });

  it("an item change that plans the same value does not restart the delay", async () => {
    const { scene, edits, wait, editAtTable } = await setup();

    editAtTable({ health: 5 });
    await wait(1000);
    expect(edits()).toEqual([]);
    scene.addItems([foreign]);
    await wait(EDIT_SETTLE_MS - 1000);

    expect(edits()).toEqual([{ instanceId: "i1", currentHp: 5 }]);
  });

  it("an mcp change of the field during the delay cancels the held edit", async () => {
    const { sync, feed, scene, edits, wait, editAtTable } = await setup();

    editAtTable({ health: 5 });
    await wait(1000);
    await sync.handleMessage(
      feed.event(
        { type: "hp-changed", id: "i1", currentHp: 7, maxHp: 16 },
        { seq: 1 },
      ),
    );
    await wait(EDIT_SETTLE_MS * 2);

    expect(edits()).toEqual([]);
    expect(bubbles(scene).health).toBe(7);
  });
});

describe("createEncounterSync unreadable values", () => {
  it("an unreadable value is reported only if still unreadable when the delay ends", async () => {
    const { heard, wait, editAtTable } = await setup();

    editAtTable({ health: "lots" });
    await wait(EDIT_SETTLE_MS - 1);
    expect(heard.rejected).toEqual([]);
    await wait(1);
    expect(heard.rejected).toHaveLength(1);

    // Control: a value that reads before the delay ends is never reported.
    editAtTable({ health: 5 });
    await wait(0);
    editAtTable({ "max health": "many" });
    await wait(1000);
    editAtTable({ "max health": 20 });
    await wait(EDIT_SETTLE_MS * 2);
    expect(heard.rejected).toHaveLength(1);
  });

  it("a reported unreadable value is cleared through onEditRejectedCleared once it reads as a whole number", async () => {
    const { heard, wait, editAtTable } = await setup();
    editAtTable({ health: "lots" });
    await wait(EDIT_SETTLE_MS);
    expect(heard.rejected).toHaveLength(1);
    expect(heard.cleared).toEqual([]);

    editAtTable({ health: 5 });
    await wait(0);

    expect(heard.cleared).toEqual([heard.rejected[0]]);

    // The same value unreadable again is reported again.
    editAtTable({ health: "lots" });
    await wait(EDIT_SETTLE_MS);
    expect(heard.rejected).toHaveLength(2);
    expect(heard.rejected[1]).toBe(heard.rejected[0]);
  });
});
