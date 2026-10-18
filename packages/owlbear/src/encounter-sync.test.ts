import { describe, expect, it } from "vitest";
import {
  INSTANCE_METADATA_KEY,
  applyEvent,
  applySnapshot,
  createEncounterSync,
  rowPositions,
  type EncounterInstance,
} from "./encounter-sync.js";
import { INITIATIVE_METADATA_KEY } from "./initiative.js";
import { createFakeObr } from "./fake-adapter.js";
import type { ObrAdapter } from "./obr-adapter.js";
import type { SceneItem } from "./scene-model.js";

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

const foreign: SceneItem = {
  id: "map",
  type: "IMAGE",
  name: "Map",
  visible: true,
  position: { x: 0, y: 0 },
  metadata: { "other.ext/thing": { instanceId: "i1" } },
};

const instanceIds = (items: SceneItem[]) =>
  items.map(
    (i) =>
      (i.metadata[INSTANCE_METADATA_KEY] as { instanceId: string }).instanceId,
  );

describe("rowPositions", () => {
  it("centres a row on the given point", () => {
    expect(rowPositions(3, { x: 1000, y: 500 })).toEqual([
      { x: 850, y: 500 },
      { x: 1000, y: 500 },
      { x: 1150, y: 500 },
    ]);
    expect(rowPositions(1, { x: 10, y: 20 })).toEqual([{ x: 10, y: 20 }]);
  });
});

describe("applyEvent added", () => {
  it("creates one hidden, named, linked shape token per instance in a row near the viewport centre", async () => {
    const { obr, scene } = createFakeObr(undefined, { x: 1000, y: 500 });
    await applyEvent(obr, {
      type: "added",
      instances: [inst(1), inst(2), inst(3)],
    });
    const items = scene.getItems();
    expect(items).toHaveLength(3);
    expect(items.map((i) => i.name)).toEqual([
      "Shadow 1",
      "Shadow 2",
      "Shadow 3",
    ]);
    expect(items.every((i) => i.visible === false && i.type === "SHAPE")).toBe(
      true,
    );
    expect(items.every((i) => i.shape?.shapeType === "CIRCLE")).toBe(true);
    expect(instanceIds(items)).toEqual(["i1", "i2", "i3"]);
    expect(items.map((i) => i.position)).toEqual([
      { x: 850, y: 500 },
      { x: 1000, y: 500 },
      { x: 1150, y: 500 },
    ]);
    expect(new Set(items.map((i) => i.id)).size).toBe(3);
  });

  it("is idempotent: replaying creates no duplicates", async () => {
    const { obr, scene } = createFakeObr();
    const event = { type: "added" as const, instances: [inst(1), inst(2)] };
    await applyEvent(obr, event);
    await applyEvent(obr, event);
    expect(instanceIds(scene.getItems())).toEqual(["i1", "i2"]);
  });

  it("only adds the instances that are missing", async () => {
    const { obr, scene } = createFakeObr();
    await applyEvent(obr, { type: "added", instances: [inst(1)] });
    await applyEvent(obr, { type: "added", instances: [inst(1), inst(2)] });
    expect(instanceIds(scene.getItems())).toEqual(["i1", "i2"]);
  });

  it("gives a token its initiative for the Initiative Tracker, alongside the instance link", async () => {
    const { obr, scene } = createFakeObr();
    await applyEvent(obr, {
      type: "added",
      instances: [{ ...inst(1), initiative: 14 }],
    });
    const [item] = scene.getItems();
    expect(item?.metadata).toEqual({
      [INSTANCE_METADATA_KEY]: { instanceId: "i1" },
      [INITIATIVE_METADATA_KEY]: { count: "14", active: false },
    });
    expect(item?.visible).toBe(false);
  });

  it("leaves the tracker key off a token whose instance has no initiative", async () => {
    const { obr, scene } = createFakeObr();
    await applyEvent(obr, { type: "added", instances: [inst(1)] });
    const [item] = scene.getItems();
    expect(item?.metadata).toEqual({
      [INSTANCE_METADATA_KEY]: { instanceId: "i1" },
    });
  });

  it("gives five instances sharing an initiative the same tracker count, all hidden", async () => {
    const { obr, scene } = createFakeObr();
    await applyEvent(obr, {
      type: "added",
      instances: [1, 2, 3, 4, 5].map((n) => ({ ...inst(n), initiative: 12 })),
    });
    const items = scene.getItems();
    expect(items).toHaveLength(5);
    expect(items.map((i) => i.metadata[INITIATIVE_METADATA_KEY])).toEqual([
      { count: "12", active: false },
      { count: "12", active: false },
      { count: "12", active: false },
      { count: "12", active: false },
      { count: "12", active: false },
    ]);
    expect(items.every((i) => i.visible === false)).toBe(true);
  });
});

describe("applyEvent removed/cleared/hp-changed", () => {
  it("removed deletes only the matching instance token, not foreign items", async () => {
    const { obr, scene } = createFakeObr();
    scene.addItems([foreign]);
    await applyEvent(obr, { type: "added", instances: [inst(1), inst(2)] });
    await applyEvent(obr, { type: "removed", id: "i1" });
    expect(
      scene
        .getItems()
        .map((i) => i.id)
        .sort(),
    ).toEqual(["map", "ttrpg-instance-i2"].sort());
  });

  it("removed for an unknown instance is a no-op", async () => {
    const { obr, scene } = createFakeObr();
    await applyEvent(obr, { type: "added", instances: [inst(1)] });
    await applyEvent(obr, { type: "removed", id: "nope" });
    expect(instanceIds(scene.getItems())).toEqual(["i1"]);
  });

  it("cleared deletes all our tokens and leaves foreign items", async () => {
    const { obr, scene } = createFakeObr();
    scene.addItems([foreign]);
    await applyEvent(obr, { type: "added", instances: [inst(1), inst(2)] });
    await applyEvent(obr, { type: "cleared" });
    expect(scene.getItems().map((i) => i.id)).toEqual(["map"]);
  });

  it("hp-changed leaves tokens untouched (documented v1 no-op)", async () => {
    const { obr, scene } = createFakeObr();
    await applyEvent(obr, { type: "added", instances: [inst(1)] });
    const before = scene.getItems();
    await applyEvent(obr, {
      type: "hp-changed",
      id: "i1",
      currentHp: 3,
      maxHp: 16,
    });
    expect(scene.getItems()).toEqual(before);
  });
});

