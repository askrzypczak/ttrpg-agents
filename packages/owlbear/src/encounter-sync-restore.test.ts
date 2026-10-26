import { describe, expect, it } from "vitest";
import { makeTestInstance } from "@ttrpg-agents/engine/testing";
import type { BridgeMessage } from "@ttrpg-agents/protocol";
import { createEncounterSync } from "./encounter-sync.js";
import { createFakeObr } from "./fake-adapter.js";
import type { ObrAdapter } from "./obr-adapter.js";
import type { Timers } from "./reconnecting-socket.js";
import type { SceneItem, SceneModel } from "./scene-model.js";
import {
  INSTANCE_METADATA_KEY,
  PLACED_METADATA_KEY,
  type EncounterInstance,
} from "./sync-plan.js";
import { createMessageFeed } from "./testing/messages.js";

const inst = (n: number): EncounterInstance =>
  makeTestInstance({ id: `i${n}`, displayName: `Shadow ${n}`, createdAt: n });

const foreign: SceneItem = {
  id: "map",
  type: "IMAGE",
  name: "Map",
  visible: true,
  position: { x: 0, y: 0 },
  metadata: {},
};

/** Lets fire-and-forget reconciles (item changes, ready flips) finish. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

/** Our token for instance `id` on the scene, if it has one. */
const tokenOf = (scene: SceneModel, id: string): SceneItem | undefined =>
  scene.getItems().find((item) => {
    const link = item.metadata[INSTANCE_METADATA_KEY] as
      { instanceId?: unknown } | undefined;
    return link?.instanceId === id;
  });

const instanceIds = (scene: SceneModel): string[] =>
  scene
    .getItems((i) => i.metadata[INSTANCE_METADATA_KEY] !== undefined)
    .map(
      (i) =>
        (i.metadata[INSTANCE_METADATA_KEY] as { instanceId: string })
          .instanceId,
    )
    .sort();

/** The bridge's non-fatal refusal of the command with envelope id `id`. */
const refusal = (id: string): BridgeMessage => ({
  v: 1,
  type: "error",
  id,
  payload: { code: "refused", message: "could not remove", fatal: false },
});

/**
 * A sync over the fake that records the `token-deleted` commands it sends;
 * `addItems` can be made to fail, and retry timers are collected and fired
 * by hand.
 */
function setup() {
  const fake = createFakeObr();
  const failing = { adds: false };
  const obr: ObrAdapter = {
    ...fake.obr,
    addItems: (items) =>
      failing.adds
        ? Promise.reject(new Error("add failed"))
        : fake.obr.addItems(items),
  };
  const retries: (() => void)[] = [];
  const timers: Timers = {
    setTimeout: (fn) => {
      retries.push(fn);
      return retries.length;
    },
    clearTimeout: () => {},
  };
  const deletions: { id: string; instanceId: string }[] = [];
  const errors: unknown[] = [];
  const sync = createEncounterSync(obr, (e) => errors.push(e), undefined, {
    timers,
    send: (message) => {
      if (message.type === "token-deleted")
        deletions.push({
          id: message.id ?? "",
          instanceId: message.payload.instanceId,
        });
      return true;
    },
  });
  const retryAll = async () => {
    while (retries.length > 0) {
      for (const retry of retries.splice(0)) retry();
      await settle();
    }
  };
  return {
    sync,
    scene: fake.scene,
    feed: createMessageFeed(),
    deletions,
    reported: () => deletions.map((d) => d.instanceId),
    errors,
    failing,
    retryAll,
  };
}

type Setup = ReturnType<typeof setup>;

/** Snapshot of i1 and i2, settled. */
async function start(s: Setup): Promise<void> {
  await s.sync.handleMessage(s.feed.snapshot([inst(1), inst(2)]));
  await settle();
}

/** The GM deletes instance `id`'s token; returns the `token-deleted` command id. */
async function gmDeletes(s: Setup, id: string): Promise<string> {
  const before = s.deletions.length;
  s.scene.deleteItems([tokenOf(s.scene, id)!.id]);
  await settle();
  expect(s.deletions.slice(before).map((d) => d.instanceId)).toEqual([id]);
  return s.deletions[s.deletions.length - 1]!.id;
}

