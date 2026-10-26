import { describe, expect, it } from "vitest";
import type {
  ChangeOrigin,
  PublishedTokenArt,
  TokenArt,
} from "@ttrpg-agents/engine";
import { makeTestInstance } from "@ttrpg-agents/engine/testing";
import { createEncounterSync } from "./encounter-sync.js";
import { createFakeObr } from "./fake-adapter.js";
import type { Timers } from "./reconnecting-socket.js";
import { instanceIdOf, type EncounterInstance } from "./sync-plan.js";
import { createMessageFeed } from "./testing/messages.js";

const mcp: ChangeOrigin = { source: "mcp", commandId: "change" };

const wolfArt: PublishedTokenArt = {
  url: "https://cdn.owlbear.rodeo/assets/wolf.png",
  mime: "image/png",
  width: 300,
  height: 300,
};

const ORC_SHA = "d4".repeat(32);

/** What the GM picks after the stored orc image is uploaded again. */
const picked: PublishedTokenArt = {
  url: "https://cdn.owlbear.rodeo/assets/ttrpg-art-d4d4d4d4d4d4d4d4.png",
  mime: "image/png",
  width: 400,
  height: 200,
};

const STORED_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2]);

const wolf: EncounterInstance = makeTestInstance({
  id: "i1",
  monsterKey: "wolf",
  displayName: "Wolf 1",
  footprint: 1,
  spawnPosition: { x: 450, y: 300 },
});

/** The store's change of instance 1 to an orc of the given footprint. */
const toOrc = (footprint: number) =>
  ({
    type: "monster-changed",
    id: "i1",
    monsterKey: "orc",
    displayName: "Orc 1",
    maxHp: 15,
    currentHp: 15,
    armorClass: 13,
    initiative: null,
    footprint,
    origin: mcp,
  }) as const;

/** Timers that never fire: no retry runs behind the test's back. */
const idleTimers: Timers = {
  setTimeout: () => 1,
  clearTimeout: () => {},
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

function setup() {
  const loads: string[] = [];
  const fake = createFakeObr(undefined, undefined, {
    imageAlive: false,
    pickImage: picked,
  });
  const errors: unknown[] = [];
  const sync = createEncounterSync(fake.obr, (e) => errors.push(e), undefined, {
    timers: idleTimers,
    loadImage: (sha256) => {
      loads.push(sha256);
      return Promise.resolve({
        bytes: STORED_BYTES.slice(),
        mime: "image/png",
      });
    },
  });
  const token = () =>
    fake.scene.getItems().find((item) => instanceIdOf(item) === "i1");
  return { fake, sync, loads, errors, token, feed: createMessageFeed() };
}

describe("createEncounterSync token redraw with stored art", () => {
  it("a monster change to a type whose stored art has no url publishes it and draws the token with the pick, even when the token's own picture already spans the footprint", async () => {
    const s = setup();
    await s.sync.handleMessage(
      s.feed.snapshot([wolf], {
        art: { wolf: wolfArt, orc: { sha256: ORC_SHA } as TokenArt },
      }),
    );
    await settle();
    expect(s.token()).toMatchObject({ type: "IMAGE", image: wolfArt });

    await s.sync.handleMessage(s.feed.event(toOrc(1)));
    await settle();

    expect(s.loads).toEqual([ORC_SHA]);
    expect(s.fake.uploads()).toHaveLength(1);
    expect(s.token()?.image?.url).toBe(picked.url);
    expect(s.token()).toMatchObject({
      type: "IMAGE",
      name: "Orc 1",
      grid: { dpi: 400, offset: { x: 200, y: 100 } },
      position: { x: 450, y: 300 },
    });
    expect(s.errors).toEqual([]);
  });

  it("a monster change to a type whose stored art's url is gone republishes it and draws the token with the pick at the new footprint", async () => {
    const s = setup();
    const deadOrcArt: TokenArt = {
      url: "https://cdn.owlbear.rodeo/assets/orc-gone.png",
      mime: "image/png",
      width: 300,
      height: 300,
      sha256: ORC_SHA,
    };
    await s.sync.handleMessage(
      s.feed.snapshot([wolf], { art: { wolf: wolfArt, orc: deadOrcArt } }),
    );
    await settle();

    await s.sync.handleMessage(s.feed.event(toOrc(2)));
    await settle();

    expect(s.loads).toEqual([ORC_SHA]);
    expect(s.fake.uploads()).toHaveLength(1);
    expect(s.token()).toMatchObject({
      type: "IMAGE",
      image: picked,
      grid: { dpi: 200, offset: { x: 200, y: 100 } },
      scale: { x: 1, y: 1 },
      position: { x: 450, y: 300 },
    });
    expect(s.errors).toEqual([]);
  });
});
