import { describe, expect, it } from "vitest";
import type {
  ChangeOrigin,
  PublishedTokenArt,
  TokenArt,
} from "@ttrpg-agents/engine";
import { makeTestInstance } from "@ttrpg-agents/engine/testing";
import type { BridgeMessage } from "@ttrpg-agents/protocol";
import { createEncounterSync } from "./encounter-sync.js";
import { createFakeObr, type FakePick } from "./fake-adapter.js";
import type { ObrAdapter } from "./obr-adapter.js";
import type { Timers } from "./reconnecting-socket.js";
import type { SceneItem, Vec2 } from "./scene-model.js";
import { STAT_BUBBLES_METADATA_KEY } from "./stat-bubbles.js";
import {
  REPLACED_BY_KEY,
  SYNCED_METADATA_KEY,
  instanceIdOf,
  type EncounterInstance,
} from "./sync-plan.js";
import { createMessageFeed } from "./testing/messages.js";

const mcp: ChangeOrigin = { source: "mcp", commandId: "change" };

const artFor = (
  name: string,
  width: number,
  height: number,
): PublishedTokenArt => ({
  url: `https://cdn.owlbear.rodeo/assets/${name}.png`,
  mime: "image/png",
  width,
  height,
});
const wolfArt = artFor("wolf", 300, 300);
const direWolfArt = artFor("dire-wolf", 400, 200);
/** Dire wolf art spanning 2 cells: the longer side over 2, centred. */
const direWolfGrid = { dpi: 200, offset: { x: 200, y: 100 } };
/** A 2-cell circle. */
const bigCircle = { shapeType: "CIRCLE", width: 300, height: 300 };

const spawn: Vec2 = { x: 450, y: 300 };

/** The id the sync gives instance 1's first token. */
const FIRST_ID = "ttrpg-instance-i1";
/** The id of its replacement. */
const REPLACEMENT_ID = "ttrpg-instance-i1-r2";

