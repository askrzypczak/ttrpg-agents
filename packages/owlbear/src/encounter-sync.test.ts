import { describe, expect, it } from "vitest";
import type { ChangeOrigin } from "@ttrpg-agents/engine";
import { makeTestInstance } from "@ttrpg-agents/engine/testing";
import { nextDelay } from "./backoff.js";
import { createEncounterSync } from "./encounter-sync.js";
import { createFakeObr } from "./fake-adapter.js";
import type { ObrAdapter } from "./obr-adapter.js";
import type { Timers } from "./reconnecting-socket.js";
import {
  MissingSceneError,
  SceneModel,
  type SceneItem,
} from "./scene-model.js";
import { STAT_BUBBLES_METADATA_KEY } from "./stat-bubbles.js";
import { createMessageFeed, type MessageFeed } from "./testing/messages.js";
import {
  INSTANCE_METADATA_KEY,
  NAME_BASELINE_KEY,
  SYNCED_METADATA_KEY,
  type EncounterInstance,
} from "./sync-plan.js";

const inst = (n: number): EncounterInstance =>
  makeTestInstance({ id: `i${n}`, displayName: `Shadow ${n}`, createdAt: n });

const mcp: ChangeOrigin = { source: "mcp", commandId: "test" };
const table: ChangeOrigin = { source: "table", commandId: "test" };

const snapshot = (feed: MessageFeed, ...ns: number[]) =>
  feed.snapshot(ns.map(inst));
const added = (feed: MessageFeed, ...ns: number[]) =>
  feed.event({ type: "added", instances: ns.map(inst) });
const removed = (feed: MessageFeed, n: number) =>
  feed.event({ type: "removed", id: `i${n}` });
