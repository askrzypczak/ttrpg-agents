import { describe, expect, it } from "vitest";
import type { ChangeOrigin, PublishedTokenArt } from "@ttrpg-agents/engine";
import { makeTestInstance } from "@ttrpg-agents/engine/testing";
import type { BridgeMessage } from "@ttrpg-agents/protocol";
import { createEncounterSync } from "./encounter-sync.js";
import { createFakeObr } from "./fake-adapter.js";
import type { ObrAdapter } from "./obr-adapter.js";
import type { Timers } from "./reconnecting-socket.js";
import type { SceneItem, Vec2 } from "./scene-model.js";
import {
  REPLACED_BY_KEY,
  SYNCED_METADATA_KEY,
  instanceIdOf,
  type EncounterInstance,
} from "./sync-plan.js";
import { createMessageFeed } from "./testing/messages.js";

const mcp: ChangeOrigin = { source: "mcp", commandId: "change" };

const direWolfArt: PublishedTokenArt = {
  url: "https://cdn.owlbear.rodeo/assets/dire-wolf.png",
  mime: "image/png",
  width: 400,
  height: 200,
};

const spawn: Vec2 = { x: 450, y: 300 };

/** The id the sync gives instance 1's first token. */
const FIRST_ID = "ttrpg-instance-i1";
/** The id of its replacement. */
const REPLACEMENT_ID = "ttrpg-instance-i1-r2";

const wolf = (n: number): EncounterInstance =>
  makeTestInstance({
    id: `i${n}`,
    monsterKey: "wolf",
    displayName: `Wolf ${n}`,
    maxHp: 11,
    currentHp: 5,
    armorClass: 13,
    initiative: 15,
    footprint: 1,
    spawnPosition: { x: spawn.x + 300 * (n - 1), y: spawn.y },
  });

/** The store's change of instance 1 to a Dire Wolf. */
const toDireWolf = {
  type: "monster-changed",
  id: "i1",
  monsterKey: "dire-wolf",
  displayName: "Dire Wolf 1",
  maxHp: 37,
  currentHp: 31,
  armorClass: 14,
  initiative: 14,
  footprint: 2,
  origin: mcp,
} as const;

/** The store's change of instance 1 back to a Wolf. */
const backToWolf = {
  type: "monster-changed",
  id: "i1",
  monsterKey: "wolf",
  displayName: "Wolf 1",
  maxHp: 11,
  currentHp: 5,
  armorClass: 13,
  initiative: 15,
  footprint: 1,
  origin: mcp,
} as const;

const replacedNote = (name: string) =>
  `${name}'s token was replaced with a new one for its new monster type at the agent's request; any attachments on the old token were deleted with it.`;

const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

/**
 * A sync over a fake scene that can fail the next item delete, or the next
 * metadata write that is not a replacement marker; retry timers are
 * collected and fired by hand, and sent commands and override notes are kept.
 */
function setup() {
  const fake = createFakeObr();
  const failing = { delete: false, metadata: false };
  const isMarker = (u: { key: string; value: unknown }): boolean =>
    u.key === SYNCED_METADATA_KEY &&
    typeof u.value === "object" &&
    u.value !== null &&
    Object.hasOwn(u.value, REPLACED_BY_KEY);
  const obr: ObrAdapter = {
    ...fake.obr,
    deleteItems: (ids) => {
      if (failing.delete) {
        failing.delete = false;
        return Promise.reject(new Error("delete failed"));
      }
      return fake.obr.deleteItems(ids);
    },
    setItemMetadata: (updates) => {
      if (failing.metadata && !updates.some(isMarker)) {
        failing.metadata = false;
        return Promise.reject(new Error("metadata failed"));
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
  const errors: unknown[] = [];
  const overrides: string[] = [];
  const sent: BridgeMessage[] = [];
  const sync = createEncounterSync(obr, (e) => errors.push(e), undefined, {
    timers,
    send: (message) => {
      sent.push(message);
      return true;
    },
    onOverride: (text) => overrides.push(text),
  });
  const tokens = (instanceId: string): SceneItem[] =>
    fake.scene.getItems().filter((item) => instanceIdOf(item) === instanceId);
  const retryAll = async () => {
    while (retries.length > 0) {
      for (const retry of retries.splice(0)) retry();
      await settle();
    }
  };
  return {
    sync,
    feed: createMessageFeed(),
    failing,
    errors,
    overrides,
    tokens,
    retryAll,
    deletedCommands: () => sent.filter((m) => m.type === "token-deleted"),
  };
}

describe("createEncounterSync replacement notes", () => {
  it("a replacement's note is reported even when a later write of the reconcile fails, and not again on the retry", async () => {
    const s = setup();
    // Wolves have no art and the picker is cancelled: both tokens are circles.
    await s.sync.handleMessage(
      s.feed.snapshot([wolf(1), wolf(2)], {
        art: { "dire-wolf": direWolfArt },
      }),
    );
    await settle();
    expect(s.tokens("i1")).toMatchObject([{ id: FIRST_ID, type: "SHAPE" }]);

    // Both events are folded before their reconcile runs: it replaces i1's
    // token, then writes i2's metadata, which fails once.
    s.failing.metadata = true;
    void s.sync.handleMessage(s.feed.event(toDireWolf));
    void s.sync.handleMessage(
      s.feed.event({
        type: "hp-changed",
        id: "i2",
        currentHp: 2,
        maxHp: 11,
        origin: mcp,
      }),
    );
    await settle();
    expect(s.errors).toHaveLength(1);

    await s.retryAll();

    expect(s.overrides).toEqual([replacedNote("Dire Wolf 1")]);
    expect(s.tokens("i1")).toMatchObject([
      { id: REPLACEMENT_ID, type: "IMAGE" },
    ]);
    expect(s.deletedCommands()).toEqual([]);
  });

  it("a half-done replacement finished in the same reconcile as a new replacement of the same token reports one note and leaves one token", async () => {
    const s = setup();
    // The wolf's picker is cancelled: wolves are circles for the session.
    await s.sync.handleMessage(
      s.feed.snapshot([wolf(1)], { art: { "dire-wolf": direWolfArt } }),
    );
    await settle();
    expect(s.tokens("i1")).toMatchObject([{ id: FIRST_ID, type: "SHAPE" }]);

    s.failing.delete = true;
    await s.sync.handleMessage(s.feed.event(toDireWolf));
    await settle();
    expect(s.errors).toHaveLength(1);
    expect(s.tokens("i1")).toHaveLength(2);

    // Back to a wolf: the image replacement must become a circle again.
    await s.sync.handleMessage(s.feed.event(backToWolf));
    await settle();
    await s.retryAll();

    expect(s.tokens("i1")).toMatchObject([
      { id: "ttrpg-instance-i1-r3", type: "SHAPE" },
    ]);
    expect(s.overrides).toEqual([replacedNote("Wolf 1")]);
    expect(s.deletedCommands()).toEqual([]);
  });
});
