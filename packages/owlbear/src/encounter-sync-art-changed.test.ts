import { describe, expect, it } from "vitest";
import type {
  ChangeOrigin,
  PublishedTokenArt,
  TokenArt,
} from "@ttrpg-agents/engine";
import { makeTestInstance } from "@ttrpg-agents/engine/testing";
import {
  createEncounterSync,
  type Reupload,
  type TypeArt,
} from "./encounter-sync.js";
import { createFakeObr } from "./fake-adapter.js";
import type { ObrAdapter } from "./obr-adapter.js";
import { SCENE_ID_METADATA_KEY } from "./open-scene.js";
import type { Timers } from "./reconnecting-socket.js";
import { SceneModel, type SceneItem } from "./scene-model.js";
import {
  INSTANCE_METADATA_KEY,
  NAME_BASELINE_KEY,
  SYNCED_METADATA_KEY,
  instanceIdOf,
  type EncounterInstance,
} from "./sync-plan.js";
import { createMessageFeed, type MessageFeed } from "./testing/messages.js";

const NAMES: Record<string, string> = { wolf: "Wolf", goblin: "Goblin" };

const inst = (n: number, monsterKey = "wolf"): EncounterInstance =>
  makeTestInstance({
    id: `${monsterKey}-${n}`,
    monsterKey,
    displayName: `${NAMES[monsterKey] ?? monsterKey} ${n}`,
    createdAt: n,
  });

const mcp: ChangeOrigin = { source: "mcp", commandId: "agent-art" };
const table: ChangeOrigin = { source: "table", commandId: "gm-pick" };

const artFor = (name: string, sha256?: string): PublishedTokenArt => ({
  url: `https://cdn.owlbear.rodeo/assets/${name}.png`,
  mime: "image/png",
  width: 300,
  height: 280,
  ...(sha256 === undefined ? {} : { sha256 }),
});

/** The art the tokens are first drawn with. */
const oldArt = artFor("wolf-old");
/** The art the agent sets. */
const newArt = artFor("wolf-new");
/** What the GM picks from the panel. */
const repicked = artFor("wolf-repicked");

const OLD_SHA = "a1".repeat(32);
const NEW_SHA = "b2".repeat(32);

/** The re-upload row of a type whose stored image has the given hash. */
const reuploadRow = (monsterKey: string, sha256: string): Reupload => ({
  monsterKey,
  monsterName: NAMES[monsterKey] ?? monsterKey,
  assetName: `ttrpg-art-${sha256.slice(0, 16)}`,
  uploaded: false,
});

const redrawnNote = (name: string) =>
  `${name}'s token was redrawn with the art picked for its monster type.`;
const replacedNote = (name: string) =>
  `${name}'s token was replaced with a new one drawn with the art picked for its monster type; any attachments on the old token were deleted with it.`;

/** The image fields a token is drawn with. */
const pictureOf = ({ url, mime, width, height }: PublishedTokenArt) => ({
  url,
  mime,
  width,
  height,
});

/** Our own hidden circle for an instance, as an earlier session wrote it. */
const circleToken = (instance: EncounterInstance): SceneItem => ({
  id: `circle-${instance.id}`,
  type: "SHAPE",
  name: instance.displayName,
  visible: false,
  position: { x: 0, y: 0 },
  layer: "CHARACTER",
  shape: { shapeType: "CIRCLE", width: 150, height: 150 },
  metadata: {
    [INSTANCE_METADATA_KEY]: {
      instanceId: instance.id,
      encounterId: instance.encounterId,
    },
    [SYNCED_METADATA_KEY]: {
      [INSTANCE_METADATA_KEY]: {
        instanceId: instance.id,
        encounterId: instance.encounterId,
      },
      [NAME_BASELINE_KEY]: instance.displayName,
    },
  },
});

/** Timers that never fire, so a failed reconcile is not retried behind the test's back. */
const idleTimers: Timers = {
  setTimeout: () => 1,
  clearTimeout: () => {},
};

/** Lets pending promise chains and timers queued by the sync run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

/** A promise the test settles by hand. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** The store's art change for a monster type, as the bridge forwards it: no encounter. */
function artChanged(
  feed: MessageFeed,
  monsterKey: string,
  value: TokenArt,
  origin: ChangeOrigin = mcp,
) {
  return feed.event(
    { type: "art-changed", monsterKey, art: value, origin },
    { encounterId: null },
  );
}

