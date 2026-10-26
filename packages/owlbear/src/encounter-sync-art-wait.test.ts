import { describe, expect, it } from "vitest";
import type { PublishedTokenArt, TokenArt } from "@ttrpg-agents/engine";
import { makeTestInstance } from "@ttrpg-agents/engine/testing";
import type { BridgeMessage } from "@ttrpg-agents/protocol";
import { createEncounterSync } from "./encounter-sync.js";
import { createFakeObr, type FakePick } from "./fake-adapter.js";
import type { ObrAdapter } from "./obr-adapter.js";
import type { Timers } from "./reconnecting-socket.js";
import type { SceneModel } from "./scene-model.js";
import { STAT_BUBBLES_METADATA_KEY } from "./stat-bubbles.js";
import {
  PLACED_METADATA_KEY,
  instanceIdOf,
  type EncounterInstance,
} from "./sync-plan.js";
import { createMessageFeed } from "./testing/messages.js";
import type { StoredTokenImage } from "./token-art.js";

const goblin = (currentHp = 10): EncounterInstance =>
  makeTestInstance({
    id: "goblin-1",
    monsterKey: "goblin",
    displayName: "Goblin 1",
    maxHp: 16,
    currentHp,
    armorClass: 12,
    createdAt: 1,
  });

const shadow = (): EncounterInstance =>
  makeTestInstance({
    id: "shadow-1",
    monsterKey: "shadow",
    displayName: "Shadow 1",
    createdAt: 2,
  });

/** Published goblin art with no stored bytes: used as is, never checked. */
const goblinArt: PublishedTokenArt = {
  url: "https://cdn.owlbear.rodeo/assets/goblin.png",
  mime: "image/png",
  width: 200,
  height: 200,
};

/** Shadow art with stored bytes; whether its url is alive is up to each test. */
const storedShadowArt: PublishedTokenArt = {
  url: "https://cdn.owlbear.rodeo/assets/shadow-old.png",
  mime: "image/png",
  width: 300,
  height: 280,
  sha256: "c3".repeat(32),
};

/** What the GM picks for the shadow. */
const pickedShadowArt: PublishedTokenArt = {
  url: "https://cdn.owlbear.rodeo/assets/shadow-new.png",
  mime: "image/png",
  width: 256,
  height: 256,
};

const STORED_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7, 7,
]);

const loadImage = (): Promise<StoredTokenImage> =>
  Promise.resolve({ bytes: STORED_BYTES.slice(), mime: "image/png" });

/** Timers that never fire, so held table edits are not sent behind the test's back. */
const idleTimers: Timers = {
  setTimeout: () => 1,
  clearTimeout: () => {},
};

const helloAck: BridgeMessage = {
  v: 1,
  type: "hello-ack",
  payload: { serverVersion: "0" },
};

/** Lets pending promise chains and follow-up reconciles run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

const tokenOf = (scene: SceneModel, instanceId: string) =>
  scene.getItems().find((item) => instanceIdOf(item) === instanceId);

const bubblesOf = (scene: SceneModel, instanceId: string) =>
  tokenOf(scene, instanceId)?.metadata[STAT_BUBBLES_METADATA_KEY] as
    Record<string, unknown> | undefined;

/** Edits a token's Stat Bubbles at the table, as the GM or a player would. */
function editAtTable(
  scene: SceneModel,
  instanceId: string,
  fields: Record<string, unknown>,
): void {
  const token = tokenOf(scene, instanceId);
  if (token === undefined) throw new Error(`no token for ${instanceId}`);
  scene.setItemMetadata([
    {
      id: token.id,
      key: STAT_BUBBLES_METADATA_KEY,
      value: { ...bubblesOf(scene, instanceId), ...fields },
    },
  ]);
}

/** A sync over a fake scene that counts its scene reads. */
function setup(
  options: {
    pickImage?: FakePick;
    imageAlive?: boolean;
    awaitUploadConfirmed?: () => Promise<void>;
  } = {},
) {
  const fake = createFakeObr(undefined, undefined, {
    ...(options.pickImage === undefined
      ? {}
      : { pickImage: options.pickImage }),
    imageAlive: options.imageAlive ?? true,
  });
  const reads = { items: 0, placed: 0 };
  const obr: ObrAdapter = {
    ...fake.obr,
    getItems: (filter) => (reads.items++, fake.obr.getItems(filter)),
    getSceneMetadata: () => (reads.placed++, fake.obr.getSceneMetadata()),
  };
  const sent: BridgeMessage[] = [];
  const errors: unknown[] = [];
  const confirm = options.awaitUploadConfirmed;
  const sync = createEncounterSync(
    obr,
    (e) => errors.push(e),
    () => {},
    {
      timers: idleTimers,
      send: (message) => {
        sent.push(message);
        return true;
      },
      loadImage,
      awaitUploadConfirmed: () =>
        confirm === undefined ? Promise.resolve() : confirm(),
    },
  );
  const resetReads = () => {
    reads.items = 0;
    reads.placed = 0;
  };
  return { fake, scene: fake.scene, sync, reads, resetReads, sent, errors };
}

