import { describe, expect, it } from "vitest";
import type { BridgeMessage } from "@ttrpg-agents/protocol";
import { nextDelay } from "./backoff.js";
import {
  createEncounterSync,
  type EncounterEventPayload,
} from "./encounter-sync.js";
import { createFakeObr } from "./fake-adapter.js";
import type { ObrAdapter } from "./obr-adapter.js";
import type { Timers } from "./reconnecting-socket.js";
import {
  MissingSceneError,
  SceneModel,
  type SceneItem,
} from "./scene-model.js";
import {
  INSTANCE_METADATA_KEY,
  NAME_BASELINE_KEY,
  SYNCED_METADATA_KEY,
  type EncounterInstance,
} from "./sync-plan.js";

const inst = (n: number): EncounterInstance => ({
  id: `i${n}`,
  encounterId: "e1",
  monsterKey: "shadow",
  displayName: `Shadow ${n}`,
  maxHp: 16,
  currentHp: 16,
  initiative: null,
  armorClass: null,
  groupId: null,
  createdAt: n,
});

const snapshot = (...ns: number[]): BridgeMessage => ({
  v: 1,
  type: "encounter-snapshot",
  payload: { instances: ns.map(inst) },
});
const snapshotOf = (...instances: EncounterInstance[]): BridgeMessage => ({
  v: 1,
  type: "encounter-snapshot",
  payload: { instances },
});
const event = (payload: EncounterEventPayload): BridgeMessage => ({
  v: 1,
  type: "encounter-event",
  payload,
});
const added = (...ns: number[]) =>
  event({ type: "added", instances: ns.map(inst) });
const removed = (n: number) => event({ type: "removed", id: `i${n}` });

const foreign: SceneItem = {
  id: "map",
  type: "IMAGE",
  name: "Map",
  visible: true,
  position: { x: 0, y: 0 },
  metadata: { "other.ext/thing": { instanceId: "i1" } },
};

/** Instance ids of our tokens on the scene, sorted. */
const instanceIds = (scene: SceneModel): string[] =>
  scene
    .getItems((i) => i.metadata[INSTANCE_METADATA_KEY] !== undefined)
    .map(
      (i) =>
        (i.metadata[INSTANCE_METADATA_KEY] as { instanceId: string })
          .instanceId,
    )
    .sort();

/** Our token for instance `n`. */
const tokenOf = (scene: SceneModel, n: number): SceneItem => {
  const found = scene
    .getItems()
    .find(
      (i) =>
        (
          i.metadata[INSTANCE_METADATA_KEY] as
            { instanceId?: string } | undefined
        )?.instanceId === `i${n}`,
    );
  if (!found) throw new Error(`no token for i${n}`);
  return found;
};

/** Token names keyed by item id. */
const namesById = (scene: SceneModel): Record<string, string> =>
  Object.fromEntries(scene.getItems().map((i) => [i.id, i.name]));

/** Lets fire-and-forget reconciles (ready flips, retries) finish. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

class FakeTimers implements Timers {
  pending = new Map<number, { fn: () => void; ms: number }>();
  private next = 1;
  setTimeout(fn: () => void, ms: number) {
    const id = this.next++;
    this.pending.set(id, { fn, ms });
    return id;
  }
  clearTimeout(handle: unknown) {
    this.pending.delete(handle as number);
  }
  fireAll() {
    const all = [...this.pending.values()];
    this.pending.clear();
    for (const t of all) t.fn();
  }
  pendingDelays(): number[] {
    return [...this.pending.values()].map((t) => t.ms);
  }
}

const backoff = { baseMs: 100, random: () => 0 };

/** Fake adapter that records items API calls; `fail` makes addItems reject. */
function recording(scene: SceneModel = new SceneModel()) {
  const fake = createFakeObr(scene);
  const calls: string[] = [];
  let failures = 0;
  const obr: ObrAdapter = {
    ...fake.obr,
    getItems: (f) => (calls.push("getItems"), fake.obr.getItems(f)),
    addItems: (i) => {
      calls.push("addItems");
      if (failures > 0) {
        failures--;
        return Promise.reject(new Error("boom"));
      }
      return fake.obr.addItems(i);
    },
    updateItems: (ids, p) => (
      calls.push("updateItems"),
      fake.obr.updateItems(ids, p)
    ),
    setItemMetadata: (u) => (
      calls.push("setItemMetadata"),
      fake.obr.setItemMetadata(u)
    ),
    deleteItems: (i) => (calls.push("deleteItems"), fake.obr.deleteItems(i)),
  };
  return {
    obr,
    scene: fake.scene,
    calls,
    failNextAdds: (n: number) => {
      failures = n;
    },
  };
}

