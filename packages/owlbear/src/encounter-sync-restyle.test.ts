import { describe, expect, it } from "vitest";
import type { ChangeOrigin, PublishedTokenArt } from "@ttrpg-agents/engine";
import { makeTestInstance } from "@ttrpg-agents/engine/testing";
import { createEncounterSync } from "./encounter-sync.js";
import { createFakeObr, type FakePick } from "./fake-adapter.js";
import { INITIATIVE_METADATA_KEY } from "./initiative.js";
import type { ObrAdapter } from "./obr-adapter.js";
import type { Timers } from "./reconnecting-socket.js";
import type { ItemPatch, SceneItem, Vec2 } from "./scene-model.js";
import { STAT_BUBBLES_METADATA_KEY } from "./stat-bubbles.js";
import {
  LOOK_BASELINE_KEY,
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

const spawn: Vec2 = { x: 450, y: 300 };

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

const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

const isRestyle = (patch: ItemPatch): boolean =>
  patch.image !== undefined ||
  patch.grid !== undefined ||
  patch.shape !== undefined ||
  patch.scale !== undefined;

/**
 * A sync over a fake scene that logs each redraw write and metadata write
 * (and each override note) in order and can fail the next redraw or metadata
 * write; retry timers are collected and fired by hand.
 */
function setup(pickImage?: FakePick) {
  const fake = createFakeObr(undefined, undefined, { pickImage });
  const log: string[] = [];
  const restyles: { ids: string[]; patch: ItemPatch }[] = [];
  let failRestyle = false;
  let failMetadata = false;
  const obr: ObrAdapter = {
    ...fake.obr,
    updateItems: (ids, patch) => {
      if (isRestyle(patch)) {
        if (failRestyle) {
          failRestyle = false;
          return Promise.reject(new Error("redraw failed"));
        }
        restyles.push({ ids: [...ids], patch: structuredClone(patch) });
        log.push("redraw");
      }
      return fake.obr.updateItems(ids, patch);
    },
    setItemMetadata: (updates) => {
      if (failMetadata) {
        failMetadata = false;
        return Promise.reject(new Error("metadata failed"));
      }
      log.push("metadata");
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
  const sync = createEncounterSync(obr, (e) => errors.push(e), undefined, {
    timers,
    onOverride: (text) => {
      overrides.push(text);
      log.push(`note: ${text}`);
    },
  });
  const token = (): SceneItem => {
    const found = fake.scene
      .getItems()
      .find((item) => instanceIdOf(item) === "i1");
    if (!found) throw new Error("no token for i1");
    return found;
  };
  return {
    fake,
    sync,
    feed: createMessageFeed(),
    log,
    restyles,
    errors,
    overrides,
    retries,
    token,
    failNextRestyle: () => {
      failRestyle = true;
    },
    failNextMetadata: () => {
      failMetadata = true;
    },
  };
}

describe("createEncounterSync token redraw", () => {
  it("an mcp monster-changed event renames the token and redraws its art and size once, keeping its position and visibility, and pushes the new HP, AC and initiative", async () => {
    const s = setup();
    await s.sync.handleMessage(
      s.feed.snapshot([wolf], {
        art: { wolf: wolfArt, "dire-wolf": direWolfArt },
      }),
    );
    await settle();
    expect(s.token()).toMatchObject({ type: "IMAGE", image: wolfArt });
    // The GM reveals the token.
    s.fake.scene.updateItems([s.token().id], { visible: true });
    await settle();

    await s.sync.handleMessage(s.feed.event(toDireWolf));
    await settle();

    expect(s.token()).toMatchObject({
      type: "IMAGE",
      name: "Dire Wolf 1",
      image: direWolfArt,
      grid: direWolfGrid,
      scale: { x: 1, y: 1 },
      position: spawn,
      visible: true,
    });
    expect(s.token().metadata[STAT_BUBBLES_METADATA_KEY]).toMatchObject({
      health: 31,
      "max health": 37,
      "armor class": 14,
    });
    expect(s.token().metadata[INITIATIVE_METADATA_KEY]).toMatchObject({
      count: "14",
    });

    // A later change reconciles again without redrawing a second time.
    await s.sync.handleMessage(
      s.feed.event({
        type: "hp-changed",
        id: "i1",
        currentHp: 20,
        maxHp: 37,
        origin: mcp,
      }),
    );
    await settle();
    expect(s.restyles).toHaveLength(1);
    expect(s.errors).toEqual([]);
  });

  it("a monster-changed event to a type with no art opens the picker once and draws the token with the pick", async () => {
    const s = setup(direWolfArt);
    await s.sync.handleMessage(
      s.feed.snapshot([wolf], { art: { wolf: wolfArt } }),
    );
    await settle();
    expect(s.fake.pickImageCalls()).toBe(0);

    await s.sync.handleMessage(s.feed.event(toDireWolf));
    await settle();

    expect(s.fake.pickImageCalls()).toBe(1);
    expect(s.token()).toMatchObject({
      type: "IMAGE",
      image: direWolfArt,
      grid: direWolfGrid,
      position: spawn,
    });

    await s.sync.handleMessage(
      s.feed.event({
        type: "hp-changed",
        id: "i1",
        currentHp: 20,
        maxHp: 37,
        origin: mcp,
      }),
    );
    await settle();
    expect(s.fake.pickImageCalls()).toBe(1);
    expect(s.errors).toEqual([]);
  });

  it("a reconcile that fails after a monster-changed event redraws the token on the retry", async () => {
    const s = setup();
    await s.sync.handleMessage(
      s.feed.snapshot([wolf], {
        art: { wolf: wolfArt, "dire-wolf": direWolfArt },
      }),
    );
    await settle();
    // A token drawn before looks were recorded: only the event says to redraw it.
    const synced = {
      ...(s.token().metadata[SYNCED_METADATA_KEY] as Record<string, unknown>),
    };
    delete synced[LOOK_BASELINE_KEY];
    s.fake.scene.setItemMetadata([
      { id: s.token().id, key: SYNCED_METADATA_KEY, value: synced },
    ]);
    await settle();

    s.failNextRestyle();
    await s.sync.handleMessage(s.feed.event(toDireWolf));
    await settle();
    expect(s.errors).toHaveLength(1);
    expect(s.token()).toMatchObject({ image: wolfArt });

    for (const retry of s.retries.splice(0)) retry();
    await settle();
    expect(s.token()).toMatchObject({
      image: direWolfArt,
      grid: direWolfGrid,
      position: spawn,
    });
  });

  it("a redraw's override note is reported once, right after its write", async () => {
    const s = setup();
    await s.sync.handleMessage(
      s.feed.snapshot([wolf], {
        art: { wolf: wolfArt, "dire-wolf": direWolfArt },
      }),
    );
    await settle();
    // The GM enlarged the token.
    s.fake.scene.updateItems([s.token().id], { scale: { x: 2, y: 2 } });
    await settle();
    s.log.length = 0;

    // The metadata write after the redraw fails: the retry finds the token
    // already redrawn.
    s.failNextMetadata();
    await s.sync.handleMessage(s.feed.event(toDireWolf));
    await settle();
    expect(s.errors).toHaveLength(1);
    for (const retry of s.retries.splice(0)) retry();
    await settle();

    const note =
      "Dire Wolf 1's token was redrawn for its new monster type at the agent's request; its art or size had been changed on the table, and was overwritten.";
    expect(s.overrides).toEqual([note]);
    expect(s.log.slice(0, 2)).toEqual(["redraw", `note: ${note}`]);
    expect(s.token()).toMatchObject({
      image: direWolfArt,
      scale: { x: 1, y: 1 },
    });
  });
});
