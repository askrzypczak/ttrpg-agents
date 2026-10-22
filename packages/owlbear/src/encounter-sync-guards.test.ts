import { describe, expect, it } from "vitest";
import type { BridgeMessage } from "@ttrpg-agents/protocol";
import { createEncounterSync } from "./encounter-sync.js";
import { createFakeObr } from "./fake-adapter.js";
import type { ObrAdapter } from "./obr-adapter.js";
import type { Timers } from "./reconnecting-socket.js";
import { PLACED_METADATA_KEY, type EncounterInstance } from "./sync-plan.js";

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
const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

/** Fake adapter that records which calls are made. */
function spied() {
  const fake = createFakeObr();
  const calls: string[] = [];
  const spy =
    <A extends unknown[], R>(name: string, fn: (...args: A) => R) =>
    (...args: A): R => (calls.push(name), fn(...args));
  const obr: ObrAdapter = {
    ...fake.obr,
    getItems: spy("getItems", fake.obr.getItems),
    deleteItems: spy("deleteItems", fake.obr.deleteItems),
    addItems: spy("addItems", fake.obr.addItems),
    setItemMetadata: spy("setItemMetadata", fake.obr.setItemMetadata),
    setSceneMetadata: spy("setSceneMetadata", fake.obr.setSceneMetadata),
  };
  return { obr, scene: fake.scene, calls };
}

const placedOf = (scene: { getMetadata(): Record<string, unknown> }) =>
  scene.getMetadata()[PLACED_METADATA_KEY];

describe("createEncounterSync guards", () => {
  it("makes no write calls when the scene already matches", async () => {
    const { obr, calls } = spied();
    const sync = createEncounterSync(obr);
    await sync.handleMessage(snapshot(1, 2));
    expect(calls).toContain("addItems");
    expect(calls).toContain("setSceneMetadata");
    await settle();
    calls.length = 0;
    await sync.handleMessage(snapshot(1, 2));
    await settle();
    // Only reads: the scene's own item changes also trigger reconciles.
    expect(calls).toContain("getItems");
    expect(calls.filter((c) => c !== "getItems")).toEqual([]);
  });

  it("only deletes when something is stale, and prunes the placed ids", async () => {
    const { obr, scene, calls } = spied();
    const sync = createEncounterSync(obr);
    await sync.handleMessage(snapshot(1, 2));
    expect(calls).not.toContain("deleteItems");
    expect(placedOf(scene)).toEqual(["i1", "i2"]);
    await settle();
    calls.length = 0;
    await sync.handleMessage(snapshot(1));
    await settle();
    expect(calls.filter((c) => c !== "getItems")).toEqual([
      "deleteItems",
      "setSceneMetadata",
    ]);
    expect(placedOf(scene)).toEqual(["i1"]);
  });

  it("writes the placed record when a new id is placed", async () => {
    const { obr, scene, calls } = spied();
    const sync = createEncounterSync(obr);
    await sync.handleMessage(snapshot(1));
    calls.length = 0;
    await sync.handleMessage(snapshot(1, 2));
    expect(calls).toContain("setSceneMetadata");
    expect(placedOf(scene)).toEqual(["i1", "i2"]);
  });

  it("writes item metadata only when a token needs it", async () => {
    const { obr, scene, calls } = spied();
    const sync = createEncounterSync(obr);
    await sync.handleMessage(snapshot(1));
    expect(calls).not.toContain("setItemMetadata");
    const [token] = scene.getItems();
    scene.setItemMetadata([
      { id: token!.id, key: "com.ttrpg-agents/synced", value: undefined },
    ]);
    await sync.handleMessage(snapshot(1));
    expect(calls).toContain("setItemMetadata");
  });

  it("ignores a malformed placed record", async () => {
    const { obr, scene } = spied();
    scene.setMetadata({ [PLACED_METADATA_KEY]: "oops" });
    await createEncounterSync(obr).handleMessage(snapshot(1));
    expect(placedOf(scene)).toEqual(["i1"]);
  });

  it("drops non-string entries from the placed record", async () => {
    const { obr, scene } = spied();
    scene.setMetadata({ [PLACED_METADATA_KEY]: [5, null, "i2"] });
    await createEncounterSync(obr).handleMessage(snapshot(1, 2));
    // i2 counts as placed, so only i1 is created; the junk entries are gone.
    expect(scene.getItems()).toHaveLength(1);
    expect(placedOf(scene)).toEqual(["i2", "i1"]);
  });

  it("keeps reconciling without errors after an hp-changed event", async () => {
    const { obr, scene } = spied();
    const errors: unknown[] = [];
    const sync = createEncounterSync(obr, (e) => errors.push(e));
    await sync.handleMessage(snapshot(1));
    await sync.handleMessage({
      v: 1,
      type: "encounter-event",
      payload: { type: "hp-changed", id: "i1", currentHp: 3, maxHp: 16 },
    });
    await sync.handleMessage({
      v: 1,
      type: "encounter-event",
      payload: { type: "added", instances: [inst(5)] },
    });
    expect(errors).toEqual([]);
    expect(scene.getItems().map((i) => i.name)).toEqual([
      "Shadow 1",
      "Shadow 5",
    ]);
  });

  it("makes no items API call before the first snapshot", async () => {
    const { obr, scene, calls } = spied();
    createEncounterSync(obr);
    scene.setReady(false);
    scene.setReady(true);
    await settle();
    expect(calls).toEqual([]);
  });

  it("clears the pending retry timer when a new trigger arrives", async () => {
    const cleared: unknown[] = [];
    const timers: Timers = {
      setTimeout: () => "handle",
      clearTimeout: (h) => void cleared.push(h),
    };
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
    const sync = createEncounterSync(obr, () => {}, undefined, { timers });
    await sync.handleMessage(snapshot(1));
    expect(cleared).toEqual([]);
    await sync.handleMessage(snapshot(1));
    expect(cleared).toEqual(["handle"]);
    await sync.handleMessage(snapshot(1));
    expect(cleared).toEqual(["handle"]);
  });
});
