import { describe, expect, it } from "vitest";
import type { BridgeMessage } from "@ttrpg-agents/protocol";
import { createEncounterSync } from "./encounter-sync.js";
import { createFakeObr } from "./fake-adapter.js";
import type { ObrAdapter } from "./obr-adapter.js";
import type { Timers } from "./reconnecting-socket.js";
import type { SceneItem } from "./scene-model.js";
import { INSTANCE_METADATA_KEY, type EncounterInstance } from "./sync-plan.js";

const inst = (n: number): EncounterInstance => ({
  id: `i${n}`,
  encounterId: "e1",
  monsterKey: "shadow",
  displayName: `Shadow ${n}`,
  maxHp: 16,
  currentHp: 16,
  initiative: null,
  groupId: null,
  createdAt: n,
});
const snapshot = (...ns: number[]): BridgeMessage => ({
  v: 1,
  type: "encounter-snapshot",
  payload: { instances: ns.map(inst) },
});
const foreign = (id: string): SceneItem => ({
  id,
  type: "IMAGE",
  name: id,
  visible: true,
  position: { x: 0, y: 0 },
  metadata: {},
});
const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

/** Timers that never fire, so a scheduled retry stays pending. */
const idleTimers: Timers = {
  setTimeout: () => 1,
  clearTimeout: () => {},
};

describe("createEncounterSync item changes", () => {
  it("an item change that recovers from a failed reconcile reports onApplied", async () => {
    const fake = createFakeObr();
    let fail = true;
    const obr: ObrAdapter = {
      ...fake.obr,
      addItems: (items) => {
        if (!fail) return fake.obr.addItems(items);
        fail = false;
        return Promise.reject(new Error("boom"));
      },
    };
    const errors: unknown[] = [];
    let applied = 0;
    const sync = createEncounterSync(
      obr,
      (e) => errors.push(e),
      () => applied++,
      { timers: idleTimers },
    );
    await sync.handleMessage(snapshot(1));
    expect(errors).toHaveLength(1);
    expect(applied).toBe(0);

    fake.scene.addItems([foreign("map")]);
    await settle();
    expect(applied).toBe(1);
    expect(errors).toHaveLength(1);

    // Not recovering any more: a further item change stays quiet.
    fake.scene.addItems([foreign("map2")]);
    await settle();
    expect(applied).toBe(1);
  });

  it("reports a token the GM deletes in the middle of a reconcile", async () => {
    const fake = createFakeObr();
    let armed = false;
    let reads = 0;
    const obr: ObrAdapter = {
      ...fake.obr,
      getItems: (f) => (reads++, fake.obr.getItems(f)),
      getViewportCenter: () => {
        if (armed) {
          armed = false;
          const token = fake.scene
            .getItems()
            .find(
              (i) =>
                (i.metadata[INSTANCE_METADATA_KEY] as { instanceId: string })
                  .instanceId === "i2",
            )!;
          fake.scene.deleteItems([token.id]);
        }
        return fake.obr.getViewportCenter();
      },
    };
    const reported: string[] = [];
    const sync = createEncounterSync(obr, undefined, undefined, {
      onTokenDeleted: (id) => reported.push(id),
    });
    await sync.handleMessage(snapshot(1, 2));
    await settle();
    expect(reported).toEqual([]);

    armed = true;
    await sync.handleMessage(snapshot(1, 2));
    await settle();
    expect(reported).toEqual(["i2"]);
    // The follow-up settles: no reconcile keeps re-queueing itself.
    const before = reads;
    await settle();
    await settle();
    expect(reads).toBe(before);
  });

  it("our own writes cost no extra reconcile pass", async () => {
    const fake = createFakeObr();
    let reads = 0;
    const obr: ObrAdapter = {
      ...fake.obr,
      getItems: (f) => (reads++, fake.obr.getItems(f)),
    };
    const sync = createEncounterSync(obr);
    await sync.handleMessage(snapshot(1, 2));
    await settle();
    expect(reads).toBe(1);
  });

  it("reports a deletion on a sync whose reconciles have not written anything", async () => {
    const fake = createFakeObr();
    await createEncounterSync(fake.obr).handleMessage(snapshot(1, 2));
    await settle();

    const reported: string[] = [];
    const second = createEncounterSync(fake.obr, undefined, undefined, {
      onTokenDeleted: (id) => reported.push(id),
    });
    await second.handleMessage(snapshot(1, 2));
    await settle();
    const token = fake.scene
      .getItems()
      .find(
        (i) =>
          (i.metadata[INSTANCE_METADATA_KEY] as { instanceId: string })
            .instanceId === "i1",
      )!;
    fake.scene.deleteItems([token.id]);
    await settle();
    expect(reported).toEqual(["i1"]);
  });

  it("a burst of item changes costs a bounded number of reconciles", async () => {
    const fake = createFakeObr();
    let reads = 0;
    const obr: ObrAdapter = {
      ...fake.obr,
      getItems: (f) => (reads++, fake.obr.getItems(f)),
    };
    const sync = createEncounterSync(obr);
    const ids = ["a", "b", "c", "d", "e"];
    fake.scene.addItems(ids.map(foreign));
    await sync.handleMessage(snapshot(1));
    await settle();
    reads = 0;
    for (const id of ids) fake.scene.deleteItems([id]);
    await settle();
    expect(reads).toBeGreaterThanOrEqual(1);
    expect(reads).toBeLessThanOrEqual(2);
  });
});
