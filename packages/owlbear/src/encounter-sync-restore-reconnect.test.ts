import { describe, expect, it } from "vitest";
import { makeTestInstance } from "@ttrpg-agents/engine/testing";
import type { BridgeMessage } from "@ttrpg-agents/protocol";
import {
  createEncounterSync,
  PLACED_SEQ_METADATA_KEY,
} from "./encounter-sync.js";
import { createFakeObr } from "./fake-adapter.js";
import type { ObrAdapter } from "./obr-adapter.js";
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

const helloAck: BridgeMessage = {
  v: 1,
  type: "hello-ack",
  payload: { serverVersion: "0" },
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

/** The seq the scene's placed record is current as of. */
const placedSeq = (scene: SceneModel): unknown =>
  scene.getMetadata()[PLACED_SEQ_METADATA_KEY];

type Fake = ReturnType<typeof createFakeObr>;

/**
 * One extension tab: a sync over the shared fake scene that records the
 * `token-deleted` commands it sends. `close()` silences it as a closed tab
 * would be: it sends nothing more and no longer reacts to scene changes.
 */
function openTab(fake: Fake) {
  let open = true;
  const obr: ObrAdapter = {
    ...fake.obr,
    onItemsChange: (callback) =>
      fake.obr.onItemsChange(() => {
        if (open) callback();
      }),
    onSceneReadyChange: (callback) =>
      fake.obr.onSceneReadyChange((ready) => {
        if (open) callback(ready);
      }),
  };
  const reported: string[] = [];
  const sync = createEncounterSync(obr, undefined, undefined, {
    send: (message) => {
      if (!open) return false;
      if (message.type === "token-deleted")
        reported.push(message.payload.instanceId);
      return true;
    },
  });
  return {
    sync,
    reported,
    close: () => {
      open = false;
    },
  };
}

type Tab = ReturnType<typeof openTab>;

function setup() {
  const fake = createFakeObr();
  return { fake, scene: fake.scene, feed: createMessageFeed() };
}

/** Handles the messages back to back, so they fold before a reconcile runs. */
async function fold(tab: Tab, ...messages: BridgeMessage[]): Promise<void> {
  await Promise.all(messages.map((m) => tab.sync.handleMessage(m)));
  await settle();
}

/** The GM deletes instance `id`'s token. */
async function gmDeletes(scene: SceneModel, id: string): Promise<void> {
  scene.deleteItems([tokenOf(scene, id)!.id]);
  await settle();
}

/** A later reconcile that brings no restore: an unrelated item change. */
async function laterReconcile(scene: SceneModel): Promise<void> {
  scene.addItems([foreign]);
  await settle();
}

describe("createEncounterSync restore after a missed removal", () => {
  it("a monster restored while the socket was down, after the GM's deletion reached the store, gets a new token after the reconnect and is not reported deleted again", async () => {
    const { fake, scene, feed } = setup();
    const tab = openTab(fake);
    await fold(tab, feed.snapshot([inst(1), inst(2)]));
    await gmDeletes(scene, "i1");
    expect(tab.reported).toEqual(["i1"]);

    // The socket drops: the store removes i1 (seq 1) and an mcp restore puts
    // it back (seq 2); neither event reaches the extension.
    await fold(
      tab,
      helloAck,
      feed.snapshot([inst(1), inst(2)], { seq: 2, restoreSeqs: { i1: 2 } }),
    );

    expect(tokenOf(scene, "i1")).toBeDefined();
    expect(instanceIds(scene)).toEqual(["i1", "i2"]);
    expect(tab.reported).toEqual(["i1"]);
  });

  it("a monster restored while the tab was closed, after the GM's deletion reached the store, gets a new token when the reloaded tab reconciles and is not reported deleted again", async () => {
    const { fake, scene, feed } = setup();
    const first = openTab(fake);
    await fold(first, feed.snapshot([inst(1), inst(2)]));
    await gmDeletes(scene, "i1");
    expect(first.reported).toEqual(["i1"]);
    first.close();

    // While the tab is closed the store removes i1 (seq 1) and an mcp
    // restore puts it back (seq 2).
    const reloaded = openTab(fake);
    await fold(
      reloaded,
      helloAck,
      feed.snapshot([inst(1), inst(2)], { seq: 2, restoreSeqs: { i1: 2 } }),
    );

    expect(tokenOf(scene, "i1")).toBeDefined();
    expect(instanceIds(scene)).toEqual(["i1", "i2"]);
    expect(reloaded.reported).toEqual([]);

    // The GM deletes the new token: reported once and not recreated.
    await gmDeletes(scene, "i1");
    expect(reloaded.reported).toEqual(["i1"]);
    await fold(
      reloaded,
      feed.event({ type: "hp-changed", id: "i2", currentHp: 3, maxHp: 16 }),
    );
    await laterReconcile(scene);
    expect(reloaded.reported).toEqual(["i1"]);
    expect(instanceIds(scene)).toEqual(["i2"]);
  });

  it("a removal learned from a snapshot and a restore event folded into one reconcile create the token and do not report it deleted again", async () => {
    const { fake, scene, feed } = setup();
    const tab = openTab(fake);
    await fold(tab, feed.snapshot([inst(1), inst(2)]));
    await gmDeletes(scene, "i1");
    expect(tab.reported).toEqual(["i1"]);

    // The socket drops and the store removes i1 (seq 1); the snapshot after
    // the reconnect lacks it, and the restore (seq 2) follows at once.
    await fold(
      tab,
      helloAck,
      feed.snapshot([inst(2)], { seq: 1 }),
      feed.event({ type: "added", instances: [inst(1)] }, { seq: 2 }),
    );

    expect(tokenOf(scene, "i1")).toBeDefined();
    expect(instanceIds(scene)).toEqual(["i1", "i2"]);
    expect(tab.reported).toEqual(["i1"]);
  });

  it("a restore seq newer than the snapshot's own seq is recorded with the placed record, so the GM's later deletion of that token is reported once and the token is not recreated", async () => {
    const { fake, scene, feed } = setup();
    const tab = openTab(fake);
    await fold(tab, feed.snapshot([inst(1), inst(2)]));
    await gmDeletes(scene, "i1");
    expect(tab.reported).toEqual(["i1"]);

    // The store removed i1 at seq 1; the snapshot is taken at seq 1, and the
    // restore at seq 2 lands before its restore seqs are read.
    await fold(
      tab,
      helloAck,
      feed.snapshot([inst(1), inst(2)], { seq: 1, restoreSeqs: { i1: 2 } }),
    );
    expect(tokenOf(scene, "i1")).toBeDefined();
    expect(tab.reported).toEqual(["i1"]);
    expect(placedSeq(scene)).toBe(2);
    expect(scene.getMetadata()[PLACED_METADATA_KEY]).toEqual(
      expect.arrayContaining(["i1", "i2"]),
    );

    // The GM deletes the new token before the restore's event arrives.
    await gmDeletes(scene, "i1");
    expect(tab.reported).toEqual(["i1", "i1"]);
    await laterReconcile(scene);
    expect(tab.reported).toEqual(["i1", "i1"]);
    expect(instanceIds(scene)).toEqual(["i2"]);

    // The restore's own event, at the recorded seq, does not bring it back.
    await fold(
      tab,
      feed.event({ type: "added", instances: [inst(1)] }, { seq: 2 }),
    );
    expect(tab.reported).toEqual(["i1", "i1"]);
    expect(instanceIds(scene)).toEqual(["i2"]);
  });

  it("a placed instance that kept its token through a missed removal and restore keeps it, and the GM's later deletion of that token is reported once and not recreated", async () => {
    const { fake, scene, feed } = setup();
    const tab = openTab(fake);
    await fold(tab, feed.snapshot([inst(1), inst(2)]));
    const kept = tokenOf(scene, "i1")!.id;

    // The socket drops: mcp removes i1 (seq 1) and restores it (seq 2); the
    // extension never saw either, so its token stayed.
    await fold(
      tab,
      helloAck,
      feed.snapshot([inst(1), inst(2)], { seq: 2, restoreSeqs: { i1: 2 } }),
    );
    expect(tokenOf(scene, "i1")?.id).toBe(kept);
    expect(tab.reported).toEqual([]);
    // The record is brought up to the restore, so i1 counts as placed again.
    expect(placedSeq(scene)).toBe(2);

    await gmDeletes(scene, "i1");
    expect(tab.reported).toEqual(["i1"]);
    await laterReconcile(scene);
    expect(tab.reported).toEqual(["i1"]);
    expect(instanceIds(scene)).toEqual(["i2"]);
  });

  it("after a reload, a placed instance without a token that the store still holds and never restored is reported deleted", async () => {
    const { fake, scene, feed } = setup();
    const first = openTab(fake);
    await fold(first, feed.snapshot([inst(1), inst(2)], { seq: 3 }));
    // The first reconcile records the seq the placed record is current as of.
    expect(placedSeq(scene)).toBe(3);

    // The GM deletes i1's token; the tab closes before the command reaches
    // the store, so i1 is never removed (and never restored).
    await gmDeletes(scene, "i1");
    expect(first.reported).toEqual(["i1"]);
    first.close();

    const reloaded = openTab(fake);
    await fold(
      reloaded,
      helloAck,
      feed.snapshot([inst(1), inst(2)], { seq: 4 }),
    );

    expect(reloaded.reported).toEqual(["i1"]);
    expect(instanceIds(scene)).toEqual(["i2"]);
  });

  it("a placed instance without a token whose last restore is at or before the placed record's seq is reported deleted after a reconnect", async () => {
    const { fake, scene, feed } = setup();
    const tab = openTab(fake);
    await fold(tab, feed.snapshot([inst(1), inst(2)]));
    // mcp removes i1 and restores it, both seen by the extension.
    await fold(tab, feed.event({ type: "removed", id: "i1" }));
    await fold(tab, feed.event({ type: "added", instances: [inst(1)] }));
    expect(tokenOf(scene, "i1")).toBeDefined();
    // The placed record is current as of the restore.
    expect(placedSeq(scene)).toBe(2);

    // The GM deletes the token and the command is lost when the socket drops.
    await gmDeletes(scene, "i1");
    expect(tab.reported).toEqual(["i1"]);
    await fold(
      tab,
      helloAck,
      feed.snapshot([inst(1), inst(2)], { seq: 2, restoreSeqs: { i1: 2 } }),
    );

    expect(tab.reported).toEqual(["i1", "i1"]);
    expect(instanceIds(scene)).toEqual(["i2"]);
  });

  it("a placed record without a seq, from an older extension, reports a placed instance without a token as before and is given a seq", async () => {
    const { fake, scene, feed } = setup();
    const older = openTab(fake);
    await fold(older, feed.snapshot([inst(1), inst(2)]));
    older.close();
    // An older extension wrote the placed record without a seq.
    scene.setMetadata({ [PLACED_SEQ_METADATA_KEY]: undefined });
    expect(scene.getMetadata()[PLACED_METADATA_KEY]).toEqual(
      expect.arrayContaining(["i1", "i2"]),
    );

    // The GM deletes i1's token while no current extension is open.
    await gmDeletes(scene, "i1");

    const current = openTab(fake);
    await fold(
      current,
      helloAck,
      feed.snapshot([inst(1), inst(2)], { seq: 2, restoreSeqs: { i1: 1 } }),
    );

    expect(current.reported).toEqual(["i1"]);
    expect(instanceIds(scene)).toEqual(["i2"]);
    expect(placedSeq(scene)).toBe(2);
  });
});