const addedAt = (
  feed: MessageFeed,
  seq: number,
  origin: ChangeOrigin,
  ...ns: number[]
) => feed.event({ type: "added", instances: ns.map(inst), origin }, { seq });

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
    pickImage: (search) => current.obr.pickImage(search),
    fetchImage: (url) => current.obr.fetchImage(url),
    isImageAlive: (url) => current.obr.isImageAlive(url),
    uploadImage: (image) => current.obr.uploadImage(image),
    openPanel: () => current.obr.openPanel(),
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
    const feed = createMessageFeed();
    const { obr, a, b, switchToB } = twoScenes();
    const errors: unknown[] = [];
    const sync = createEncounterSync(obr, (e) => errors.push(e));
    await sync.handleMessage(snapshot(feed, 1, 2));
    expect(instanceIds(a)).toEqual(["i1", "i2"]);
    switchToB();
    await settle();
    expect(errors).toEqual([]);
    expect(instanceIds(b)).toEqual(["i1", "i2"]);
    expect(instanceIds(a)).toEqual(["i1", "i2"]);
  });

  it("does not recreate a token the GM deleted, also after a ready flip", async () => {
    const feed = createMessageFeed();
    const { obr, scene } = createFakeObr();
    const sync = createEncounterSync(obr);
    await sync.handleMessage(snapshot(feed, 1, 2));
    const gone = scene.getItems().find((i) => i.name === "Shadow 1")!;
    scene.deleteItems([gone.id]);

    await sync.handleMessage(snapshot(feed, 1, 2));
    expect(instanceIds(scene)).toEqual(["i2"]);
    await sync.handleMessage(
      feed.event({
        type: "hp-changed",
        id: "i1",
        currentHp: 3,
        maxHp: 16,
      }),
    );
    expect(instanceIds(scene)).toEqual(["i2"]);
    scene.setReady(false);
    scene.setReady(true);
    await settle();
    expect(instanceIds(scene)).toEqual(["i2"]);
  });

  it("records placed instance ids and prunes removed ones", async () => {
    const feed = createMessageFeed();
    const { obr, scene } = createFakeObr();
    const first = createEncounterSync(obr);
    await first.handleMessage(snapshot(feed, 1, 2));
    await first.handleMessage(removed(feed, 1));
    expect(instanceIds(scene)).toEqual(["i2"]);
    // The GM deletes i2's token; then the extension reloads (a new sync on
    // the same scene) and the bridge sends a snapshot that has i1 again.
    scene.deleteItems(scene.getItems().map((i) => i.id));
    const second = createEncounterSync(obr);
    await second.handleMessage(snapshot(feed, 1, 2));
    // i2 is still recorded as placed, so it stays deleted; i1 was pruned
    // when it was removed, so it counts as never placed and is created.
    expect(instanceIds(scene)).toEqual(["i1"]);
  });

  it("a failed apply is retried with backoff and converges", async () => {
    const feed = createMessageFeed();
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
    await sync.handleMessage(snapshot(feed, 1));
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
    await sync.handleMessage(added(feed, 2));
    expect(errors).toHaveLength(3);
    expect(timers.pendingDelays()).toEqual([nextDelay(0, backoff)]);
  });

  it("a scene that goes away mid-apply defers without `onError` and converges on ready", async () => {
    const feed = createMessageFeed();
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
    await sync.handleMessage(snapshot(feed, 1));
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
    const feed = createMessageFeed();
    const { obr, scene, failNextAdds } = recording();
    const timers = new FakeTimers();
    const errors: unknown[] = [];
    const sync = createEncounterSync(obr, (e) => errors.push(e), undefined, {
      timers,
      backoff,
    });
    failNextAdds(1);
    await sync.handleMessage(snapshot(feed, 1));
    expect(timers.pendingDelays()).toHaveLength(1);
    await sync.handleMessage(added(feed, 2));
    expect(timers.pendingDelays()).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(instanceIds(scene)).toEqual(["i1", "i2"]);
  });

  it("folds added, removed, cleared and hp-changed events into the desired state", async () => {
    const feed = createMessageFeed();
    const { obr, scene } = createFakeObr();
    scene.addItems([foreign]);
    const sync = createEncounterSync(obr);
    await sync.handleMessage(snapshot(feed, 1));
    await sync.handleMessage(added(feed, 2, 3));
    expect(instanceIds(scene)).toEqual(["i1", "i2", "i3"]);
    await sync.handleMessage(added(feed, 2, 3));
    expect(instanceIds(scene)).toEqual(["i1", "i2", "i3"]);
    await sync.handleMessage(removed(feed, 1));
    expect(instanceIds(scene)).toEqual(["i2", "i3"]);
    await sync.handleMessage(removed(feed, 99));
    expect(instanceIds(scene)).toEqual(["i2", "i3"]);
    const before = scene.getItems();
    await sync.handleMessage(
      feed.event({
        type: "hp-changed",
        id: "i2",
        currentHp: 3,
        maxHp: 16,
      }),
    );
    // Only i2's stat bubbles value and its entry in the synced record may change.
    const withoutBubbles = (items: SceneItem[]) =>
      items.map((item) => {
        const metadata: Record<string, unknown> = { ...item.metadata };
        delete metadata[STAT_BUBBLES_METADATA_KEY];
        const synced = metadata[SYNCED_METADATA_KEY] as
          Record<string, unknown> | undefined;
        if (synced !== undefined) {
          const rest = { ...synced };
          delete rest[STAT_BUBBLES_METADATA_KEY];
          metadata[SYNCED_METADATA_KEY] = rest;
        }
        return { ...item, metadata };
      });
    expect(withoutBubbles(scene.getItems())).toEqual(withoutBubbles(before));
    expect(tokenOf(scene, 2).metadata[STAT_BUBBLES_METADATA_KEY]).toMatchObject(
      { health: 3, "max health": 16 },
    );
    await sync.handleMessage(feed.event({ type: "cleared" }));
    expect(instanceIds(scene)).toEqual([]);
    await sync.handleMessage(added(feed, 4));
    expect(instanceIds(scene)).toEqual(["i4"]);
    expect(scene.getItems().some((i) => i.id === foreign.id)).toBe(true);
  });

  it("an hp-changed event only updates the stat bubbles of its own token", async () => {
    const feed = createMessageFeed();
    const { obr, scene } = createFakeObr();
    const sync = createEncounterSync(obr);
    await sync.handleMessage(snapshot(feed, 1, 2));
    await sync.handleMessage(
      feed.event({
        type: "hp-changed",
        id: "i1",
        currentHp: 3,
        maxHp: 20,
      }),
    );

    const bubblesOf = (n: number) =>
      tokenOf(scene, n).metadata[STAT_BUBBLES_METADATA_KEY];
    expect(bubblesOf(1)).toMatchObject({ health: 3, "max health": 20 });
    expect(bubblesOf(2)).toMatchObject({ health: 16, "max health": 16 });
  });

  it("ignores events before the first snapshot", async () => {
    const feed = createMessageFeed();
    const { obr, scene } = createFakeObr();
    const sync = createEncounterSync(obr);
    await sync.handleMessage(added(feed, 1));
    expect(instanceIds(scene)).toEqual([]);
    await sync.handleMessage(snapshot(feed, 2));
    expect(instanceIds(scene)).toEqual(["i2"]);
  });

  it("serialises concurrent messages", async () => {
    const feed = createMessageFeed();
    const { obr, scene } = slowObr();
    const errors: unknown[] = [];
    const sync = createEncounterSync(obr, (e) => errors.push(e));
    await Promise.all([
      sync.handleMessage(snapshot(feed, 1, 2)),
      sync.handleMessage(added(feed, 1, 2)),
      sync.handleMessage(added(feed, 1, 2)),
    ]);
    expect(errors).toEqual([]);
    expect(scene.getItems()).toHaveLength(2);
    expect(instanceIds(scene)).toEqual(["i1", "i2"]);
  });

  it("applies in arrival order", async () => {
    const feed = createMessageFeed();
    const { obr, scene } = slowObr();
    const sync = createEncounterSync(obr);
    await Promise.all([
      sync.handleMessage(snapshot(feed, 1, 2)),
      sync.handleMessage(removed(feed, 1)),
    ]);
    expect(instanceIds(scene)).toEqual(["i2"]);
  });

  it("keeps reconciling when `onError` throws", async () => {
    const feed = createMessageFeed();
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
    await expect(
      sync.handleMessage(snapshot(feed, 1)),
    ).resolves.toBeUndefined();
    await expect(sync.handleMessage(added(feed, 2))).resolves.toBeUndefined();
    expect(instanceIds(scene)).toEqual(["i1", "i2"]);
  });

  it("no items API calls while not ready", async () => {
    const feed = createMessageFeed();
    const { obr, calls } = recording(new SceneModel("gm", false));
    const timers = new FakeTimers();
    const errors: unknown[] = [];
    const sync = createEncounterSync(obr, (e) => errors.push(e), undefined, {
      timers,
      backoff,
    });
    await sync.handleMessage(snapshot(feed, 1, 2));
    await sync.handleMessage(added(feed, 3));
    await sync.handleMessage(removed(feed, 1));
    expect(calls).toEqual([]);
    expect(errors).toEqual([]);
    expect(timers.pendingDelays()).toEqual([]);
  });

  it("`onApplied` per successful reconcile", async () => {
    const feed = createMessageFeed();
    const { obr, scene, failNextAdds } = recording(new SceneModel("gm", false));
    const timers = new FakeTimers();
    let applied = 0;
    const sync = createEncounterSync(
      obr,
      () => {},
      () => applied++,
      { timers, backoff },
    );
    await sync.handleMessage(snapshot(feed, 1));
    expect(applied).toBe(0);
    scene.setReady(true);
    await settle();
    expect(applied).toBe(1);
    await sync.handleMessage(added(feed, 2));
    expect(applied).toBe(2);
    failNextAdds(1);
    await sync.handleMessage(added(feed, 3));
    expect(applied).toBe(2);
  });

  it("`appliedInstanceCount` follows snapshot / added / removed / cleared, and does not count a held or failed message", async () => {
    const feed = createMessageFeed();
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

    await sync.handleMessage(snapshot(feed, 1, 2));
    expect(sync.appliedInstanceCount(), "held snapshot").toBe(0);
    scene.setReady(true);
    await settle();
    expect(sync.appliedInstanceCount(), "snapshot").toBe(2);

    await sync.handleMessage(added(feed, 3));
    expect(sync.appliedInstanceCount(), "added").toBe(3);
    await sync.handleMessage(added(feed, 3));
    expect(sync.appliedInstanceCount(), "added again").toBe(3);

    await sync.handleMessage(removed(feed, 1));
    expect(sync.appliedInstanceCount(), "removed").toBe(2);

    failNextAdds(1);
    await sync.handleMessage(added(feed, 4));
    expect(errors).toHaveLength(1);
    expect(sync.appliedInstanceCount(), "failed added").toBe(2);

    await sync.handleMessage(snapshot(feed, 5));
    expect(sync.appliedInstanceCount(), "replacing snapshot").toBe(1);

    await sync.handleMessage(feed.event({ type: "cleared" }));
    expect(sync.appliedInstanceCount(), "cleared").toBe(0);
  });

  it("a snapshot with a renamed instance renames only that token", async () => {
    const feed = createMessageFeed();
    const { obr, scene } = createFakeObr();
    const sync = createEncounterSync(obr);
    await sync.handleMessage(snapshot(feed, 1, 2, 3));
    const before = scene.getItems();

    await sync.handleMessage(
      feed.snapshot([inst(1), { ...inst(2), displayName: "Boss" }, inst(3)]),
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
    const feed = createMessageFeed();
    const { obr, scene } = createFakeObr();
    const sync = createEncounterSync(obr);
    await sync.handleMessage(snapshot(feed, 1, 2));
    scene.updateItems([tokenOf(scene, 1).id], { name: "Boss" });

    // Unrelated to token 1: instance 2 is renamed in the store (control).
    await sync.handleMessage(
      feed.snapshot([inst(1), { ...inst(2), displayName: "Ghost" }]),
    );
    expect(tokenOf(scene, 1).name).toBe("Boss");
    expect(tokenOf(scene, 2).name).toBe("Ghost");
  });

  it("a failed rename leaves the baseline unwritten so the retry renames", async () => {
    const feed = createMessageFeed();
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
    await sync.handleMessage(snapshot(feed, 1));

    failRenames = 1;
    await sync.handleMessage(
      feed.snapshot([{ ...inst(1), displayName: "Boss" }]),
    );
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
    const feed = createMessageFeed();
    const { obr, scene, calls } = recording();
    let applied = 0;
    const sync = createEncounterSync(
      obr,
      () => {},
      () => applied++,
    );
    await sync.handleMessage(snapshot(feed, 1));
    expect(applied).toBe(1);
    calls.length = 0;
    await sync.handleMessage({ v: 1, type: "pong", payload: {} });
    expect(calls).toEqual([]);
    expect(applied).toBe(1);
    expect(instanceIds(scene)).toEqual(["i1"]);
  });
});

