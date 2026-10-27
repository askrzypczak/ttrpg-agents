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

/** Where the extension first placed the tokens. */
const placedAt = (n: number): Vec2 => ({ x: 150 * n, y: 150 });
/** The new spawn position the move tool set for instance 1. */
const target: Vec2 = { x: 650, y: 550 };
/** Where the GM dragged token 1. */
const dragged: Vec2 = { x: 900, y: 900 };

const inst = (n: number): EncounterInstance =>
  makeTestInstance({
    id: `i${n}`,
    displayName: `Shadow ${n}`,
    createdAt: n,
    spawnPosition: placedAt(n),
  });

const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

const positionChanged = (feed: MessageFeed, n: number, at: Vec2) =>
  feed.event({
    type: "position-changed",
    id: `i${n}`,
    spawnPosition: at,
    origin: mcp,
  });

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

const movedNote =
  "Shadow 1 was moved at the agent's request; its token had been moved on the table, and that position was overwritten.";

/**
 * A sync over a fake scene that records each position write and can fail the
 * next one; retry timers are collected and fired by hand.
 */
function setup(scene: SceneModel = new SceneModel()) {
  const fake = createFakeObr(scene);
  const positionWrites: { ids: string[]; position: Vec2 }[] = [];
  let failMove = false;
  const obr: ObrAdapter = {
    ...fake.obr,
    updateItems: (ids, patch) => {
      if (patch.position !== undefined) {
        if (failMove) {
          failMove = false;
          return Promise.reject(new Error("move failed"));
        }
        positionWrites.push({ ids: [...ids], position: { ...patch.position } });
      }
      return fake.obr.updateItems(ids, patch);
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
    {
      timers,
      onOverride: (text) => heard.overrides.push(text),
    },
  );
  return {
    sync,
    scene: fake.scene,
    feed: createMessageFeed(),
    heard,
    positionWrites,
    retries,
    failNextMove: () => {
      failMove = true;
    },
    /** Drags token `n` on the table, as the GM does. */
    drag: (n: number, to: Vec2) =>
      fake.scene.updateItems([tokenOf(fake.scene, n).id], { position: to }),
  };
}

describe("createEncounterSync token move", () => {
  it("an mcp position-changed event moves the instance's token once", async () => {
    const s = setup();
    await s.sync.handleMessage(s.feed.snapshot([inst(1), inst(2)]));
    await settle();
    s.positionWrites.length = 0;

    await s.sync.handleMessage(positionChanged(s.feed, 1, target));
    await settle();
    expect(tokenOf(s.scene, 1).position).toEqual(target);
    expect(tokenOf(s.scene, 2).position).toEqual(placedAt(2));

    // A later change reconciles again without moving the token a second time.
    await s.sync.handleMessage(
      s.feed.event({ type: "hp-changed", id: "i1", currentHp: 3, maxHp: 16 }),
    );
    await settle();
    expect(s.positionWrites).toEqual([
      { ids: [tokenOf(s.scene, 1).id], position: target },
    ]);
    expect(s.heard.errors).toEqual([]);
  });

  it("a position-changed event for an instance without a token yet creates the token at the new position", async () => {
    // The scene is not ready: both messages wait, and the token is created
    // once it is.
    const s = setup(new SceneModel("gm", false));
    await s.sync.handleMessage(s.feed.snapshot([inst(1)]));
    await s.sync.handleMessage(positionChanged(s.feed, 1, target));
    s.scene.setReady(true);
    await settle();

    expect(tokenOf(s.scene, 1).position).toEqual(target);
    expect(s.positionWrites).toEqual([]);
  });

  it("the same spawn position set again by an mcp change moves a token the GM moved", async () => {
    const s = setup();
    await s.sync.handleMessage(s.feed.snapshot([inst(1)]));
    await settle();
    await s.sync.handleMessage(positionChanged(s.feed, 1, target));
    await settle();
    expect(tokenOf(s.scene, 1).position).toEqual(target);

    s.drag(1, dragged);
    await settle();
    expect(tokenOf(s.scene, 1).position).toEqual(dragged);

    await s.sync.handleMessage(positionChanged(s.feed, 1, target));
    await settle();
    expect(tokenOf(s.scene, 1).position).toEqual(target);
  });

  it("a move that fails is retried on the next reconcile", async () => {
    const s = setup();
    await s.sync.handleMessage(s.feed.snapshot([inst(1)]));
    await settle();

    s.failNextMove();
    await s.sync.handleMessage(positionChanged(s.feed, 1, target));
    await settle();
    expect(s.heard.errors).toHaveLength(1);
    expect(tokenOf(s.scene, 1).position).toEqual(placedAt(1));

    for (const retry of s.retries.splice(0)) retry();
    await settle();
    expect(tokenOf(s.scene, 1).position).toEqual(target);
  });

  it("the sync reports a move over a token the GM moved through onOverride", async () => {
    const s = setup();
    await s.sync.handleMessage(s.feed.snapshot([inst(1)]));
    await settle();
    s.drag(1, dragged);
    await settle();
    expect(s.heard.overrides).toEqual([]);

    await s.sync.handleMessage(positionChanged(s.feed, 1, target));
    await settle();
    expect(tokenOf(s.scene, 1).position).toEqual(target);
    expect(s.heard.overrides).toEqual([movedNote]);
  });

  it("an mcp position-changed event with a null spawn position moves the token back to where it stood before its move", async () => {
    const s = setup();
    await s.sync.handleMessage(s.feed.snapshot([inRow(1), inRow(2)]));
    await settle();
    const before = { ...tokenOf(s.scene, 1).position };
    await s.sync.handleMessage(positionChanged(s.feed, 1, target));
    await settle();
    expect(tokenOf(s.scene, 1).position).toEqual(target);

    await s.sync.handleMessage(positionCleared(s.feed, 1));
    await settle();

    expect(tokenOf(s.scene, 1).position).toEqual(before);
    expect(s.heard.errors).toEqual([]);
    expect(s.heard.overrides).toEqual([]);
  });

  it("the sync reports a move back over a token the GM dragged since through onOverride", async () => {
    const s = setup();
    await s.sync.handleMessage(s.feed.snapshot([inRow(1)]));
    await settle();
    const before = { ...tokenOf(s.scene, 1).position };
    await s.sync.handleMessage(positionChanged(s.feed, 1, target));
    await settle();
    s.drag(1, dragged);
    await settle();
    expect(s.heard.overrides).toEqual([]);

    await s.sync.handleMessage(positionCleared(s.feed, 1));
    await settle();

    expect(tokenOf(s.scene, 1).position).toEqual(before);
    expect(s.heard.overrides).toEqual([movedNote]);
  });
});

/** Instance `n` with no spawn position: its token goes in the default row. */
function inRow(n: number): EncounterInstance {
  return makeTestInstance({
    id: `i${n}`,
    displayName: `Shadow ${n}`,
    createdAt: n,
  });
}

/** An mcp change that cleared instance `n`'s spawn position. */
function positionCleared(feed: MessageFeed, n: number) {
  return feed.event({
    type: "position-changed",
    id: `i${n}`,
    spawnPosition: null,
    origin: mcp,
  });
}