/** Handles the messages back to back, so they fold before a reconcile runs. */
async function fold(s: Setup, ...messages: BridgeMessage[]): Promise<void> {
  await Promise.all(messages.map((m) => s.sync.handleMessage(m)));
  await settle();
}

/** The GM deletes i1, then the store's removal and an mcp restore are folded together. */
async function deleteAndRestore(s: Setup): Promise<void> {
  await start(s);
  const commandId = await gmDeletes(s, "i1");
  await fold(
    s,
    s.feed.event({
      type: "removed",
      id: "i1",
      origin: { source: "table", commandId },
    }),
    s.feed.event({ type: "added", instances: [inst(1)] }),
  );
}

describe("createEncounterSync restore after deletion", () => {
  it("a table removal and a restore of the same id folded into one reconcile create its token and do not report it deleted again", async () => {
    const s = setup();
    await deleteAndRestore(s);

    expect(tokenOf(s.scene, "i1")).toBeDefined();
    expect(instanceIds(s.scene)).toEqual(["i1", "i2"]);
    expect(s.reported()).toEqual(["i1"]);
    expect(s.scene.getMetadata()[PLACED_METADATA_KEY]).toEqual(
      expect.arrayContaining(["i1"]),
    );
  });

  it("an mcp removal of an instance whose token is already gone and a restore of the same id folded into one reconcile create its token and do not report it deleted", async () => {
    const s = setup();
    await start(s);
    const commandId = await gmDeletes(s, "i1");
    await s.sync.handleMessage(refusal(commandId));
    await settle();
    expect(s.reported()).toEqual(["i1"]);

    await fold(
      s,
      s.feed.event({ type: "removed", id: "i1" }),
      s.feed.event({ type: "added", instances: [inst(1)] }),
    );

    expect(tokenOf(s.scene, "i1")).toBeDefined();
    expect(instanceIds(s.scene)).toEqual(["i1", "i2"]);
    expect(s.reported()).toEqual(["i1"]);
  });

  it("a removal and a restore folded into a reconcile that fails create the token on the retry and do not report it deleted again", async () => {
    const s = setup();
    await start(s);
    const commandId = await gmDeletes(s, "i1");

    s.failing.adds = true;
    await fold(
      s,
      s.feed.event({
        type: "removed",
        id: "i1",
        origin: { source: "table", commandId },
      }),
      s.feed.event({ type: "added", instances: [inst(1)] }),
    );
    expect(s.errors.length).toBeGreaterThan(0);
    expect(tokenOf(s.scene, "i1")).toBeUndefined();

    s.failing.adds = false;
    await s.retryAll();
    expect(tokenOf(s.scene, "i1")).toBeDefined();
    expect(instanceIds(s.scene)).toEqual(["i1", "i2"]);
    expect(s.reported()).toEqual(["i1"]);
  });

  it("a restored token the GM deletes later is reported once and not recreated", async () => {
    const s = setup();
    await deleteAndRestore(s);
    expect(tokenOf(s.scene, "i1")).toBeDefined();

    s.scene.deleteItems([tokenOf(s.scene, "i1")!.id]);
    await settle();
    expect(s.reported()).toEqual(["i1", "i1"]);

    // Later reconciles: an unrelated store event and an item change.
    await s.sync.handleMessage(
      s.feed.event({ type: "hp-changed", id: "i2", currentHp: 3, maxHp: 16 }),
    );
    await settle();
    s.scene.addItems([foreign]);
    await settle();
    expect(s.reported()).toEqual(["i1", "i1"]);
    expect(instanceIds(s.scene)).toEqual(["i2"]);
  });

  it("a clear and a restore of the same ids folded into one reconcile create their tokens and do not report them deleted", async () => {
    const s = setup();
    await start(s);
    const kept = tokenOf(s.scene, "i2")!.id;
    const commandId = await gmDeletes(s, "i1");
    await s.sync.handleMessage(refusal(commandId));
    await settle();

    await fold(
      s,
      s.feed.event({ type: "cleared" }),
      s.feed.event({ type: "added", instances: [inst(1), inst(2)] }),
    );

    expect(tokenOf(s.scene, "i1")).toBeDefined();
    expect(tokenOf(s.scene, "i2")?.id).toBe(kept);
    expect(instanceIds(s.scene)).toEqual(["i1", "i2"]);
    expect(s.reported()).toEqual(["i1"]);
  });
});
