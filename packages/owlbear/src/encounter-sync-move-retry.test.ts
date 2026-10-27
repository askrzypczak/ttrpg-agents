import { describe, expect, it } from "vitest";
import type { ChangeOrigin } from "@ttrpg-agents/engine";
import { makeTestInstance } from "@ttrpg-agents/engine/testing";
import { createEncounterSync } from "./encounter-sync.js";
import { createFakeObr } from "./fake-adapter.js";
import type { ObrAdapter } from "./obr-adapter.js";
import type { Timers } from "./reconnecting-socket.js";
import { SceneModel, type SceneItem, type Vec2 } from "./scene-model.js";
import { INSTANCE_METADATA_KEY, type EncounterInstance } from "./sync-plan.js";
import { createMessageFeed, type MessageFeed } from "./testing/messages.js";

const mcp: ChangeOrigin = { source: "mcp", commandId: "move" };

/** The new spawn position the move tool set for instance 1. */
const target: Vec2 = { x: 650, y: 550 };
/** Where the GM dragged token 1. */
const dragged: Vec2 = { x: 900, y: 900 };

const inst = (n: number): EncounterInstance =>
  makeTestInstance({
    id: `i${n}`,
    displayName: `Shadow ${n}`,
    createdAt: n,
    spawnPosition: { x: 150 * n, y: 150 },
  });

const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

const positionChanged = (feed: MessageFeed, n: number, at: Vec2) =>
  feed.event({
    type: "position-changed",
    id: `i${n}`,
    spawnPosition: at,
    origin: mcp,
  });

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

const movedNote =
  "Shadow 1 was moved at the agent's request; its token had been moved on the table, and that position was overwritten.";

/**
 * A sync over a fake scene whose next position write or next item metadata
 * write can be made to fail; retry timers are collected and fired by hand.
 */
function setup() {
  const fake = createFakeObr(new SceneModel());
  const failing = { move: false, metadata: false };
  const obr: ObrAdapter = {
    ...fake.obr,
    updateItems: (ids, patch) => {
      if (patch.position !== undefined && failing.move) {
        failing.move = false;
        return Promise.reject(new Error("move failed"));
      }
      return fake.obr.updateItems(ids, patch);
    },
    setItemMetadata: (updates) => {
      if (failing.metadata) {
        failing.metadata = false;
        return Promise.reject(new Error("metadata write failed"));
      }
      return fake.obr.setItemMetadata(updates);
    },
  };
  const retries: (() => void)[] = [];
  const timers: Timers = {
    setTimeout: (fn) => {
      retries.push(fn);
      return retries.length;
    },
    clearTimeout: () => {},
  };
  const heard = { errors: [] as unknown[], overrides: [] as string[] };
  const sync = createEncounterSync(
    obr,
    (e) => heard.errors.push(e),
    undefined,
    { timers, onOverride: (text) => heard.overrides.push(text) },
  );
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
    heard,
    failing,
    retryAll,
    drag: (n: number, to: Vec2) =>
      fake.scene.updateItems([tokenOf(fake.scene, n).id], { position: to }),
  };
}

describe("createEncounterSync token move retries", () => {
  it("a move over a token the GM moved is reported once when a later write of the reconcile fails", async () => {
    const s = setup();
    await s.sync.handleMessage(s.feed.snapshot([inst(1)]));
    await settle();
    s.drag(1, dragged);
    await settle();

    s.failing.metadata = true;
    await s.sync.handleMessage(positionChanged(s.feed, 1, target));
    await settle();
    expect(s.heard.errors).toHaveLength(1);

    await s.retryAll();
    expect(tokenOf(s.scene, 1).position).toEqual(target);
    expect(s.heard.overrides).toEqual([movedNote]);
  });

  it("a failed move of a token the GM dragged off its new spawn position is retried", async () => {
    const s = setup();
    await s.sync.handleMessage(s.feed.snapshot([inst(1)]));
    await settle();
    await s.sync.handleMessage(positionChanged(s.feed, 1, target));
    await settle();
    expect(tokenOf(s.scene, 1).position).toEqual(target);

    s.drag(1, dragged);
    await settle();
    s.failing.move = true;
    await s.sync.handleMessage(positionChanged(s.feed, 1, target));
    await settle();
    expect(s.heard.errors).toHaveLength(1);
    expect(tokenOf(s.scene, 1).position).toEqual(dragged);

    await s.retryAll();
    expect(tokenOf(s.scene, 1).position).toEqual(target);
  });
});