/** Adapter whose reads and writes yield to the event loop, widening races. */
function slowObr() {
  const { obr, scene } = createFakeObr();
  const later = () => new Promise((resolve) => setTimeout(resolve, 5));
  const slow: ObrAdapter = {
    ...obr,
    getItems: async (filter) => (await later(), obr.getItems(filter)),
    addItems: async (items) => (await later(), obr.addItems(items)),
  };
  return { obr: slow, scene };
}

/**
 * One adapter over two scenes, A (ready) and B (not ready), as when the GM
 * switches scenes: `switchToB` makes A unready, then B current and ready.
 */
function twoScenes() {
  const a = createFakeObr();
  const b = createFakeObr(new SceneModel("gm", false));
  let current = a;
  const listeners = new Set<(ready: boolean) => void>();
  for (const fake of [a, b])
    fake.obr.onSceneReadyChange((ready) => {
      if (fake === current) for (const l of [...listeners]) l(ready);
    });
  const obr: ObrAdapter = {
    onReady: (cb) => current.obr.onReady(cb),
    getRole: () => current.obr.getRole(),
    isSceneReady: () => current.obr.isSceneReady(),
    onSceneReadyChange: (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    onItemsChange: (cb) => {
      const offs = [a, b].map((fake) =>
        fake.obr.onItemsChange(() => {
          if (fake === current) cb();
        }),
      );
      return () => offs.forEach((off) => off());
    },
    addItems: (i) => current.obr.addItems(i),
    getItems: (f) => current.obr.getItems(f),
    updateItems: (ids, p) => current.obr.updateItems(ids, p),
    setItemMetadata: (u) => current.obr.setItemMetadata(u),
    deleteItems: (ids) => current.obr.deleteItems(ids),
    getSceneMetadata: () => current.obr.getSceneMetadata(),
    setSceneMetadata: (u) => current.obr.setSceneMetadata(u),
    getViewportCenter: () => current.obr.getViewportCenter(),
  };
  return {
    obr,
    a: a.scene,
    b: b.scene,
    switchToB: () => {
      a.scene.setReady(false);
      current = b;
      b.scene.setReady(true);
    },
  };
}

describe("createEncounterSync", () => {
  it("recreates tokens when the scene becomes ready on a scene never populated, without a new message", async () => {
    const { obr, a, b, switchToB } = twoScenes();
    const errors: unknown[] = [];
    const sync = createEncounterSync(obr, (e) => errors.push(e));
    await sync.handleMessage(snapshot(1, 2));
    expect(instanceIds(a)).toEqual(["i1", "i2"]);
    switchToB();
    await settle();
    expect(errors).toEqual([]);
    expect(instanceIds(b)).toEqual(["i1", "i2"]);
    expect(instanceIds(a)).toEqual(["i1", "i2"]);
  });

  it("does not recreate a token the GM deleted, also after a ready flip", async () => {
    const { obr, scene } = createFakeObr();
    const sync = createEncounterSync(obr);
    await sync.handleMessage(snapshot(1, 2));
    const gone = scene.getItems().find((i) => i.name === "Shadow 1")!;
    scene.deleteItems([gone.id]);

    await sync.handleMessage(snapshot(1, 2));
    expect(instanceIds(scene)).toEqual(["i2"]);
    await sync.handleMessage(
      event({ type: "hp-changed", id: "i1", currentHp: 3, maxHp: 16 }),
    );
    expect(instanceIds(scene)).toEqual(["i2"]);
    scene.setReady(false);
    scene.setReady(true);
    await settle();
    expect(instanceIds(scene)).toEqual(["i2"]);
  });

  it("records placed instance ids and prunes removed ones", async () => {
    const { obr, scene } = createFakeObr();
    const first = createEncounterSync(obr);
    await first.handleMessage(snapshot(1, 2));
    await first.handleMessage(removed(1));
    expect(instanceIds(scene)).toEqual(["i2"]);
    // The GM deletes i2's token; then the extension reloads (a new sync on
    // the same scene) and the bridge sends a snapshot that has i1 again.
    scene.deleteItems(scene.getItems().map((i) => i.id));
    const second = createEncounterSync(obr);
    await second.handleMessage(snapshot(1, 2));
    // i2 is still recorded as placed, so it stays deleted; i1 was pruned
    // when it was removed, so it counts as never placed and is created.
    expect(instanceIds(scene)).toEqual(["i1"]);
  });

  it("a failed apply is retried with backoff and converges", async () => {
    const { obr, scene, failNextAdds } = recording();
    const timers = new FakeTimers();
    const errors: unknown[] = [];
    let applied = 0;
    const sync = createEncounterSync(
      obr,
      (e) => errors.push(e),
      () => applied++,
      { timers, backoff },
    );
    failNextAdds(2);
    await sync.handleMessage(snapshot(1));
    expect(errors).toHaveLength(1);
    expect(timers.pendingDelays()).toEqual([nextDelay(0, backoff)]);

    timers.fireAll();
    await settle();
    expect(errors).toHaveLength(2);
    expect(timers.pendingDelays()).toEqual([nextDelay(1, backoff)]);

    timers.fireAll();
    await settle();
    expect(errors).toHaveLength(2);
    expect(timers.pendingDelays()).toEqual([]);
    expect(applied).toBe(1);
    expect(instanceIds(scene)).toEqual(["i1"]);

    // Success reset the attempt counter: the next failure waits the base delay.
    failNextAdds(1);
    await sync.handleMessage(added(2));
    expect(errors).toHaveLength(3);
    expect(timers.pendingDelays()).toEqual([nextDelay(0, backoff)]);
  });

  it("a scene that goes away mid-apply defers without `onError` and converges on ready", async () => {
    const fake = createFakeObr();
    const timers = new FakeTimers();
    const errors: unknown[] = [];
    let failOnce = true;
    const obr: ObrAdapter = {
      ...fake.obr,
      addItems: (items) => {
        if (failOnce) {
          failOnce = false;
          fake.scene.setReady(false);
          return Promise.reject(new MissingSceneError());
        }
        return fake.obr.addItems(items);
      },
    };
    let applied = 0;
    const sync = createEncounterSync(
      obr,
      (e) => errors.push(e),
      () => applied++,
      { timers, backoff },
    );
    await sync.handleMessage(snapshot(1));
    expect(errors).toEqual([]);
    expect(applied).toBe(0);
    expect(timers.pendingDelays()).toEqual([]);
    fake.scene.setReady(true);
    await settle();
    expect(errors).toEqual([]);
    expect(applied).toBe(1);
    expect(instanceIds(fake.scene)).toEqual(["i1"]);
  });

  it("a new message cancels the pending retry", async () => {
    const { obr, scene, failNextAdds } = recording();
    const timers = new FakeTimers();
    const errors: unknown[] = [];
    const sync = createEncounterSync(obr, (e) => errors.push(e), undefined, {
      timers,
      backoff,
    });
    failNextAdds(1);
    await sync.handleMessage(snapshot(1));
    expect(timers.pendingDelays()).toHaveLength(1);
    await sync.handleMessage(added(2));
    expect(timers.pendingDelays()).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(instanceIds(scene)).toEqual(["i1", "i2"]);
  });

  it("folds added, removed, cleared and hp-changed events into the desired state", async () => {
    const { obr, scene } = createFakeObr();
    scene.addItems([foreign]);
    const sync = createEncounterSync(obr);
    await sync.handleMessage(snapshot(1));
    await sync.handleMessage(added(2, 3));
    expect(instanceIds(scene)).toEqual(["i1", "i2", "i3"]);
    await sync.handleMessage(added(2, 3));
    expect(instanceIds(scene)).toEqual(["i1", "i2", "i3"]);
    await sync.handleMessage(removed(1));
    expect(instanceIds(scene)).toEqual(["i2", "i3"]);
    await sync.handleMessage(removed(99));
    expect(instanceIds(scene)).toEqual(["i2", "i3"]);
    const before = scene.getItems();
    await sync.handleMessage(
      event({ type: "hp-changed", id: "i2", currentHp: 3, maxHp: 16 }),
    );
    expect(scene.getItems()).toEqual(before);
    await sync.handleMessage(event({ type: "cleared" }));
    expect(instanceIds(scene)).toEqual([]);
    await sync.handleMessage(added(4));
    expect(instanceIds(scene)).toEqual(["i4"]);
    expect(scene.getItems().some((i) => i.id === foreign.id)).toBe(true);
  });

  it("ignores events before the first snapshot", async () => {
    const { obr, scene } = createFakeObr();
    const sync = createEncounterSync(obr);
    await sync.handleMessage(added(1));
    expect(instanceIds(scene)).toEqual([]);
    await sync.handleMessage(snapshot(2));
    expect(instanceIds(scene)).toEqual(["i2"]);
  });

  it("serialises concurrent messages", async () => {
    const { obr, scene } = slowObr();
    const errors: unknown[] = [];
    const sync = createEncounterSync(obr, (e) => errors.push(e));
    await Promise.all([
      sync.handleMessage(snapshot(1, 2)),
      sync.handleMessage(added(1, 2)),
      sync.handleMessage(added(1, 2)),
    ]);
    expect(errors).toEqual([]);
    expect(scene.getItems()).toHaveLength(2);
    expect(instanceIds(scene)).toEqual(["i1", "i2"]);
  });

  it("applies in arrival order", async () => {
    const { obr, scene } = slowObr();
    const sync = createEncounterSync(obr);
    await Promise.all([
      sync.handleMessage(snapshot(1, 2)),
      sync.handleMessage(removed(1)),
    ]);
    expect(instanceIds(scene)).toEqual(["i2"]);
  });

  it("keeps reconciling when `onError` throws", async () => {
    const { obr, scene, failNextAdds } = recording();
    const timers = new FakeTimers();
    const sync = createEncounterSync(
      obr,
      () => {
        throw new Error("handler broke");
      },
      undefined,
      { timers, backoff },
    );
    failNextAdds(1);
    await expect(sync.handleMessage(snapshot(1))).resolves.toBeUndefined();
    await expect(sync.handleMessage(added(2))).resolves.toBeUndefined();
    expect(instanceIds(scene)).toEqual(["i1", "i2"]);
  });

  it("no items API calls while not ready", async () => {
    const { obr, calls } = recording(new SceneModel("gm", false));
    const timers = new FakeTimers();
    const errors: unknown[] = [];
    const sync = createEncounterSync(obr, (e) => errors.push(e), undefined, {
      timers,
      backoff,
    });
    await sync.handleMessage(snapshot(1, 2));
    await sync.handleMessage(added(3));
    await sync.handleMessage(removed(1));
    expect(calls).toEqual([]);
    expect(errors).toEqual([]);
    expect(timers.pendingDelays()).toEqual([]);
  });

  it("`onApplied` per successful reconcile", async () => {
    const { obr, scene, failNextAdds } = recording(new SceneModel("gm", false));
    const timers = new FakeTimers();
    let applied = 0;
    const sync = createEncounterSync(
      obr,
      () => {},
      () => applied++,
      { timers, backoff },
    );
    await sync.handleMessage(snapshot(1));
    expect(applied).toBe(0);
    scene.setReady(true);
    await settle();
    expect(applied).toBe(1);
    await sync.handleMessage(added(2));
    expect(applied).toBe(2);
    failNextAdds(1);
    await sync.handleMessage(added(3));
    expect(applied).toBe(2);
  });

  it("`appliedInstanceCount` follows snapshot / added / removed / cleared, and does not count a held or failed message", async () => {
    const { obr, scene, failNextAdds } = recording(new SceneModel("gm", false));
    const errors: unknown[] = [];
    const sync = createEncounterSync(
      obr,
      (e) => errors.push(e),
      () => {},
      {
        timers: new FakeTimers(),
        backoff,
      },
    );

    await sync.handleMessage(snapshot(1, 2));
    expect(sync.appliedInstanceCount(), "held snapshot").toBe(0);
    scene.setReady(true);
    await settle();
    expect(sync.appliedInstanceCount(), "snapshot").toBe(2);

    await sync.handleMessage(added(3));
    expect(sync.appliedInstanceCount(), "added").toBe(3);
    await sync.handleMessage(added(3));
    expect(sync.appliedInstanceCount(), "added again").toBe(3);

    await sync.handleMessage(removed(1));
    expect(sync.appliedInstanceCount(), "removed").toBe(2);

    failNextAdds(1);
    await sync.handleMessage(added(4));
    expect(errors).toHaveLength(1);
    expect(sync.appliedInstanceCount(), "failed added").toBe(2);

    await sync.handleMessage(snapshot(5));
    expect(sync.appliedInstanceCount(), "replacing snapshot").toBe(1);

    await sync.handleMessage(event({ type: "cleared" }));
    expect(sync.appliedInstanceCount(), "cleared").toBe(0);
  });

  it("a snapshot with a renamed instance renames only that token", async () => {
    const { obr, scene } = createFakeObr();
    const sync = createEncounterSync(obr);
    await sync.handleMessage(snapshot(1, 2, 3));
    const before = scene.getItems();

    await sync.handleMessage(
      snapshotOf(inst(1), { ...inst(2), displayName: "Boss" }, inst(3)),
    );
    const after = scene.getItems();
    expect(after.map((i) => i.id)).toEqual(before.map((i) => i.id));
    expect(namesById(scene)).toEqual({
      [tokenOf(scene, 1).id]: "Shadow 1",
      [tokenOf(scene, 2).id]: "Boss",
      [tokenOf(scene, 3).id]: "Shadow 3",
    });
  });

  it("a GM-renamed token keeps its name across an unrelated snapshot", async () => {
    const { obr, scene } = createFakeObr();
    const sync = createEncounterSync(obr);
    await sync.handleMessage(snapshot(1, 2));
    scene.updateItems([tokenOf(scene, 1).id], { name: "Boss" });

    // Unrelated to token 1: instance 2 is renamed in the store (control).
    await sync.handleMessage(
      snapshotOf(inst(1), { ...inst(2), displayName: "Ghost" }),
    );
    expect(tokenOf(scene, 1).name).toBe("Boss");
    expect(tokenOf(scene, 2).name).toBe("Ghost");
  });

  it("a failed rename leaves the baseline unwritten so the retry renames", async () => {
    const fake = createFakeObr();
    let failRenames = 0;
    const obr: ObrAdapter = {
      ...fake.obr,
      updateItems: (ids, patch) => {
        if (patch.name !== undefined && failRenames > 0) {
          failRenames--;
          return Promise.reject(new Error("boom"));
        }
        return fake.obr.updateItems(ids, patch);
      },
    };
    const timers = new FakeTimers();
    const errors: unknown[] = [];
    const sync = createEncounterSync(obr, (e) => errors.push(e), undefined, {
      timers,
      backoff,
    });
    await sync.handleMessage(snapshot(1));

    failRenames = 1;
    await sync.handleMessage(snapshotOf({ ...inst(1), displayName: "Boss" }));
    expect(errors).toHaveLength(1);
    const failed = tokenOf(fake.scene, 1);
    expect(failed.name).toBe("Shadow 1");
    expect(failed.metadata[SYNCED_METADATA_KEY]).toMatchObject({
      [NAME_BASELINE_KEY]: "Shadow 1",
    });

    timers.fireAll();
    await settle();
    expect(errors).toHaveLength(1);
    expect(tokenOf(fake.scene, 1).name).toBe("Boss");
  });

  it("ignores non-encounter messages", async () => {
    const { obr, scene, calls } = recording();
    let applied = 0;
    const sync = createEncounterSync(
      obr,
      () => {},
      () => applied++,
    );
    await sync.handleMessage(snapshot(1));
    expect(applied).toBe(1);
    calls.length = 0;
    await sync.handleMessage({ v: 1, type: "pong", payload: {} });
    expect(calls).toEqual([]);
    expect(applied).toBe(1);
    expect(instanceIds(scene)).toEqual(["i1"]);
  });
});