/** What the picker does when opened: answer art, or cancel. */
type Answer = () =>
  PublishedTokenArt | undefined | Promise<PublishedTokenArt | undefined>;

function setup(
  options: {
    scene?: SceneModel;
    /** Whether an image url answers, per url. Default: alive. */
    imageAlive?: (url: string) => boolean | Promise<boolean>;
  } = {},
) {
  const overrides: string[] = [];
  const reported: [string, PublishedTokenArt][] = [];
  const reuploads: Reupload[][] = [];
  const typeArt: TypeArt[][] = [];
  const errors: unknown[] = [];
  const writes: string[] = [];
  const loads: string[] = [];
  let storeChanges = 0;
  // The picker cancels until a test sets an answer.
  let answer: Answer = () => undefined;
  const fake = createFakeObr(options.scene, undefined, {
    imageAlive: options.imageAlive ?? true,
    pickImage: () => answer(),
  });
  const base = fake.obr;
  const obr: ObrAdapter = {
    ...base,
    addItems: (items) => (writes.push("addItems"), base.addItems(items)),
    updateItems: (ids, patch) => (
      writes.push("updateItems"),
      base.updateItems(ids, patch)
    ),
    setItemMetadata: (update) => (
      writes.push("setItemMetadata"),
      base.setItemMetadata(update)
    ),
    deleteItems: (ids) => (writes.push("deleteItems"), base.deleteItems(ids)),
    setSceneMetadata: (update) => (
      writes.push("setSceneMetadata"),
      base.setSceneMetadata(update)
    ),
  };
  const sync = createEncounterSync(
    obr,
    (e) => errors.push(e),
    () => {},
    {
      timers: idleTimers,
      send: (message) => {
        if (message.type === "token-art-set")
          reported.push([message.payload.monsterKey, message.payload.art]);
        return true;
      },
      loadImage: (sha256) => {
        loads.push(sha256);
        return Promise.resolve({
          bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2]),
          mime: "image/png",
        });
      },
      onOverride: (text) => overrides.push(text),
      onReuploadsChange: (list) => reuploads.push(structuredClone(list)),
      onTypeArtChange: (list) => typeArt.push(structuredClone(list)),
      onStoreChange: () => storeChanges++,
    },
  );
  const tokenOf = (instanceId: string) =>
    fake.scene.getItems().find((item) => instanceIdOf(item) === instanceId);
  return {
    fake,
    sync,
    overrides,
    reported,
    errors,
    writes,
    loads,
    storeChanges: () => storeChanges,
    tokenOf,
    /** The re-upload list as last reported; empty before any report. */
    listed: () => reuploads.at(-1) ?? [],
    /** The state of one type in the Token art list as last reported. */
    stateOf: (monsterKey: string) =>
      (typeArt.at(-1) ?? []).find((row) => row.monsterKey === monsterKey)
        ?.state,
    answer: (next: Answer) => {
      answer = next;
    },
  };
}

/** Expects one IMAGE token per instance id, drawn with `value`. */
function expectImages(
  tokenOf: (id: string) => SceneItem | undefined,
  ids: string[],
  value: PublishedTokenArt,
): void {
  for (const id of ids)
    expect(tokenOf(id), id).toMatchObject({
      type: "IMAGE",
      image: pictureOf(value),
    });
}

/** A sync whose wolves are drawn with `oldArt`. */
async function drawnWolves(ids: number[] = [1, 2]) {
  const feed = createMessageFeed();
  const s = setup();
  await s.sync.handleMessage(
    feed.snapshot(
      ids.map((n) => inst(n)),
      { art: { wolf: oldArt } },
    ),
  );
  await settle();
  expectImages(
    s.tokenOf,
    ids.map((n) => `wolf-${n}`),
    oldArt,
  );
  return { ...s, feed };
}

