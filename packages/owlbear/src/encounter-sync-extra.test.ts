import { describe, expect, it } from "vitest";
import type { PublishedTokenArt } from "@ttrpg-agents/engine";
import { makeTestInstance } from "@ttrpg-agents/engine/testing";
import type { BridgeMessage } from "@ttrpg-agents/protocol";
import { createEncounterSync } from "./encounter-sync.js";
import { createFakeObr } from "./fake-adapter.js";
import type { ObrAdapter } from "./obr-adapter.js";
import type { Timers } from "./reconnecting-socket.js";
import type { SceneItem } from "./scene-model.js";
import { createMessageFeed, type MessageFeed } from "./testing/messages.js";
import { INSTANCE_METADATA_KEY, type EncounterInstance } from "./sync-plan.js";

const inst = (n: number): EncounterInstance =>
  makeTestInstance({ id: `i${n}`, displayName: `Shadow ${n}`, createdAt: n });
const snapshot = (feed: MessageFeed, ...ns: number[]) =>
  feed.snapshot(ns.map(inst));
/** Published art for the instances' type, with no stored bytes to check. */
const shadowArt: PublishedTokenArt = {
  url: "https://cdn.owlbear.rodeo/assets/shadow.png",
  mime: "image/png",
  width: 256,
  height: 256,
};
const foreign = (id: string): SceneItem => ({
  id,
  type: "IMAGE",
  name: id,
  visible: true,
  position: { x: 0, y: 0 },
  metadata: {},
});
const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

/** A `send` that records the instance of each `token-deleted` command. */
const recordDeletions =
  (reported: string[]) =>
  (message: BridgeMessage): boolean => {
    if (message.type === "token-deleted")
      reported.push(message.payload.instanceId);
    return true;
  };

/** Timers that never fire, so a scheduled retry stays pending. */
const idleTimers: Timers = {
  setTimeout: () => 1,
  clearTimeout: () => {},
};

describe("createEncounterSync item changes", () => {
  it("an item change that recovers from a failed reconcile reports onApplied", async () => {
    const feed = createMessageFeed();
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
    await sync.handleMessage(snapshot(feed, 1));
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
    const feed = createMessageFeed();
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
      send: recordDeletions(reported),
    });
    await sync.handleMessage(snapshot(feed, 1, 2));
    await settle();
    expect(reported).toEqual([]);

    armed = true;
    await sync.handleMessage(snapshot(feed, 1, 2));
    await settle();
    expect(reported).toEqual(["i2"]);
    // The follow-up settles: no reconcile keeps re-queueing itself.
    const before = reads;
    await settle();
    await settle();
    expect(reads).toBe(before);
  });

  it("our own writes cost no extra reconcile pass", async () => {
    const feed = createMessageFeed();
    const fake = createFakeObr();
    let reads = 0;
    const obr: ObrAdapter = {
      ...fake.obr,
      getItems: (f) => (reads++, fake.obr.getItems(f)),
    };
    const sync = createEncounterSync(obr);
    // The type has art, so no art dialog opens.
    await sync.handleMessage(
      feed.snapshot([inst(1), inst(2)], { art: { shadow: shadowArt } }),
    );
    await settle();
    expect(reads).toBe(1);
  });

  it("reports a deletion on a sync whose reconciles have not written anything", async () => {
    const feed = createMessageFeed();
    const fake = createFakeObr();
    await createEncounterSync(fake.obr).handleMessage(snapshot(feed, 1, 2));
    await settle();

    const reported: string[] = [];
    const second = createEncounterSync(fake.obr, undefined, undefined, {
      send: recordDeletions(reported),
    });
    await second.handleMessage(snapshot(feed, 1, 2));
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
    const feed = createMessageFeed();
    const fake = createFakeObr();
    let reads = 0;
    const obr: ObrAdapter = {
      ...fake.obr,
      getItems: (f) => (reads++, fake.obr.getItems(f)),
    };
    const sync = createEncounterSync(obr);
    const ids = ["a", "b", "c", "d", "e"];
    fake.scene.addItems(ids.map(foreign));
    await sync.handleMessage(snapshot(feed, 1));
    await settle();
    reads = 0;
    for (const id of ids) fake.scene.deleteItems([id]);
    await settle();
    expect(reads).toBeGreaterThanOrEqual(1);
    expect(reads).toBeLessThanOrEqual(2);
  });
});