describe("createEncounterSync scene reads around art dialogs", () => {
  it("a Stat Bubbles edit made on the table while the picker is open is not overwritten by that reconcile's writes", async () => {
    const feed = createMessageFeed();
    let editWhilePicking = (): void => {};
    const s = setup({
      pickImage: () => {
        editWhilePicking();
        return pickedShadowArt;
      },
    });
    await s.sync.handleMessage(
      feed.snapshot([goblin()], { art: { goblin: goblinArt } }),
    );
    await settle();
    expect(bubblesOf(s.scene, "goblin-1")).toEqual({
      health: 10,
      "max health": 16,
      "armor class": 12,
      hide: true,
    });

    editWhilePicking = () =>
      editAtTable(s.scene, "goblin-1", { "armor class": 15 });
    await s.sync.handleMessage(helloAck);
    await s.sync.handleMessage(
      feed.snapshot([goblin(7), shadow()], { art: { goblin: goblinArt } }),
    );
    await settle();

    expect(s.fake.pickImageCalls()).toBe(1);
    expect(bubblesOf(s.scene, "goblin-1")).toMatchObject({
      health: 7,
      "armor class": 15,
    });
  });

  it("a Stat Bubbles edit made on the table while a republish waits for the GM is not overwritten by that reconcile's writes", async () => {
    const feed = createMessageFeed();
    let editWhileWaiting = (): void => {};
    const s = setup({
      imageAlive: false,
      pickImage: pickedShadowArt,
      awaitUploadConfirmed: () => {
        editWhileWaiting();
        return Promise.resolve();
      },
    });
    await s.sync.handleMessage(
      feed.snapshot([goblin()], { art: { goblin: goblinArt } }),
    );
    await settle();
    expect(bubblesOf(s.scene, "goblin-1")).toMatchObject({
      "armor class": 12,
    });

    editWhileWaiting = () =>
      editAtTable(s.scene, "goblin-1", { "armor class": 15 });
    await s.sync.handleMessage(helloAck);
    await s.sync.handleMessage(
      feed.snapshot([goblin(7), shadow()], {
        art: { goblin: goblinArt, shadow: storedShadowArt },
      }),
    );
    await settle();

    expect(s.fake.uploads()).toHaveLength(1);
    expect(s.fake.pickImageCalls()).toBe(1);
    expect(bubblesOf(s.scene, "goblin-1")).toMatchObject({
      health: 7,
      "armor class": 15,
    });
  });

  it("the scene items and the placed record are read once by a reconcile that runs no art step, and again after a fresh pick or a stored-art check", async () => {
    // No art step: art with no stored bytes, then an hp change.
    const plain = setup();
    const plainFeed = createMessageFeed();
    await plain.sync.handleMessage(
      plainFeed.snapshot([goblin()], { art: { goblin: goblinArt } }),
    );
    await settle();
    expect(plain.reads).toEqual({ items: 1, placed: 1 });
    plain.resetReads();
    await plain.sync.handleMessage(
      plainFeed.event({
        type: "hp-changed",
        id: "goblin-1",
        currentHp: 5,
        maxHp: 16,
      }),
    );
    await settle();
    expect(bubblesOf(plain.scene, "goblin-1")).toMatchObject({ health: 5 });
    expect(plain.reads).toEqual({ items: 1, placed: 1 });

    const readsForShadow = async (
      s: ReturnType<typeof setup>,
      art: Record<string, TokenArt> | undefined,
    ) => {
      await s.sync.handleMessage(
        createMessageFeed().snapshot(
          [shadow()],
          art === undefined ? {} : { art },
        ),
      );
      await settle();
      expect(tokenOf(s.scene, "shadow-1")).toBeDefined();
      return s.reads;
    };

    // A fresh pick.
    const picked = setup({ pickImage: pickedShadowArt });
    expect(await readsForShadow(picked, undefined)).toEqual({
      items: 2,
      placed: 2,
    });
    expect(picked.fake.pickImageCalls()).toBe(1);

    // A liveness check that finds the stored art alive.
    const alive = setup({ imageAlive: true });
    expect(await readsForShadow(alive, { shadow: storedShadowArt })).toEqual({
      items: 2,
      placed: 2,
    });
    expect(alive.fake.pickImageCalls()).toBe(0);

    // A republish: dead url, stored bytes.
    const republished = setup({
      imageAlive: false,
      pickImage: pickedShadowArt,
    });
    expect(
      await readsForShadow(republished, { shadow: storedShadowArt }),
    ).toEqual({ items: 2, placed: 2 });
    expect(republished.fake.uploads()).toHaveLength(1);
  });

  it("a scene switched while the picker is open gets its tokens and reports no instance deleted", async () => {
    const feed = createMessageFeed();
    let switchWhilePicking = (): void => {};
    const s = setup({
      pickImage: () => {
        switchWhilePicking();
        return pickedShadowArt;
      },
    });
    await s.sync.handleMessage(
      feed.snapshot([goblin()], { art: { goblin: goblinArt } }),
    );
    await settle();
    expect(tokenOf(s.scene, "goblin-1")).toBeDefined();

    switchWhilePicking = () => {
      s.scene.setReady(false);
      s.scene.deleteItems(s.scene.getItems().map((item) => item.id));
      s.scene.setMetadata({ [PLACED_METADATA_KEY]: [] });
      s.scene.setReady(true);
    };
    await s.sync.handleMessage(
      feed.event({ type: "added", instances: [shadow()] }),
    );
    await settle();
    await settle();

    expect(tokenOf(s.scene, "goblin-1")).toBeDefined();
    expect(tokenOf(s.scene, "shadow-1")).toBeDefined();
    expect(s.sent.filter((m) => m.type === "token-deleted")).toEqual([]);
  });

  it("art without a url published on first use also reads the scene again", async () => {
    const feed = createMessageFeed();
    const s = setup({ pickImage: pickedShadowArt });
    await s.sync.handleMessage(
      feed.snapshot([shadow()], {
        art: { shadow: { sha256: "c3".repeat(32) } },
      }),
    );
    await settle();

    expect(tokenOf(s.scene, "shadow-1")).toBeDefined();
    expect(s.reads).toEqual({ items: 2, placed: 2 });
    expect(s.fake.uploads()).toHaveLength(1);
  });
});