describe("createEncounterSync art-changed", () => {
  it("an mcp art-changed for a type with circle and image tokens redraws them with the art in the next reconcile, each listed under the overrides", async () => {
    const feed = createMessageFeed();
    const scene = new SceneModel();
    scene.addItems([circleToken(inst(1))]);
    const s = setup({ scene });
    await s.sync.handleMessage(
      feed.snapshot([inst(1), inst(2)], { art: { wolf: oldArt } }),
    );
    await settle();
    expect(s.tokenOf("wolf-1")).toMatchObject({
      id: "circle-wolf-1",
      type: "SHAPE",
    });
    expectImages(s.tokenOf, ["wolf-2"], oldArt);
    const imageId = s.tokenOf("wolf-2")?.id;
    const before = s.overrides.length;

    await s.sync.handleMessage(artChanged(feed, "wolf", newArt));
    await settle();

    expectImages(s.tokenOf, ["wolf-1", "wolf-2"], newArt);
    expect(s.tokenOf("wolf-1")?.id).not.toBe("circle-wolf-1");
    expect(s.tokenOf("wolf-2")?.id).toBe(imageId);
    const notes = s.overrides.slice(before);
    expect(notes).toHaveLength(2);
    expect(notes).toEqual(
      expect.arrayContaining([
        replacedNote("Wolf 1"),
        redrawnNote("Wolf 2"),
      ]) as string[],
    );
    // The agent's art is the store's already: nothing is sent back.
    expect(s.reported).toEqual([]);
    expect(s.fake.pickImageCalls()).toBe(0);
    expect(s.errors).toEqual([]);
  });

  it("after an mcp art-changed a new token of the type is drawn with the art", async () => {
    const s = await drawnWolves([1]);

    await s.sync.handleMessage(artChanged(s.feed, "wolf", newArt));
    await s.sync.handleMessage(
      s.feed.event({ type: "added", instances: [inst(2)], origin: mcp }),
    );
    await settle();

    expectImages(s.tokenOf, ["wolf-1", "wolf-2"], newArt);
    expect(s.fake.pickImageCalls()).toBe(0);
    expect(s.errors).toEqual([]);
  });

  it("an mcp art-changed with art without a url lists the type for upload and leaves its tokens unchanged", async () => {
    const s = await drawnWolves();
    const tokens = s.fake.scene.getItems();
    const before = s.overrides.length;

    await s.sync.handleMessage(artChanged(s.feed, "wolf", { sha256: NEW_SHA }));
    await settle();

    expect(s.listed()).toEqual([reuploadRow("wolf", NEW_SHA)]);
    expect(s.sync.artWaits()).toEqual([
      { monsterKey: "wolf", monsterName: "Wolf", step: "reupload" },
    ]);
    expect(s.fake.scene.getItems()).toEqual(tokens);
    expect(s.overrides.slice(before)).toEqual([]);
    expect(s.fake.pickImageCalls()).toBe(0);
    expect(s.fake.uploads()).toEqual([]);
    expect(s.errors).toEqual([]);
  });

  it("a table art-changed writes nothing to the scene and leaves the type's art as it was", async () => {
    const s = await drawnWolves([1]);
    const tokens = s.fake.scene.getItems();
    const changes = s.storeChanges();
    s.writes.length = 0;

    await s.sync.handleMessage(artChanged(s.feed, "wolf", newArt, table));
    await settle();

    expect(s.writes).toEqual([]);
    expect(s.fake.scene.getItems()).toEqual(tokens);
    expect(s.storeChanges()).toBe(changes);

    // A token added afterwards is drawn with the art the type had.
    await s.sync.handleMessage(
      s.feed.event({ type: "added", instances: [inst(2)], origin: mcp }),
    );
    await settle();

    expectImages(s.tokenOf, ["wolf-1", "wolf-2"], oldArt);
    expect(s.reported).toEqual([]);
    expect(s.errors).toEqual([]);
  });

  it("an mcp art-changed replaces art the GM picked from the panel this session", async () => {
    const s = await drawnWolves();
    s.answer(() => structuredClone(repicked));
    await s.sync.repickArt("wolf");
    await settle();
    expectImages(s.tokenOf, ["wolf-1", "wolf-2"], repicked);
    const before = s.overrides.length;

    await s.sync.handleMessage(artChanged(s.feed, "wolf", newArt));
    await settle();

    expectImages(s.tokenOf, ["wolf-1", "wolf-2"], newArt);
    expect(s.overrides.slice(before)).toEqual([
      redrawnNote("Wolf 1"),
      redrawnNote("Wolf 2"),
    ]);
    // Only the GM's own pick was sent.
    expect(s.reported).toEqual([["wolf", repicked]]);
    expect(s.stateOf("wolf")).toBe("art");
    expect(s.errors).toEqual([]);
  });

  it("an mcp art-changed draws a type whose fresh pick the GM declined this session", async () => {
    const feed = createMessageFeed();
    const s = setup();
    await s.sync.handleMessage(
      feed.snapshot([inst(1, "goblin"), inst(2, "goblin")]),
    );
    await settle();
    expect(s.fake.pickImageCalls()).toBe(1);
    expect(s.stateOf("goblin")).toBe("declined");
    for (const id of ["goblin-1", "goblin-2"])
      expect(s.tokenOf(id), id).toMatchObject({ type: "SHAPE" });
    const before = s.overrides.length;

    await s.sync.handleMessage(artChanged(feed, "goblin", newArt));
    await settle();

    expectImages(s.tokenOf, ["goblin-1", "goblin-2"], newArt);
    expect(s.overrides.slice(before)).toEqual([
      replacedNote("Goblin 1"),
      replacedNote("Goblin 2"),
    ]);
    expect(s.stateOf("goblin")).toBe("art");
    expect(s.fake.pickImageCalls()).toBe(1);
    expect(s.errors).toEqual([]);
  });

  it("an mcp art-changed whose url no longer answers lists the type for re-upload", async () => {
    const deadArt = artFor("wolf-dead", NEW_SHA);
    const feed = createMessageFeed();
    const s = setup({ imageAlive: (url) => url !== deadArt.url });
    await s.sync.handleMessage(
      feed.snapshot([inst(1)], { art: { wolf: oldArt } }),
    );
    await settle();
    expect(s.listed()).toEqual([]);

    await s.sync.handleMessage(artChanged(feed, "wolf", deadArt));
    await settle();

    expect(s.listed()).toEqual([reuploadRow("wolf", NEW_SHA)]);
    expect(s.sync.artWaits()).toEqual([
      { monsterKey: "wolf", monsterName: "Wolf", step: "reupload" },
    ]);
    expect(s.stateOf("wolf")).toBe("reupload");
    expect(s.tokenOf("wolf-1")?.image?.url).not.toBe(deadArt.url);
    expect(s.fake.pickImageCalls()).toBe(0);
    expect(s.errors).toEqual([]);
  });

  it("a liveness check of the replaced art that ends after an mcp art-changed leaves the new art drawn and lists nothing", async () => {
    const replaced = artFor("wolf-replaced", OLD_SHA);
    const oldCheck = deferred<boolean>();
    const feed = createMessageFeed();
    const s = setup({
      imageAlive: (url) => (url === replaced.url ? oldCheck.promise : true),
    });

    // The snapshot's reconcile waits for the replaced art's check.
    const snapshotApplied = s.sync.handleMessage(
      feed.snapshot([inst(1), inst(2)], { art: { wolf: replaced } }),
    );
    await settle();
    const eventApplied = s.sync.handleMessage(
      artChanged(feed, "wolf", artFor("wolf-new", NEW_SHA)),
    );
    await settle();
    oldCheck.resolve(false);
    await snapshotApplied;
    await eventApplied;
    await settle();

    expectImages(s.tokenOf, ["wolf-1", "wolf-2"], newArt);
    expect(s.listed()).toEqual([]);
    expect(s.sync.artWaits()).toEqual([]);
    expect(s.stateOf("wolf")).toBe("art");
    expect(s.errors).toEqual([]);
  });

  it("a Pick art pick that resolves after an mcp art-changed wins", async () => {
    const s = await drawnWolves();
    const pick = deferred<PublishedTokenArt | undefined>();
    s.answer(() => pick.promise);
    const picking = s.sync.repickArt("wolf");
    await settle();

    await s.sync.handleMessage(artChanged(s.feed, "wolf", newArt));
    await settle();
    pick.resolve(structuredClone(repicked));
    await picking;
    await settle();

    expectImages(s.tokenOf, ["wolf-1", "wolf-2"], repicked);
    expect(s.reported).toEqual([["wolf", repicked]]);
    expect(s.stateOf("wolf")).toBe("art");
    expect(s.errors).toEqual([]);
  });

  it("a type whose published art arrived by an mcp art-changed before its added event gets no fresh picker and its token is drawn with the art", async () => {
    const feed = createMessageFeed();
    const s = setup();
    await s.sync.handleMessage(feed.snapshot([]));
    await settle();

    await s.sync.handleMessage(artChanged(feed, "wolf", newArt));
    await s.sync.handleMessage(
      feed.event({ type: "added", instances: [inst(1)], origin: mcp }),
    );
    await settle();

    expect(s.fake.pickImageCalls()).toBe(0);
    expectImages(s.tokenOf, ["wolf-1"], newArt);
    expect(s.stateOf("wolf")).toBe("art");
    expect(s.errors).toEqual([]);
  });

  it("a type whose art without a url arrived by an mcp art-changed before its added event gets no fresh picker and is listed for upload", async () => {
    const feed = createMessageFeed();
    const s = setup();
    await s.sync.handleMessage(feed.snapshot([]));
    await settle();

    await s.sync.handleMessage(artChanged(feed, "wolf", { sha256: NEW_SHA }));
    await s.sync.handleMessage(
      feed.event({ type: "added", instances: [inst(1)], origin: mcp }),
    );
    await settle();

    expect(s.fake.pickImageCalls()).toBe(0);
    expect(s.listed()).toEqual([reuploadRow("wolf", NEW_SHA)]);
    expect(s.tokenOf("wolf-1")).toMatchObject({ type: "SHAPE" });
    expect(s.errors).toEqual([]);
  });

  it("an mcp art-changed while the open scene is not the held encounter's redraws nothing until that scene is reconciled", async () => {
    const s = await drawnWolves();
    const wolfIds = [s.tokenOf("wolf-1")?.id, s.tokenOf("wolf-2")?.id];
    const foreign: SceneItem = {
      id: "map",
      type: "IMAGE",
      name: "Map",
      visible: true,
      position: { x: 0, y: 0 },
      metadata: {},
    };
    const other = {
      items: [foreign],
      metadata: { [SCENE_ID_METADATA_KEY]: "s2" },
    };
    const left = s.fake.scene.switchScene(other);
    await settle();
    s.writes.length = 0;
    const before = s.overrides.length;

    await s.sync.handleMessage(artChanged(s.feed, "wolf", newArt));
    await settle();

    expect(s.writes).toEqual([]);
    expect(s.fake.scene.getItems()).toEqual([foreign]);
    expect(s.overrides.slice(before)).toEqual([]);

    // Back on the held encounter's scene, with no other snapshot between.
    s.fake.scene.switchScene(left);
    await settle();

    expectImages(s.tokenOf, ["wolf-1", "wolf-2"], newArt);
    expect([s.tokenOf("wolf-1")?.id, s.tokenOf("wolf-2")?.id]).toEqual(wolfIds);
    expect(s.overrides.slice(before)).toEqual([
      redrawnNote("Wolf 1"),
      redrawnNote("Wolf 2"),
    ]);
    expect(s.errors).toEqual([]);
  });

  it("a fresh picker the GM cancels after an mcp art-changed for its type leaves the agent's art usable and its token drawn with it", async () => {
    const feed = createMessageFeed();
    const s = setup();
    const pick = deferred<PublishedTokenArt | undefined>();
    s.answer(() => pick.promise);

    const snapshotApplied = s.sync.handleMessage(
      feed.snapshot([inst(1, "goblin")]),
    );
    await settle();
    expect(s.fake.pickImageCalls()).toBe(1);

    const eventApplied = s.sync.handleMessage(
      artChanged(feed, "goblin", newArt),
    );
    await settle();
    pick.resolve(undefined);
    await snapshotApplied;
    await eventApplied;
    await settle();

    expectImages(s.tokenOf, ["goblin-1"], newArt);
    expect(s.stateOf("goblin")).toBe("art");
    expect(s.fake.pickImageCalls()).toBe(1);
    expect(s.reported).toEqual([]);
    expect(s.errors).toEqual([]);
  });
});
