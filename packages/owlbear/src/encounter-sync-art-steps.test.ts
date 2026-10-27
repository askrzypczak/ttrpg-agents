import { describe, expect, it } from "vitest";
import type { PublishedTokenArt, TableArtWait } from "@ttrpg-agents/engine";
import { makeTestInstance } from "@ttrpg-agents/engine/testing";
import {
  createEncounterSync,
  type ArtStep,
  type EncounterSync,
} from "./encounter-sync.js";
import { createFakeObr, type FakePick } from "./fake-adapter.js";
import type { Timers } from "./reconnecting-socket.js";
import { instanceIdOf, type EncounterInstance } from "./sync-plan.js";
import { createMessageFeed } from "./testing/messages.js";
import type { StoredTokenImage } from "./token-art.js";

const monster = (
  monsterKey: string,
  name: string,
  n: number,
): EncounterInstance =>
  makeTestInstance({
    id: `${monsterKey}-${n}`,
    monsterKey,
    displayName: `${name} ${n}`,
    createdAt: n,
  });

const ogre = (n: number) => monster("ogre", "Ogre", n);
const wolf = (n: number) => monster("wolf", "Wolf", 10 + n);

/** Wolf art with stored bytes and a url that answers. */
const storedWolfArt: PublishedTokenArt = {
  url: "https://cdn.owlbear.rodeo/assets/wolf.png",
  mime: "image/png",
  width: 300,
  height: 300,
  sha256: "c3".repeat(32),
};

const loadImage = (): Promise<StoredTokenImage> =>
  Promise.resolve({ bytes: new Uint8Array([1, 2, 3]), mime: "image/png" });

/** Timers that never fire: no retry runs behind the test's back. */
const idleTimers: Timers = {
  setTimeout: () => 1,
  clearTimeout: () => {},
};

/** Lets pending promise chains run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

/**
 * A sync over a fake scene whose picker calls `onPick` with the sync, then
 * answers `answer`; records each art step announced.
 */
function setup(
  options: {
    answer?: FakePick;
    onPick?: (sync: EncounterSync) => void;
    imageAlive?: boolean;
  } = {},
) {
  const steps: (ArtStep | undefined)[] = [];
  const errors: unknown[] = [];
  const answer = options.answer;
  const fake = createFakeObr(undefined, undefined, {
    imageAlive: options.imageAlive ?? true,
    pickImage: (search) => {
      options.onPick?.(sync);
      return typeof answer === "function"
        ? answer(search)
        : structuredClone(answer);
    },
  });
  // The picker runs after this, so it sees the sync.
  const sync: EncounterSync = createEncounterSync(
    fake.obr,
    (e) => errors.push(e),
    () => {},
    {
      timers: idleTimers,
      loadImage,
      onArtStep: (step) => steps.push(step),
    },
  );
  const tokens = () =>
    fake.scene.getItems().filter((item) => instanceIdOf(item) !== undefined);
  return { fake, sync, steps, errors, tokens };
}

describe("createEncounterSync fresh picks", () => {
  it("each fresh picker is announced through onArtStep with the monster name and its place among the reconcile's picks, and cleared once it resolves", async () => {
    const stepAtPick: (ArtStep | undefined)[] = [];
    const s = setup({
      onPick: () => stepAtPick.push(s.steps.at(-1)),
    });

    await s.sync.handleMessage(
      createMessageFeed().snapshot([ogre(1), ogre(2), wolf(1)]),
    );

    expect(s.fake.pickImageCalls()).toBe(2);
    // Announced before each picker opened.
    expect(stepAtPick).toEqual([
      { monsterName: "Ogre", index: 1, total: 2 },
      { monsterName: "Wolf", index: 2, total: 2 },
    ]);
    // Cleared after each picker resolved.
    expect(s.steps).toEqual([
      { monsterName: "Ogre", index: 1, total: 2 },
      undefined,
      { monsterName: "Wolf", index: 2, total: 2 },
      undefined,
    ]);
    expect(s.tokens()).toHaveLength(3);
    expect(s.errors).toEqual([]);
  });

  it("artWaits lists the types whose picker is open or still to open in the current reconcile as pick, and none once the pickers resolve", async () => {
    const waitsAtPick: TableArtWait[][] = [];
    const s = setup({
      onPick: (sync) => waitsAtPick.push(sync.artWaits()),
    });

    await s.sync.handleMessage(
      createMessageFeed().snapshot([ogre(1), wolf(1), wolf(2)]),
    );

    expect(waitsAtPick).toEqual([
      [
        { monsterKey: "ogre", monsterName: "Ogre", step: "pick" },
        { monsterKey: "wolf", monsterName: "Wolf", step: "pick" },
      ],
      [{ monsterKey: "wolf", monsterName: "Wolf", step: "pick" }],
    ]);
    expect(s.sync.artWaits()).toEqual([]);
    expect(s.tokens()).toHaveLength(3);
  });

  it("artWaits is empty when no picker is open and no type is listed for re-upload", async () => {
    const s = setup({ imageAlive: true });
    expect(s.sync.artWaits()).toEqual([]);

    await s.sync.handleMessage(
      createMessageFeed().snapshot([wolf(1), wolf(2)], {
        art: { wolf: storedWolfArt },
      }),
    );
    await settle();

    expect(s.sync.artWaits()).toEqual([]);
    expect(s.fake.pickImageCalls()).toBe(0);
    expect(s.tokens()).toHaveLength(2);
  });
});