describe("applySnapshot", () => {
  it("adds missing tokens and deletes stale ones, leaving foreign items", async () => {
    const { obr, scene } = createFakeObr();
    scene.addItems([foreign]);
    await applyEvent(obr, { type: "added", instances: [inst(1), inst(2)] });
    await applySnapshot(obr, [inst(2), inst(3)]);
    expect(instanceIds(scene.getItems((i) => i.id !== "map")).sort()).toEqual([
      "i2",
      "i3",
    ]);
    expect(scene.getItems().some((i) => i.id === "map")).toBe(true);
  });

  it("is idempotent", async () => {
    const { obr, scene } = createFakeObr();
    await applySnapshot(obr, [inst(1), inst(2)]);
    const first = scene.getItems();
    await applySnapshot(obr, [inst(1), inst(2)]);
    expect(scene.getItems()).toEqual(first);
  });

  it("an empty snapshot removes all our tokens", async () => {
    const { obr, scene } = createFakeObr();
    await applyEvent(obr, { type: "added", instances: [inst(1)] });
    await applySnapshot(obr, []);
    expect(scene.getItems()).toEqual([]);
  });

  it("gives tokens it adds their initiative for the Initiative Tracker", async () => {
    const { obr, scene } = createFakeObr();
    await applySnapshot(obr, [{ ...inst(1), initiative: 9 }]);
    expect(scene.getItems()[0]?.metadata).toEqual({
      [INSTANCE_METADATA_KEY]: { instanceId: "i1" },
      [INITIATIVE_METADATA_KEY]: { count: "9", active: false },
    });
  });

  it("does not update the metadata of tokens that already exist", async () => {
    const { obr, scene } = createFakeObr();
    await applyEvent(obr, {
      type: "added",
      instances: [{ ...inst(1), initiative: 5 }],
    });
    const before = scene.getItems();
    await applySnapshot(obr, [{ ...inst(1), initiative: 14 }]);
    expect(scene.getItems()).toEqual(before);
    expect(scene.getItems()[0]?.metadata[INITIATIVE_METADATA_KEY]).toEqual({
      count: "5",
      active: false,
    });
  });
});

describe("createEncounterSync", () => {
  /** Adapter whose getItems yields to the event loop, widening any race window. */
  function slowObr(): {
    obr: ObrAdapter;
    scene: ReturnType<typeof createFakeObr>["scene"];
  } {
    const { obr, scene } = createFakeObr();
    return {
      scene,
      obr: {
        ...obr,
        getItems: async (filter) => {
          await new Promise((resolve) => setTimeout(resolve, 5));
          return obr.getItems(filter);
        },
        addItems: async (items) => {
          await new Promise((resolve) => setTimeout(resolve, 5));
          return obr.addItems(items);
        },
      },
    };
  }

  it("serialises concurrent messages so duplicates are never created", async () => {
    const { obr, scene } = slowObr();
    const errors: unknown[] = [];
    const sync = createEncounterSync(obr, (e) => errors.push(e));
    const added = {
      v: 1 as const,
      type: "encounter-event" as const,
      payload: { type: "added" as const, instances: [inst(1), inst(2)] },
    };
    await Promise.all([
      sync.handleMessage(added),
      sync.handleMessage(added),
      sync.handleMessage({
        v: 1,
        type: "encounter-snapshot",
        payload: { instances: [inst(1), inst(2)] },
      }),
    ]);
    expect(errors).toEqual([]);
    expect(instanceIds(scene.getItems())).toEqual(["i1", "i2"]);
  });

  it("applies messages in arrival order", async () => {
    const { obr, scene } = slowObr();
    const sync = createEncounterSync(obr);
    await Promise.all([
      sync.handleMessage({
        v: 1,
        type: "encounter-event",
        payload: { type: "added", instances: [inst(1)] },
      }),
      sync.handleMessage({
        v: 1,
        type: "encounter-event",
        payload: { type: "removed", id: "i1" },
      }),
    ]);
    expect(scene.getItems()).toEqual([]);
  });

  it("reports a failure and keeps processing later messages", async () => {
    const { obr, scene } = createFakeObr();
    let failNext = true;
    const flaky: ObrAdapter = {
      ...obr,
      addItems: (items) => {
        if (failNext) {
          failNext = false;
          return Promise.reject(new Error("boom"));
        }
        return obr.addItems(items);
      },
    };
    const errors: unknown[] = [];
    const sync = createEncounterSync(flaky, (e) => errors.push(e));
    const msg = (n: number) => ({
      v: 1 as const,
      type: "encounter-event" as const,
      payload: { type: "added" as const, instances: [inst(n)] },
    });
    await sync.handleMessage(msg(1));
    await sync.handleMessage(msg(2));
    expect(errors).toHaveLength(1);
    expect(instanceIds(scene.getItems())).toEqual(["i2"]);
  });

  it("ignores non-encounter messages", async () => {
    const { obr, scene } = createFakeObr();
    const sync = createEncounterSync(obr);
    await sync.handleMessage({ v: 1, type: "pong", payload: {} });
    expect(scene.getItems()).toEqual([]);
  });
});