describe("createEncounterSync event sequence", () => {
  it("applies mcp events in seq order after the snapshot", async () => {
    const feed = createMessageFeed();
    const { obr, scene } = createFakeObr();
    let storeChanges = 0;
    const sync = createEncounterSync(obr, undefined, undefined, {
      onStoreChange: () => storeChanges++,
    });
    await sync.handleMessage(feed.snapshot([inst(1)]));

    await sync.handleMessage(addedAt(feed, 1, mcp, 2));
    await sync.handleMessage(addedAt(feed, 2, mcp, 3));
    await sync.handleMessage(
      feed.event({ type: "removed", id: "i1", origin: mcp }, { seq: 3 }),
    );

    expect(instanceIds(scene)).toEqual(["i2", "i3"]);
    // The snapshot and each applied event.
    expect(storeChanges).toBe(4);
  });

  it("ignores an event whose seq is not after the last snapshot or applied event", async () => {
    const feed = createMessageFeed();
    const { obr, scene } = createFakeObr();
    let gaps = 0;
    const sync = createEncounterSync(obr, undefined, undefined, {
      onGap: () => gaps++,
    });
    await sync.handleMessage(feed.snapshot([inst(1)], { seq: 3 }));

    await sync.handleMessage(addedAt(feed, 3, mcp, 2));
    await sync.handleMessage(addedAt(feed, 2, mcp, 2));
    await sync.handleMessage(addedAt(feed, 4, mcp, 3));
    await sync.handleMessage(addedAt(feed, 4, mcp, 4));
    await sync.handleMessage(addedAt(feed, 1, mcp, 5));

    expect(instanceIds(scene)).toEqual(["i1", "i3"]);
    expect(gaps).toBe(0);
  });

  it("a table event advances the seq, so the next mcp event applies", async () => {
    const feed = createMessageFeed();
    const { obr, scene } = createFakeObr();
    let gaps = 0;
    const sync = createEncounterSync(obr, undefined, undefined, {
      onGap: () => gaps++,
    });
    await sync.handleMessage(feed.snapshot([inst(1)]));

    await sync.handleMessage(
      feed.event(
        {
          type: "hp-changed",
          id: "i1",
          currentHp: 3,
          maxHp: 16,
          origin: table,
        },
        { seq: 1 },
      ),
    );
    await sync.handleMessage(addedAt(feed, 2, mcp, 3));

    expect(instanceIds(scene)).toEqual(["i1", "i3"]);
    expect(gaps).toBe(0);
  });

  it("on a gap applies nothing, calls onGap once and ignores later events until the next snapshot", async () => {
    const feed = createMessageFeed();
    const { obr, scene } = createFakeObr();
    let gaps = 0;
    const sync = createEncounterSync(obr, undefined, undefined, {
      onGap: () => gaps++,
    });
    await sync.handleMessage(feed.snapshot([inst(1)]));

    await sync.handleMessage(addedAt(feed, 2, mcp, 2));
    expect(instanceIds(scene)).toEqual(["i1"]);
    expect(gaps).toBe(1);

    await sync.handleMessage(addedAt(feed, 1, mcp, 3));
    await sync.handleMessage(addedAt(feed, 3, mcp, 4));
    await sync.handleMessage(addedAt(feed, 5, mcp, 5));

    expect(instanceIds(scene)).toEqual(["i1"]);
    expect(gaps).toBe(1);
  });

  it("a snapshot after a gap resumes applying events after its seq", async () => {
    const feed = createMessageFeed();
    const { obr, scene } = createFakeObr();
    let gaps = 0;
    const sync = createEncounterSync(obr, undefined, undefined, {
      onGap: () => gaps++,
    });
    await sync.handleMessage(feed.snapshot([inst(1)]));
    await sync.handleMessage(addedAt(feed, 2, mcp, 2));
    expect(gaps).toBe(1);

    await sync.handleMessage(feed.snapshot([inst(1), inst(4)], { seq: 5 }));
    await sync.handleMessage(addedAt(feed, 6, mcp, 6));

    expect(instanceIds(scene)).toEqual(["i1", "i4", "i6"]);
    expect(gaps).toBe(1);
  });

  describe("resetting what the table reported", () => {
    /** A sync with token i1 deleted and i2's health typed as text, both reported. */
    async function reported() {
      const feed = createMessageFeed();
      const { obr, scene } = createFakeObr();
      const deleted: string[] = [];
      const rejected: string[] = [];
      let storeChanges = 0;
      const timers = new FakeTimers();
      const sync = createEncounterSync(obr, undefined, undefined, {
        timers,
        send: (message) => {
          if (message.type === "token-deleted")
            deleted.push(message.payload.instanceId);
          return true;
        },
        onEditRejected: (text) => rejected.push(text),
        onStoreChange: () => storeChanges++,
      });
      await sync.handleMessage(feed.snapshot([inst(1), inst(2)]));
      await settle();
      const second = tokenOf(scene, 2);
      scene.setItemMetadata([
        {
          id: second.id,
          key: STAT_BUBBLES_METADATA_KEY,
          value: {
            ...(second.metadata[STAT_BUBBLES_METADATA_KEY] as object),
            health: "lots",
          },
        },
      ]);
      scene.deleteItems([tokenOf(scene, 1).id]);
      await settle();
      timers.fireAll();
      await settle();
      expect(deleted).toEqual(["i1"]);
      expect(rejected).toHaveLength(1);
      return {
        timers,
        sync,
        feed,
        deleted,
        rejected,
        storeChanges: () => storeChanges,
      };
    }

    // Built when the table is collected, so every seq is explicit.
    const tableFeed = createMessageFeed();
    it.each([
      ["snapshot", tableFeed.snapshot([inst(1), inst(2)], { seq: 5 })],
      ["applied mcp event", addedAt(tableFeed, 1, mcp, 3)],
    ])(
      "re-reports an unreadable value and calls onStoreChange, but not a deletion still in flight (%s)",
      async (_name, message) => {
        const { sync, timers, deleted, rejected, storeChanges } =
          await reported();
        const before = storeChanges();

        await sync.handleMessage(message);
        await settle();
        timers.fireAll();
        await settle();

        expect(deleted).toEqual(["i1"]);
        expect(rejected).toHaveLength(2);
        expect(storeChanges()).toBe(before + 1);
      },
    );

    it("a table event does not call onStoreChange", async () => {
      const { sync, feed, deleted, rejected, storeChanges } = await reported();
      const before = storeChanges();

      await sync.handleMessage(addedAt(feed, 1, table, 3));
      await settle();

      expect(storeChanges()).toBe(before);
      expect(deleted).toEqual(["i1"]);
      expect(rejected).toHaveLength(1);

      // Control: the next mcp event does call it.
      await sync.handleMessage(addedAt(feed, 2, mcp, 4));
      expect(storeChanges()).toBe(before + 1);
    });
  });
});