const wolf: EncounterInstance = makeTestInstance({
  id: "i1",
  monsterKey: "wolf",
  displayName: "Wolf 1",
  maxHp: 11,
  currentHp: 5,
  armorClass: 13,
  initiative: 15,
  footprint: 1,
  spawnPosition: spawn,
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

const hpChanged = {
  type: "hp-changed",
  id: "i1",
  currentHp: 20,
  maxHp: 37,
  origin: mcp,
} as const;

const replacedNote =
  "Dire Wolf 1's token was replaced with a new one for its new monster type at the agent's request; any attachments on the old token were deleted with it.";

const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

/**
 * A sync over a fake scene that logs each item write (and each override note)
 * in order and can fail the next marker write, item add or item delete; retry
 * timers are collected and fired by hand, and sent commands are kept.
 */
function setup(
  options: {
    pickImage?: FakePick;
    imageAlive?: boolean;
    loadImage?: (
      sha256: string,
    ) => Promise<{ bytes: Uint8Array; mime: string }>;
  } = {},
) {
  const fake = createFakeObr(undefined, undefined, {
    pickImage: options.pickImage,
    imageAlive: options.imageAlive,
  });
  const log: string[] = [];
  const failing = { marker: false, add: false, delete: false };
  const isMarker = (u: { key: string; value: unknown }): boolean =>
    u.key === SYNCED_METADATA_KEY &&
    typeof u.value === "object" &&
    u.value !== null &&
    Object.hasOwn(u.value, REPLACED_BY_KEY);
  const obr: ObrAdapter = {
    ...fake.obr,
    addItems: (items) => {
      if (failing.add) {
        failing.add = false;
        return Promise.reject(new Error("add failed"));
      }
      log.push(`add ${items.map((i) => i.id).join(",")}`);
      return fake.obr.addItems(items);
    },
    deleteItems: (ids) => {
      if (failing.delete) {
        failing.delete = false;
        return Promise.reject(new Error("delete failed"));
      }
      log.push(`delete ${ids.join(",")}`);
      return fake.obr.deleteItems(ids);
    },
    updateItems: (ids, patch) => {
      log.push(`update ${ids.join(",")}`);
      return fake.obr.updateItems(ids, patch);
    },
    setItemMetadata: (updates) => {
      const marker = updates.some(isMarker);
      if (marker && failing.marker) {
        failing.marker = false;
        return Promise.reject(new Error("marker failed"));
      }
      log.push(
        `${marker ? "marker" : "metadata"} ${updates.map((u) => u.id).join(",")}`,
      );
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
    onOverride: (text) => {
      overrides.push(text);
      log.push(`note: ${text}`);
    },
    ...(options.loadImage === undefined
      ? {}
      : { loadImage: options.loadImage }),
  });
  const tokens = (): SceneItem[] =>
    fake.scene.getItems().filter((item) => instanceIdOf(item) === "i1");
  const token = (): SceneItem => {
    const [found] = tokens();
    if (!found) throw new Error("no token for i1");
    return found;
  };
  const retryAll = async () => {
    while (retries.length > 0) {
      for (const retry of retries.splice(0)) retry();
      await settle();
    }
  };
  return {
    fake,
    sync,
    feed: createMessageFeed(),
    log,
    failing,
    errors,
    overrides,
    sent,
    tokens,
    token,
    retryAll,
    deletedCommands: () => sent.filter((m) => m.type === "token-deleted"),
  };
}

/** A sync whose wolf token is a circle (wolves have no art; the picker is cancelled). */
async function circleWolf(s: ReturnType<typeof setup>) {
  await s.sync.handleMessage(
    s.feed.snapshot([wolf], { art: { "dire-wolf": direWolfArt } }),
  );
  await settle();
  expect(s.token()).toMatchObject({ id: FIRST_ID, type: "SHAPE" });
}

describe("createEncounterSync token replacement", () => {
  it("an mcp monster-changed event replaces a circle token whose new type has art with an image token at the new footprint, in place, leaving one token for the instance", async () => {
    const s = setup();
    await circleWolf(s);
    // The GM reveals the token.
    s.fake.scene.updateItems([FIRST_ID], { visible: true });
    await settle();

    await s.sync.handleMessage(s.feed.event(toDireWolf));
    await settle();

    expect(s.tokens()).toHaveLength(1);
    expect(s.fake.scene.getItems()).toHaveLength(1);
    expect(s.token()).toMatchObject({
      id: REPLACEMENT_ID,
      type: "IMAGE",
      name: "Dire Wolf 1",
      image: direWolfArt,
      grid: direWolfGrid,
      position: spawn,
      visible: true,
    });
    expect(s.token().scale ?? { x: 1, y: 1 }).toEqual({ x: 1, y: 1 });
    expect(s.token().metadata[STAT_BUBBLES_METADATA_KEY]).toMatchObject({
      health: 31,
      "max health": 37,
      "armor class": 14,
    });
    expect(s.errors).toEqual([]);
  });

  it("an mcp monster-changed event to a type with no art replaces an image token with a circle at the new footprint, in place, when the GM cancels the picker", async () => {
    const s = setup();
    await s.sync.handleMessage(
      s.feed.snapshot([wolf], { art: { wolf: wolfArt } }),
    );
    await settle();
    expect(s.token()).toMatchObject({ id: FIRST_ID, type: "IMAGE" });

    await s.sync.handleMessage(s.feed.event(toDireWolf));
    await settle();

    expect(s.fake.pickImageCalls()).toBe(1);
    expect(s.tokens()).toHaveLength(1);
    expect(s.token()).toMatchObject({
      id: REPLACEMENT_ID,
      type: "SHAPE",
      name: "Dire Wolf 1",
      shape: bigCircle,
      position: spawn,
    });
    expect(s.token().image).toBeUndefined();
    expect(s.errors).toEqual([]);
  });

  it("a circle token changed to a type with no art opens the picker once; a pick replaces it with an image token in place, and a cancel leaves it a circle at the new footprint", async () => {
    // The wolf's picker is cancelled; the dire wolf's is picked.
    let calls = 0;
    const picks = setup({
      pickImage: () => (calls++ === 0 ? undefined : direWolfArt),
    });
    await picks.sync.handleMessage(picks.feed.snapshot([wolf]));
    await settle();
    expect(picks.token()).toMatchObject({ id: FIRST_ID, type: "SHAPE" });
    const before = picks.fake.pickImageCalls();

    await picks.sync.handleMessage(picks.feed.event(toDireWolf));
    await settle();
    await picks.sync.handleMessage(picks.feed.event(hpChanged));
    await settle();

    expect(picks.fake.pickImageCalls()).toBe(before + 1);
    expect(picks.tokens()).toHaveLength(1);
    expect(picks.token()).toMatchObject({
      id: REPLACEMENT_ID,
      type: "IMAGE",
      image: direWolfArt,
      grid: direWolfGrid,
      position: spawn,
    });
    expect(picks.errors).toEqual([]);

    const cancels = setup();
    await cancels.sync.handleMessage(cancels.feed.snapshot([wolf]));
    await settle();
    const cancelledBefore = cancels.fake.pickImageCalls();

    await cancels.sync.handleMessage(cancels.feed.event(toDireWolf));
    await settle();
    await cancels.sync.handleMessage(cancels.feed.event(hpChanged));
    await settle();

    expect(cancels.fake.pickImageCalls()).toBe(cancelledBefore + 1);
    expect(cancels.tokens()).toHaveLength(1);
    expect(cancels.token()).toMatchObject({
      id: FIRST_ID,
      type: "SHAPE",
      shape: bigCircle,
      position: spawn,
    });
    expect(cancels.errors).toEqual([]);
  });

  it("a replacement writes the marker, then adds the new token, then deletes the old one", async () => {
    const s = setup();
    await circleWolf(s);
    s.log.length = 0;

    await s.sync.handleMessage(s.feed.event(toDireWolf));
    await settle();

    const writes = s.log.filter((entry) => !entry.startsWith("note: "));
    expect(writes.slice(0, 3)).toEqual([
      `marker ${FIRST_ID}`,
      `add ${REPLACEMENT_ID}`,
      `delete ${FIRST_ID}`,
    ]);
    // Nothing else is written on the old token.
    expect(
      writes
        .slice(3)
        .filter((entry) => entry.split(" ")[1]?.split(",").includes(FIRST_ID)),
    ).toEqual([]);
    expect(s.tokens()).toHaveLength(1);
    expect(s.token().id).toBe(REPLACEMENT_ID);
    expect(s.errors).toEqual([]);
  });

  it("a reconcile that fails between the add and the delete ends, on retry, with exactly one token for the instance and no token-deleted command", async () => {
    const s = setup();
    await circleWolf(s);

    s.failing.delete = true;
    await s.sync.handleMessage(s.feed.event(toDireWolf));
    await settle();
    expect(s.errors).toHaveLength(1);
    // Both tokens are on the scene until the retry.
    expect(s.tokens()).toHaveLength(2);

    await s.retryAll();

    expect(s.tokens()).toHaveLength(1);
    expect(s.token()).toMatchObject({
      id: REPLACEMENT_ID,
      type: "IMAGE",
      image: direWolfArt,
      grid: direWolfGrid,
      position: spawn,
    });
    expect(s.deletedCommands()).toEqual([]);
    // A later change leaves it so.
    await s.sync.handleMessage(s.feed.event(hpChanged));
    await settle();
    expect(s.tokens()).toHaveLength(1);
    expect(s.deletedCommands()).toEqual([]);
  });

  it("a reconcile that fails at the add ends, on retry, with exactly one token for the instance and no token-deleted command", async () => {
    const s = setup();
    await circleWolf(s);

    s.failing.add = true;
    await s.sync.handleMessage(s.feed.event(toDireWolf));
    await settle();
    expect(s.errors).toHaveLength(1);
    // The old token is still there, marked.
    expect(s.tokens()).toHaveLength(1);
    expect(s.token().id).toBe(FIRST_ID);

    await s.retryAll();

    expect(s.tokens()).toHaveLength(1);
    expect(s.token()).toMatchObject({
      type: "IMAGE",
      image: direWolfArt,
      grid: direWolfGrid,
      position: spawn,
    });
    expect(s.token().id).not.toBe(FIRST_ID);
    expect(s.deletedCommands()).toEqual([]);
    await s.sync.handleMessage(s.feed.event(hpChanged));
    await settle();
    expect(s.tokens()).toHaveLength(1);
    expect(s.deletedCommands()).toEqual([]);
  });

  it("a replacement's override note is reported once, after the old token is deleted, also when the delete succeeds only on the retry", async () => {
    const s = setup();
    await circleWolf(s);
    s.log.length = 0;

    await s.sync.handleMessage(s.feed.event(toDireWolf));
    await settle();
    await s.sync.handleMessage(s.feed.event(hpChanged));
    await settle();

    expect(s.overrides).toEqual([replacedNote]);
    const deleted = s.log.indexOf(`delete ${FIRST_ID}`);
    expect(deleted).toBeGreaterThanOrEqual(0);
    expect(s.log.indexOf(`note: ${replacedNote}`)).toBe(deleted + 1);

    const late = setup();
    await circleWolf(late);
    late.log.length = 0;

    late.failing.delete = true;
    await late.sync.handleMessage(late.feed.event(toDireWolf));
    await settle();
    expect(late.errors).toHaveLength(1);
    expect(late.overrides).toEqual([]);

    await late.retryAll();
    await late.sync.handleMessage(late.feed.event(hpChanged));
    await settle();

    expect(late.overrides).toEqual([replacedNote]);
    const lateDeleted = late.log.indexOf(`delete ${FIRST_ID}`);
    expect(lateDeleted).toBeGreaterThanOrEqual(0);
    expect(late.log.indexOf(`note: ${replacedNote}`)).toBe(lateDeleted + 1);
  });

  it("a circle token changed to a type whose stored art's url is gone has the art republished before it is replaced with an image", async () => {
    const ORC_SHA = "d4".repeat(32);
    /** What the GM picks after the stored orc image is uploaded again. */
    const picked: PublishedTokenArt = {
      url: "https://cdn.owlbear.rodeo/assets/ttrpg-art-d4d4d4d4d4d4d4d4.png",
      mime: "image/png",
      width: 400,
      height: 200,
    };
    const deadOrcArt: TokenArt = {
      url: "https://cdn.owlbear.rodeo/assets/orc-gone.png",
      mime: "image/png",
      width: 300,
      height: 300,
      sha256: ORC_SHA,
    };
    const loads: string[] = [];
    let pickCalls = 0;
    const s = setup({
      imageAlive: false,
      // The wolf's picker is cancelled; the republished orc is picked.
      pickImage: () => (pickCalls++ === 0 ? undefined : picked),
      loadImage: (sha256) => {
        loads.push(sha256);
        return Promise.resolve({
          bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2]),
          mime: "image/png",
        });
      },
    });
    await s.sync.handleMessage(
      s.feed.snapshot([wolf], { art: { orc: deadOrcArt } }),
    );
    await settle();
    expect(s.token()).toMatchObject({ id: FIRST_ID, type: "SHAPE" });

    await s.sync.handleMessage(
      s.feed.event({
        type: "monster-changed",
        id: "i1",
        monsterKey: "orc",
        displayName: "Orc 1",
        maxHp: 15,
        currentHp: 15,
        armorClass: 13,
        initiative: null,
        footprint: 2,
        origin: mcp,
      }),
    );
    await settle();

    expect(loads).toEqual([ORC_SHA]);
    expect(s.fake.uploads()).toHaveLength(1);
    expect(s.tokens()).toHaveLength(1);
    expect(s.token()).toMatchObject({
      id: REPLACEMENT_ID,
      type: "IMAGE",
      name: "Orc 1",
      image: picked,
      grid: { dpi: 200, offset: { x: 200, y: 100 } },
      position: spawn,
    });
    expect(s.errors).toEqual([]);
  });
});
