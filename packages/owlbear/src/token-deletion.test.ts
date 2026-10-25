import { describe, expect, it } from "vitest";
import { makeTestInstance } from "@ttrpg-agents/engine/testing";
import { createEncounterSync } from "./encounter-sync.js";
import { createFakeObr } from "./fake-adapter.js";
import type { ObrAdapter } from "./obr-adapter.js";
import type { SceneItem, SceneModel } from "./scene-model.js";
import { createMessageFeed, type MessageFeed } from "./testing/messages.js";
import {
  INSTANCE_METADATA_KEY,
  PLACED_METADATA_KEY,
  type EncounterInstance,
} from "./sync-plan.js";

const inst = (n: number): EncounterInstance =>
  makeTestInstance({ id: `i${n}`, displayName: `Shadow ${n}`, createdAt: n });

const snapshot = (feed: MessageFeed, ...ns: number[]) =>
  feed.snapshot(ns.map(inst));

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

/** Our token for instance `id` on the scene. */
const tokenOf = (scene: SceneModel, id: string): SceneItem =>
  scene.getItems().find((item) => {
    const link = item.metadata[INSTANCE_METADATA_KEY] as
      { instanceId?: unknown } | undefined;
    return link?.instanceId === id;
  })!;

const instanceIds = (scene: SceneModel): string[] =>
  scene
    .getItems((i) => i.metadata[INSTANCE_METADATA_KEY] !== undefined)
    .map(
      (i) =>
        (i.metadata[INSTANCE_METADATA_KEY] as { instanceId: string })
          .instanceId,
    )
    .sort();

/** A sync over the fake that records the `token-deleted` commands it sends and its write calls. */
function setup() {
  const fake = createFakeObr();
  const writes: string[] = [];
  const obr: ObrAdapter = {
    ...fake.obr,
    addItems: (i) => (writes.push("addItems"), fake.obr.addItems(i)),
    updateItems: (ids, p) => (
      writes.push("updateItems"),
      fake.obr.updateItems(ids, p)
    ),
    setItemMetadata: (u) => (
      writes.push("setItemMetadata"),
      fake.obr.setItemMetadata(u)
    ),
    deleteItems: (i) => (writes.push("deleteItems"), fake.obr.deleteItems(i)),
    setSceneMetadata: (u) => (
      writes.push("setSceneMetadata"),
      fake.obr.setSceneMetadata(u)
    ),
  };
  const reported: string[] = [];
  const sync = createEncounterSync(obr, undefined, undefined, {
    send: (message) => {
      if (message.type === "token-deleted")
        reported.push(message.payload.instanceId);
      return true;
    },
  });
  return { sync, scene: fake.scene, reported, writes };
}

describe("createEncounterSync token deletion", () => {
  it("sends token-deleted after the GM deletes a token", async () => {
    const feed = createMessageFeed();
    const { sync, scene, reported } = setup();
    await sync.handleMessage(snapshot(feed, 1, 2));
    await settle();
    expect(reported).toEqual([]);

    scene.deleteItems([tokenOf(scene, "i1").id]);
    await settle();
    expect(reported).toEqual(["i1"]);
  });

  it("a token deletion in flight is not reported again on a store change", async () => {
    const feed = createMessageFeed();
    const { sync, scene, reported } = setup();
    await sync.handleMessage(snapshot(feed, 1, 2));
    await settle();
    scene.deleteItems([tokenOf(scene, "i1").id]);
    await settle();
    expect(reported).toEqual(["i1"]);

    // More reconciles without a store change: an unrelated item change and
    // a ready flip.
    scene.addItems([foreign]);
    await settle();
    scene.setReady(false);
    scene.setReady(true);
    await settle();
    expect(reported).toEqual(["i1"]);

    // A snapshot that still wants i1 does not send it again: the command
    // waits for the store's answer.
    await sync.handleMessage(snapshot(feed, 1, 2));
    await settle();
    expect(reported).toEqual(["i1"]);

    // Control: after the connection dropped and came back the command may
    // have been lost, so the snapshot that follows reports it again.
    await sync.handleMessage({
      v: 1,
      type: "hello-ack",
      payload: { serverVersion: "0" },
    });
    await sync.handleMessage(snapshot(feed, 1, 2));
    await settle();
    expect(reported).toEqual(["i1", "i1"]);

    // Once i1 has left the encounter it is not reported any more.
    await sync.handleMessage(snapshot(feed, 2));
    await settle();
    expect(reported).toEqual(["i1", "i1"]);
  });

  it("reports nothing while the scene is not ready", async () => {
    const feed = createMessageFeed();
    const { sync, scene, reported } = setup();
    await sync.handleMessage(snapshot(feed, 1, 2));
    await settle();
    const tokens = scene.getItems();

    // The tokens vanish with the scene, then come back with it.
    scene.setReady(false);
    scene.deleteItems(tokens.map((t) => t.id));
    await settle();
    expect(reported).toEqual([]);
    scene.addItems(tokens);
    scene.setReady(true);
    await settle();
    expect(reported).toEqual([]);

    // Control: a deletion on the ready scene is still reported.
    scene.deleteItems([tokenOf(scene, "i2").id]);
    await settle();
    expect(reported).toEqual(["i2"]);
  });

  it("a scene switch (not ready, items cleared, placed record reset via scene.setMetadata, ready) reports nothing", async () => {
    const feed = createMessageFeed();
    const { sync, scene, reported } = setup();
    await sync.handleMessage(snapshot(feed, 1, 2));
    await settle();

    scene.setReady(false);
    await settle();
    scene.deleteItems(scene.getItems().map((i) => i.id));
    await settle();
    scene.setMetadata({ [PLACED_METADATA_KEY]: undefined });
    scene.setReady(true);
    await settle();
    expect(reported).toEqual([]);
    // The new scene is populated instead.
    expect(instanceIds(scene)).toEqual(["i1", "i2"]);

    // Control: a deletion on the new scene is reported.
    scene.deleteItems([tokenOf(scene, "i1").id]);
    await settle();
    expect(reported).toEqual(["i1"]);
  });

  it("our own writes settle: an items change from a reconcile's own writes triggers no further writes", async () => {
    const feed = createMessageFeed();
    const { sync, scene, reported, writes } = setup();
    await sync.handleMessage(snapshot(feed, 1, 2));
    await settle();
    await settle();
    expect(writes).toEqual(["addItems", "setSceneMetadata"]);

    // A GM deletion triggers a reconcile through the items subscription;
    // it reports the instance and writes nothing back to the scene.
    writes.length = 0;
    scene.deleteItems([tokenOf(scene, "i1").id]);
    await settle();
    await settle();
    expect(reported).toEqual(["i1"]);
    expect(writes).toEqual([]);
  });
});
